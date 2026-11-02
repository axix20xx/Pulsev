import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";

export const RAVEN_CHANNELS = ["xray", "wireguard", "openvpn", "dns"] as const;
export type RavenChannel = (typeof RAVEN_CHANNELS)[number];
export const DEFAULT_RAVEN_CHANNELS: RavenChannel[] = ["xray", "wireguard", "openvpn"];
const BYTES_PER_GB = 1_073_741_824;
const SECONDS_PER_DAY = 86_400;

export type RavenPanel = {
  key: string;
  api_base: string;
  api_key?: string;
  channels?: RavenChannel[];
};

export type RavenBackfillPlan = {
  eligible: boolean;
  quotaGb: number;
  days: number;
  expiresAtUnix: number | null;
  reason?: "inactive" | "expired" | "no_expiry" | "unlimited" | "quota_exhausted" | "invalid" | "expiry_too_soon";
};

export function ravenBackfillPlan(input: {
  status: string;
  gb: number | string | null;
  lastRemainingBytes: number | string | null;
  lastUsedBytes: number | string | null;
  expiresAtUnix: number | string | null;
}, nowUnix = Math.floor(Date.now() / 1000)): RavenBackfillPlan {
  if (input.status !== "active") {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: null, reason: "inactive" };
  }
  const expiry = input.expiresAtUnix === null ? null : Number(input.expiresAtUnix);
  if (expiry === null) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: null, reason: "no_expiry" };
  }
  if (!Number.isFinite(expiry) || expiry <= nowUnix) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: null, reason: "expired" };
  }

  const totalGb = Number(input.gb);
  if (input.gb === null || !Number.isFinite(totalGb) || totalGb < 0) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: expiry, reason: "invalid" };
  }
  if (totalGb === 0) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: expiry, reason: "unlimited" };
  }

  const usedBytes = input.lastUsedBytes === null ? 0 : Number(input.lastUsedBytes);
  const snapshotRemaining = input.lastRemainingBytes === null
    ? null
    : Number(input.lastRemainingBytes);
  if (
    !Number.isFinite(usedBytes)
    || usedBytes < 0
    || (snapshotRemaining !== null && (!Number.isFinite(snapshotRemaining) || snapshotRemaining < 0))
  ) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: expiry, reason: "invalid" };
  }
  const totalBytes = totalGb * BYTES_PER_GB;
  if (!Number.isFinite(totalBytes)) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: expiry, reason: "invalid" };
  }
  const remainingBytes = Math.min(
    totalBytes,
    snapshotRemaining ?? Math.max(0, totalBytes - usedBytes),
  );
  if (remainingBytes <= 0) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: expiry, reason: "quota_exhausted" };
  }

  // Raven accepts expiryDays as whole days; round down so backfill never
  // extends a customer's existing expiry date.
  const days = Math.floor((expiry - nowUnix) / SECONDS_PER_DAY);
  if (days < 1) {
    return { eligible: false, quotaGb: 0, days: 0, expiresAtUnix: expiry, reason: "expiry_too_soon" };
  }
  return { eligible: true, quotaGb: remainingBytes / BYTES_PER_GB, days, expiresAtUnix: expiry };
}

export class RavenProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RavenProviderError";
  }
}

export function normalizeRavenChannels(value: unknown): RavenChannel[] {
  if (!Array.isArray(value)) return [...DEFAULT_RAVEN_CHANNELS];
  return [...new Set(value.filter(
    (channel): channel is RavenChannel =>
      typeof channel === "string" && RAVEN_CHANNELS.includes(channel as RavenChannel),
  ))];
}

function apiBase(panel: RavenPanel): string {
  const url = new URL(panel.api_base);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new RavenProviderError("Raven API must use HTTPS.", 400);
  }
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/api\/v1$/i.test(path) ? path : `${path}/api/v1`;
  return url.toString().replace(/\/+$/, "");
}

function payloadObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const root = value as Record<string, any>;
  return root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data
    : root;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function ravenRequest(
  panel: RavenPanel,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, any>> {
  if (!panel.api_key?.trim()) throw new RavenProviderError(`Raven provider ${panel.key} has no API key.`, 400);
  const base = apiBase(panel);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${panel.api_key.trim()}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new RavenProviderError(`Raven provider ${panel.key} could not be reached.`, 502, true);
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!response.ok) {
    const parsed = payloadObject(data);
    const detail = typeof parsed.message === "string"
      ? parsed.message
      : typeof parsed.error === "string"
        ? parsed.error
        : `HTTP ${response.status}`;
    const safeDetail = detail.replaceAll(panel.api_key.trim(), "[redacted]").slice(0, 240);
    throw new RavenProviderError(
      `Raven provider ${panel.key} rejected the request: ${safeDetail}`,
      response.status,
      retryableStatus(response.status),
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new RavenProviderError(`Raven provider ${panel.key} returned invalid JSON.`, 502, true);
  }
  return payloadObject(data);
}

export async function testRavenProvider(panel: RavenPanel): Promise<{ ok: boolean; detail: string }> {
  try {
    const account = await ravenRequest(panel, "GET", "/me");
    if (account.isSeller !== true) {
      return { ok: false, detail: "Raven API key is valid, but it is not a seller account." };
    }
    return {
      ok: true,
      detail: `Raven seller connection succeeded${Number.isFinite(Number(account.creditGb)) ? ` · ${Number(account.creditGb)} GB credit` : ""}.`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Raven connection failed.",
    };
  }
}

type RavenAccountRow = {
  config_label: string;
  remote_config_id: string | null;
  channels: RavenChannel[] | string[] | null;
};

async function getAccount(serviceId: number, providerKey: string): Promise<RavenAccountRow | null> {
  const result = await pool.query<RavenAccountRow>(
    `SELECT config_label, remote_config_id, channels
     FROM raven_service_accounts
     WHERE service_id = $1 AND provider_key = $2
     LIMIT 1`,
    [serviceId, providerKey],
  );
  return result.rows[0] ?? null;
}

function ravenConfigId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

async function findByLabel(panel: RavenPanel, label: string): Promise<Record<string, any> | null> {
  const query = new URLSearchParams({ status: "all", limit: "100", page: "1", q: label });
  const result = await ravenRequest(panel, "GET", `/configs?${query.toString()}`);
  const configs = Array.isArray(result.configs) ? result.configs : [];
  return configs.find((entry: any) =>
    entry && typeof entry === "object" && String(entry.label ?? "").trim() === label,
  ) ?? null;
}

async function saveAccount(
  serviceId: number,
  panel: RavenPanel,
  account: RavenAccountRow,
  remoteConfigId: string,
): Promise<void> {
  await pool.query(
    `UPDATE raven_service_accounts
     SET remote_config_id = $1,
         channels = $2::jsonb,
         updated_at = NOW()
     WHERE service_id = $3 AND provider_key = $4`,
    [
      remoteConfigId,
      JSON.stringify(account.channels ?? panel.channels ?? DEFAULT_RAVEN_CHANNELS),
      serviceId,
      panel.key,
    ],
  );
}

export async function provisionRavenConfig(
  panel: RavenPanel,
  serviceId: number,
  gb: number,
  days: number,
): Promise<number> {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    throw new RavenProviderError("Raven service ID is invalid.", 400);
  }
  if (!Number.isFinite(gb) || gb <= 0 || !Number.isSafeInteger(days) || days <= 0) {
    throw new RavenProviderError("Raven volume and expiry must be positive.", 400);
  }
  const channels = normalizeRavenChannels(panel.channels);
  if (!channels.length) {
    throw new RavenProviderError(`Select at least one Raven channel for ${panel.key}.`, 400);
  }

  const lockClient = await pool.connect();
  const lockName = `${serviceId}:${panel.key}`;
  let locked = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74427, hashtext($1::text)) AS locked",
      [lockName],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) throw new RavenProviderError(`Raven provisioning for service ${serviceId} is already running.`, 409, true);

    let account = await getAccount(serviceId, panel.key);
    if (!account) {
      const label = `P${serviceId}-${randomBytes(8).toString("hex")}`;
      await pool.query(
        `INSERT INTO raven_service_accounts
           (service_id, provider_key, config_label, channels, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
         ON CONFLICT (service_id, provider_key) DO NOTHING`,
        [serviceId, panel.key, label, JSON.stringify(channels)],
      );
      account = await getAccount(serviceId, panel.key);
    }
    if (!account) throw new RavenProviderError("Raven account mapping could not be saved.", 500, true);
    if (account.remote_config_id) return 200;

    let remote = await findByLabel(panel, account.config_label);
    if (!remote) {
      try {
        remote = await ravenRequest(panel, "POST", "/configs", {
          gb,
          label: account.config_label,
          expiryDays: days,
          channels,
        });
      } catch (error) {
        // A create request may commit remotely before a network error reaches us.
        // The stable label makes a later retry safe and avoids a second charge.
        if (!(error instanceof RavenProviderError) || !error.retryable) throw error;
        remote = await findByLabel(panel, account.config_label).catch(() => null);
        if (!remote) throw error;
      }
    }
    const remoteId = ravenConfigId(remote.id ?? remote.config?.id);
    if (!remoteId) {
      throw new RavenProviderError("Raven created the config but returned no config ID.", 502, true);
    }
    await saveAccount(serviceId, panel, account, remoteId);
    return 201;
  } finally {
    if (locked) {
      await lockClient.query("SELECT pg_advisory_unlock(74427, hashtext($1::text))", [lockName]).catch(() => undefined);
    }
    lockClient.release();
  }
}

