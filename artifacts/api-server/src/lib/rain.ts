import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { decryptPanelCredential } from "./panel-credentials";
import { parsePasarGuardWireGuardArchive } from "./pasarguard-wireguard-archive";
import { samePasarGuardInstance } from "./pasarguard-instance";
import { parsePasarGuardGroupIds } from "./pasarguard-groups";
import {
  ensureRainAdminBackfillAccount,
  RainAdminBackfillError,
} from "./rain-admin-wireguard-account";
import { renewAzadPanelAccount } from "./azadpanel-renewal";
import { isRetryableAzadPanelStatus } from "./azadpanel-retry-policy";
import { azadPanelV2RayCollisionUsername } from "./azadpanel-v2ray-username";
import { shouldPersistAzadPanelV2RayAccountMapping } from "./azadpanel-v2ray-backfill";
import { azadPanelOpenVpnCollisionUsername, shouldUseAzadPanelOpenVpnCollision } from "./azadpanel-openvpn-identity";
import {
  azadPanelExpectedCore,
  azadPanelXrayDeliveryDisposition,
  azadPanelXraySubscriptionLinks,
  azadPanelXraySubscriptionPath,
  azadPanelXrayUserPath,
  isAzadPanelCoreCandidate,
  isStandardServiceProvisioningPanel,
  standardServiceProvisioningPanels,
  uniqueRainAdminPanelEntries,
  mergeAzadPanelXraySubscriptionFeeds,
} from "./panel-protocol-policy";
import {
  providerConfigLabel,
  subscriptionProviderShortCodes,
} from "./subscription-provider-labels";

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

type AzadPanelXrayReadRoute = "user" | "denied";
const azadPanelXrayReadRouteCache = new Map<string, {
  route: AzadPanelXrayReadRoute;
  expiresAt: number;
}>();
const AZAD_PANEL_XRAY_USER_ROUTE_TTL_MS = 10 * 60_000;
const AZAD_PANEL_XRAY_DENIED_TTL_MS = 2 * 60_000;

function getAzadPanelXrayReadRoute(key: string): AzadPanelXrayReadRoute | null {
  const entry = azadPanelXrayReadRouteCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    azadPanelXrayReadRouteCache.delete(key);
    return null;
  }
  return entry.route;
}

function cacheAzadPanelXrayReadRoute(
  key: string,
  route: AzadPanelXrayReadRoute,
  ttlMs: number,
): void {
  const now = Date.now();
  if (azadPanelXrayReadRouteCache.size > 5000) {
    for (const [entryKey, entry] of azadPanelXrayReadRouteCache) {
      if (entry.expiresAt <= now) azadPanelXrayReadRouteCache.delete(entryKey);
    }
    while (azadPanelXrayReadRouteCache.size > 5000) {
      const oldestKey = azadPanelXrayReadRouteCache.keys().next().value;
      if (oldestKey === undefined) break;
      azadPanelXrayReadRouteCache.delete(oldestKey);
    }
  }
  azadPanelXrayReadRouteCache.set(key, { route, expiresAt: now + ttlMs });
}

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
  const result = await pool.query<{
    service_id: number | string;
    provider_key: string | null;
    provider_username: string | null;
  }>(
    `SELECT service_id, provider_key, provider_username
     FROM reseller_service_ipsec_accounts
     WHERE service_id = ANY($1::bigint[])`,
    [ids],
  );
  for (const row of result.rows) {
    const serviceId = Number(row.service_id);
    const providerKey = typeof row.provider_key === "string" && row.provider_key.trim()
      ? row.provider_key.trim()
      : null;
    const username = typeof row.provider_username === "string" && row.provider_username.trim()
      ? row.provider_username.trim()
      : null;
    accounts.set(serviceId, { providerKey, username });
  }
  return accounts;
}

