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

const AWG_STATS_CACHE_TTL_MS = 5 * 60_000;
const AWG_STATS_ERROR_RETRY_MS = 5 * 60_000;
const AWG_STATS_ROUTE_COOLDOWN_MS = 60 * 60_000;
const AWG_STATS_MIN_REQUEST_GAP_MS = 500;
const AWG_STATS_CACHE_PRUNE_INTERVAL_MS = 60_000;
const statsEndpointByApiUrl = new Map<string, string>();
const statsRouteUnavailableUntil = new Map<string, number>();
export type AwgStats = { rxBytes: number; txBytes: number; source: "api" | "cache" };
const statsCache = new Map<string, { value: AwgStats; expiresAt: number }>();
const statsErrorCache = new Map<string, { message: string; kind?: "stats-route-unavailable"; expiresAt: number }>();
const statsInFlight = new Map<string, Promise<AwgStats>>();
let lastStatsRequestAt = 0;
let lastStatsCachePruneAt = 0;
let statsRequestQueue = Promise.resolve();

function awgStatsCacheKey(apiUrl: string, clientId: string): string {
  return `${apiUrl}\u0000${clientId}`;
}

function pruneExpiredAwgStatsCache(now: number): void {
  if (now - lastStatsCachePruneAt < AWG_STATS_CACHE_PRUNE_INTERVAL_MS) return;
  lastStatsCachePruneAt = now;
  for (const [key, value] of statsCache) {
    if (value.expiresAt <= now) statsCache.delete(key);
  }
  for (const [key, value] of statsErrorCache) {
    if (value.expiresAt <= now) statsErrorCache.delete(key);
  }
  for (const [apiUrl, expiresAt] of statsRouteUnavailableUntil) {
    if (expiresAt <= now) statsRouteUnavailableUntil.delete(apiUrl);
  }
}

export function clearAwgStatsCache(clientId: string): void {
  for (const key of statsCache.keys()) {
    if (key.endsWith(`\u0000${clientId}`)) statsCache.delete(key);
  }
  for (const key of statsErrorCache.keys()) {
    if (key.endsWith(`\u0000${clientId}`)) statsErrorCache.delete(key);
  }
  for (const key of statsInFlight.keys()) {
    if (key.endsWith(`\u0000${clientId}`)) statsInFlight.delete(key);
  }
}

async function requestAwgStats(endpoint: string, awg: AwgConfig) {
  const previousRequest = statsRequestQueue;
  let releaseRequest!: () => void;
  statsRequestQueue = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await previousRequest;
  try {
    const waitMs = AWG_STATS_MIN_REQUEST_GAP_MS - (Date.now() - lastStatsRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastStatsRequestAt = Date.now();
    return await request("GET", endpoint, undefined, awg);
  } finally {
    releaseRequest();
  }
}

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
        clearAwgStatsCache(clientId);
        return { configured: true, clientId, error: null };
      }
      return {
        configured: true,
        clientId: null,
        error: responseError(response.status, response.text),
      };
    }
    clearAwgStatsCache(clientId);
    return { configured: true, clientId, error: null };
  } catch {
    if (await confirmAwgClient(clientId)) {
      clearAwgStatsCache(clientId);
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

async function fetchAwgStats(clientId: string, awg: AwgConfig): Promise<AwgStats> {
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
    const candidate = await requestAwgStats(endpoint, awg);
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
    if (endpoint === preferredEndpoint && candidate.status === 404) break;
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
  return { rxBytes: Math.round(rxBytes), txBytes: Math.round(txBytes), source: "api" };
}

export async function getAwgStats(
  clientId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<AwgStats> {
  const awg = await config();
  if (!awg) throw new AwgApiError("AmneziaWG API is not configured.");
  const now = Date.now();
  pruneExpiredAwgStatsCache(now);
  const key = awgStatsCacheKey(awg.apiUrl, clientId);
  const cached = statsCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > now) {
    return { ...cached.value, source: "cache" };
  }
  if (cached) statsCache.delete(key);
  const failed = statsErrorCache.get(key);
  if (failed && failed.expiresAt > now) throw new AwgApiError(failed.message, failed.kind);
  if (failed) statsErrorCache.delete(key);
  const inFlight = statsInFlight.get(key);
  if (inFlight) return inFlight;

  const requestPromise = fetchAwgStats(clientId, awg)
    .then((value) => {
      statsCache.set(key, { value, expiresAt: Date.now() + AWG_STATS_CACHE_TTL_MS });
      statsErrorCache.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      const normalized = error instanceof AwgApiError
        ? error
        : new AwgApiError(error instanceof Error ? error.message : "AmneziaWG stats request failed.");
      const retryDelay = normalized.kind === "stats-route-unavailable"
        ? AWG_STATS_ROUTE_COOLDOWN_MS
        : AWG_STATS_ERROR_RETRY_MS;
      statsErrorCache.set(key, {
        message: normalized.message,
        kind: normalized.kind,
        expiresAt: Date.now() + retryDelay,
      });
      throw normalized;
    })
    .finally(() => {
      statsInFlight.delete(key);
    });
  statsInFlight.set(key, requestPromise);
  return requestPromise;
}

export async function disableAwgClient(clientId: string): Promise<boolean> {
  try {
    const response = await request("DELETE", `/api/clients/${encodeURIComponent(clientId)}`);
    const disabled = response.status >= 200 && response.status < 300 || response.status === 404;
    if (disabled) clearAwgStatsCache(clientId);
    return disabled;
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
  clearAwgStatsCache(clientId);
}