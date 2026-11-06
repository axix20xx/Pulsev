export type ProviderDisableIdentityMaps = {
  usage?: ReadonlyMap<string, string>;
  wireGuard?: ReadonlyMap<string, string>;
  v2ray?: ReadonlyMap<string, string>;
  openVpn?: ReadonlyMap<string, string>;
  ipsec?: { providerKey: string | null; username: string | null } | null;
};

export function isDedicatedAwgUsageProviderKey(providerKey: string): boolean {
  return providerKey.trim().toLowerCase() === "amneziawg";
}

export function panelBackedProviderKeys(
  providerKeys: Iterable<string | null | undefined>,
): Set<string> {
  return new Set([...providerKeys]
    .map((providerKey) => providerKey?.trim() ?? "")
    .filter((providerKey) => providerKey && !isDedicatedAwgUsageProviderKey(providerKey)));
}

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

export function hasMappedRavenAccount(
  providerKey: string,
  mappedProviderKeys: ReadonlySet<string>,
): boolean {
  return mappedProviderKeys.has(providerKey);
}
