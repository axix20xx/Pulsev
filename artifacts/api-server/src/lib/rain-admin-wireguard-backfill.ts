const bytesPerGb = 1024 ** 3;

export type RainAdminWireGuardBackfillPlan =
  | { eligible: true; expiresAtUnix: number | null }
  | { eligible: false; reason: "inactive" | "expired" | "quota_exhausted" | "invalid" };

export function rainAdminWireGuardBackfillPlan(input: {
  status: unknown;
  gb: unknown;
  lastRemainingBytes: unknown;
  lastUsedBytes: unknown;
  expiresAtUnix: unknown;
  nowUnix?: number;
}): RainAdminWireGuardBackfillPlan {
  if (input.status !== "active") return { eligible: false, reason: "inactive" };

  const nowUnix = Number.isFinite(input.nowUnix) ? Number(input.nowUnix) : Math.floor(Date.now() / 1000);
  const expiresAtUnix = input.expiresAtUnix === null || input.expiresAtUnix === undefined
    ? null
    : Number(input.expiresAtUnix);
  if (expiresAtUnix !== null && (!Number.isFinite(expiresAtUnix) || expiresAtUnix <= nowUnix)) {
    return { eligible: false, reason: "expired" };
  }

  const gb = Number(input.gb);
  if (!Number.isFinite(gb)) return { eligible: false, reason: "invalid" };
  if (gb > 0) {
    const lastRemaining = input.lastRemainingBytes === null || input.lastRemainingBytes === undefined
      ? Number.NaN
      : Number(input.lastRemainingBytes);
    const lastUsed = Number.isFinite(Number(input.lastUsedBytes))
      ? Number(input.lastUsedBytes)
      : 0;
    const remainingBytes = Number.isFinite(lastRemaining)
      ? lastRemaining
      : gb * bytesPerGb - lastUsed;
    if (remainingBytes <= 0) return { eligible: false, reason: "quota_exhausted" };
  }

  return { eligible: true, expiresAtUnix };
}
