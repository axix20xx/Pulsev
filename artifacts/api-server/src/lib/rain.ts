import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { decryptPanelCredential } from "./panel-credentials";

type Panel = {
  key?: string;
  kind?: string;
  api_base: string;
  admin_user?: string;
  admin_pass?: string;
  api_key?: string;
};

type StoredPanel = Panel & {
  username_secret?: string | null;
  password_secret?: string | null;
  api_key_secret?: string | null;
};

type PanelResult = {
  key: string;
  kind: string;
  status: number;
  error?: string;
};

export class RainApiError extends Error {
  readonly results: PanelResult[];

  constructor(message: string, results: PanelResult[] = []) {
    super(message);
    this.name = "RainApiError";
    this.results = results;
  }
}

const tokenCache = new Map<string, string>();

function panelKey(panel: Panel): string {
  return panel.key?.trim() || panel.api_base;
}

function panelKind(panel: Panel): "rain_admin" | "falcon" | "marzban" {
  const kind = panel.kind?.trim().toLowerCase();
  if (kind === "rain_admin") return "rain_admin";
  if (kind === "falcon") return "falcon";
  return "marzban";
}

async function panels(ownerId?: number, role?: string): Promise<Panel[]> {
  const result = await pool.query<StoredPanel>(
    `SELECT p.key, p.kind, p.api_base,
            p.username_secret, p.password_secret, p.api_key_secret
     FROM panel_configs p
     WHERE p.is_enabled = 1
     ORDER BY p.key`,
  );
  return result.rows.map((panel) => ({
    key: panel.key,
    kind: panel.kind,
    api_base: panel.api_base.replace(/\/+$/, ""),
    admin_user: decryptPanelCredential(panel.username_secret),
    admin_pass: decryptPanelCredential(panel.password_secret),
    api_key: decryptPanelCredential(panel.api_key_secret),
  })).filter((panel) => {
    const kind = panelKind(panel);
    return kind === "falcon"
      ? Boolean(panel.api_key)
      : Boolean(panel.admin_user && panel.admin_pass);
  });
}

export async function listAvailablePanels(): Promise<Array<{ key: string; kind: string }>> {
  const configured = await panels();
  return configured.map((panel) => ({ key: panelKey(panel), kind: panelKind(panel) }));
}

export async function rainConfigured(ownerId?: number, role?: string): Promise<boolean> {
  return (await panels(ownerId, role)).some((panel) => {
    const kind = panelKind(panel);
    return Boolean(
      panel.api_base &&
        (kind === "falcon"
          ? panel.api_key
          : panel.admin_user && panel.admin_pass),
    );
  });
}

export function subscriptionUrl(token: string): string {
  return `/api/public/subscription/${encodeURIComponent(token)}/feed`;
}

