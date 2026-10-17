export function azadPanelV2RayCollisionUsername(serviceId: number): string | null {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) return null;
  return `pulsev2_${serviceId}`;
}
