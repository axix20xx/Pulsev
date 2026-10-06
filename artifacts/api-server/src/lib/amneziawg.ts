import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

type AwgConfig = {
  apiUrl: string;
  apiToken: string;
};

export class AwgApiError extends Error {
  constructor(
    message: string,
    readonly kind?: "stats-route-unavailable",
  ) {
    super(message);
    this.name = "AwgApiError";
  }
}

const AWG_STATS_ROUTE_COOLDOWN_MS = 5 * 60_000;
const statsEndpointByApiUrl = new Map<string, string>();
const statsRouteUnavailableUntil = new Map<string, number>();

function responseError(status: number, text: string): string {
  const raw = text.trim();
  if (!raw) return `AmneziaWG returned HTTP ${status}`;
  let detail = raw;
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    detail = String(payload.detail ?? payload.error ?? payload.message ?? raw);
  } catch {
    // Keep the provider's plain-text response.
  }
  return `AmneziaWG returned HTTP ${status}: ${detail.replace(/\s+/g, " ").slice(0, 400)}`;
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
  const apiUrl = /^https?:\/\//i.test(row.awg_api_url) ? row.awg_api_url : `http://${row.awg_api_url}`;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    apiToken: row.awg_api_token,
  };
}

async function request(
  method: string,
  endpoint: string,
  body?: unknown,
  configured?: AwgConfig | null,
): Promise<{ configured: boolean; status: number; text: string }> {
  const awg = configured === undefined ? await config() : configured;
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

async function confirmAwgClient(clientId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    try {
      const response = await request("GET", "/api/clients");
      if (!response.configured || response.status < 200 || response.status >= 300) continue;
      const payload = JSON.parse(response.text) as unknown;
      const clients = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as { clients?: unknown }).clients)
          ? (payload as { clients: unknown[] }).clients
          : [];
      if (clients.some((client) =>
        client && typeof client === "object" && String((client as { id?: unknown }).id ?? "") === clientId
      )) {
        return true;
      }
    } catch {
      // A failed reconciliation check should preserve the original create error.
    }
  }
  return false;
}

export async function createAwgClient(requestedClientId?: string): Promise<{
  configured: boolean;
  clientId: string | null;
  error: string | null;
}> {
  const clientId = requestedClientId || randomUUID();
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
      if (response.status >= 500 && await confirmAwgClient(clientId)) {
        return { configured: true, clientId, error: null };
      }
      return {
        configured: true,
        clientId: null,
        error: responseError(response.status, response.text),
      };
    }
    return { configured: true, clientId, error: null };
  } catch {
    if (await confirmAwgClient(clientId)) {
      return { configured: true, clientId, error: null };
    }
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
    throw new AwgApiError(responseError(response.status, response.text));
  }
  if (!response.text.trim()) throw new AwgApiError("AmneziaWG returned an empty configuration.");
  return response.text;
}

