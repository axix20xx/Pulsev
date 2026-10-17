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

export async function readSavedWireGuardProviderUsernames(
  serviceIds: number[],
): Promise<Map<number, { providerKey: string | null; username: string | null }>> {
  const ids = [...new Set(serviceIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const accounts = new Map<number, { providerKey: string | null; username: string | null }>();
  if (!ids.length) return accounts;
  const result = await pool.query<{ service_id: number | string; delivery_secret: string }>(
    `SELECT service_id, delivery_secret
     FROM reseller_service_wireguard_accounts
     WHERE service_id = ANY($1::bigint[])`,
    [ids],
  );
  for (const row of result.rows) {
    const serviceId = Number(row.service_id);
    const decoded = decryptPanelCredential(row.delivery_secret);
    let providerKey: string | null = null;
    let username: string | null = null;
    if (decoded) {
      try {
        const delivery = JSON.parse(decoded) as { core?: unknown; provider_key?: unknown; username?: unknown };
        if (delivery.core === "wireguard") {
          providerKey = typeof delivery.provider_key === "string" && delivery.provider_key.trim()
            ? delivery.provider_key.trim()
            : null;
          username = typeof delivery.username === "string" && delivery.username.trim()
            ? delivery.username.trim()
            : null;
        }
      } catch {
        // Retain a null map entry so callers know an account exists but its
        // provider identity cannot safely be used.
      }
    }
    accounts.set(serviceId, { providerKey, username });
  }
  return accounts;
}

export async function readSavedIpsecProviderUsernames(
  serviceIds: number[],
): Promise<Map<number, { providerKey: string | null; username: string | null }>> {
  const ids = [...new Set(serviceIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const accounts = new Map<number, { providerKey: string | null; username: string | null }>();
  if (!ids.length) return accounts;
  const result = await pool.query<{ service_id: number | string; delivery_secret: string }>(
    `SELECT service_id, delivery_secret
     FROM reseller_service_ipsec_accounts
     WHERE service_id = ANY($1::bigint[])`,
    [ids],
  );
  for (const row of result.rows) {
    const serviceId = Number(row.service_id);
    const decoded = decryptPanelCredential(row.delivery_secret);
    let providerKey: string | null = null;
    let username: string | null = null;
    if (decoded) {
      try {
        const delivery = JSON.parse(decoded) as { core?: unknown; provider_key?: unknown; username?: unknown };
        if (delivery.core === "ipsec") {
          providerKey = typeof delivery.provider_key === "string" && delivery.provider_key.trim()
            ? delivery.provider_key.trim()
            : null;
          username = typeof delivery.username === "string" && delivery.username.trim()
            ? delivery.username.trim()
            : null;
        }
      } catch {
        // Keep the account entry unresolved; callers must preserve its usage and lifecycle state.
      }
    }
    accounts.set(serviceId, { providerKey, username });
  }
  return accounts;
}

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
const azadPanelCoreCache = new Map<string, { core: string; expiresAt: number }>();
const providerAuditQueues = new Map<string, Promise<void>>();
const providerAuditLastRequest = new Map<string, number>();

function panelKey(panel: Panel): string {
  return panel.key?.trim() || panel.api_base;
}

function panelKind(panel: Panel): "rain_admin" | "falcon" | "marzban" | "azadpanel" {
  const kind = panel.kind?.trim().toLowerCase();
  if (kind === "rain_admin") return "rain_admin";
  if (kind === "falcon") return "falcon";
  if (kind === "azadpanel" || kind === "azadpanel_openvpn" || kind === "azadpanel_wireguard" || kind === "azadpanel_ipsec") return "azadpanel";
  return "marzban";
}

function panelEnvCredential(key: string | undefined, suffix: "USER" | "PASS" | "API_KEY"): string | undefined {
  const normalized = key?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (!normalized) return undefined;
  return process.env[`RAIN_${normalized}_${suffix}`]?.trim() || undefined;
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
    admin_user: decryptPanelCredential(panel.username_secret) ?? panelEnvCredential(panel.key, "USER"),
    admin_pass: decryptPanelCredential(panel.password_secret) ?? panelEnvCredential(panel.key, "PASS"),
    api_key: decryptPanelCredential(panel.api_key_secret) ?? panelEnvCredential(panel.key, "API_KEY"),
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
    /^[A-Za-z0-9+/=_-]+$/.test(compact)
  ) {
    try {
      const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const decoded = Buffer.from(padded, "base64").toString("utf8").trim();
      if (decoded && /(?:[a-z][a-z0-9+.-]*):\/\//i.test(decoded)) {
        return { text: decoded, encoded: true };
      }
    } catch {
      // Keep the original response when it is not valid base64.
    }
  }
  return { text: trimmed, encoded: false };
}

const COUNTRY_FLAGS: Array<[RegExp, string]> = [
  [/(?:^|[^a-z])(iran|ir)(?:[^a-z]|$)|ایران/i, "🇮🇷"],
  [/(?:^|[^a-z])(germany|de)(?:[^a-z]|$)|آلمان/i, "🇩🇪"],
  [/(?:^|[^a-z])(france|fr)(?:[^a-z]|$)|فرانسه/i, "🇫🇷"],
  [/(?:^|[^a-z])(netherlands|holland|nl)(?:[^a-z]|$)|هلند/i, "🇳🇱"],
  [/(?:^|[^a-z])(finland|fi)(?:[^a-z]|$)|فنلاند/i, "🇫🇮"],
  [/(?:^|[^a-z])(sweden|se)(?:[^a-z]|$)|سوئد/i, "🇸🇪"],
  [/(?:^|[^a-z])(switzerland|ch)(?:[^a-z]|$)|سوئیس/i, "🇨🇭"],
  [/(?:^|[^a-z])(united kingdom|england|uk|gb)(?:[^a-z]|$)|انگلیس/i, "🇬🇧"],
  [/(?:^|[^a-z])(united states|usa|us)(?:[^a-z]|$)|آمریکا/i, "🇺🇸"],
  [/(?:^|[^a-z])(canada|ca)(?:[^a-z]|$)|کانادا/i, "🇨🇦"],
  [/(?:^|[^a-z])(turkey|tr)(?:[^a-z]|$)|ترکیه/i, "🇹🇷"],
  [/(?:^|[^a-z])(russia|ru)(?:[^a-z]|$)|روسیه/i, "🇷🇺"],
  [/(?:^|[^a-z])(uae|united arab emirates|ae)(?:[^a-z]|$)|امارات/i, "🇦🇪"],
  [/(?:^|[^a-z])(singapore|sg)(?:[^a-z]|$)|سنگاپور/i, "🇸🇬"],
  [/(?:^|[^a-z])(japan|jp)(?:[^a-z]|$)|ژاپن/i, "🇯🇵"],
];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function countryFlag(value: string): string {
  const existing = value.match(/\p{Regional_Indicator}{2}/u)?.[0];
  if (existing) return existing;
  return COUNTRY_FLAGS.find(([pattern]) => pattern.test(value))?.[1] ?? "🌐";
}

function brandedConfigLink(raw: string, index: number): string {
  const value = raw.trim();
  if (!value || value.startsWith("#")) return raw;
  const vmess = value.match(/^vmess:\/\/(.+)$/i);
  if (vmess) {
    try {
      const json = JSON.parse(Buffer.from(vmess[1], "base64").toString("utf8"));
      if (json && typeof json === "object") {
        const flag = countryFlag(`${String(json.ps ?? "")} ${String(json.add ?? "")}`);
        json.ps = `Pulse - ${flag} ${String(index).padStart(2, "0")}`;
        return `vmess://${Buffer.from(JSON.stringify(json), "utf8").toString("base64")}`;
      }
    } catch {
      // Fall through to the generic fragment renamer.
    }
  }
  if (!isClientConfigUri(value)) return raw;
  const hashAt = value.indexOf("#");
  const base = hashAt >= 0 ? value.slice(0, hashAt) : value;
  const oldName = hashAt >= 0 ? safeDecode(value.slice(hashAt + 1)) : "";
  const flag = countryFlag(`${oldName} ${base}`);
  return `${base}#${encodeURIComponent(`Pulse - ${flag} ${String(index).padStart(2, "0")}`)}`;
}

export function brandSubscriptionBody(body: string): string {
  const decoded = decodeSubscriptionBody(body);
  let configIndex = 0;
  const branded = decoded.text
    .split(/\r?\n/)
    .map((line) => {
      if (!isClientConfigUri(line.trim())) return line;
      configIndex += 1;
      return brandedConfigLink(line, configIndex);
    })
    .join("\n")
    .trim();
  return decoded.encoded ? Buffer.from(branded, "utf8").toString("base64") : branded;
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
    if (kind === "azadpanel") continue;
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
): Promise<{ status: number; json: any; text: string; contentDisposition: string | null }> {
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
  return {
    status: response.status,
    json,
    text,
    contentDisposition: response.headers.get("content-disposition"),
  };
}

async function tokenFor(panel: Panel, forceRefresh = false): Promise<string> {
  const key = panelKey(panel);
  if (!forceRefresh && tokenCache.has(key)) return tokenCache.get(key)!;
  const kind = panelKind(panel);
  if (kind === "falcon") {
    if (!panel.api_key) throw new RainApiError(`Panel ${key} has no API key`);
    return panel.api_key;
  }
  if (kind === "azadpanel") {
    if (!panel.admin_user || !panel.admin_pass) {
      throw new RainApiError(`AzadPanel ${key} has no username or password`);
    }
    let response: Response;
    try {
      response = await fetch(`${panel.api_base}/api/admin/token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: panel.admin_user,
          password: panel.admin_pass,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new RainApiError(`Could not authenticate with AzadPanel ${key} (network error)`);
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
    const retryAfter = response.headers.get("retry-after");
    const retryHint = response.status === 429 && retryAfter
      ? `; retry after ${retryAfter}`
      : "";
    throw new RainApiError(`Could not authenticate with AzadPanel ${key} (HTTP ${response.status}${retryHint})`);
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
    if (panelKind(panel) === "azadpanel") {
      const core = await azadPanelCore(panel, true);
      const configuredKind = panel.kind?.trim().toLowerCase();
      const requiredCore = configuredKind === "azadpanel_wireguard" ? "wireguard" : "openvpn";
      if (core !== requiredCore) {
        return { ok: false, detail: `AzadPanel core is ${core || "unknown"}; ${requiredCore} is required.` };
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

export type PasarguardConnectionUser = {
  panel_key: string;
  username: string;
  status: string;
  online: boolean;
  online_at: string | null;
  used_traffic: number;
  data_limit: number | null;
  expire: string | null;
  group_names: string[];
};

export async function listPasarguardConnectionUsers(
  ownerId?: number,
  role?: string,
): Promise<PasarguardConnectionUser[]> {
  const rainPanels = (await panels(ownerId, role)).filter((panel) => panelKind(panel) === "rain_admin");
  const recentAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const results = await Promise.all(rainPanels.map(async (panel) => {
    const query = new URLSearchParams({
      limit: "200",
      sort: "-online_at",
      online_after: recentAfter,
    });
    try {
      const response = await panelRequest(panel, "GET", `/api/users?${query.toString()}`);
      if (response.status < 200 || response.status >= 300) return [];
      const users = Array.isArray(response.json?.users)
        ? response.json.users
        : Array.isArray(response.json)
          ? response.json
          : [];
      return users.flatMap((user: any) => {
        const username = typeof user?.username === "string" ? user.username.trim() : "";
        if (!username) return [];
        const onlineAt = typeof user.online_at === "string" ? user.online_at : null;
        const online = Boolean(user.online) || (
          onlineAt ? Date.now() - new Date(onlineAt).getTime() <= 15 * 60 * 1000 : false
        );
        return [{
          panel_key: panelKey(panel),
          username,
          status: typeof user.status === "string" ? user.status : "unknown",
          online,
          online_at: onlineAt,
          used_traffic: Number(user.used_traffic ?? 0),
          data_limit: user.data_limit === null || user.data_limit === undefined ? null : Number(user.data_limit),
          expire: typeof user.expire === "string" ? user.expire : null,
          group_names: Array.isArray(user.group_names) ? user.group_names.filter((item: unknown): item is string => typeof item === "string") : [],
        }];
      });
    } catch {
      return [];
    }
  }));
  const seen = new Set<string>();
  return results.flat().filter((user) => {
    const key = `${user.panel_key}:${user.username}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Number(b.online) - Number(a.online) || (b.online_at ?? "").localeCompare(a.online_at ?? ""));
}

async function panelRequest(
  panel: Panel,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string; contentDisposition: string | null }> {
  let token = await tokenFor(panel);
  let response = await request(panel, method, path, token, body);
  if (response.status === 401) {
    tokenCache.delete(panelKey(panel));
    token = await tokenFor(panel, true);
    response = await request(panel, method, path, token, body);
  }
  return response;
}

async function azadPanelCore(panel: Panel, forceRefresh = false): Promise<string> {
  const key = panelKey(panel);
  const configuredKind = panel.kind?.trim().toLowerCase();
  const expectedCore = configuredKind === "azadpanel_wireguard"
    ? "wireguard"
    : configuredKind === "azadpanel_ipsec"
      ? "ipsec"
    : configuredKind === "azadpanel_openvpn"
      ? "openvpn"
      : null;
  const cached = azadPanelCoreCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    if (!expectedCore || cached.core === expectedCore) return cached.core;
    azadPanelCoreCache.delete(key);
  }
  const response = await panelRequest(panel, "GET", "/api/admin");
  if (response.status < 200 || response.status >= 300) {
    throw new RainApiError(`Could not read AzadPanel ${key} settings: ${safeError(response)}`);
  }
  const core = typeof response.json?.core === "string" ? response.json.core.trim().toLowerCase() : "";
  if (!core) throw new RainApiError(`AzadPanel ${key} did not return a core type.`);
  if (expectedCore && core !== expectedCore) {
    throw new RainApiError(`AzadPanel ${key} is configured for ${expectedCore} but reports ${core || "unknown"}.`);
  }
  azadPanelCoreCache.set(key, { core, expiresAt: Date.now() + 5 * 60_000 });
  return core;
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
  username: string;
  usedBytes: number;
  totalBytes: number | null;
  expiresAt: string | null;
  stale?: boolean;
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
    ["used_gb", "usage_gb", "data_used_gb", "traffic_used_gb", "used_traffic_gb", "data_limit_used_gb"],
  );
  if (direct !== null) return direct;
  const upload = bytesValue(payload, ["upload", "upload_bytes", "up", "uplink"]);
  const download = bytesValue(payload, ["download", "download_bytes", "down", "downlink"]);
  return upload === null && download === null ? null : Math.round((upload ?? 0) + (download ?? 0));
}

async function lastKnownPanelUsage(username: string, key: string): Promise<PanelUsage | null> {
  const existing = await pool.query<{ upload: number; download: number; offset_bytes: number }>(
    `SELECT COALESCE(upload, 0)::float8 AS upload,
            COALESCE(download, 0)::float8 AS download,
            COALESCE(offset_bytes, 0)::float8 AS offset_bytes
     FROM user_panel_usages
     WHERE username = $1 AND panel_key = $2
     ORDER BY id DESC LIMIT 1`,
    [username, key],
  );
  const row = existing.rows[0];
  if (!row) return null;
  return {
    panelKey: key,
    username,
    usedBytes: Math.max(0, Math.round(Number(row.upload) + Number(row.download) - Number(row.offset_bytes))),
    totalBytes: null,
    expiresAt: null,
    stale: true,
  };
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
  serviceId: number,
  username: string,
  falcoConfigId: number | null,
  ownerId?: number,
  role?: string,
): Promise<PanelUsage[]> {
  const result: PanelUsage[] = [];
  const configuredPanels = await panels(ownerId, role);
  let wireGuardAccounts = new Map<number, { providerKey: string | null; username: string | null }>();
  let wireGuardLookupFailed = false;
  let ipsecAccounts = new Map<number, { providerKey: string | null; username: string | null }>();
  let ipsecLookupFailed = false;
  try {
    wireGuardAccounts = await readSavedWireGuardProviderUsernames([serviceId]);
  } catch {
    wireGuardLookupFailed = true;
  }
  try {
    ipsecAccounts = await readSavedIpsecProviderUsernames([serviceId]);
  } catch {
    ipsecLookupFailed = true;
  }
  const safePanelRequest = async (panel: Panel, method: string, path: string): Promise<{ status: number; json: any; text: string } | null> => {
    try {
      return await panelRequest(panel, method, path);
    } catch {
      return null;
    }
  };
  for (const panel of configuredPanels) {
    const wireGuardPanel = panel.kind?.trim().toLowerCase() === "azadpanel_wireguard";
    const ipsecPanel = panel.kind?.trim().toLowerCase() === "azadpanel_ipsec";
    let requestUsername = username;
    if (wireGuardPanel) {
      if (!wireGuardLookupFailed && !wireGuardAccounts.has(serviceId)) continue;
      const savedAccount = wireGuardAccounts.get(serviceId);
      if (wireGuardLookupFailed || !savedAccount?.providerKey) {
        result.push({
          panelKey: panelKey(panel),
          username: "",
          usedBytes: 0,
          totalBytes: null,
          expiresAt: null,
          stale: true,
        });
        continue;
      }
      if (savedAccount.providerKey !== panelKey(panel)) continue;
      if (!savedAccount.username) {
        result.push({
          panelKey: panelKey(panel),
          username: "",
          usedBytes: 0,
          totalBytes: null,
          expiresAt: null,
          stale: true,
        });
        continue;
      }
      requestUsername = savedAccount.username;
    }
    if (ipsecPanel) {
      if (!ipsecLookupFailed && !ipsecAccounts.has(serviceId)) continue;
      const savedAccount = ipsecAccounts.get(serviceId);
      if (ipsecLookupFailed || !savedAccount?.providerKey) {
        result.push({
          panelKey: panelKey(panel),
          username: "",
          usedBytes: 0,
          totalBytes: null,
          expiresAt: null,
          stale: true,
        });
        continue;
      }
      if (savedAccount.providerKey !== panelKey(panel)) continue;
      if (!savedAccount.username) {
        result.push({
          panelKey: panelKey(panel),
          username: "",
          usedBytes: 0,
          totalBytes: null,
          expiresAt: null,
          stale: true,
        });
        continue;
      }
      requestUsername = savedAccount.username;
    }
    const kind = panelKind(panel);
    let response: { status: number; json: any; text: string } | null = null;
    if (kind === "falcon") {
      response = await safePanelRequest(
        panel,
        "GET",
        falcoConfigId ? `/api/v1/configs/${encodeURIComponent(String(falcoConfigId))}` : `/api/v1/configs?username=${encodeURIComponent(requestUsername)}`,
      );
      if (response?.status === 200 && !falcoConfigId && Array.isArray(response.json?.data)) {
        const match = response.json.data.find((item: any) => String(item?.username ?? item?.name ?? "") === requestUsername);
        response = match ? { ...response, json: match } : response;
      }
    } else {
      const encoded = encodeURIComponent(requestUsername);
      const paths = kind === "azadpanel"
        ? [`/api/user/${encoded}`]
        : kind === "rain_admin"
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
          const matched = findUserPayload(response.json, requestUsername);
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
    if (!response || response.status < 200 || response.status >= 300) {
      if (wireGuardPanel || ipsecPanel) {
        const stale = await lastKnownPanelUsage(requestUsername, panelKey(panel));
        result.push(stale ?? {
          panelKey: panelKey(panel),
          username: requestUsername,
          usedBytes: 0,
          totalBytes: null,
          expiresAt: null,
          stale: true,
        });
      } else if (response?.status !== 404) {
        const stale = await lastKnownPanelUsage(requestUsername, panelKey(panel));
        if (stale) result.push(stale);
      }
      continue;
    }
    const payload = findUserPayload(response.json, requestUsername) ?? nestedPayload(response.json);
    const usedBytes = usedBytesValue(payload);
    if (usedBytes === null) {
      const stale = await lastKnownPanelUsage(requestUsername, panelKey(panel));
      if (stale) result.push(stale);
      else if (wireGuardPanel || ipsecPanel) {
        result.push({
          panelKey: panelKey(panel),
          username: requestUsername,
          usedBytes: 0,
          totalBytes: null,
          expiresAt: null,
          stale: true,
        });
      }
      continue;
    }
    result.push({
      panelKey: panelKey(panel),
      username: requestUsername,
      usedBytes,
      totalBytes: bytesValue(payload, ["data_limit", "data_limit_bytes", "total_bytes", "quota_bytes"], ["data_limit_gb", "limit_gb", "quota_gb"]),
      expiresAt: expiryValue(payload),
    });
  }
  const savedAccount = wireGuardAccounts.get(serviceId);
  if (wireGuardLookupFailed) {
    result.push({
      panelKey: "WireGuard",
      username: "",
      usedBytes: 0,
      totalBytes: null,
      expiresAt: null,
      stale: true,
    });
  } else if (savedAccount && !savedAccount.providerKey) {
    if (!result.some((usage) => configuredPanels.some((panel) =>
      panel.kind?.trim().toLowerCase() === "azadpanel_wireguard"
      && usage.panelKey === panelKey(panel),
    ))) {
      result.push({
        panelKey: "WireGuard",
        username: "",
        usedBytes: 0,
        totalBytes: null,
        expiresAt: null,
        stale: true,
      });
    }
  } else if (
    savedAccount?.providerKey
    && !configuredPanels.some((panel) =>
      panel.kind?.trim().toLowerCase() === "azadpanel_wireguard"
      && panelKey(panel) === savedAccount.providerKey,
    )
  ) {
    result.push({
      panelKey: savedAccount.providerKey,
      username: "",
      usedBytes: 0,
      totalBytes: null,
      expiresAt: null,
      stale: true,
    });
  }
  const savedIpsecAccount = ipsecAccounts.get(serviceId);
  if (ipsecLookupFailed) {
    result.push({
      panelKey: "IPsec",
      username: "",
      usedBytes: 0,
      totalBytes: null,
      expiresAt: null,
      stale: true,
    });
  } else if (savedIpsecAccount && !savedIpsecAccount.providerKey) {
    if (!result.some((usage) => configuredPanels.some((panel) =>
      panel.kind?.trim().toLowerCase() === "azadpanel_ipsec"
      && usage.panelKey === panelKey(panel),
    ))) {
      result.push({
        panelKey: "IPsec",
        username: "",
        usedBytes: 0,
        totalBytes: null,
        expiresAt: null,
        stale: true,
      });
    }
  } else if (
    savedIpsecAccount?.providerKey
    && !configuredPanels.some((panel) =>
      panel.kind?.trim().toLowerCase() === "azadpanel_ipsec"
      && panelKey(panel) === savedIpsecAccount.providerKey,
    )
  ) {
    result.push({
      panelKey: savedIpsecAccount.providerKey,
      username: "",
      usedBytes: 0,
      totalBytes: null,
      expiresAt: null,
      stale: true,
    });
  }
  return result;
}

export async function disablePanelUser(
  username: string,
  falcoConfigId: number | null,
  serviceId: number,
  ownerId?: number,
  role?: string,
): Promise<{ attempted: number; disabled: number }> {
  let attempted = 0;
  let disabled = 0;
  const configuredPanels = await panels(ownerId, role);
  let wireGuardAccounts = new Map<number, { providerKey: string | null; username: string | null }>();
  let wireGuardLookupFailed = false;
  let ipsecAccounts = new Map<number, { providerKey: string | null; username: string | null }>();
  let ipsecLookupFailed = false;
  try {
    wireGuardAccounts = await readSavedWireGuardProviderUsernames([serviceId]);
  } catch {
    wireGuardLookupFailed = true;
  }
  try {
    ipsecAccounts = await readSavedIpsecProviderUsernames([serviceId]);
  } catch {
    ipsecLookupFailed = true;
  }
  const savedWireGuardAccount = wireGuardAccounts.get(serviceId);
  const wireGuardAccountUnresolved = wireGuardLookupFailed
    ? true
    : Boolean(savedWireGuardAccount && (
      !savedWireGuardAccount.providerKey
      || !savedWireGuardAccount.username
      || !configuredPanels.some((panel) =>
      panel.kind?.trim().toLowerCase() === "azadpanel_wireguard"
      && panelKey(panel) === savedWireGuardAccount.providerKey,
      )
    ));
  if (wireGuardAccountUnresolved) attempted += 1;
  const savedIpsecAccount = ipsecAccounts.get(serviceId);
  const ipsecAccountUnresolved = ipsecLookupFailed
    ? true
    : Boolean(savedIpsecAccount && (
      !savedIpsecAccount.providerKey
      || !savedIpsecAccount.username
      || !configuredPanels.some((panel) =>
        panel.kind?.trim().toLowerCase() === "azadpanel_ipsec"
        && panelKey(panel) === savedIpsecAccount.providerKey,
      )
    ));
  if (ipsecAccountUnresolved) attempted += 1;
  for (const panel of configuredPanels) {
    const kind = panelKind(panel);
    let providerUsername = username;
    if (panel.kind?.trim().toLowerCase() === "azadpanel_wireguard") {
      if (wireGuardAccountUnresolved || !savedWireGuardAccount || savedWireGuardAccount.providerKey !== panelKey(panel)) continue;
      if (!savedWireGuardAccount.username) continue;
      providerUsername = savedWireGuardAccount.username;
    }
    if (panel.kind?.trim().toLowerCase() === "azadpanel_ipsec") {
      if (ipsecAccountUnresolved || !savedIpsecAccount || savedIpsecAccount.providerKey !== panelKey(panel)) continue;
      if (!savedIpsecAccount.username) continue;
      providerUsername = savedIpsecAccount.username;
    }
    attempted += 1;
    const encoded = encodeURIComponent(providerUsername);
    const candidates: Array<[string, string, unknown]> = kind === "falcon"
      ? (falcoConfigId ? [["PATCH", `/api/v1/configs/${encodeURIComponent(String(falcoConfigId))}`, { status: "disabled" }]] : [])
      : kind === "rain_admin"
        ? [["PUT", `/api/user/${encoded}`, { status: "disabled" }]]
        : kind === "azadpanel"
          ? [["PUT", `/api/user/${encoded}`, { status: "disabled" }]]
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

export type ProviderAccountAuditService = {
  username: string;
  falcoConfigId: number | null;
  expiresAt: string;
  quotaBytes: number;
  usedBytes: number;
};

export type ProviderAccountAuditMatch = {
  providerKey: string;
  providerKind: string;
  providerStatus: string;
  expiresAt: string;
  remainingBytes: number;
};

export type ProviderAccountAuditIssue = {
  providerKey: string;
  providerKind: string;
  message: string;
};

export type ProviderAccountAuditScan = {
  enabledPanelCount: number;
  matches: ProviderAccountAuditMatch[];
  issues: ProviderAccountAuditIssue[];
};

async function pacedAuditPanelRequest(
  panel: Panel,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  const key = panelKey(panel);
  const previous = providerAuditQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  providerAuditQueues.set(key, queued);
  await previous;
  const waitMs = Math.max(0, 1_000 - (Date.now() - (providerAuditLastRequest.get(key) ?? 0)));
  if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  providerAuditLastRequest.set(key, Date.now());
  try {
    return await panelRequest(panel, method, path, body);
  } finally {
    release();
    if (providerAuditQueues.get(key) === queued) providerAuditQueues.delete(key);
  }
}

function providerAccountPath(
  panel: Panel,
  username: string,
  falcoConfigId: number | null,
): string | null {
  if (panelKind(panel) === "falcon") {
    return falcoConfigId
      ? `/api/v1/configs/${encodeURIComponent(String(falcoConfigId))}`
      : `/api/v1/configs?username=${encodeURIComponent(username)}`;
  }
  return `/api/user/${encodeURIComponent(username)}`;
}

function providerAccountStatus(payload: any): string {
  const status = String(payload?.status ?? payload?.state ?? payload?.account_status ?? "")
    .trim()
    .toLowerCase();
  if (status) return status;
  if (
    payload?.is_disabled === true ||
    payload?.enabled === false ||
    payload?.enabled === 0 ||
    payload?.is_active === false ||
    payload?.is_active === 0
  ) {
    return "disabled";
  }
  return "";
}

function isProviderAccountDisabled(status: string): boolean {
  return ["disabled", "inactive", "deactivated"].includes(status);
}

async function inspectProviderAccount(
  panel: Panel,
  service: ProviderAccountAuditService,
): Promise<{
  found: boolean;
  status: string;
  expiresAt: string | null;
  remainingBytes: number;
}> {
  const path = providerAccountPath(panel, service.username, service.falcoConfigId);
  if (!path) return { found: false, status: "", expiresAt: null, remainingBytes: 0 };
  const response = await pacedAuditPanelRequest(panel, "GET", path);
  if (response.status === 404) {
    return { found: false, status: "", expiresAt: null, remainingBytes: 0 };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new RainApiError(`HTTP ${response.status}`);
  }
  const payload = findUserPayload(response.json, service.username) ?? nestedPayload(response.json);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RainApiError("Provider returned no account details.");
  }
  const status = providerAccountStatus(payload);
  const remoteExpiry = expiryValue(payload);
  const expiresAt = remoteExpiry ?? service.expiresAt;
  const expiry = new Date(expiresAt);
  const localRemaining = Math.max(0, service.quotaBytes - service.usedBytes);
  const providerQuota = bytesValue(
    payload,
    ["data_limit", "data_limit_bytes", "total_bytes", "quota_bytes", "traffic_limit_bytes"],
    ["data_limit_gb", "limit_gb", "quota_gb", "traffic_limit_gb"],
  );
  const providerUsed = usedBytesValue(payload);
  const remoteRemaining =
    providerQuota !== null && providerQuota > 0 && providerUsed !== null
      ? Math.max(0, providerQuota - providerUsed)
      : null;
  const remainingBytes =
    remoteRemaining === null ? localRemaining : Math.min(localRemaining, remoteRemaining);
  return {
    found: true,
    status,
    expiresAt,
    remainingBytes,
  };
}

export async function scanProviderAccountsForService(
  service: ProviderAccountAuditService,
): Promise<ProviderAccountAuditScan> {
  const configured = await panels();
  const matches: ProviderAccountAuditMatch[] = [];
  const issues: ProviderAccountAuditIssue[] = [];
  for (const panel of configured) {
    const key = panelKey(panel);
    const kind = panelKind(panel);
    try {
      const account = await inspectProviderAccount(panel, service);
      if (
        account.found &&
        isProviderAccountDisabled(account.status) &&
        account.expiresAt !== null &&
        new Date(account.expiresAt).getTime() > Date.now() &&
        account.remainingBytes > 0
      ) {
        matches.push({
          providerKey: key,
          providerKind: kind,
          providerStatus: account.status,
          expiresAt: account.expiresAt,
          remainingBytes: account.remainingBytes,
        });
      }
    } catch (error) {
      issues.push({
        providerKey: key,
        providerKind: kind,
        message: error instanceof RainApiError && /^HTTP \d{3}$/.test(error.message)
          ? `پاسخ پنل: ${error.message}`
          : "جزئیات حساب از پنل خوانده نشد؛ هیچ اصلاحی انجام نشد.",
      });
    }
  }
  return { enabledPanelCount: configured.length, matches, issues };
}

export async function reactivateProviderAccountStatus(
  service: ProviderAccountAuditService,
  providerKey: string,
): Promise<{ outcome: "repaired" | "skipped"; message: string }> {
  const panel = (await panels()).find((candidate) => panelKey(candidate) === providerKey);
  if (!panel) throw new RainApiError("Provider is not enabled or has no configured credentials.");

  const account = await inspectProviderAccount(panel, service);
  if (!account.found) throw new RainApiError("Provider account was not found.");
  if (
    !isProviderAccountDisabled(account.status) ||
    !account.expiresAt ||
    new Date(account.expiresAt).getTime() <= Date.now() ||
    account.remainingBytes <= 0
  ) {
    return {
      outcome: "skipped",
      message: "Provider account changed or no longer has remaining time and quota; no update was sent.",
    };
  }

  const kind = panelKind(panel);
  const path = providerAccountPath(panel, service.username, service.falcoConfigId);
  if (!path) throw new RainApiError("Provider account cannot be safely identified.");
  const candidates: Array<[string, string]> = kind === "falcon"
    ? [["PATCH", path]]
    : kind === "rain_admin" || kind === "azadpanel"
      ? [["PUT", path]]
      : [["PATCH", path], ["PUT", path]];

  let last = { status: 0, json: null, text: "" };
  for (const [method, candidatePath] of candidates) {
    last = await pacedAuditPanelRequest(panel, method, candidatePath, { status: "active" });
    if (last.status >= 200 && last.status < 300) {
      return {
        outcome: "repaired",
        message: "Account status was reactivated; quota, expiry, and traffic counters were not changed.",
      };
    }
    if (![405, 422].includes(last.status)) break;
  }
  throw new RainApiError(`Provider rejected the status-only repair: ${safeError(last)}`);
}

function groupIdsFromUser(value: any): number[] {
  const payload = nestedPayload(value);
  const direct = Array.isArray(payload?.group_ids) ? payload.group_ids : [];
  const groups = Array.isArray(payload?.groups)
    ? payload.groups.map((group: any) => group?.id)
    : [];
  return [...new Set([...direct, ...groups, 1]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
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
  resetUsage: boolean,
): Promise<number> {
  const encoded = encodeURIComponent(username);
  const existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  const body = {
    username,
    status: "active",
    expire: Math.floor((Date.now() + Math.max(0, days) * 86_400_000) / 1000),
    data_limit: bytesForGb(gb),
    data_limit_reset_strategy: "no_reset",
    group_ids: existing.status === 200 ? groupIdsFromUser(existing.json) : [1],
    note: `Pulse provisioned ${new Date().toISOString()}`,
  };
  const candidates: Array<[string, string]> = existing.status === 200
    ? [["PUT", `/api/user/${encoded}`]]
    : [["POST", "/api/user"]];
  let last = { status: 0, json: null, text: "" };
  for (const [method, path] of candidates) {
    last = await panelRequest(panel, method, path, body);
    if (last.status >= 200 && last.status < 300) {
      if (resetUsage && existing.status === 200) {
        const reset = await panelRequest(panel, "POST", `/api/user/${encoded}/reset`);
        if (reset.status < 200 || reset.status >= 300) {
          throw new RainApiError(
            `PasarGuard panel ${panelKey(panel)} updated the plan but could not reset usage: ${safeError(reset)}`,
          );
        }
      }
      return last.status;
    }
    if (![404, 405, 422].includes(last.status)) break;
  }
  throw new RainApiError(`Rain panel ${panelKey(panel)} rejected the user: ${safeError(last)}`);
}

function azadPanelUserBody(username: string, gb: number, expiresAt: Date): Record<string, unknown> {
  return {
    username,
    status: "active",
    expire: Math.floor(expiresAt.getTime() / 1000),
    data_limit: bytesForGb(gb),
    data_limit_reset_strategy: "no_reset",
    device_limit: 2,
    note: `Pulse service ${username}`,
    proxies: { vless: {} },
    inbounds: {},
  };
}

async function provisionAzadPanel(
  panel: Panel,
  username: string,
  gb: number,
  days: number,
  resetUsage: boolean,
): Promise<number> {
  const core = await azadPanelCore(panel);
  if (core !== "openvpn") {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} is configured for ${core}, not OpenVPN.`);
  }
  const encoded = encodeURIComponent(username);
  const existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  if (existing.status !== 200 && existing.status !== 404) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} could not check the user: ${safeError(existing)}`);
  }
  const expiresAt = new Date(Date.now() + Math.max(0, days) * 86_400_000);
  const body = existing.status === 200
    ? {
        status: "active",
        expire: Math.floor(expiresAt.getTime() / 1000),
        data_limit: bytesForGb(gb),
        data_limit_reset_strategy: "no_reset",
      }
    : azadPanelUserBody(username, gb, expiresAt);
  const response = existing.status === 200
    ? await panelRequest(panel, "PUT", `/api/user/${encoded}`, body)
    : await panelRequest(panel, "POST", "/api/user", body);
  if (response.status < 200 || response.status >= 300) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} rejected the user: ${safeError(response)}`);
  }
  if (resetUsage && existing.status === 200) {
    const reset = await panelRequest(panel, "POST", `/api/user/${encoded}/reset`);
    if (reset.status < 200 || reset.status >= 300) {
      throw new RainApiError(`AzadPanel ${panelKey(panel)} updated the plan but could not reset usage: ${safeError(reset)}`);
    }
  }
  return response.status;
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
  options?: { resetUsage?: boolean },
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
          ? await provisionRainAdmin(panel, username, gb, days, options?.resetUsage === true)
          : kind === "azadpanel"
            ? await provisionAzadPanel(panel, username, gb, days, options?.resetUsage === true)
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

export async function repairXrayProviderUser(
  username: string,
  gb: number,
  expiresAt: Date,
  providerKey: string,
  ownerId?: number,
  role?: string,
): Promise<{ key: string; kind: "rain_admin" | "marzban"; status: number }> {
  const panel = (await panels(ownerId, role)).find((candidate) => panelKey(candidate) === providerKey);
  if (!panel) {
    throw new RainApiError("Provider انتخاب‌شده فعال یا دارای credential نیست.");
  }
  const kind = panelKind(panel);
  if (kind !== "rain_admin" && kind !== "marzban") {
    throw new RainApiError("تعمیر فقط برای Providerهای Xray پشتیبانی می‌شود.");
  }
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new RainApiError("اعتبار سرویس پایان یافته است؛ هیچ تغییری در Provider انجام نشد.");
  }

  const encodedUsername = encodeURIComponent(username);
  const existing = await panelRequest(panel, "GET", `/api/user/${encodedUsername}`);
  if (existing.status !== 200) {
    const detail = existing.status === 404
      ? "کاربر در این Provider پیدا نشد؛ حساب جدیدی ساخته نشد."
      : `Provider نتوانست حساب را بخواند: ${safeError(existing)}`;
    throw new RainApiError(detail);
  }

  const current = nestedPayload(existing.json);
  const body: Record<string, unknown> = {
    username,
    status: "active",
    expire: Math.floor(expiresAt.getTime() / 1000),
    data_limit: bytesForGb(gb),
    data_limit_reset_strategy:
      typeof current?.data_limit_reset_strategy === "string"
        ? current.data_limit_reset_strategy
        : "no_reset",
  };

  if (kind === "rain_admin") {
    body.group_ids = groupIdsFromUser(existing.json);
  }
  for (const field of [
    "group_ids",
    "proxies",
    "inbounds",
    "excluded_inbounds",
    "proxy_settings",
    "note",
  ]) {
    if (field === "group_ids" && kind === "rain_admin") continue;
    if (current?.[field] !== undefined && current[field] !== null) {
      body[field] = current[field];
    }
  }

  const response = await panelRequest(panel, "PUT", `/api/user/${encodedUsername}`, body);
  if (response.status < 200 || response.status >= 300) {
    throw new RainApiError(`Provider ${panelKey(panel)} تعمیر را نپذیرفت: ${safeError(response)}`);
  }
  return { key: panelKey(panel), kind, status: response.status };
}

export type OpenVpnLocation = {
  id: string;
  name: string;
};

export type OpenVpnDelivery = {
  provider_key: string;
  server: string;
  username: string;
  password: string;
  core: "openvpn";
  locations: OpenVpnLocation[];
};

export async function prepareOpenVpnAccount(
  username: string,
  gb: number,
  expiresAt: Date,
  ownerId?: number,
  role?: string,
  requestedPanelKey?: string,
): Promise<OpenVpnDelivery> {
  const openVpnPanels = (await panels(ownerId, role)).filter((panel) => panelKind(panel) === "azadpanel");
  const panel = requestedPanelKey
    ? openVpnPanels.find((candidate) => panelKey(candidate) === requestedPanelKey)
    : openVpnPanels[0];
  if (!panel) throw new RainApiError("No enabled AzadPanel OpenVPN provider is configured.");
  if (await azadPanelCore(panel) !== "openvpn") {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} is not configured for OpenVPN.`);
  }

  const encoded = encodeURIComponent(username);
  let existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  if (existing.status === 404) {
    const created = await panelRequest(panel, "POST", "/api/user", azadPanelUserBody(username, gb, expiresAt));
    if (created.status < 200 || created.status >= 300) {
      if (created.status !== 409) {
        throw new RainApiError(`AzadPanel ${panelKey(panel)} could not create the OpenVPN account: ${safeError(created)}`);
      }
      existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
      if (existing.status !== 200) {
        throw new RainApiError(`AzadPanel ${panelKey(panel)} could not confirm the OpenVPN account: ${safeError(existing)}`);
      }
    }
  } else if (existing.status !== 200) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} could not check the OpenVPN account: ${safeError(existing)}`);
  }

  const configsResponse = await panelRequest(panel, "GET", `/api/ovpn/user/${encoded}/configs`);
  if (configsResponse.status < 200 || configsResponse.status >= 300) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} could not read OpenVPN locations: ${safeError(configsResponse)}`);
  }
  const configsData = configsResponse.json?.data ?? configsResponse.json;
  let importData = configsData?.import;
  if (!importData || typeof importData !== "object") {
    const importResponse = await panelRequest(panel, "GET", `/api/ovpn/user/${encoded}/import`);
    if (importResponse.status < 200 || importResponse.status >= 300) {
      throw new RainApiError(`AzadPanel ${panelKey(panel)} could not read OpenVPN login details: ${safeError(importResponse)}`);
    }
    importData = importResponse.json?.data ?? importResponse.json;
  }
  const rawLocations = Array.isArray(configsData?.locations)
    ? configsData.locations
    : Array.isArray(configsData?.endpoints)
      ? configsData.endpoints
      : Array.isArray(importData?.locations)
        ? importData.locations
        : [];
  const locations = rawLocations.flatMap((location: any): OpenVpnLocation[] => {
    const rawId = location?.id ?? location?.host_id ?? location?.host;
    if (rawId === null || rawId === undefined || String(rawId).trim() === "") return [];
    const id = String(rawId).trim();
    const name = typeof location?.name === "string" && location.name.trim()
      ? location.name.trim()
      : `Location ${id}`;
    return [{ id, name }];
  });
  const server = typeof importData?.server === "string" ? importData.server.trim() : "";
  const importUsername = typeof importData?.username === "string" ? importData.username : "";
  const password = typeof importData?.password === "string" ? importData.password : "";
  if (!server || !importUsername || !password || !locations.length) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} returned incomplete OpenVPN import details.`);
  }
  return {
    provider_key: panelKey(panel),
    server,
    username: importUsername,
    password,
    core: "openvpn",
    locations,
  };
}

export async function downloadOpenVpnProfile(
  username: string,
  providerKey: string,
  hostId?: string,
  ownerId?: number,
  role?: string,
): Promise<{ body: string; contentType: string }> {
  const panel = (await panels(ownerId, role)).find(
    (candidate) => panelKey(candidate) === providerKey && panelKind(candidate) === "azadpanel",
  );
  if (!panel) throw new RainApiError("The selected AzadPanel OpenVPN provider is unavailable.");
  if (await azadPanelCore(panel) !== "openvpn") {
    throw new RainApiError(`AzadPanel ${providerKey} is not configured for OpenVPN.`);
  }
  const encoded = encodeURIComponent(username);
  const path = hostId
    ? `/api/ovpn/user/${encoded}/config?host=${encodeURIComponent(hostId)}`
    : `/api/ovpn/user/${encoded}/bundle`;
  const response = await panelRequest(panel, "GET", path);
  if (response.status < 200 || response.status >= 300 || !response.text.trim()) {
    throw new RainApiError(`AzadPanel ${providerKey} could not download the OpenVPN profile: ${safeError(response)}`);
  }
  return { body: response.text, contentType: "text/plain; charset=utf-8" };
}

export type WireGuardLocation = {
  id: string;
  name: string;
};

export type WireGuardDelivery = {
  provider_key: string;
  username: string;
  core: "wireguard";
  locations: WireGuardLocation[];
};

function azadPanelWireGuardEndpoints(value: any): any[] {
  const payload = value?.data ?? value;
  return Array.isArray(payload?.endpoints) ? payload.endpoints : [];
}

function wireGuardLocationId(endpoint: any): string {
  const id = endpoint?.id ?? endpoint?.host_id;
  return id === null || id === undefined ? "" : String(id).trim();
}

async function findAzadPanelCore(
  expectedCore: "wireguard" | "ipsec",
  ownerId?: number,
  role?: string,
  requestedPanelKey?: string,
): Promise<Panel> {
  const candidates = (await panels(ownerId, role))
    .filter((panel) => panelKind(panel) === "azadpanel")
    .filter((panel) => !requestedPanelKey || panelKey(panel) === requestedPanelKey);
  let lastError: unknown = null;
  for (const panel of candidates) {
    try {
      if (await azadPanelCore(panel) === expectedCore) return panel;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new RainApiError(`No enabled AzadPanel ${expectedCore === "wireguard" ? "WireGuard" : "IPsec"} provider is configured.`);
}

async function listWireGuardEndpoints(panel: Panel, username: string): Promise<any[]> {
  let response: Awaited<ReturnType<typeof panelRequest>> | null = null;
  for (const delayMs of [0, 1_000, 2_000, 4_000, 8_000]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await panelRequest(panel, "GET", `/api/wg/user/${encodeURIComponent(username)}/configs`);
    if (response.status !== 503) break;
  }
  if (!response) throw new RainApiError(`AzadPanel ${panelKey(panel)} did not return WireGuard locations.`);
  if (response.status < 200 || response.status >= 300) {
    throw new RainApiError(
      `AzadPanel ${panelKey(panel)} could not read WireGuard locations: ${safeError(response)}`,
    );
  }
  return azadPanelWireGuardEndpoints(response.json);
}

export async function prepareWireGuardAccount(
  username: string,
  gb: number,
  expiresAt: Date,
  serviceId: number,
  ownerId?: number,
  role?: string,
): Promise<WireGuardDelivery> {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    throw new RainApiError("Invalid service ID for WireGuard account.");
  }
  const panel = await findAzadPanelCore("wireguard", ownerId, role);
  let providerUsername = username;
  let encoded = encodeURIComponent(providerUsername);
  let existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);

  if (existing.status === 403) {
    providerUsername = `pulsewg_${serviceId}`;
    encoded = encodeURIComponent(providerUsername);
    existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
    if (existing.status === 403) {
      throw new RainApiError(
        `AzadPanel ${panelKey(panel)} cannot access the dedicated WireGuard account ${providerUsername}: ${safeError(existing)}. Confirm this Provider login belongs to the intended reseller and is not blocked.`,
      );
    }
  }

  if (existing.status === 404) {
    const created = await panelRequest(
      panel,
      "POST",
      "/api/user",
      azadPanelUserBody(providerUsername, gb, expiresAt),
    );
    if (created.status < 200 || created.status >= 300) {
      if (created.status !== 409) {
        throw new RainApiError(
          `AzadPanel ${panelKey(panel)} could not create the WireGuard account: ${safeError(created)}`,
        );
      }
      existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
      if (existing.status !== 200) {
        throw new RainApiError(
          `AzadPanel ${panelKey(panel)} could not confirm the WireGuard account: ${safeError(existing)}`,
        );
      }
    }
  } else if (existing.status !== 200) {
    throw new RainApiError(
      `AzadPanel ${panelKey(panel)} could not check the WireGuard account: ${safeError(existing)}`,
    );
  }

  const endpointData = await listWireGuardEndpoints(panel, providerUsername);
  const locations = endpointData.flatMap(
    (endpoint: any): WireGuardLocation[] => {
      const id = wireGuardLocationId(endpoint);
      if (!id) return [];
      const name = typeof endpoint?.name === "string" && endpoint.name.trim()
        ? endpoint.name.trim().slice(0, 120)
        : `Location ${id}`;
      return [{ id, name }];
    },
  );
  if (!locations.length) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} returned no ready WireGuard locations.`);
  }
  return {
    provider_key: panelKey(panel),
    username: providerUsername,
    core: "wireguard",
    locations,
  };
}

