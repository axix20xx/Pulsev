export function hasWireGuardAccess(
  resellerTelegramId: number | string | null | undefined,
  wireguardEnabled: boolean | number | string | null | undefined,
  masterAdminTelegramId: number,
): boolean {
  if (resellerTelegramId !== null && resellerTelegramId !== undefined
    && String(resellerTelegramId).trim() === String(masterAdminTelegramId)) {
    return true;
  }
  return wireguardEnabled === true || wireguardEnabled === 1 || wireguardEnabled === "1";
}

export function isWireGuardServiceAvailable(input: {
  enabled: boolean;
  status: string;
  totalBytes: number;
  remainingBytes: number;
  expiresAtMs?: number;
  nowMs?: number;
}): boolean {
  const nowMs = input.nowMs ?? Date.now();
  const unlimited = Number.isFinite(input.totalBytes) && input.totalBytes <= 0;
  const expired = Number.isFinite(input.expiresAtMs)
    && Number(input.expiresAtMs) > 0
    && Number(input.expiresAtMs) <= nowMs;

  return input.enabled
    && input.status === "active"
    && (unlimited || input.remainingBytes > 0)
    && !expired;
}
