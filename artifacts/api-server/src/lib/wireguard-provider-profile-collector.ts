export type WireGuardProviderProfileResult<TProfile> = {
  providers: Array<{ providerKey: string; profiles: TProfile[] }>;
  failedProviderKeys: string[];
};

/**
 * Loads provider profile collections sequentially so one unhealthy provider
 * cannot abort the archive or cause all providers to be queried at once.
 */
export async function collectWireGuardProviderProfiles<TProvider, TProfile>(
  providers: readonly TProvider[],
  getProviderKey: (provider: TProvider) => string,
  isEnabled: (provider: TProvider) => Promise<boolean>,
  loadProfiles: (provider: TProvider) => Promise<TProfile[]>,
): Promise<WireGuardProviderProfileResult<TProfile>> {
  const loaded: WireGuardProviderProfileResult<TProfile>["providers"] = [];
  const failedProviderKeys: string[] = [];

  for (const provider of providers) {
    const providerKey = getProviderKey(provider);
    try {
      if (!await isEnabled(provider)) continue;
      const profiles = await loadProfiles(provider);
      if (profiles.length === 0) {
        failedProviderKeys.push(providerKey);
        continue;
      }
      loaded.push({ providerKey, profiles });
    } catch {
      failedProviderKeys.push(providerKey);
    }
  }

  return { providers: loaded, failedProviderKeys };
}
