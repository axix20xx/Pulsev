export function publicWireGuardDeliveryLinks<T extends { id: string }>(
  token: string,
  providerKey: string,
  locations: T[],
): {
  bundle_url: string;
  bundle_mobileconfig_url: string;
  locations: Array<T & { config_url: string; mobileconfig_url: string }>;
} {
  const providerPath = `/api/public/subscription/${encodeURIComponent(token)}/wireguard`;
  const encodedProvider = encodeURIComponent(providerKey);
  return {
    bundle_url: `${providerPath}/bundle/${encodedProvider}`,
    bundle_mobileconfig_url: `${providerPath}/mobileconfig/${encodedProvider}`,
    locations: locations.map((location) => ({
      ...location,
      config_url: `${providerPath}/config/${encodedProvider}/${encodeURIComponent(location.id)}`,
      mobileconfig_url: `${providerPath}/mobileconfig/${encodedProvider}/${encodeURIComponent(location.id)}`,
    })),
  };
}
