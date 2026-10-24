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
