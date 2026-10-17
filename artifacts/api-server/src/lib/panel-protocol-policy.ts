const normalizeKind = (kind: unknown) =>
  typeof kind === "string" ? kind.trim().toLowerCase() : "";

export function isAzadPanelCoreCandidate(kind: unknown, core: "openvpn" | "wireguard" | "ipsec"): boolean {
  const normalized = normalizeKind(kind);
  return normalized === "azadpanel" || normalized === `azadpanel_${core}`;
}

export function isStandardServiceProvisioningPanel(kind: unknown): boolean {
  const normalized = normalizeKind(kind);
  return normalized !== "azadpanel_wireguard" && normalized !== "azadpanel_ipsec";
}