export type IpsecLocation = {
  id: string;
  name: string;
  server: string;
  ikev2_remote_id: string;
};

export type IpsecDelivery = {
  provider_key: string;
  username: string;
  core: "ipsec";
  login: string;
  password: string;
  locations: IpsecLocation[];
};

function azadPanelIpsecLocations(value: any): IpsecLocation[] {
  const payload = value?.data ?? value;
  if (!Array.isArray(payload?.locations)) return [];
  return payload.locations.flatMap((location: any): IpsecLocation[] => {
    const id = String(location?.id ?? "").trim();
    const server = String(location?.server ?? "").trim();
    const remoteId = String(location?.ikev2_remote_id ?? "").trim();
    if (!id || !server || !remoteId) return [];
    const name = typeof location?.name === "string" && location.name.trim()
      ? location.name.trim().slice(0, 120)
      : server;
    return [{ id: id.slice(0, 120), name, server: server.slice(0, 253), ikev2_remote_id: remoteId.slice(0, 253) }];
  });
}

export async function prepareIpsecAccount(
  gb: number,
  expiresAt: Date,
  serviceId: number,
  ownerId?: number,
  role?: string,
  requestedPanelKey?: string,
): Promise<IpsecDelivery> {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    throw new RainApiError("Invalid service ID for IPsec account.");
  }
  const panel = await findAzadPanelCore("ipsec", ownerId, role, requestedPanelKey);
  const providerUsername = `pulseipsec_${serviceId}`;
  const encoded = encodeURIComponent(providerUsername);
  let existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  if (existing.status === 404) {
    const created = await panelRequest(panel, "POST", "/api/user", azadPanelUserBody(providerUsername, gb, expiresAt));
    if (created.status < 200 || created.status >= 300) {
      if (created.status !== 409) {
        throw new RainApiError(`AzadPanel ${panelKey(panel)} could not create the IPsec account: ${safeError(created)}`);
      }
      existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
      if (existing.status !== 200) {
        throw new RainApiError(`AzadPanel ${panelKey(panel)} could not confirm the IPsec account: ${safeError(existing)}`);
      }
    }
  } else if (existing.status !== 200) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} could not check the IPsec account: ${safeError(existing)}`);
  }

  let response: Awaited<ReturnType<typeof panelRequest>> | null = null;
  for (const delayMs of [0, 1_000, 2_000, 4_000, 8_000]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await panelRequest(panel, "GET", `/api/ipsec/user/${encoded}/configs`);
    if (response.status !== 503) break;
  }
  if (!response || response.status < 200 || response.status >= 300) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} could not load IPsec settings: ${response ? safeError(response) : "no response"}`);
  }
  const payload = response.json?.data ?? response.json;
  const login = typeof payload?.login === "string" ? payload.login.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  const locations = azadPanelIpsecLocations(payload);
  if (!login || !password || !locations.length) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} returned incomplete IPsec credentials or server locations.`);
  }
  return { provider_key: panelKey(panel), username: providerUsername, core: "ipsec", login, password, locations };
}

async function findIpsecProvider(
  providerKey: string,
  ownerId?: number,
  role?: string,
): Promise<Panel> {
  const panel = (await panels(ownerId, role)).find(
    (candidate) => panelKey(candidate) === providerKey && panelKind(candidate) === "azadpanel",
  );
  if (!panel) throw new RainApiError("The selected AzadPanel IPsec provider is unavailable.");
  if (await azadPanelCore(panel) !== "ipsec") {
    throw new RainApiError(`AzadPanel ${providerKey} is not configured for IPsec.`);
  }
  return panel;
}

export async function downloadIpsecAppleProfile(
  username: string,
  providerKey: string,
  ownerId?: number,
  role?: string,
): Promise<{ body: string; contentType: string; contentDisposition: string | null }> {
  const panel = await findIpsecProvider(providerKey, ownerId, role);
  const encoded = encodeURIComponent(username);
  const response = await panelRequest(panel, "GET", `/api/ipsec/user/${encoded}/file?kind=apple`);
  if (response.status < 200 || response.status >= 300 || !response.text.trim()) {
    throw new RainApiError(`AzadPanel ${providerKey} could not download the IPsec iOS profile: ${safeError(response)}`);
  }
  return {
    body: response.text,
    contentType: "application/x-apple-aspen-config",
    contentDisposition: response.contentDisposition,
  };
}

async function findWireGuardProvider(
  providerKey: string,
  ownerId?: number,
  role?: string,
): Promise<Panel> {
  const panel = (await panels(ownerId, role)).find(
    (candidate) => panelKey(candidate) === providerKey && panelKind(candidate) === "azadpanel",
  );
  if (!panel) throw new RainApiError("The selected AzadPanel WireGuard provider is unavailable.");
  if (await azadPanelCore(panel) !== "wireguard") {
    throw new RainApiError(`AzadPanel ${providerKey} is not configured for WireGuard.`);
  }
  return panel;
}

export async function downloadWireGuardProfile(
  username: string,
  providerKey: string,
  hostId: string,
  ownerId?: number,
  role?: string,
): Promise<{ body: string; contentType: string; contentDisposition: string | null }> {
  const panel = await findWireGuardProvider(providerKey, ownerId, role);
  const endpoints = await listWireGuardEndpoints(panel, username);
  const endpoint = endpoints.find((candidate) => wireGuardLocationId(candidate) === hostId);
  if (!endpoint) {
    throw new RainApiError("The requested WireGuard location is not available for this account.");
  }
  return downloadWireGuardEndpointConfig(panel, username, providerKey, hostId, endpoint);
}

async function downloadWireGuardEndpointConfig(
  panel: Panel,
  username: string,
  providerKey: string,
  hostId: string,
  endpoint: any,
): Promise<{ body: string; contentType: string; contentDisposition: string | null }> {
  if (typeof endpoint?.config_url !== "string") {
    throw new RainApiError("AzadPanel did not return a WireGuard configuration path for this location.");
  }
  let configUrl: URL;
  try {
    configUrl = new URL(endpoint.config_url, panel.api_base);
  } catch {
    throw new RainApiError("AzadPanel returned an invalid WireGuard configuration path.");
  }
  const panelOrigin = new URL(panel.api_base).origin;
  const expectedPath = `/api/wg/user/${encodeURIComponent(username)}/config`;
  if (
    configUrl.origin !== panelOrigin ||
    configUrl.pathname !== expectedPath ||
    configUrl.searchParams.get("host") !== hostId
  ) {
    throw new RainApiError("AzadPanel returned an unsafe WireGuard configuration path.");
  }
  const response = await panelRequest(panel, "GET", `${configUrl.pathname}${configUrl.search}`);
  if (response.status < 200 || response.status >= 300 || !response.text.trim()) {
    throw new RainApiError(
      `AzadPanel ${providerKey} could not download the WireGuard profile: ${safeError(response)}`,
    );
  }
  return {
    body: response.text,
    contentType: "text/plain; charset=utf-8",
    contentDisposition: response.contentDisposition,
  };
}

export async function downloadWireGuardProfiles(
  username: string,
  providerKey: string,
  hostIds: string[],
  ownerId?: number,
  role?: string,
): Promise<Array<{ hostId: string; body: string; contentType: string; contentDisposition: string | null }>> {
  const panel = await findWireGuardProvider(providerKey, ownerId, role);
  const endpoints = await listWireGuardEndpoints(panel, username);
  const requestedHostIds = [...new Set(hostIds)];
  if (!requestedHostIds.length || requestedHostIds.length > 40) {
    throw new RainApiError("The WireGuard profile bundle must contain between 1 and 40 servers.");
  }
  const selected = requestedHostIds.map((hostId) => {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(hostId)) {
      throw new RainApiError("Invalid WireGuard server identity.");
    }
    const endpoint = endpoints.find((candidate) => wireGuardLocationId(candidate) === hostId);
    if (!endpoint) {
      throw new RainApiError("A requested WireGuard server is no longer available for this account.");
    }
    return { hostId, endpoint };
  });
  return Promise.all(selected.map(async ({ hostId, endpoint }) => ({
    hostId,
    ...await downloadWireGuardEndpointConfig(panel, username, providerKey, hostId, endpoint),
  })));
}

export async function downloadWireGuardBundle(
  username: string,
  providerKey: string,
  ownerId?: number,
  role?: string,
): Promise<{ body: string; contentType: string; contentDisposition: string | null }> {
  const panel = await findWireGuardProvider(providerKey, ownerId, role);
  const response = await panelRequest(
    panel,
    "GET",
    `/api/wg/user/${encodeURIComponent(username)}/bundle`,
  );
  if (response.status < 200 || response.status >= 300 || !response.text.trim()) {
    throw new RainApiError(
      `AzadPanel ${providerKey} could not download the WireGuard bundle: ${safeError(response)}`,
    );
  }
  return {
    body: response.text,
    contentType: "text/plain; charset=utf-8",
    contentDisposition: response.contentDisposition,
  };
}

export function createServiceUsername(customerId: number): string {
  return `u${customerId}_${randomBytes(8).toString("hex")}`;
}

export function createSubscriptionToken(): string {
  return randomBytes(16).toString("hex");
}