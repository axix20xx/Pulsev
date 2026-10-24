export type RainAdminBackfillResponse = {
  status: number;
  error?: string;
};

export type RainAdminBackfillProvider = {
  key: string;
  lookup: () => Promise<RainAdminBackfillResponse>;
  create: (body: Record<string, unknown>) => Promise<RainAdminBackfillResponse>;
};

export class RainAdminBackfillError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "RainAdminBackfillError";
    this.retryable = retryable;
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function ensureRainAdminBackfillAccount(
  input: {
    username: string;
    remainingBytes: number | null;
    expiresAtUnix: number | null;
  },
  providers: RainAdminBackfillProvider[],
): Promise<{ created: boolean; providerKey: string }> {
  if (!input.username.trim()) {
    throw new RainAdminBackfillError("A service username is required for Rain Admin backfill.", false);
  }
  if (
    input.remainingBytes !== null
    && (!Number.isFinite(input.remainingBytes) || input.remainingBytes < 0)
  ) {
    throw new RainAdminBackfillError("Remaining quota is invalid for Rain Admin backfill.", false);
  }
  if (
    input.expiresAtUnix !== null
    && (!Number.isSafeInteger(input.expiresAtUnix) || input.expiresAtUnix <= 0)
  ) {
    throw new RainAdminBackfillError("Service expiry is invalid for Rain Admin backfill.", false);
  }
  if (!providers.length) {
    throw new RainAdminBackfillError(
      "No matching main Rain Admin provider is configured for this WireGuard panel.",
      false,
    );
  }

  const missing: RainAdminBackfillProvider[] = [];
  const lookupErrors: string[] = [];
  let hasRetryableLookupError = false;
  for (const provider of providers) {
    const lookup = await provider.lookup();
    if (lookup.status === 200) return { created: false, providerKey: provider.key };
    if ([404, 405].includes(lookup.status)) {
      missing.push(provider);
      continue;
    }
    lookupErrors.push(`${provider.key}: ${lookup.error || `HTTP ${lookup.status}`}`);
    hasRetryableLookupError ||= retryableStatus(lookup.status);
  }

  if (!missing.length) {
    throw new RainAdminBackfillError(
      `Rain Admin could not verify the user on the matching panel. ${lookupErrors.join("; ")}`.trim(),
      hasRetryableLookupError,
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

  throw new RainAdminBackfillError(
    `Rain Admin ${provider.key} could not create the missing WireGuard account: ${created.error || `HTTP ${created.status}`}`,
    retryableStatus(created.status),
  );
}
