export type RainAdminBackfillResponse = {
  status: number;
  error?: string;
};

export type RainAdminBackfillProvider = {
  key: string;
  lookup: () => Promise<RainAdminBackfillResponse>;
  create: (body: Record<string, unknown>) => Promise<RainAdminBackfillResponse>;
};

export async function ensureRainAdminBackfillAccount(
  input: {
    username: string;
    remainingBytes: number | null;
    expiresAtUnix: number | null;
  },
  providers: RainAdminBackfillProvider[],
): Promise<{ created: boolean; providerKey: string }> {
  if (!input.username.trim()) throw new Error("A service username is required for Rain Admin backfill.");
  if (
    input.remainingBytes !== null
    && (!Number.isFinite(input.remainingBytes) || input.remainingBytes < 0)
  ) {
    throw new Error("Remaining quota is invalid for Rain Admin backfill.");
  }
  if (
    input.expiresAtUnix !== null
    && (!Number.isSafeInteger(input.expiresAtUnix) || input.expiresAtUnix <= 0)
  ) {
    throw new Error("Service expiry is invalid for Rain Admin backfill.");
  }
  if (!providers.length) {
    throw new Error("No matching main Rain Admin provider is configured for this WireGuard panel.");
  }

  const missing: RainAdminBackfillProvider[] = [];
  const lookupErrors: string[] = [];
  for (const provider of providers) {
    const lookup = await provider.lookup();
    if (lookup.status === 200) return { created: false, providerKey: provider.key };
    if ([404, 405].includes(lookup.status)) {
      missing.push(provider);
      continue;
    }
    lookupErrors.push(`${provider.key}: ${lookup.error || `HTTP ${lookup.status}`}`);
  }

  if (!missing.length) {
    throw new Error(
      `Rain Admin could not verify the user on the matching panel. ${lookupErrors.join("; ")}`.trim(),
    );
  }

  const provider = missing[0];
  const created = await provider.create({
    username: input.username.trim(),
    status: "active",
    expire: input.expiresAtUnix,
    data_limit: input.remainingBytes === null
      ? 0
      : Math.max(1, Math.ceil(input.remainingBytes)),
    data_limit_reset_strategy: "no_reset",
    group_ids: [1],
    note: "Pulse WireGuard backfill",
  });
  if (created.status >= 200 && created.status < 300) {
    return { created: true, providerKey: provider.key };
  }

  if (created.status === 409) {
    for (const candidate of providers) {
      const confirmed = await candidate.lookup();
      if (confirmed.status === 200) {
        return { created: false, providerKey: candidate.key };
      }
    }
  }

  throw new Error(
    `Rain Admin ${provider.key} could not create the missing WireGuard account: ${created.error || `HTTP ${created.status}`}`,
  );
}
