export function remainingSubscriptionDays(
  expiresAt: string | number | Date | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (expiresAt === null || expiresAt === undefined || expiresAt === "") return null;
  const timestamp = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - nowMs) / 86_400_000));
}

export function isSubscriptionQuotaExceeded(
  usedGb: number | string | null | undefined,
  limitGb: number | string | null | undefined,
): boolean {
  const used = Number(usedGb ?? 0);
  const limit = Number(limitGb ?? 0);
  return Number.isFinite(used) && Number.isFinite(limit) && limit > 0 && used >= limit;
}

export function isPublicSubscriptionFinished(input: {
  serverFinished?: boolean;
  status?: string;
  remainingDays: number | null;
  quotaFinished: boolean;
}): boolean {
  return Boolean(
    input.serverFinished
    || input.status === "expired"
    || input.status === "disabled"
    || (input.remainingDays !== null && input.remainingDays <= 0)
    || input.quotaFinished
  );
}

export function isPublicSubscriptionExpiring(input: {
  finished: boolean;
  status?: string;
  remainingDays: number | null;
}): boolean {
  return !input.finished
    && (input.status === "expiring" || (input.remainingDays !== null && input.remainingDays <= 7));
}