export async function renewRavenConfig(
  panel: RavenPanel,
  serviceId: number,
  targetGb: number,
  days: number,
): Promise<number> {
  const account = await getAccount(serviceId, panel.key);
  if (!account?.remote_config_id) {
    throw new RavenProviderError(`Raven config for service ${serviceId} has not been provisioned.`, 404);
  }
  const lockClient = await pool.connect();
  const lockName = `renew:${serviceId}:${panel.key}`;
  let locked = false;
  let resetAttempted = false;
  let reviveAttempted = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74427, hashtext($1::text)) AS locked",
      [lockName],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) throw new RavenProviderError(`Raven renewal for service ${serviceId} is already running.`, 409, true);

    const id = encodeURIComponent(account.remote_config_id);
    const current = await ravenRequest(panel, "GET", `/configs/${id}`);
    const currentGb = Number(current.limitGb);
    if (!Number.isFinite(targetGb) || targetGb <= 0 || !Number.isSafeInteger(days) || days <= 0) {
      throw new RavenProviderError("Raven renewal volume and expiry must be positive.", 400);
    }
    if (!Number.isFinite(currentGb)) {
      throw new RavenProviderError("Raven returned an invalid traffic limit; renewal was not applied.", 502, true);
    }
    const status = String(current.status ?? "").toLowerCase();
    if (status !== "active" && status !== "paused") {
      reviveAttempted = true;
      await ravenRequest(panel, "POST", `/configs/${id}/revive`, { gb: targetGb, days });
      return 200;
    }
    if (targetGb < currentGb - 0.000001) {
      throw new RavenProviderError(
        `Raven cannot reduce this config from ${currentGb} GB to ${targetGb} GB in place; no reset was applied.`,
        409,
      );
    }

    const quote = await ravenRequest(panel, "GET", `/configs/${id}/reset-traffic/quote`);
    if (quote.allowed !== true) {
      throw new RavenProviderError(
        typeof quote.message === "string" && quote.message
          ? `Raven traffic reset is not allowed: ${quote.message}`
          : "Raven traffic reset is not allowed; no renewal was applied.",
        409,
      );
    }
    resetAttempted = true;
    await ravenRequest(panel, "POST", `/configs/${id}/reset-traffic`);
    const additionalGb = Math.max(0, targetGb - currentGb);
    if (additionalGb > 0.000001) {
      await ravenRequest(panel, "POST", `/configs/${id}/extend`, { gb: additionalGb });
    }
    await ravenRequest(panel, "PUT", `/configs/${id}/expiry`, { days });
    if (status === "paused") await ravenRequest(panel, "POST", `/configs/${id}/resume`);
    return 200;
  } catch (error) {
    if (reviveAttempted) {
      const failure = error instanceof RavenProviderError
        ? error
        : new RavenProviderError("Raven config revive failed.", 502);
      throw new RavenProviderError(
        `${failure.message} Revive may already have applied; check Raven before retrying.`,
        failure.status,
        false,
      );
    }
    if (error instanceof RavenProviderError && resetAttempted) {
      throw new RavenProviderError(
        `${error.message} The traffic reset may already have applied; check Raven before retrying.`,
        error.status,
        false,
      );
    }
    throw error;
  } finally {
    if (locked) {
      await lockClient.query("SELECT pg_advisory_unlock(74427, hashtext($1::text))", [lockName]).catch(() => undefined);
    }
    lockClient.release();
  }
}