export function legacySubscriptionUrl(token: string): string {
  const base =
    process.env.SUBSCRIPTION_UPSTREAM_BASE_URL?.trim() ||
    process.env.LEGACY_SUBSCRIPTION_BASE_URL?.trim() ||
    "https://peppernopepper.com/reseller/sub.php";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}t=${encodeURIComponent(token)}`;
}

function collectSubscriptionLinks(value: unknown, keyHint = "", depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    const candidate = value.trim();
    const configUri = /^(?:vless|vmess|trojan|ss|ssr|hysteria|hysteria2|tuic|socks(?:4|5)?):\/\//i.test(candidate);
    if (
      /(subscription|subscribe|sub|links?|configs?|uris?)/i.test(keyHint) &&
      (/^https?:\/\//i.test(candidate) || candidate.startsWith("/") || configUri)
    ) {
      return [candidate];
    }
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSubscriptionLinks(item, keyHint, depth + 1));
  }
  if (typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    collectSubscriptionLinks(item, key, depth + 1),
  );
}

function isClientConfigUri(value: string): boolean {
  return /^(?:vless|vmess|trojan|ss|ssr|hysteria|hysteria2|tuic|socks(?:4|5)?):\/\//i.test(value);
}

function resolvePanelUrl(panel: Panel, rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return `${panel.api_base.replace(/\/+$/, "")}/${rawUrl.replace(/^\/+/, "")}`;
}

function decodeSubscriptionBody(body: string): { text: string; encoded: boolean } {
  const trimmed = body.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (
    compact.length >= 16 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/=_-]+$/.test(compact)
  ) {
    try {
      const decoded = Buffer.from(compact, "base64").toString("utf8").trim();
      if (decoded && /(?:[a-z][a-z0-9+.-]*):\/\//i.test(decoded)) {
        return { text: decoded, encoded: true };
      }
    } catch {
      // Keep the original response when it is not valid base64.
    }
  }
  return { text: trimmed, encoded: false };
}

export async function fetchPanelSubscription(
  username: string,
  ownerId?: number,
  role?: string,
): Promise<{ body: string; contentType: string } | null> {
  const feeds: Array<{ text: string; encoded: boolean }> = [];
  const encodedUsername = encodeURIComponent(username);

  for (const panel of await panels(ownerId, role)) {
    const kind = panelKind(panel);
    const paths =
      kind === "rain_admin"
        ? [`/api/users/${encodedUsername}`, `/api/user/${encodedUsername}`]
        : kind === "falcon"
          ? [`/api/v1/configs?username=${encodedUsername}`]
          : [`/api/user/${encodedUsername}`];

    let links: string[] = [];
    for (const path of paths) {
      try {
        const response = await panelRequest(panel, "GET", path);
        if (response.status >= 200 && response.status < 300) {
          links = [...new Set(collectSubscriptionLinks(response.json))];
          if (links.length) break;
        }
        if (![404, 405].includes(response.status)) break;
      } catch {
        // A single unavailable Provider must not prevent another Provider from serving a feed.
      }
    }

    for (const rawLink of links) {
      if (isClientConfigUri(rawLink)) {
        feeds.push({ text: rawLink, encoded: false });
        continue;
      }
      try {
        const response = await fetch(resolvePanelUrl(panel, rawLink), {
          headers: {
            Accept: "text/plain, application/octet-stream, */*",
            "User-Agent": "PulseSubscription/1.0",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) continue;
        const body = await response.text();
        if (body.trim()) feeds.push(decodeSubscriptionBody(body));
      } catch {
        // Try the next link or Provider.
      }
    }
  }

  if (!feeds.length) return null;
  const text = feeds.map((feed) => feed.text).join("\n").trim();
  if (!text) return null;
  return {
    body: feeds.every((feed) => feed.encoded)
      ? Buffer.from(text, "utf8").toString("base64")
      : text,
    contentType: "text/plain; charset=utf-8",
  };
}

function bytesForGb(gb: number): number {
  return Math.round(Math.max(0, gb) * 1024 * 1024 * 1024);
}

function isoInDays(days: number): string {
  return new Date(Date.now() + Math.max(0, days) * 86_400_000).toISOString();
}

async function request(
  panel: Panel,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  const response = await fetch(`${panel.api_base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

async function tokenFor(panel: Panel, forceRefresh = false): Promise<string> {
  const key = panelKey(panel);
  if (!forceRefresh && tokenCache.has(key)) return tokenCache.get(key)!;
  const kind = panelKind(panel);
  if (kind === "falcon") {
    if (!panel.api_key) throw new RainApiError(`Panel ${key} has no API key`);
    return panel.api_key;
  }

  const paths =
    kind === "rain_admin"
      ? ["/api/admins/token", "/api/admin/token", "/api/admin/token/", "/api/admins/token/"]
      : ["/api/admin/token", "/api/admin/token/"];
  let lastStatus: number | null = null;
  let authenticationFailureStatus: number | null = null;
  let networkFailure = false;
  for (const path of paths) {
    const requestBodies: Array<{ contentType: string; body: string }> = [
      {
        contentType: "application/x-www-form-urlencoded",
        body: new URLSearchParams({
          grant_type: "password",
          username: panel.admin_user ?? "",
          password: panel.admin_pass ?? "",
        }).toString(),
      },
    ];
    if (kind === "rain_admin") {
      requestBodies.push({
        contentType: "application/json",
        body: JSON.stringify({
          username: panel.admin_user ?? "",
          password: panel.admin_pass ?? "",
        }),
      });
    }
    for (const requestBody of requestBodies) {
      try {
        const response = await fetch(`${panel.api_base}${path}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": requestBody.contentType,
          },
          body: requestBody.body,
          signal: AbortSignal.timeout(10_000),
        });
        lastStatus = response.status;
        if ([401, 403, 422].includes(response.status)) {
          authenticationFailureStatus = response.status;
        }
        const text = await response.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        const token = json?.access_token ?? json?.token ?? json?.bearer;
        if (response.ok && typeof token === "string" && token) {
          tokenCache.set(key, token);
          return token;
        }
      } catch {
        networkFailure = true;
        // Try the next supported request shape without exposing credentials.
      }
    }
  }
  const reason = authenticationFailureStatus !== null
    ? `HTTP ${authenticationFailureStatus}`
    : lastStatus !== null
      ? `HTTP ${lastStatus}`
    : networkFailure
      ? "network error"
      : "no response";
  throw new RainApiError(`Could not authenticate with panel ${key} (${reason})`);
}

export async function testPanelAuthentication(
  key: string,
  ownerId?: number,
  role?: string,
): Promise<{ ok: boolean; detail: string }> {
  const panel = (await panels(ownerId, role)).find((candidate) => panelKey(candidate) === key);
  if (!panel) return { ok: false, detail: `Panel ${key} is not configured or has no credentials.` };
  try {
    const token = await tokenFor(panel, true);
    if (panelKind(panel) === "falcon") {
      const response = await request(panel, "GET", "/configs?limit=1", token);
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, detail: `Falcon API returned ${safeError(response)}.` };
      }
    }
    return { ok: true, detail: "Authentication succeeded." };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Authentication failed.",
    };
  }
}

async function panelRequest(
  panel: Panel,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  let token = await tokenFor(panel);
  let response = await request(panel, method, path, token, body);
  if (response.status === 401 || response.status === 403) {
    tokenCache.delete(panelKey(panel));
    token = await tokenFor(panel, true);
    response = await request(panel, method, path, token, body);
  }
  return response;
}

function safeError(response: { status: number; json: any; text: string }): string {
  const detail =
    typeof response.json?.detail === "string"
      ? response.json.detail
      : typeof response.json?.message === "string"
        ? response.json.message
        : "";
  return detail ? `HTTP ${response.status}: ${detail.slice(0, 160)}` : `HTTP ${response.status}`;
}

export type PanelUsage = {
  panelKey: string;
  usedBytes: number;
  totalBytes: number | null;
  expiresAt: string | null;
};

function nestedPayload(json: any): any {
  return json?.data ?? json?.user ?? json?.config ?? json;
}

function numericValue(payload: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(payload?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function bytesValue(payload: any, byteKeys: string[], gbKeys: string[] = []): number | null {
  const bytes = numericValue(payload, byteKeys);
  if (bytes !== null) return Math.round(bytes);
  const gb = numericValue(payload, gbKeys);
  return gb === null ? null : Math.round(gb * 1024 ** 3);
}

function findUserPayload(value: unknown, username: string, depth = 0): any | null {
  if (!value || typeof value !== "object" || depth > 5) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findUserPayload(item, username, depth + 1);
      if (match) return match;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const identity = record.username ?? record.user_name ?? record.name ?? record.email;
  if (typeof identity === "string" && identity === username) return record;
  for (const nested of Object.values(record)) {
    const match = findUserPayload(nested, username, depth + 1);
    if (match) return match;
  }
  return null;
}

function usedBytesValue(payload: any): number | null {
  const direct = bytesValue(
    payload,
    [
      "data_limit_used",
      "used_bytes",
      "usage_bytes",
      "total_used",
      "used",
      "used_traffic",
      "traffic_used",
      "usedTraffic",
    ],
    ["used_gb", "usage_gb", "data_used_gb"],
  );
  if (direct !== null) return direct;
  const upload = bytesValue(payload, ["upload", "upload_bytes", "up", "uplink"]);
  const download = bytesValue(payload, ["download", "download_bytes", "down", "downlink"]);
  return upload === null && download === null ? null : Math.round((upload ?? 0) + (download ?? 0));
}

function expiryValue(payload: any): string | null {
  const value = payload?.expire_at ?? payload?.expire_date ?? payload?.expire ?? payload?.expires_at ?? payload?.expires;
  if (value === undefined || value === null || value === "") return null;
  const date = typeof value === "number"
    ? new Date(value > 10_000_000_000 ? value : value * 1000)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function readPanelUsages(
  username: string,
  falcoConfigId: number | null,
  ownerId?: number,
  role?: string,
): Promise<PanelUsage[]> {
  const result: PanelUsage[] = [];
  const safePanelRequest = async (panel: Panel, method: string, path: string): Promise<{ status: number; json: any; text: string } | null> => {
    try {
      return await panelRequest(panel, method, path);
    } catch {
      return null;
    }
  };
  for (const panel of await panels(ownerId, role)) {
    const kind = panelKind(panel);
    let response: { status: number; json: any; text: string } | null = null;
    if (kind === "falcon") {
      response = await safePanelRequest(
        panel,
        "GET",
        falcoConfigId ? `/api/v1/configs/${encodeURIComponent(String(falcoConfigId))}` : `/api/v1/configs?username=${encodeURIComponent(username)}`,
      );
      if (response?.status === 200 && !falcoConfigId && Array.isArray(response.json?.data)) {
        const match = response.json.data.find((item: any) => String(item?.username ?? item?.name ?? "") === username);
        response = match ? { ...response, json: match } : response;
      }
    } else {
      const encoded = encodeURIComponent(username);
      const paths = kind === "rain_admin"
        ? [
            `/api/users/${encoded}`,
            `/api/user/${encoded}`,
            `/api/users?username=${encoded}`,
            `/api/users?search=${encoded}`,
            "/api/users",
          ]
        : [`/api/user/${encoded}`, `/api/users?username=${encoded}`];
      for (const path of paths) {
        response = await safePanelRequest(panel, "GET", path);
        if (response?.status === 200) {
          const matched = findUserPayload(response.json, username);
          if (matched) {
            response = { ...response, json: matched };
            break;
          }
          if (!Array.isArray(response.json) && !Array.isArray(response.json?.data) && !Array.isArray(response.json?.users)) break;
          continue;
        }
        if (!response || ![404, 405].includes(response.status)) break;
      }
    }
    if (!response || response.status < 200 || response.status >= 300) continue;
    const payload = findUserPayload(response.json, username) ?? nestedPayload(response.json);
    const usedBytes = usedBytesValue(payload);
    if (usedBytes === null) continue;
    result.push({
      panelKey: panelKey(panel),
      usedBytes,
      totalBytes: bytesValue(payload, ["data_limit", "data_limit_bytes", "total_bytes", "quota_bytes"], ["data_limit_gb", "limit_gb", "quota_gb"]),
      expiresAt: expiryValue(payload),
    });
  }
  return result;
}

export async function disablePanelUser(
  username: string,
  falcoConfigId: number | null,
  ownerId?: number,
  role?: string,
): Promise<{ attempted: number; disabled: number }> {
  let attempted = 0;
  let disabled = 0;
  for (const panel of await panels(ownerId, role)) {
    attempted += 1;
    const kind = panelKind(panel);
    const encoded = encodeURIComponent(username);
    const candidates: Array<[string, string, unknown]> = kind === "falcon"
      ? (falcoConfigId ? [["PATCH", `/api/v1/configs/${encodeURIComponent(String(falcoConfigId))}`, { status: "disabled" }]] : [])
      : kind === "rain_admin"
        ? [["PATCH", `/api/users/${encoded}`, { status: "disabled" }], ["PUT", `/api/users/${encoded}`, { status: "disabled" }]]
        : [["PATCH", `/api/user/${encoded}`, { status: "disabled" }], ["PUT", `/api/user/${encoded}`, { status: "disabled" }]];
    let success = false;
    for (const [method, path, body] of candidates) {
      try {
        const response = await panelRequest(panel, method, path, body);
        if (response.status >= 200 && response.status < 300) { success = true; break; }
        if (response.status === 404) { success = true; break; }
        if (![404, 405, 422].includes(response.status)) break;
      } catch {
        break;
      }
    }
    if (success) disabled += 1;
  }
  return { attempted, disabled };
}

async function rainAdminServiceIds(panel: Panel): Promise<number[]> {
  const response = await panelRequest(panel, "GET", "/api/services");
  if (!response || ![200, 201].includes(response.status)) return [];
  const list =
    response.json?.items ??
    response.json?.data ??
    response.json?.results ??
    response.json?.services ??
    response.json;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => Number(item?.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function marzbanInbounds(panel: Panel): Promise<Record<string, string[]>> {
  const response = await panelRequest(panel, "GET", "/api/inbounds");
  if (response.status !== 200 || !response.json || typeof response.json !== "object") {
    return { vless: [] };
  }
  if (Array.isArray(response.json) && response.json.every((item) => typeof item === "string")) {
    return {
      vless: response.json,
      vmess: response.json,
      trojan: response.json,
      shadowsocks: response.json,
    };
  }
  const result: Record<string, string[]> = {};
  for (const [protocol, items] of Object.entries(response.json)) {
    if (!Array.isArray(items)) continue;
    const tags = items
      .map((item: any) => String(item?.tag ?? "").trim())
      .filter(Boolean)
      .filter((tag) => !/grpc|disabled|test|old/i.test(tag));
    if (tags.length) result[protocol.toLowerCase()] = [...new Set(tags)];
  }
  if (!Object.keys(result).length) result.vless = [];
  return result;
}

async function provisionRainAdmin(
  panel: Panel,
  username: string,
  gb: number,
  days: number,
): Promise<number> {
  const ids = await rainAdminServiceIds(panel);
  const body = {
    username,
    expire_strategy: "fixed_date",
    expire_date: isoInDays(days),
    expire_at: isoInDays(days),
    data_limit: bytesForGb(gb),
    data_limit_bytes: bytesForGb(gb),
    data_limit_reset_strategy: "no_reset",
    note: `Pulse provisioned ${new Date().toISOString()}`,
    ...(ids.length ? { service_ids: ids } : {}),
  };
  const encoded = encodeURIComponent(username);
  const candidates: Array<[string, string]> = [
    ["PUT", `/api/users/${encoded}`],
    ["PATCH", `/api/users/${encoded}`],
    ["POST", "/api/users"],
    ["PUT", `/api/user/${encoded}`],
    ["POST", "/api/user"],
  ];
  let last = { status: 0, json: null, text: "" };
  for (const [method, path] of candidates) {
    last = await panelRequest(panel, method, path, body);
    if (last.status >= 200 && last.status < 300) return last.status;
    if (![404, 405, 422].includes(last.status)) break;
  }
  throw new RainApiError(`Rain panel ${panelKey(panel)} rejected the user: ${safeError(last)}`);
}

async function provisionMarzban(
  panel: Panel,
  username: string,
  gb: number,
  days: number,
): Promise<number> {
  const encoded = encodeURIComponent(username);
  const existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  const inbounds = await marzbanInbounds(panel);
  const protocols = Object.keys(inbounds);
  const proxies = Object.fromEntries(protocols.map((protocol) => [protocol, {}]));
  const excluded = Object.fromEntries(protocols.map((protocol) => [protocol, []]));
  const body = {
    username,
    expire: Math.floor((Date.now() + Math.max(0, days) * 86_400_000) / 1000),
    data_limit: bytesForGb(gb),
    status: "active",
    proxies,
    inbounds,
    excluded_inbounds: excluded,
    proxy_settings: proxies,
    ...(existing.status === 200 && existing.json?.group_ids
      ? { group_ids: existing.json.group_ids }
      : panel.key === "phonepanel" || panel.key === "speedur"
        ? { group_ids: [1] }
        : {}),
  };
  const response =
    existing.status === 200
      ? await panelRequest(panel, "PUT", `/api/user/${encoded}`, body)
      : await panelRequest(panel, "POST", "/api/user", body);
  if (response.status >= 200 && response.status < 300) return response.status;
  throw new RainApiError(
    `Marzban panel ${panelKey(panel)} rejected the user: ${safeError(response)}`,
  );
}

async function provisionFalcon(
  panel: Panel,
  gb: number,
  days: number,
  label: string,
): Promise<number> {
  const info = await panelRequest(panel, "GET", "/api/v1/panels");
  const first = info.json?.data?.[0] ?? info.json?.[0] ?? {};
  const serviceIds = Array.isArray(first.services)
    ? first.services.map((service: any) => Number(service?.id)).filter(Boolean)
    : [];
  const response = await panelRequest(panel, "POST", "/api/v1/configs", {
    panel_id: first.id ?? 1,
    traffic_limit_gb: gb,
    expires_days: days,
    status: "active",
    comment: label,
    service_ids: serviceIds,
  });
  if (response.status >= 200 && response.status < 300) return response.status;
  throw new RainApiError(
    `Falcon panel ${panelKey(panel)} rejected the user: ${safeError(response)}`,
  );
}

export async function provisionUser(
  username: string,
  gb: number,
  days: number,
  label: string,
  ownerId?: number,
  role?: string,
  onlyPanelKeys?: string[],
): Promise<{ ok: boolean; results: PanelResult[] }> {
  const configured = await panels(ownerId, role);
  const configuredPanels = onlyPanelKeys?.length
    ? configured.filter((panel) => onlyPanelKeys.includes(panelKey(panel)))
    : configured;
  const hasCredentials = configuredPanels.some((panel) => {
    const kind = panelKind(panel);
    return Boolean(kind === "falcon" ? panel.api_key : panel.admin_user && panel.admin_pass);
  });
  if (!configuredPanels.length || !hasCredentials) {
    throw new RainApiError(
      "هیچ Provider فعال و دارای credential در تنظیمات دیتابیس پیدا نشد. از صفحهٔ Settings credential پنل را ذخیره کنید.",
    );
  }
  const results = await Promise.all(configuredPanels.map(async (panel): Promise<PanelResult> => {
    const kind = panelKind(panel);
    try {
      const status =
        kind === "rain_admin"
          ? await provisionRainAdmin(panel, username, gb, days)
          : kind === "falcon"
            ? await provisionFalcon(panel, gb, days, label)
            : await provisionMarzban(panel, username, gb, days);
      return { key: panelKey(panel), kind, status };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "خطای ناشناخته در ارتباط با Provider";
      return {
        key: panelKey(panel),
        kind,
        status: error instanceof RainApiError ? 502 : 500,
        error: detail.slice(0, 240),
      };
    }
  }));
  if (!results.length || !results.some((result) => result.status >= 200 && result.status < 300)) {
    throw new RainApiError("No configured Rain panel accepted the service.", results);
  }
  return { ok: true, results };
}

export function createServiceUsername(customerId: number): string {
  return `u${customerId}_${randomBytes(3).toString("hex")}`;
}

export function createSubscriptionToken(): string {
  return randomBytes(16).toString("hex");
}