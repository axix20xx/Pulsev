import { samePasarGuardInstance } from "./pasarguard-instance";

const normalizeKind = (kind: unknown) =>
  typeof kind === "string" ? kind.trim().toLowerCase() : "";

export type AzadPanelCore = "xray" | "openvpn" | "wireguard" | "ipsec";

export function azadPanelExpectedCore(kind: unknown): AzadPanelCore | null {
  switch (normalizeKind(kind)) {
    case "azadpanel_v2ray":
      return "xray";
    case "azadpanel_openvpn":
      return "openvpn";
    case "azadpanel_wireguard":
      return "wireguard";
    case "azadpanel_ipsec":
      return "ipsec";
    default:
      return null;
  }
}

export function isAzadPanelCoreCandidate(kind: unknown, core: AzadPanelCore): boolean {
  const normalized = normalizeKind(kind);
  return normalized === "azadpanel" || azadPanelExpectedCore(normalized) === core;
}

export function azadPanelReportsCore(
  kind: unknown,
  reportedCore: unknown,
  expectedCore: AzadPanelCore,
): boolean {
  return isAzadPanelCoreCandidate(kind, expectedCore)
    && normalizeKind(reportedCore) === expectedCore;
}

export function isStandardServiceProvisioningPanel(kind: unknown): boolean {
  const normalized = normalizeKind(kind);
  return normalized !== "azadpanel_wireguard"
    && normalized !== "azadpanel_ipsec";
}

export function uniqueRainAdminPanelEntries<
  T extends { kind?: unknown; api_base?: unknown },
>(
  panels: readonly T[],
): T[] {
  const primaryPanels = panels.filter((panel) => normalizeKind(panel.kind) === "rain_admin");
  return panels.filter((panel) => {
    if (normalizeKind(panel.kind) !== "rain_admin_wireguard") return true;
    return !primaryPanels.some((primary) =>
      typeof panel.api_base === "string"
      && typeof primary.api_base === "string"
      && samePasarGuardInstance(panel.api_base, primary.api_base),
    );
  });
}

export function standardServiceProvisioningPanels<
  T extends { kind?: unknown; api_base?: unknown },
>(
  panels: readonly T[],
): T[] {
  return uniqueRainAdminPanelEntries(panels)
    .filter((panel) => isStandardServiceProvisioningPanel(panel.kind));
}

export function azadPanelXraySubscriptionPath(username: string): string {
  return `/api/xray/user/${encodeURIComponent(username)}/link`;
}

export function azadPanelXrayUserPath(username: string): string {
  return `/api/user/${encodeURIComponent(username)}`;
}

export type AzadPanelXrayDeliveryDisposition =
  | "available"
  | "denied"
  | "no_links"
  | "retryable_error"
  | "unexpected_error";

export function azadPanelXrayDeliveryDisposition(
  responses: Array<{ status: number; linkCount: number }>,
): AzadPanelXrayDeliveryDisposition {
  if (responses.some(({ status, linkCount }) => status >= 200 && status < 300 && linkCount > 0)) {
    return "available";
  }
  if (responses.some(({ status }) => status === 408 || status === 429 || status >= 500)) {
    return "retryable_error";
  }
  if (responses.length > 0 && responses.every(({ status }) => [403, 404, 405].includes(status))) {
    return "denied";
  }
  if (responses.some(({ status }) => status >= 200 && status < 300)) {
    return "no_links";
  }
  return "unexpected_error";
}

export function azadPanelXraySubscriptionLinks(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const source = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : root;
  const subscriptionUrl = typeof source.subscription_url === "string"
    ? source.subscription_url.trim()
    : "";
  const links = source.links;
  return [...new Set([
    ...(subscriptionUrl ? [subscriptionUrl] : []),
    ...(Array.isArray(links)
      ? links.filter((link): link is string => typeof link === "string" && link.trim().length > 0)
        .map((link) => link.trim())
      : []),
  ])];
}

export type AzadPanelXrayFeed = { text: string; encoded: boolean };

function configIdentity(value: string): string | null {
  const line = value.trim();
  if (!/^(?:vless|vmess|trojan|ss|ssr|hysteria|hysteria2|tuic|socks(?:4|5)?):\/\//i.test(line)) {
    return null;
  }
  return line.split("#", 1)[0].trim();
}

export function mergeAzadPanelXraySubscriptionFeeds(
  subscriptionFeeds: AzadPanelXrayFeed[],
  directLinks: string[],
): AzadPanelXrayFeed[] {
  const seen = new Set<string>();
  for (const feed of subscriptionFeeds) {
    for (const line of feed.text.split(/\r?\n/)) {
      const identity = configIdentity(line);
      if (identity) seen.add(identity);
    }
  }

  const extraLinks: string[] = [];
  for (const link of directLinks) {
    const identity = configIdentity(link);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    extraLinks.push(link.trim());
  }

  return extraLinks.length
    ? [...subscriptionFeeds, { text: extraLinks.join("\n"), encoded: false }]
    : subscriptionFeeds;
}