export async function ravenServiceAccount(
  serviceId: number,
  providerKey: string,
): Promise<RavenAccountRow | null> {
  return getAccount(serviceId, providerKey);
}

export async function ravenConfigUsageBytes(
  panel: RavenPanel,
  configId: string,
): Promise<number> {
  const config = await ravenRequest(panel, "GET", `/configs/${encodeURIComponent(configId)}`);
  const usedGb = Number(config.usedGb);
  if (Number.isFinite(usedGb) && usedGb >= 0) return Math.round(usedGb * 1024 ** 3);
  const usedBytes = Number(config.usedBytes);
  if (Number.isFinite(usedBytes) && usedBytes >= 0) return Math.round(usedBytes);
  throw new RavenProviderError(`Raven returned invalid usage for ${panel.key}.`, 502, true);
}

export async function ravenDeliveryLinks(
  panel: RavenPanel,
  configId: string,
): Promise<{ subscriptionUrl: string | null; xrayLinks: string[]; files: Record<string, Array<{ name: string; url: string }>> }> {
  const links = await ravenRequest(panel, "GET", `/configs/${encodeURIComponent(configId)}/links`);
  const subscriptionUrl = typeof links.subUrl === "string" ? links.subUrl : null;
  const jsonUrl = typeof links.protocolFiles?.json === "string"
    ? links.protocolFiles.json
    : subscriptionUrl
      ? `${subscriptionUrl}${subscriptionUrl.includes("?") ? "&" : "?"}format=json`
      : null;
  const files: Record<string, Array<{ name: string; url: string }>> = { wireguard: [], openvpn: [] };
  if (jsonUrl) {
    const expectedOrigin = new URL(panel.api_base).origin;
    const deliveryUrl = new URL(jsonUrl, `${expectedOrigin}/`);
    if (deliveryUrl.protocol !== "https:" || deliveryUrl.origin !== expectedOrigin) {
      throw new RavenProviderError("Raven returned a profile URL outside its configured HTTPS origin.", 502);
    }
    const response = await fetch(deliveryUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new RavenProviderError(`Raven profile list returned HTTP ${response.status}.`, response.status, retryableStatus(response.status));
    }
    const payload = payloadObject(await response.json().catch(() => null));
    for (const [channel, field] of [["wireguard", "wgConfigs"], ["openvpn", "ovpnConfigs"]] as const) {
      const rows = Array.isArray(payload[field]) ? payload[field] : [];
      files[channel] = rows.flatMap((row: any, index: number) => {
        if (!row || typeof row !== "object") return [];
        const url = typeof row.downloadUrl === "string" ? row.downloadUrl : "";
        const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : `${channel}-${index + 1}`;
        if (!url) return [];
        const parsed = new URL(url, deliveryUrl);
        if (parsed.protocol !== "https:" || parsed.origin !== expectedOrigin) return [];
        return [{ name, url: parsed.toString() }];
      });
    }
  }
  const xrayLinks = Array.isArray(links.links)
    ? links.links.filter((link: unknown): link is string =>
        typeof link === "string" && /^(?:vless|vmess|trojan|ss|hysteria2?|tuic):\/\//i.test(link.trim()),
      ).map((link: string) => link.trim())
    : [];
  return { subscriptionUrl, xrayLinks, files };
}

export async function pauseRavenConfig(panel: RavenPanel, serviceId: number): Promise<boolean> {
  const account = await getAccount(serviceId, panel.key);
  if (!account?.remote_config_id) return false;
  await ravenRequest(
    panel,
    "POST",
    `/configs/${encodeURIComponent(account.remote_config_id)}/pause`,
  );
  return true;
}

export async function reactivateRavenConfig(
  panel: RavenPanel,
  serviceId: number,
): Promise<"repaired" | "skipped"> {
  const account = await getAccount(serviceId, panel.key);
  if (!account?.remote_config_id) {
    throw new RavenProviderError(`Raven config for service ${serviceId} was not found.`, 404);
  }
  const id = encodeURIComponent(account.remote_config_id);
  const current = await ravenRequest(panel, "GET", `/configs/${id}`);
  const status = String(current.status ?? "").trim().toLowerCase();
  if (status === "active") return "skipped";
  if (status !== "paused") {
    throw new RavenProviderError(
      `Raven config is ${status || "not active"}; use renewal to restore its time and quota.`,
      409,
    );
  }
  await ravenRequest(panel, "POST", `/configs/${id}/resume`);
  return "repaired";
}