export async function readSavedAzadPanelV2RayUsernames(
  serviceIds: number[],
): Promise<Map<number, Map<string, string>>> {
  const ids = [...new Set(serviceIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const accounts = new Map<number, Map<string, string>>();
  if (!ids.length) return accounts;
  const result = await pool.query<{
    service_id: number | string;
    provider_key: string;
    provider_username: string;
  }>(
    `SELECT service_id, provider_key, provider_username
     FROM reseller_service_v2ray_accounts
     WHERE service_id = ANY($1::bigint[])`,
    [ids],
  );
  for (const row of result.rows) {
    const serviceId = Number(row.service_id);
    const providerKey = String(row.provider_key ?? "").trim();
    const username = String(row.provider_username ?? "").trim();
    if (!providerKey || !username) continue;
    const perProvider = accounts.get(serviceId) ?? new Map<string, string>();
    perProvider.set(providerKey, username);
    accounts.set(serviceId, perProvider);
  }
  return accounts;
}

export async function readSavedAzadPanelOpenVpnUsernames(
  serviceIds: number[],
): Promise<Map<number, Map<string, string>>> {
  const ids = [...new Set(serviceIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const accounts = new Map<number, Map<string, string>>();
  if (!ids.length) return accounts;
  const result = await pool.query<{
    service_id: number | string;
    provider_key: string;
    provider_username: string;
  }>(
    `SELECT service_id, provider_key, provider_username
     FROM reseller_service_openvpn_provider_accounts
     WHERE service_id = ANY($1::bigint[])`,
    [ids],
  );
  for (const row of result.rows) {
    const serviceId = Number(row.service_id);
    const providerKey = String(row.provider_key ?? "").trim();
    const username = String(row.provider_username ?? "").trim();
    if (!providerKey || !username) continue;
    const perProvider = accounts.get(serviceId) ?? new Map<string, string>();
    perProvider.set(providerKey, username);
    accounts.set(serviceId, perProvider);
  }
  return accounts;
}

type PanelResult = {
  key: string;
  kind: string;
  status: number;
  error?: string;
  retryable?: boolean;
  retryAfterMs?: number;
};

export class RainApiError extends Error {
  readonly results: PanelResult[];
  readonly retryable: boolean;

  constructor(message: string, results: PanelResult[] = [], retryable = true) {
    super(message);
    this.name = "RainApiError";
    this.results = results;
    this.retryable = retryable;
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
  if (kind === "rain_admin" || kind === "rain_admin_wireguard") return "rain_admin";
  if (kind === "falcon") return "falcon";
  if (
    kind === "azadpanel"
    || kind === "azadpanel_v2ray"
    || kind === "azadpanel_openvpn"
    || kind === "azadpanel_wireguard"
    || kind === "azadpanel_ipsec"
  ) return "azadpanel";
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

export async function listAvailablePanels(
  includeProtocolOnly = false,
): Promise<Array<{ key: string; kind: string }>> {
  const configured = await panels();
  const available = includeProtocolOnly
    ? configured
    : standardServiceProvisioningPanels(configured);
  return available.map((panel) => ({ key: panelKey(panel), kind: panelKind(panel) }));
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
  try {
    const base = new URL(panel.api_base);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return new URL(rawUrl, base).toString();
  } catch {
    return `${panel.api_base.replace(/\/+$/, "")}/${rawUrl.replace(/^\/+/, "")}`;
  }
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

function brandedConfigLink(raw: string, index: number, providerCode: string): string {
  const value = raw.trim();
  if (!value || value.startsWith("#")) return raw;
  const vmess = value.match(/^vmess:\/\/(.+)$/i);
  if (vmess) {
    try {
      const json = JSON.parse(Buffer.from(vmess[1], "base64").toString("utf8"));
      if (json && typeof json === "object") {
        const flag = countryFlag(`${String(json.ps ?? "")} ${String(json.add ?? "")}`);
        json.ps = providerConfigLabel(providerCode, flag, index);
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
  return `${base}#${encodeURIComponent(providerConfigLabel(providerCode, flag, index))}`;
}

export function brandSubscriptionBody(body: string, providerCode = "PUL"): string {
  const decoded = decodeSubscriptionBody(body);
  let configIndex = 0;
  const branded = decoded.text
    .split(/\r?\n/)
    .map((line) => {
      if (!isClientConfigUri(line.trim())) return line;
      configIndex += 1;
      return brandedConfigLink(line, configIndex, providerCode);
    })
    .join("\n")
    .trim();
  return decoded.encoded ? Buffer.from(branded, "utf8").toString("base64") : branded;
}

export async function fetchPanelSubscription(
  username: string,
  serviceId?: number,
  ownerId?: number,
  role?: string,
): Promise<{ body: string; contentType: string } | null> {
  const feeds: Array<{ text: string; encoded: boolean; providerCode: string }> = [];
  let v2rayAccounts = new Map<number, Map<string, string>>();
  let v2rayLookupFailed = false;
  if (Number.isSafeInteger(serviceId) && Number(serviceId) > 0) {
    try {
      v2rayAccounts = await readSavedAzadPanelV2RayUsernames([Number(serviceId)]);
    } catch {
      v2rayLookupFailed = true;
    }
  }

  const configuredPanels = await panels(ownerId, role);
  const providerCodes = subscriptionProviderShortCodes(configuredPanels);
  for (const panel of configuredPanels) {
    if (panel.kind?.trim().toLowerCase() === "rain_admin_wireguard") continue;
    const kind = panelKind(panel);
    const providerCode = providerCodes.get(panelKey(panel)) ?? "VPN";
    const isAzadPanelV2Ray = kind === "azadpanel" && panel.kind?.trim().toLowerCase() === "azadpanel_v2ray";
    if (kind === "azadpanel" && !isAzadPanelV2Ray) continue;
    if (isAzadPanelV2Ray && v2rayLookupFailed) continue;
    const savedProviderUsername = isAzadPanelV2Ray && Number.isSafeInteger(serviceId)
      ? v2rayAccounts.get(Number(serviceId))?.get(panelKey(panel)) ?? null
      : null;
    const panelUsername = savedProviderUsername ?? username;
    const encodedUsername = encodeURIComponent(panelUsername);
    const azadXrayUserPath = isAzadPanelV2Ray
      ? azadPanelXrayUserPath(panelUsername)
      : "";
    const azadXrayRouteCacheKey = isAzadPanelV2Ray
      ? `${panelKey(panel)}:${Number.isSafeInteger(serviceId) ? serviceId : username}`
      : "";
    const cachedAzadXrayRoute = isAzadPanelV2Ray
      ? getAzadPanelXrayReadRoute(azadXrayRouteCacheKey)
      : null;
    const azadLookupSuppressed = cachedAzadXrayRoute === "denied";
    const paths = isAzadPanelV2Ray
      ? azadLookupSuppressed
        ? []
        : [cachedAzadXrayRoute === "user"
          ? azadXrayUserPath
          : azadPanelXraySubscriptionPath(panelUsername)]
      : kind === "rain_admin"
        ? [`/api/users/${encodedUsername}`, `/api/user/${encodedUsername}`]
        : kind === "falcon"
          ? [`/api/v1/configs?username=${encodedUsername}`]
          : [`/api/user/${encodedUsername}`];

    let links: string[] = [];
    for (const path of paths) {
      try {
        let response = await panelRequest(panel, "GET", path);
        const linkPath = isAzadPanelV2Ray ? azadPanelXraySubscriptionPath(panelUsername) : "";
        if (
          isAzadPanelV2Ray
          && path === linkPath
          && [403, 404, 405].includes(response.status)
        ) {
          const linkEndpointStatus = response.status;
          response = await panelRequest(panel, "GET", azadXrayUserPath);
          if (response.status >= 200 && response.status < 300) {
            cacheAzadPanelXrayReadRoute(
              azadXrayRouteCacheKey,
              "user",
              AZAD_PANEL_XRAY_USER_ROUTE_TTL_MS,
            );
            console.info("[subscription] AzadPanel Xray link endpoint denied; documented user endpoint succeeded", {
              providerKey: panelKey(panel),
              usernameSource: savedProviderUsername ? "provider_mapping" : "service_username",
            });
          } else if (response.status === 403 || response.status === 404) {
            cacheAzadPanelXrayReadRoute(
              azadXrayRouteCacheKey,
              "denied",
              AZAD_PANEL_XRAY_DENIED_TTL_MS,
            );
            console.warn("[subscription] AzadPanel denied Xray link and user endpoint access", {
              providerKey: panelKey(panel),
              linkEndpointStatus,
              userEndpointStatus: response.status,
              usernameSource: savedProviderUsername ? "provider_mapping" : "service_username",
              retryAfterMs: AZAD_PANEL_XRAY_DENIED_TTL_MS,
            });
          }
        } else if (isAzadPanelV2Ray && path === azadXrayUserPath && response.status === 403) {
          cacheAzadPanelXrayReadRoute(
            azadXrayRouteCacheKey,
            "denied",
            AZAD_PANEL_XRAY_DENIED_TTL_MS,
          );
          console.warn("[subscription] AzadPanel denied the Xray user endpoint", {
            providerKey: panelKey(panel),
            status: response.status,
            usernameSource: savedProviderUsername ? "provider_mapping" : "service_username",
            retryAfterMs: AZAD_PANEL_XRAY_DENIED_TTL_MS,
          });
        }
        if (response.status >= 200 && response.status < 300) {
          links = [...new Set(isAzadPanelV2Ray
            ? azadPanelXraySubscriptionLinks(response.json)
            : collectSubscriptionLinks(response.json))];
          if (
            isAzadPanelV2Ray
            && path === azadXrayUserPath
            && !azadLookupSuppressed
          ) {
            cacheAzadPanelXrayReadRoute(
              azadXrayRouteCacheKey,
              "user",
              AZAD_PANEL_XRAY_USER_ROUTE_TTL_MS,
            );
          }
          if (links.length) break;
        }
        if (isAzadPanelV2Ray) {
          console.warn("[subscription] AzadPanel V2Ray link lookup returned no usable links", {
            providerKey: panelKey(panel),
            status: response.status,
          });
        }
        if (![404, 405].includes(response.status)) break;
      } catch (error) {
        if (isAzadPanelV2Ray) {
          console.warn("[subscription] AzadPanel V2Ray link lookup failed", {
            providerKey: panelKey(panel),
            error: error instanceof Error ? error.name : "unknown",
          });
        }
        // A single unavailable Provider must not prevent another Provider from serving a feed.
      }
    }

    const fallbackConfigLinks: string[] = [];
    const azadPanelSubscriptionFeeds: Array<{ text: string; encoded: boolean }> = [];
    for (const rawLink of links) {
      if (isClientConfigUri(rawLink)) {
        if (isAzadPanelV2Ray) fallbackConfigLinks.push(rawLink);
        else feeds.push({ text: rawLink, encoded: false, providerCode });
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
        if (!response.ok) {
          if (isAzadPanelV2Ray) {
            console.warn("[subscription] AzadPanel V2Ray subscription URL was rejected", {
              providerKey: panelKey(panel),
              status: response.status,
            });
          }
          continue;
        }
        const body = await response.text();
        const decoded = decodeSubscriptionBody(body);
        if (isAzadPanelV2Ray) {
          const containsConfigs = decoded.text
            .split(/\r?\n/)
            .some((line) => isClientConfigUri(line.trim()));
          if (!containsConfigs) {
            console.warn("[subscription] AzadPanel V2Ray subscription URL returned no configs", {
              providerKey: panelKey(panel),
            });
            continue;
          }
        } else if (!body.trim()) {
          continue;
        }
        if (isAzadPanelV2Ray) {
          azadPanelSubscriptionFeeds.push(decoded);
        } else {
          feeds.push({ ...decoded, providerCode });
        }
      } catch (error) {
        if (isAzadPanelV2Ray) {
          console.warn("[subscription] AzadPanel V2Ray subscription URL fetch failed", {
            providerKey: panelKey(panel),
            error: error instanceof Error ? error.name : "unknown",
          });
        }
        // Try the next link or Provider.
      }
    }
    if (isAzadPanelV2Ray) {
      const mergedFeeds = mergeAzadPanelXraySubscriptionFeeds(
        azadPanelSubscriptionFeeds,
        fallbackConfigLinks,
      );
      if (!mergedFeeds.length && !azadLookupSuppressed) {
        console.warn("[subscription] AzadPanel V2Ray returned no usable subscription configs", {
          providerKey: panelKey(panel),
        });
      }
      feeds.push(...mergedFeeds.map((feed) => ({ ...feed, providerCode })));
    }
  }

  if (!feeds.length) return null;
  const text = feeds
    .map((feed) => brandSubscriptionBody(feed.text, feed.providerCode))
    .join("\n")
    .trim();
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
): Promise<{ status: number; json: any; text: string; contentDisposition: string | null; retryAfter: string | null }> {
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
    retryAfter: response.headers.get("retry-after"),
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
    const retryable = response.status === 429 || response.status >= 500;
    throw new RainApiError(
      `Could not authenticate with AzadPanel ${key} (HTTP ${response.status}${retryHint})`,
      [{
        key,
        kind: "azadpanel",
        status: response.status,
        error: `HTTP ${response.status}`,
        retryable,
        retryAfterMs: retryAfterDelayMs({ retryAfter }),
      }],
      retryable,
    );
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
      const requiredCore = azadPanelExpectedCore(panel.kind) ?? "openvpn";
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
  const rainPanels = (await panels(ownerId, role)).filter(
    (panel) => panel.kind?.trim().toLowerCase() === "rain_admin",
  );
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
): Promise<{ status: number; json: any; text: string; contentDisposition: string | null; retryAfter: string | null }> {
  let token = await tokenFor(panel);
  let response = await request(panel, method, path, token, body);
  if (response.status === 401) {
    tokenCache.delete(panelKey(panel));
    token = await tokenFor(panel, true);
    response = await request(panel, method, path, token, body);
  }
  return response;
}

type BinaryPanelResponse = {
  status: number;
  body: Buffer;
  json: any;
  text: string;
  contentDisposition: string | null;
  retryAfter: string | null;
};

async function readLimitedPanelBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RainApiError("PasarGuard WireGuard archive exceeds the supported download size.", [], false);
  }

  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RainApiError("PasarGuard WireGuard archive exceeds the supported download size.", [], false);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

async function panelRequestBinary(
  panel: Panel,
  path: string,
): Promise<BinaryPanelResponse> {
  const perform = async (token: string): Promise<BinaryPanelResponse> => {
    const response = await fetch(`${panel.api_base}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/zip, application/octet-stream",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readLimitedPanelBody(response, 8 * 1024 * 1024);
    const text = response.ok ? "" : body.toString("utf8").slice(0, 4_000);
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      status: response.status,
      body,
      json,
      text,
      contentDisposition: response.headers.get("content-disposition"),
      retryAfter: response.headers.get("retry-after"),
    };
  };

  let token = await tokenFor(panel);
  let response = await perform(token);
  if (response.status === 401) {
    tokenCache.delete(panelKey(panel));
    token = await tokenFor(panel, true);
    response = await perform(token);
  }
  return response;
}

async function loadRainAdminWireGuardConfigs(
  panel: Panel,
  username: string,
): Promise<{
  userId: number;
  archive: Buffer;
  configs: ReturnType<typeof parsePasarGuardWireGuardArchive>;
  contentDisposition: string | null;
}> {
  const matchingMainPanels = await matchingRainAdminPanels(panel);
  const lookupPanels = [...matchingMainPanels, panel];
  const lookupResponses: Array<{ source: "rain_admin" | "wireguard"; response: Awaited<ReturnType<typeof panelRequest>> }> = [];
  let userResponse: Awaited<ReturnType<typeof panelRequest>> | null = null;
  for (const lookupPanel of lookupPanels) {
    const response = await lookupPasarGuardUser(lookupPanel, username);
    lookupResponses.push({
      source: lookupPanel === panel ? "wireguard" : "rain_admin",
      response,
    });
    if (response.status === 200) {
      userResponse = response;
      break;
    }
  }
  if (!userResponse) {
    const lastResponse = lookupResponses.at(-1)?.response;
    const userLookupResponse = lookupResponses.find(({ response }) =>
      ![404, 405].includes(response.status),
    )?.response ?? lastResponse;
    if (!userLookupResponse) {
      throw new RainApiError("PasarGuard did not return a user lookup response.", [], true);
    }
    const allLookupsNotFound = lookupResponses.every(({ response }) =>
      [404, 405].includes(response.status),
    );
    const detail = allLookupsNotFound
      ? matchingMainPanels.length
        ? "PasarGuard user was not found by either the main Rain Admin login or the WireGuard extension. Confirm this service exists on that same panel."
        : "PasarGuard user was not found. Create the service through the configured Rain Admin WireGuard provider, or retry the eligible-service setup from Provider settings."
      : `PasarGuard could not read the WireGuard user: ${safeError(userLookupResponse)}`;
    const retryable = userLookupResponse.status === 408 || userLookupResponse.status === 429 || userLookupResponse.status >= 500;
    const retryAfterSeconds = Number(userLookupResponse.retryAfter);
    const retryAfterDate = userLookupResponse.retryAfter ? Date.parse(userLookupResponse.retryAfter) : Number.NaN;
    throw new RainApiError(
      detail,
      [{
        key: panelKey(panel),
        kind: "rain_admin_wireguard",
        status: userLookupResponse.status,
        error: detail,
        retryable,
        retryAfterMs: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.round(retryAfterSeconds * 1000)
          : Number.isFinite(retryAfterDate)
            ? Math.max(0, retryAfterDate - Date.now())
            : undefined,
      }],
      retryable,
    );
  }

  const user = userResponse.json?.data?.user
    ?? userResponse.json?.data
    ?? userResponse.json?.user
    ?? userResponse.json;
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new RainApiError("PasarGuard did not return a valid user ID for the WireGuard account.", [], false);
  }

  const response = await panelRequestBinary(panel, `/api/user/${userId}/subscription/wireguard`);
  if (response.status < 200 || response.status >= 300) {
    const detail = response.status === 406
      ? "PasarGuard has no WireGuard configs for this user. Enable or assign WireGuard to the user in the panel first."
      : `PasarGuard could not download the WireGuard configs: ${safeError(response)}`;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const retryAfterSeconds = Number(response.retryAfter);
    const retryAfterDate = response.retryAfter ? Date.parse(response.retryAfter) : Number.NaN;
    throw new RainApiError(
      detail,
      [{
        key: panelKey(panel),
        kind: "rain_admin_wireguard",
        status: response.status,
        error: detail,
        retryable,
        retryAfterMs: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.round(retryAfterSeconds * 1000)
          : Number.isFinite(retryAfterDate)
            ? Math.max(0, retryAfterDate - Date.now())
            : undefined,
      }],
      retryable,
    );
  }

  return {
    userId,
    archive: response.body,
    configs: parsePasarGuardWireGuardArchive(response.body),
    contentDisposition: response.contentDisposition,
  };
}

function isRainAdminWireGuardPanel(panel: Panel): boolean {
  return panel.kind?.trim().toLowerCase() === "rain_admin_wireguard";
}

export async function isConfiguredRainAdminWireGuardProvider(
  providerKey: string,
  ownerId?: number,
  role?: string,
): Promise<boolean> {
  const normalizedKey = providerKey.trim();
  if (!normalizedKey) return false;
  return (await panels(ownerId, role)).some(
    (panel) => isRainAdminWireGuardPanel(panel) && panelKey(panel) === normalizedKey,
  );
}

async function matchingRainAdminPanels(panel: Panel): Promise<Panel[]> {
  return (await panels()).filter((candidate) =>
    candidate.kind?.trim().toLowerCase() === "rain_admin"
    && samePasarGuardInstance(candidate.api_base, panel.api_base),
  );
}

async function lookupPasarGuardUser(panel: Panel, username: string) {
  const encodedUsername = encodeURIComponent(username);
  let response = await panelRequest(panel, "GET", `/api/user/${encodedUsername}`);
  if ([404, 405].includes(response.status)) {
    response = await panelRequest(panel, "GET", `/api/user/by-username/${encodedUsername}`);
  }
  return response;
}

export async function ensureRainAdminWireGuardBackfillUser(
  username: string,
  remainingBytes: number | null,
  expiresAtUnix: number | null,
  providerKey: string,
): Promise<{ created: boolean; accountProviderKey: string }> {
  const wireGuardPanel = (await panels()).find(
    (candidate) => isRainAdminWireGuardPanel(candidate) && panelKey(candidate) === providerKey,
  );
  if (!wireGuardPanel) {
    throw new RainApiError(
      "The selected Rain Admin WireGuard provider is disabled or missing credentials.",
      [],
      false,
    );
  }
  const mainPanels = await matchingRainAdminPanels(wireGuardPanel);
  const accountPanels = [...mainPanels, wireGuardPanel];
  let outcome: Awaited<ReturnType<typeof ensureRainAdminBackfillAccount>>;
  try {
    outcome = await ensureRainAdminBackfillAccount(
      { username, remainingBytes, expiresAtUnix },
      accountPanels.map((accountPanel) => ({
        key: panelKey(accountPanel),
        lookup: async () => {
          const response = await lookupPasarGuardUser(accountPanel, username);
          return { status: response.status, error: safeError(response) };
        },
        listGroupIds: async () => {
          try {
            return await readPasarGuardGroupIds(accountPanel);
          } catch (error) {
            return {
              status: 503,
              groupIds: [],
              error: error instanceof Error ? error.message : "Group lookup failed.",
            };
          }
        },
        create: async (body) => {
          const response = await panelRequest(accountPanel, "POST", "/api/user", body);
          return { status: response.status, error: safeError(response) };
        },
      })),
    );
  } catch (error) {
    if (error instanceof RainAdminBackfillError) {
      throw new RainApiError(error.message, [], error.retryable);
    }
    throw error;
  }
  return { created: outcome.created, accountProviderKey: outcome.providerKey };
}

export async function prepareRainAdminWireGuardDelivery(
  username: string,
  providerKey: string,
  ownerId?: number,
  role?: string,
): Promise<WireGuardDelivery> {
  const panel = (await panels(ownerId, role)).find(
    (candidate) => isRainAdminWireGuardPanel(candidate) && panelKey(candidate) === providerKey,
  );
  if (!panel) {
    throw new RainApiError(
      "The selected Rain Admin WireGuard provider is disabled or missing credentials.",
      [],
      false,
    );
  }
  const { configs } = await loadRainAdminWireGuardConfigs(panel, username);
  return {
    provider_key: panelKey(panel),
    username,
    core: "wireguard",
    locations: configs.map(({ id, name }) => ({ id, name })),
  };
}

export async function ensureRainAdminWireGuardDelivery(
  username: string,
  remainingBytes: number | null,
  expiresAtUnix: number | null,
  ownerId?: number,
  role?: string,
): Promise<WireGuardDelivery | null> {
  const providers = (await panels(ownerId, role)).filter(isRainAdminWireGuardPanel);
  if (!providers.length) return null;

  let panel: Panel | undefined;
  if (providers.length === 1) {
    panel = providers[0];
  } else {
    const keys = providers.map(panelKey);
    const mapped = await pool.query<{ panel_key: string }>(
      `SELECT DISTINCT panel_key
       FROM user_panel_usages
       WHERE username = $1 AND panel_key = ANY($2::text[])`,
      [username, keys],
    );
    const mappedKeys = [...new Set(mapped.rows.map((row) => row.panel_key))];
    if (mappedKeys.length === 1) {
      panel = providers.find((candidate) => panelKey(candidate) === mappedKeys[0]);
    }
  }

  if (!panel) {
    throw new RainApiError(
      "More than one Rain Admin WireGuard provider is enabled and this service has no unique provider mapping.",
      [],
      false,
    );
  }

  await ensureRainAdminWireGuardBackfillUser(
    username,
    remainingBytes,
    expiresAtUnix,
    panelKey(panel),
  );
  return prepareRainAdminWireGuardDelivery(username, panelKey(panel), ownerId, role);
}

function isWireGuardDeliveryPanel(panel: Panel): boolean {
  const kind = panel.kind?.trim().toLowerCase();
  return kind === "rain_admin_wireguard" || kind === "azadpanel_wireguard";
}

async function inspectAzadPanelV2RayDelivery(
  panel: Panel,
  username: string,
): Promise<"available" | "denied"> {
  const linkResponse = await panelRequest(
    panel,
    "GET",
    azadPanelXraySubscriptionPath(username),
  );
  const linkCount = linkResponse.status >= 200 && linkResponse.status < 300
    ? azadPanelXraySubscriptionLinks(linkResponse.json).length
    : 0;
  const responses = [{ response: linkResponse, linkCount }];
  const linkRequestIsTransient =
    linkResponse.status === 408 || linkResponse.status === 429 || linkResponse.status >= 500;
  if (linkCount === 0 && !linkRequestIsTransient) {
    const userResponse = await panelRequest(
      panel,
      "GET",
      azadPanelXrayUserPath(username),
    );
    const userLinkCount = userResponse.status >= 200 && userResponse.status < 300
      ? azadPanelXraySubscriptionLinks(userResponse.json).length
      : 0;
    responses.push({ response: userResponse, linkCount: userLinkCount });
  }

  const disposition = azadPanelXrayDeliveryDisposition(
    responses.map(({ response, linkCount: count }) => ({
      status: response.status,
      linkCount: count,
    })),
  );
  if (disposition === "available") return "available";
  if (disposition === "denied") return "denied";

  const failed = responses.find(({ response }) =>
    response.status === 408 || response.status === 429 || response.status >= 500,
  );
  if (disposition === "retryable_error" && failed) {
    const status = failed.response.status;
    const detail = `HTTP ${status}`;
    throw new RainApiError(
      `AzadPanel ${panelKey(panel)} could not verify Xray subscription access: ${detail}`,
      [{
        key: panelKey(panel),
        kind: "azadpanel",
        status,
        error: detail,
        retryable: true,
        retryAfterMs: retryAfterDelayMs(failed.response),
      }],
      true,
    );
  }

  const status = responses.find(({ response }) =>
    response.status < 200 || response.status >= 300,
  )?.response.status ?? 502;
  const error = disposition === "no_links"
    ? "AzadPanel returned no usable Xray subscription links for this account."
    : `AzadPanel Xray subscription access check returned HTTP ${status}.`;
  throw new RainApiError(
    `AzadPanel ${panelKey(panel)}: ${error}`,
    [{
      key: panelKey(panel),
      kind: "azadpanel",
      status,
      error,
      retryable: false,
    }],
    false,
  );
}

async function azadPanelCore(panel: Panel, forceRefresh = false): Promise<string> {
  const key = panelKey(panel);
  const expectedCore = azadPanelExpectedCore(panel.kind);
  const cached = azadPanelCoreCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    if (!expectedCore || cached.core === expectedCore) return cached.core;
    azadPanelCoreCache.delete(key);
  }
  const response = await panelRequest(panel, "GET", "/api/admin");
  if (response.status < 200 || response.status >= 300) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new RainApiError(
      `Could not read AzadPanel ${key} settings: ${safeError(response)}`,
      [{
        key,
        kind: "azadpanel",
        status: response.status,
        error: safeError(response),
        retryable,
        retryAfterMs: retryAfterDelayMs(response),
      }],
      retryable,
    );
  }
  const core = typeof response.json?.core === "string" ? response.json.core.trim().toLowerCase() : "";
  if (!core) {
    const message = `AzadPanel ${key} did not return a core type.`;
    throw new RainApiError(message, [{ key, kind: "azadpanel", status: 502, error: message, retryable: false }], false);
  }
  if (expectedCore && core !== expectedCore) {
    const message = `AzadPanel ${key} is configured for ${expectedCore} but reports ${core || "unknown"}.`;
    throw new RainApiError(message, [{ key, kind: "azadpanel", status: 400, error: message, retryable: false }], false);
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

function retryAfterDelayMs(response: { retryAfter?: string | null }): number | undefined {
  const raw = response.retryAfter?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(delay)) return undefined;
  return Math.min(24 * 60 * 60 * 1000, Math.max(1000, delay));
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
  let v2rayAccounts = new Map<number, Map<string, string>>();
  let v2rayLookupFailed = false;
  let openVpnAccounts = new Map<number, Map<string, string>>();
  let openVpnLookupFailed = false;
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
  try {
    v2rayAccounts = await readSavedAzadPanelV2RayUsernames([serviceId]);
  } catch {
    v2rayLookupFailed = true;
  }
  try {
    openVpnAccounts = await readSavedAzadPanelOpenVpnUsernames([serviceId]);
  } catch {
    openVpnLookupFailed = true;
  }
  const safePanelRequest = async (panel: Panel, method: string, path: string): Promise<{ status: number; json: any; text: string } | null> => {
    try {
      return await panelRequest(panel, method, path);
    } catch {
      return null;
    }
  };
  for (const panel of uniqueRainAdminPanelEntries(configuredPanels)) {
    const panelType = panel.kind?.trim().toLowerCase();
    const azadPanelWireGuard = panelType === "azadpanel_wireguard";
    const rainAdminWireGuard = isRainAdminWireGuardPanel(panel);
    const wireGuardPanel = azadPanelWireGuard || rainAdminWireGuard;
    const ipsecPanel = panel.kind?.trim().toLowerCase() === "azadpanel_ipsec";
    const v2rayPanel = panel.kind?.trim().toLowerCase() === "azadpanel_v2ray";
    const openVpnPanel = isAzadPanelCoreCandidate(panel.kind, "openvpn");
    let requestUsername = username;
    if (openVpnPanel) {
      if (openVpnLookupFailed) {
        const stale = await lastKnownPanelUsage(username, panelKey(panel));
        result.push(stale ?? {
          panelKey: panelKey(panel),
          username,
          usedBytes: 0,
          totalBytes: null,
          expiresAt: null,
          stale: true,
        });
        continue;
      }
      requestUsername = openVpnAccounts.get(serviceId)?.get(panelKey(panel)) ?? username;
    }
    if (v2rayPanel) {
      if (v2rayLookupFailed) {
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
      requestUsername = v2rayAccounts.get(serviceId)?.get(panelKey(panel)) ?? username;
    }
    if (azadPanelWireGuard) {
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
    if (rainAdminWireGuard) {
      const savedAccount = wireGuardAccounts.get(serviceId);
      if (wireGuardLookupFailed || (savedAccount && !savedAccount.providerKey)) {
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
      if (savedAccount?.providerKey === panelKey(panel)) {
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
      isWireGuardDeliveryPanel(panel)
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
      isWireGuardDeliveryPanel(panel)
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
  let v2rayAccounts = new Map<number, Map<string, string>>();
  let v2rayLookupFailed = false;
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
  try {
    v2rayAccounts = await readSavedAzadPanelV2RayUsernames([serviceId]);
  } catch {
    v2rayLookupFailed = true;
  }
  const savedWireGuardAccount = wireGuardAccounts.get(serviceId);
  const wireGuardAccountUnresolved = wireGuardLookupFailed
    ? true
    : Boolean(savedWireGuardAccount && (
      !savedWireGuardAccount.providerKey
      || !savedWireGuardAccount.username
      || !configuredPanels.some((panel) =>
      isWireGuardDeliveryPanel(panel)
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
  if (v2rayLookupFailed) {
    attempted += configuredPanels.filter(
      (panel) => panel.kind?.trim().toLowerCase() === "azadpanel_v2ray",
    ).length;
  }
  for (const panel of uniqueRainAdminPanelEntries(configuredPanels)) {
    const kind = panelKind(panel);
    let providerUsername = username;
    if (panel.kind?.trim().toLowerCase() === "azadpanel_v2ray") {
      if (v2rayLookupFailed) continue;
      providerUsername = v2rayAccounts.get(serviceId)?.get(panelKey(panel)) ?? username;
    }
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
  serviceId: number;
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
  let v2rayAccounts = new Map<number, Map<string, string>>();
  let v2rayLookupFailed = false;
  try {
    v2rayAccounts = await readSavedAzadPanelV2RayUsernames([service.serviceId]);
  } catch {
    v2rayLookupFailed = true;
  }
  for (const panel of configured) {
    const key = panelKey(panel);
    const kind = panelKind(panel);
    const isV2ray = panel.kind?.trim().toLowerCase() === "azadpanel_v2ray";
    if (isV2ray && v2rayLookupFailed) {
      issues.push({
        providerKey: key,
        providerKind: kind,
        message: "شناسهٔ کاربر اختصاصی V2Ray در پایگاه داده خوانده نشد؛ هیچ اصلاحی انجام نشد.",
      });
      continue;
    }
    const providerService = isV2ray
      ? {
          ...service,
          username: v2rayAccounts.get(service.serviceId)?.get(key) ?? service.username,
        }
      : service;
    try {
      const account = await inspectProviderAccount(panel, providerService);
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

  let providerService = service;
  if (panel.kind?.trim().toLowerCase() === "azadpanel_v2ray") {
    const accounts = await readSavedAzadPanelV2RayUsernames([service.serviceId]);
    providerService = {
      ...service,
      username: accounts.get(service.serviceId)?.get(providerKey) ?? service.username,
    };
  }
  const account = await inspectProviderAccount(panel, providerService);
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
  const path = providerAccountPath(panel, providerService.username, service.falcoConfigId);
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
  return [...new Set([...direct, ...groups]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
}

async function readPasarGuardGroupIds(
  panel: Panel,
): Promise<{ status: number; groupIds: number[]; error?: string }> {
  let lastResponse: Awaited<ReturnType<typeof panelRequest>> | null = null;
  for (const path of ["/api/groups/simple", "/api/groups"]) {
    const response = await panelRequest(panel, "GET", path);
    lastResponse = response;
    if (response.status < 200 || response.status >= 300) continue;

    const groupIds = parsePasarGuardGroupIds(response.json);
    if (groupIds.length) return { status: response.status, groupIds };
  }
  return {
    status: lastResponse?.status ?? 503,
    groupIds: [],
    error: lastResponse
      ? safeError(lastResponse) || "PasarGuard returned no valid group IDs."
      : "PasarGuard did not return a group list.",
  };
}

async function requiredPasarGuardGroupIds(panel: Panel): Promise<number[]> {
  const result = await readPasarGuardGroupIds(panel);
  if (result.status < 200 || result.status >= 300) {
    const retryable = result.status === 408 || result.status === 429 || result.status >= 500;
    throw new RainApiError(
      `PasarGuard panel ${panelKey(panel)} could not list account groups: ${result.error || `HTTP ${result.status}`}`,
      [{
        key: panelKey(panel),
        kind: "rain_admin",
        status: result.status,
        error: result.error,
        retryable,
      }],
      retryable,
    );
  }
  if (!result.groupIds.length) {
    throw new RainApiError(
      `PasarGuard panel ${panelKey(panel)} has no groups available; the account was not created.`,
      [],
      false,
    );
  }
  return result.groupIds;
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
  if (existing.status !== 200 && ![404, 405].includes(existing.status)) {
    throw new RainApiError(
      `PasarGuard panel ${panelKey(panel)} could not check the existing user: ${safeError(existing)}`,
      [{ key: panelKey(panel), kind: "rain_admin", status: existing.status, error: safeError(existing) }],
      existing.status === 408 || existing.status === 429 || existing.status >= 500,
    );
  }
  const existingGroups = existing.status === 200 ? groupIdsFromUser(existing.json) : [];
  const body = {
    username,
    status: "active",
    expire: Math.floor((Date.now() + Math.max(0, days) * 86_400_000) / 1000),
    data_limit: bytesForGb(gb),
    data_limit_reset_strategy: "no_reset",
    group_ids: existingGroups.length ? existingGroups : await requiredPasarGuardGroupIds(panel),
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

function azadPanelUserBody(username: string, gb: number, expiresAt: Date | null): Record<string, unknown> {
  return {
    username,
    status: "active",
    expire: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
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
  options: {
    resetUsage?: boolean;
    expiresAtUnix?: number | null;
    onlyIfMissingAzadPanel?: boolean;
    serviceId?: number;
  },
): Promise<number> {
  const core = await azadPanelCore(panel);
  const expectedCore = azadPanelExpectedCore(panel.kind) ?? "openvpn";
  if (core !== expectedCore) {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} is configured for ${core}, not ${expectedCore}.`);
  }
  const isAzadPanelV2Ray = panel.kind?.trim().toLowerCase() === "azadpanel_v2ray";
  const isAzadPanelOpenVpn = !isAzadPanelV2Ray && expectedCore === "openvpn";
  const serviceId = options.serviceId;
  let providerUsername = username;
  if (isAzadPanelV2Ray && Number.isSafeInteger(serviceId) && Number(serviceId) > 0) {
    const saved = await pool.query<{ provider_username: string }>(
      `SELECT provider_username
       FROM reseller_service_v2ray_accounts
       WHERE service_id = $1 AND provider_key = $2`,
      [serviceId, panelKey(panel)],
    );
    if (saved.rows[0]?.provider_username?.trim()) {
      providerUsername = saved.rows[0].provider_username.trim();
    }
  } else if (isAzadPanelOpenVpn && Number.isSafeInteger(serviceId) && Number(serviceId) > 0) {
    const saved = await pool.query<{ provider_username: string }>(
      `SELECT provider_username
       FROM reseller_service_openvpn_provider_accounts
       WHERE service_id = $1 AND provider_key = $2
       LIMIT 1`,
      [serviceId, panelKey(panel)],
    );
    if (saved.rows[0]?.provider_username?.trim()) {
      providerUsername = saved.rows[0].provider_username.trim();
    }
  }
  let encoded = encodeURIComponent(providerUsername);
  let existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  if (
    isAzadPanelV2Ray
    && providerUsername === username
    && existing.status === 403
  ) {
    const collisionUsername = azadPanelV2RayCollisionUsername(Number(serviceId));
    if (collisionUsername) {
      providerUsername = collisionUsername;
      encoded = encodeURIComponent(providerUsername);
      existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
    }
  }
  if (shouldUseAzadPanelOpenVpnCollision({
    status: existing.status,
    providerUsername,
    serviceUsername: username,
    serviceId,
  })) {
    providerUsername = azadPanelOpenVpnCollisionUsername(serviceId)!;
    encoded = encodeURIComponent(providerUsername);
    existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  }
  const persistProviderUsername = async () => {
    if (shouldPersistAzadPanelV2RayAccountMapping({
      isAzadPanelV2Ray,
      serviceId,
      providerUsername,
      serviceUsername: username,
      isBackfill: options.onlyIfMissingAzadPanel === true,
    })) {
      await pool.query(
        `INSERT INTO reseller_service_v2ray_accounts
           (service_id, provider_key, provider_username)
         VALUES ($1, $2, $3)
         ON CONFLICT (service_id, provider_key)
         DO UPDATE SET provider_username = EXCLUDED.provider_username,
                       updated_at = NOW()`,
        [serviceId, panelKey(panel), providerUsername],
      );
      azadPanelXrayReadRouteCache.delete(`${panelKey(panel)}:${serviceId}`);
    } else if (
      isAzadPanelOpenVpn
      && providerUsername !== username
      && Number.isSafeInteger(serviceId)
      && Number(serviceId) > 0
    ) {
      await pool.query(
        `INSERT INTO reseller_service_openvpn_provider_accounts
           (service_id, provider_key, provider_username)
         VALUES ($1, $2, $3)
         ON CONFLICT (service_id, provider_key)
         DO UPDATE SET provider_username = EXCLUDED.provider_username, updated_at = NOW()`,
        [serviceId, panelKey(panel), providerUsername],
      );
    }
  };
  if (
    isAzadPanelV2Ray
    && options.onlyIfMissingAzadPanel
    && existing.status === 200
  ) {
    let delivery = await inspectAzadPanelV2RayDelivery(panel, providerUsername);
    if (delivery === "denied" && providerUsername === username) {
      const collisionUsername = azadPanelV2RayCollisionUsername(Number(serviceId));
      if (!collisionUsername) {
        throw new RainApiError(
          `AzadPanel ${panelKey(panel)} denied Xray subscription access and no service-specific account name could be generated.`,
          [{
            key: panelKey(panel),
            kind: "azadpanel",
            status: 403,
            error: "Xray subscription access denied; no fallback username available.",
            retryable: false,
          }],
          false,
        );
      }
      providerUsername = collisionUsername;
      encoded = encodeURIComponent(providerUsername);
      existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
      if (existing.status === 200) {
        delivery = await inspectAzadPanelV2RayDelivery(panel, providerUsername);
      }
    }
    if (existing.status === 200 && delivery === "denied") {
      const error = "AzadPanel denied Xray subscription access for this account.";
      throw new RainApiError(
        `AzadPanel ${panelKey(panel)}: ${error}`,
        [{
          key: panelKey(panel),
          kind: "azadpanel",
          status: 403,
          error,
          retryable: false,
        }],
        false,
      );
    }
  }
  if (options.onlyIfMissingAzadPanel && existing.status === 200) {
    await persistProviderUsername();
    return existing.status;
  }
  if (existing.status !== 200 && existing.status !== 404) {
    const retryable = isRetryableAzadPanelStatus(existing.status);
    const error = `GET /api/user/${encoded}: ${safeError(existing)}`;
    throw new RainApiError(
      `AzadPanel ${panelKey(panel)} could not check the user: ${error}`,
      [{
        key: panelKey(panel),
        kind: "azadpanel",
        status: existing.status,
        error,
        retryable,
        retryAfterMs: retryAfterDelayMs(existing),
      }],
      retryable,
    );
  }
  const expiresAt = options.expiresAtUnix === undefined
    ? new Date(Date.now() + Math.max(0, days) * 86_400_000)
    : options.expiresAtUnix === null
      ? null
      : new Date(options.expiresAtUnix * 1000);
  const body = existing.status === 200
    ? {
        status: "active",
        expire: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
        data_limit: bytesForGb(gb),
        data_limit_reset_strategy: "no_reset",
      }
    : azadPanelUserBody(providerUsername, gb, expiresAt);
  const response = existing.status === 200
    ? await panelRequest(panel, "PUT", `/api/user/${encoded}`, body)
    : await panelRequest(panel, "POST", "/api/user", body);
  if (response.status < 200 || response.status >= 300) {
    const retryable = isRetryableAzadPanelStatus(response.status);
    const operation = existing.status === 200
      ? `PUT /api/user/${encoded}`
      : "POST /api/user";
    const error = `${operation}: ${safeError(response)}`;
    throw new RainApiError(
      `AzadPanel ${panelKey(panel)} rejected the user: ${error}`,
      [{
        key: panelKey(panel),
        kind: "azadpanel",
        status: response.status,
        error,
        retryable,
        retryAfterMs: retryAfterDelayMs(response),
      }],
      retryable,
    );
  }
  await persistProviderUsername();
  if (options.resetUsage && existing.status === 200) {
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
  options?: {
    resetUsage?: boolean;
    expiresAtUnix?: number | null;
    onlyIfMissingAzadPanel?: boolean;
    serviceId?: number;
  },
): Promise<{ ok: boolean; results: PanelResult[] }> {
  const configured = await panels(ownerId, role);
  const serviceProvisioningPanels = standardServiceProvisioningPanels(configured);
  const configuredPanels = onlyPanelKeys?.length
    ? serviceProvisioningPanels.filter((panel) => onlyPanelKeys.includes(panelKey(panel)))
    : serviceProvisioningPanels;
  // A stale retry may point only to a protocol-specific row that no longer
  // belongs in generic service provisioning. Complete it without contacting
  // that Provider instead of producing another misleading OpenVPN error.
  if (onlyPanelKeys?.length && configuredPanels.length === 0) {
    return { ok: true, results: [] };
  }
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
            ? await provisionAzadPanel(panel, username, gb, days, options ?? {})
          : kind === "falcon"
            ? await provisionFalcon(panel, gb, days, label)
            : await provisionMarzban(panel, username, gb, days);
      return { key: panelKey(panel), kind, status };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "خطای ناشناخته در ارتباط با Provider";
      const providerResult = error instanceof RainApiError ? error.results[0] : undefined;
      return {
        key: panelKey(panel),
        kind,
        status: providerResult?.status ?? (error instanceof RainApiError ? 502 : 500),
        error: providerResult?.error ?? detail.slice(0, 240),
        retryable: providerResult?.retryable ?? (error instanceof RainApiError ? error.retryable : undefined),
        retryAfterMs: providerResult?.retryAfterMs,
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
    const existingGroupIds = groupIdsFromUser(existing.json);
    body.group_ids = existingGroupIds.length
      ? existingGroupIds
      : await requiredPasarGuardGroupIds(panel);
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
  serviceId?: number,
): Promise<OpenVpnDelivery> {
  const openVpnPanels = (await panels(ownerId, role)).filter((panel) =>
    isAzadPanelCoreCandidate(panel.kind, "openvpn"),
  );
  const panel = requestedPanelKey
    ? openVpnPanels.find((candidate) => panelKey(candidate) === requestedPanelKey)
    : openVpnPanels[0];
  if (!panel) throw new RainApiError("No enabled AzadPanel OpenVPN provider is configured.");
  if (await azadPanelCore(panel) !== "openvpn") {
    throw new RainApiError(`AzadPanel ${panelKey(panel)} is not configured for OpenVPN.`);
  }

  let providerUsername = username;
  if (Number.isSafeInteger(serviceId) && Number(serviceId) > 0) {
    const saved = await pool.query<{ provider_username: string }>(
      `SELECT provider_username
       FROM reseller_service_openvpn_provider_accounts
       WHERE service_id = $1 AND provider_key = $2
       LIMIT 1`,
      [serviceId, panelKey(panel)],
    );
    if (saved.rows[0]?.provider_username?.trim()) {
      providerUsername = saved.rows[0].provider_username.trim();
    }
  }
  let encoded = encodeURIComponent(providerUsername);
  let existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  if (shouldUseAzadPanelOpenVpnCollision({
    status: existing.status,
    providerUsername,
    serviceUsername: username,
    serviceId,
  })) {
    providerUsername = azadPanelOpenVpnCollisionUsername(serviceId)!;
    encoded = encodeURIComponent(providerUsername);
    existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  }
  if (existing.status === 404) {
    const created = await panelRequest(panel, "POST", "/api/user", azadPanelUserBody(providerUsername, gb, expiresAt));
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

  if (providerUsername !== username && Number.isSafeInteger(serviceId) && Number(serviceId) > 0) {
    await pool.query(
      `INSERT INTO reseller_service_openvpn_provider_accounts
         (service_id, provider_key, provider_username)
       VALUES ($1, $2, $3)
       ON CONFLICT (service_id, provider_key)
       DO UPDATE SET provider_username = EXCLUDED.provider_username, updated_at = NOW()`,
      [serviceId, panelKey(panel), providerUsername],
    );
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
  serviceId?: number,
): Promise<{ body: string; contentType: string }> {
  const panel = (await panels(ownerId, role)).find(
    (candidate) => panelKey(candidate) === providerKey && isAzadPanelCoreCandidate(candidate.kind, "openvpn"),
  );
  if (!panel) throw new RainApiError("The selected AzadPanel OpenVPN provider is unavailable.");
  if (await azadPanelCore(panel) !== "openvpn") {
    throw new RainApiError(`AzadPanel ${providerKey} is not configured for OpenVPN.`);
  }
  let providerUsername = username;
  if (Number.isSafeInteger(serviceId) && Number(serviceId) > 0) {
    const saved = await pool.query<{ provider_username: string }>(
      `SELECT provider_username
       FROM reseller_service_openvpn_provider_accounts
       WHERE service_id = $1 AND provider_key = $2
       LIMIT 1`,
      [serviceId, providerKey],
    );
    if (saved.rows[0]?.provider_username?.trim()) {
      providerUsername = saved.rows[0].provider_username.trim();
    }
  }
  const encoded = encodeURIComponent(providerUsername);
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
    .filter((panel) => isAzadPanelCoreCandidate(panel.kind, expectedCore))
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
  if (isRainAdminWireGuardPanel(panel)) {
    const { configs } = await loadRainAdminWireGuardConfigs(panel, username);
    return configs.map(({ id, name }) => ({ id, name }));
  }
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
  const rainAdminWireGuardPanel = (await panels(ownerId, role)).find(isRainAdminWireGuardPanel);
  if (rainAdminWireGuardPanel) {
    const { configs } = await loadRainAdminWireGuardConfigs(rainAdminWireGuardPanel, username);
    return {
      provider_key: panelKey(rainAdminWireGuardPanel),
      username,
      core: "wireguard",
      locations: configs.map(({ id, name }) => ({ id, name })),
    };
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

export async function renewIpsecAccount(
  providerKey: string,
  username: string,
  gb: number,
  days: number,
  ownerId?: number,
  role?: string,
): Promise<void> {
  const panel = await findIpsecProvider(providerKey, ownerId, role);
  const encoded = encodeURIComponent(username);
  const existing = await panelRequest(panel, "GET", `/api/user/${encoded}`);
  if (existing.status !== 200) {
    throw new RainApiError(
      existing.status === 404
        ? `AzadPanel ${providerKey} could not find the saved IPsec account; it was not recreated.`
        : `AzadPanel ${providerKey} could not check the saved IPsec account: ${safeError(existing)}`,
    );
  }
  const expiresAt = new Date(Date.now() + Math.max(0, days) * 86_400_000);
  const update = await panelRequest(panel, "PUT", `/api/user/${encoded}`, {
    status: "active",
    expire: Math.floor(expiresAt.getTime() / 1000),
    data_limit: bytesForGb(gb),
    data_limit_reset_strategy: "no_reset",
  });
  if (update.status < 200 || update.status >= 300) {
    throw new RainApiError(`AzadPanel ${providerKey} could not renew the saved IPsec account: ${safeError(update)}`);
  }
  const reset = await panelRequest(panel, "POST", `/api/user/${encoded}/reset`);
  if (reset.status < 200 || reset.status >= 300) {
    throw new RainApiError(`AzadPanel ${providerKey} renewed the IPsec plan but could not reset its usage: ${safeError(reset)}`);
  }
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
    (candidate) => panelKey(candidate) === providerKey
      && (isRainAdminWireGuardPanel(candidate) || panelKind(candidate) === "azadpanel"),
  );
  if (!panel) throw new RainApiError("The selected WireGuard provider is unavailable.");
  if (isRainAdminWireGuardPanel(panel)) return panel;
  if (await azadPanelCore(panel) !== "wireguard") {
    throw new RainApiError(`AzadPanel ${providerKey} is not configured for WireGuard.`);
  }
  return panel;
}

export async function renewWireGuardAccount(
  providerKey: string,
  username: string,
  serviceUsername: string,
  gb: number,
  days: number,
  ownerId?: number,
  role?: string,
): Promise<void> {
  const panel = await findWireGuardProvider(providerKey, ownerId, role);
  if (isRainAdminWireGuardPanel(panel)) {
    if (username !== serviceUsername) {
      throw new RainApiError("The Rain Admin WireGuard identity does not match the service username.");
    }
    return;
  }

  const isProtocolSpecificProvider = panel.kind?.trim().toLowerCase() === "azadpanel_wireguard";
  // Generic AzadPanel accounts are renewed by provisionUser. A different saved
  // identity, however, must be renewed directly or its old usage remains live.
  if (!isProtocolSpecificProvider && username === serviceUsername) return;

  const expiresAt = new Date(Date.now() + Math.max(0, days) * 86_400_000);
  await renewAzadPanelAccount(
    (method, path, body) => panelRequest(panel, method, path, body),
    {
      username,
      providerLabel: `AzadPanel ${providerKey}`,
      plan: {
        status: "active",
        expire: Math.floor(expiresAt.getTime() / 1000),
        data_limit: bytesForGb(gb),
        data_limit_reset_strategy: "no_reset",
      },
    },
  );
}

export async function downloadWireGuardProfile(
  username: string,
  providerKey: string,
  hostId: string,
  ownerId?: number,
  role?: string,
): Promise<{ body: string; contentType: string; contentDisposition: string | null }> {
  const panel = await findWireGuardProvider(providerKey, ownerId, role);
  if (isRainAdminWireGuardPanel(panel)) {
    const { configs } = await loadRainAdminWireGuardConfigs(panel, username);
    const profile = configs.find((candidate) => candidate.id === hostId);
    if (!profile) {
      throw new RainApiError("The requested WireGuard location is not available for this account.");
    }
    return {
      body: profile.body,
      contentType: "text/plain; charset=utf-8",
      contentDisposition: null,
    };
  }
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
  const requestedHostIds = [...new Set(hostIds)];
  if (!requestedHostIds.length || requestedHostIds.length > 40) {
    throw new RainApiError("The WireGuard profile bundle must contain between 1 and 40 servers.");
  }
  if (isRainAdminWireGuardPanel(panel)) {
    for (const hostId of requestedHostIds) {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(hostId)) {
        throw new RainApiError("Invalid WireGuard server identity.");
      }
    }
    const { configs } = await loadRainAdminWireGuardConfigs(panel, username);
    const configById = new Map(configs.map((config) => [config.id, config]));
    return requestedHostIds.map((hostId) => {
      const config = configById.get(hostId);
      if (!config) {
        throw new RainApiError("A requested WireGuard location is no longer available for this account.");
      }
      return {
        hostId,
        body: config.body,
        contentType: "text/plain; charset=utf-8",
        contentDisposition: null,
      };
    });
  }
  const endpoints = await listWireGuardEndpoints(panel, username);
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
): Promise<{ body: string | Buffer; contentType: string; contentDisposition: string | null }> {
  const panel = await findWireGuardProvider(providerKey, ownerId, role);
  if (isRainAdminWireGuardPanel(panel)) {
    const { archive, contentDisposition } = await loadRainAdminWireGuardConfigs(panel, username);
    return {
      body: archive,
      contentType: "application/zip",
      contentDisposition,
    };
  }
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