export function needsRemoteProviderDisable(
  serviceStatus: string | null | undefined,
  remoteDisablePending: number | boolean | null | undefined,
): boolean {
  return Boolean(serviceStatus)
    && (serviceStatus !== "disabled" || Number(remoteDisablePending) === 1);
}
