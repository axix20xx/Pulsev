import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

type AwgConfig = {
  apiUrl: string;
  apiToken: string;
};

export class AwgApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwgApiError";
  }
}

async function config(): Promise<AwgConfig | null> {
  const result = await pool.query<{ awg_api_url: string | null; awg_api_token: string | null }>(
    `SELECT awg_api_url, awg_api_token
     FROM settings
     WHERE NULLIF(awg_api_url, '') IS NOT NULL
       AND NULLIF(awg_api_token, '') IS NOT NULL
     LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row?.awg_api_url || !row.awg_api_token) return null;
  const apiUrl = /^https?:\/\//i.test(row.awg_api_url) ? row.awg_api_url : `https://${row.awg_api_url}`;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    apiToken: row.awg_api_token,
  };
}

async function request(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<{ configured: boolean; status: number; text: string }> {
  const awg = await config();
  if (!awg) return { configured: false, status: 0, text: "" };
  const response = await fetch(`${awg.apiUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${awg.apiToken}`,
      Accept: "application/json, text/plain",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return {
    configured: true,
    status: response.status,
    text: await response.text(),
  };
}

export async function createAwgClient(): Promise<{
  configured: boolean;
  clientId: string | null;
  error: string | null;
}> {
  const clientId = randomUUID();
  try {
    const response = await request("POST", "/api/clients", { id: clientId });
    if (!response.configured) {
      return {
        configured: false,
        clientId: null,
        error: "AmneziaWG API is not configured in settings.",
      };
    }
    if (response.status < 200 || response.status >= 300) {
      return {
        configured: true,
        clientId: null,
        error: `AmneziaWG returned HTTP ${response.status}`,
      };
    }
    return { configured: true, clientId, error: null };
  } catch {
    return {
      configured: true,
      clientId: null,
      error: "AmneziaWG API is unavailable.",
    };
  }
}

export async function getAwgConfiguration(clientId: string): Promise<string> {
  const response = await request(
    "GET",
    `/api/clients/${encodeURIComponent(clientId)}/configuration`,
  );
  if (!response.configured) {
    throw new AwgApiError("AmneziaWG API is not configured.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AwgApiError(`AmneziaWG returned HTTP ${response.status}`);
  }
  if (!response.text.trim()) throw new AwgApiError("AmneziaWG returned an empty configuration.");
  return response.text;
}

export async function getAwgStats(clientId: string): Promise<{ rxBytes: number; txBytes: number }> {
  const response = await request("GET", `/api/clients/${encodeURIComponent(clientId)}/stats`);
  if (!response.configured) throw new AwgApiError("AmneziaWG API is not configured.");
  if (response.status < 200 || response.status >= 300) {
    throw new AwgApiError(`AmneziaWG returned HTTP ${response.status}`);
  }
  let payload: any = {};
  try { payload = JSON.parse(response.text); } catch { /* The endpoint must return JSON for usage sync. */ }
  const rxBytes = Number(payload?.rx_bytes ?? payload?.rx ?? payload?.received ?? 0);
  const txBytes = Number(payload?.tx_bytes ?? payload?.tx ?? payload?.sent ?? 0);
  if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) {
    throw new AwgApiError("AmneziaWG returned invalid usage statistics.");
  }
  return { rxBytes: Math.max(0, Math.round(rxBytes)), txBytes: Math.max(0, Math.round(txBytes)) };
}

export async function disableAwgClient(clientId: string): Promise<boolean> {
  try {
    const response = await request("DELETE", `/api/clients/${encodeURIComponent(clientId)}`);
    return response.status >= 200 && response.status < 300 || response.status === 404;
  } catch {
    return false;
  }
}

export async function recreateAwgClient(clientId: string): Promise<void> {
  try {
    await request("DELETE", `/api/clients/${encodeURIComponent(clientId)}`);
  } catch {
    // Continue with create, matching the legacy renewal worker.
  }
  const response = await request("POST", "/api/clients", { id: clientId });
  if (!response.configured) throw new AwgApiError("AmneziaWG API is not configured.");
  if (response.status < 200 || response.status >= 300) {
    throw new AwgApiError(`AmneziaWG returned HTTP ${response.status}`);
  }
}