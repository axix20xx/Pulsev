export type ProviderDisableIdentityMaps = {
  usage?: ReadonlyMap<string, string>;
  wireGuard?: ReadonlyMap<string, string>;
  v2ray?: ReadonlyMap<string, string>;
  openVpn?: ReadonlyMap<string, string>;
  ipsec?: { providerKey: string | null; username: string | null } | null;
};

export function providerDisableUsername(
  serviceUsername: string,
  providerKey: string,
  identities: ProviderDisableIdentityMaps,
): string {
  const candidate = identities.openVpn?.get(providerKey)
    ?? identities.v2ray?.get(providerKey)
    ?? identities.wireGuard?.get(providerKey)
    ?? (identities.ipsec?.providerKey === providerKey ? identities.ipsec.username : null)
    ?? identities.usage?.get(providerKey);
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : serviceUsername;
}