export async function getAwgStats(clientId: string): Promise<{ rxBytes: number; txBytes: number }> {
  const awg = await config();
  if (!awg) throw new AwgApiError("AmneziaWG API is not configured.");

  const unavailableUntil = statsRouteUnavailableUntil.get(awg.apiUrl) ?? 0;
  if (unavailableUntil > Date.now()) {
    throw new AwgApiError(
      "AmneziaWG stats routes are temporarily unavailable after repeated route-level 404 responses.",
      "stats-route-unavailable",
    );
  }
  statsRouteUnavailableUntil.delete(awg.apiUrl);

  const encodedId = encodeURIComponent(clientId);
  const routeCandidates = [
    `/api/clients/${encodedId}/stats`,
    `/api/clients/${encodedId}`,
    `/api/client/${encodedId}`,
    `/api/client/${encodedId}/stats`,
    `/api/stats/${encodedId}`,
  ];
  const preferredEndpoint = statsEndpointByApiUrl.get(awg.apiUrl);
  const endpoints = preferredEndpoint
    ? [preferredEndpoint, ...routeCandidates.filter((endpoint) => endpoint !== preferredEndpoint)]
    : routeCandidates;
  let response: Awaited<ReturnType<typeof request>> | null = null;
  let routeNotFoundCount = 0;
  for (const endpoint of endpoints) {
    const candidate = await request("GET", endpoint, undefined, awg);
    if (!candidate.configured) throw new AwgApiError("AmneziaWG API is not configured.");
    response = candidate;
    if (candidate.status >= 200 && candidate.status < 300) {
      statsEndpointByApiUrl.set(awg.apiUrl, endpoint);
      break;
    }
    if (
      candidate.status === 404 &&
      /^404 page not found$/i.test(candidate.text.trim())
    ) {
      routeNotFoundCount += 1;
      if (endpoint === preferredEndpoint) statsEndpointByApiUrl.delete(awg.apiUrl);
      continue;
    }
    if (candidate.status !== 404 && candidate.status !== 405) break;
  }
  if (!response || response.status < 200 || response.status >= 300) {
    if (routeNotFoundCount === endpoints.length) {
      statsRouteUnavailableUntil.set(awg.apiUrl, Date.now() + AWG_STATS_ROUTE_COOLDOWN_MS);
      throw new AwgApiError(
        "All supported AmneziaWG stats routes returned a route-level 404.",
        "stats-route-unavailable",
      );
    }
    throw new AwgApiError(
      response
        ? responseError(response.status, response.text)
        : "AmneziaWG returned HTTP 0",
    );
  }
  let payload: any;
  try {
    payload = JSON.parse(response.text);
  } catch {
    throw new AwgApiError("AmneziaWG returned non-JSON usage statistics.");
  }

  const candidates: Record<string, unknown>[] = [];
  const collect = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== "object" || depth > 3) return;
    if (Array.isArray(value)) {
      for (const item of value) collect(item, depth + 1);
      return;
    }
    candidates.push(value as Record<string, unknown>);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collect(nested, depth + 1);
    }
  };
  collect(payload);
  const readNumber = (keys: string[]): number | null => {
    for (const candidate of candidates) {
      for (const key of keys) {
        const value = Number(candidate[key]);
        if (Number.isFinite(value) && value >= 0) return value;
      }
    }
    return null;
  };
  const rxBytes = readNumber(["rx_bytes", "rxBytes", "rx", "received", "received_bytes", "receive", "download_bytes", "download", "transfer_rx", "transferRx"]);
  const txBytes = readNumber(["tx_bytes", "txBytes", "tx", "sent", "sent_bytes", "transmit", "upload_bytes", "upload", "transfer_tx", "transferTx"]);
  if (rxBytes === null || txBytes === null) {
    throw new AwgApiError("AmneziaWG returned invalid usage statistics.");
  }
  return { rxBytes: Math.round(rxBytes), txBytes: Math.round(txBytes) };
}

export async function disableAwgClient(clientId: string): Promise<boolean> {
  try {
    const response = await request("DELETE", `/api/clients/${encodeURIComponent(clientId)}`);
    return response.status >= 200 && response.status < 300 || response.status === 404;
  } catch {
    return false;
  }
}

export async function replaceAwgClient(clientId: string, replacementClientId?: string): Promise<{
  configured: boolean;
  clientId: string | null;
  error: string | null;
}> {
  const replacement = await createAwgClient(replacementClientId);
  if (!replacement.clientId) {
    return replacement;
  }
  const deleted = await disableAwgClient(clientId);
  if (!deleted) {
    return {
      ...replacement,
      error: "client جدید ساخته شد اما حذف client قبلی AmneziaWG انجام نشد",
    };
  }
  return replacement;
}

export async function recreateAwgClient(clientId: string): Promise<void> {
  try {
    await request("DELETE", `/api/clients/${encodeURIComponent(clientId)}`);
  } catch {
    // Continue with create, matching the legacy renewal worker.
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const response = await request("POST", "/api/clients", { id: clientId });
  if (!response.configured) throw new AwgApiError("AmneziaWG API is not configured.");
  if (response.status < 200 || response.status >= 300) {
    throw new AwgApiError(responseError(response.status, response.text));
  }
}