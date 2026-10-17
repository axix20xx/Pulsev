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

export function isStandardServiceProvisioningPanel(kind: unknown): boolean {
  const normalized = normalizeKind(kind);
  return normalized !== "azadpanel_wireguard" && normalized !== "azadpanel_ipsec";
}

export function azadPanelXraySubscriptionPath(username: string): string {
  return `/api/xray/user/${encodeURIComponent(username)}/link`;
}

export function azadPanelXraySubscriptionLinks(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const source = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : root;
  const subscriptionUrl = source.subscription_url;
  if (typeof subscriptionUrl === "string" && subscriptionUrl.trim()) {
    return [subscriptionUrl.trim()];
  }
  const links = source.links;
  return Array.isArray(links)
    ? [...new Set(links.filter((link): link is string => typeof link === "string" && link.trim().length > 0).map((link) => link.trim()))]
    : [];
}
