export async function resolveWireGuardDelivery<T>(options: {
  savedDelivery: T | null;
  savedDeliveryIsConfiguredRainAdmin: boolean;
  canEnsureRainAdmin: boolean;
  ensureRainAdmin: () => Promise<T | null>;
  prepareFallback: () => Promise<T | null>;
}): Promise<T | null> {
  if (options.savedDelivery && options.savedDeliveryIsConfiguredRainAdmin) {
    return options.savedDelivery;
  }

  if (options.canEnsureRainAdmin) {
    const rainAdminDelivery = await options.ensureRainAdmin();
    if (rainAdminDelivery) return rainAdminDelivery;
  }

  if (options.savedDelivery) return options.savedDelivery;
  return options.prepareFallback();
}
