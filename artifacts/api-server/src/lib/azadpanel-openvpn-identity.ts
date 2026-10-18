export function azadPanelOpenVpnCollisionUsername(serviceId: number | undefined): string | null {
  if (!Number.isSafeInteger(serviceId) || Number(serviceId) <= 0) return null;
  return `pulseovpn_${serviceId}`;
}

export function shouldUseAzadPanelOpenVpnCollision(input: {
  status: number;
  providerUsername: string;
  serviceUsername: string;
  serviceId: number | undefined;
}): boolean {
  return input.status === 403
    && input.providerUsername === input.serviceUsername
    && azadPanelOpenVpnCollisionUsername(input.serviceId) !== null;
}
