import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/wireguard-delivery-selection.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { resolveWireGuardDelivery } = await import(`data:text/javascript;base64,${code}`);

test("an enabled Rain Admin extension replaces a saved delivery from another provider", async () => {
  const oldDelivery = { provider_key: "legacy-wg" };
  const rainDelivery = { provider_key: "panelpasargad" };
  let fallbackCalls = 0;
  const result = await resolveWireGuardDelivery({
    savedDelivery: oldDelivery,
    savedDeliveryIsConfiguredRainAdmin: false,
    canEnsureRainAdmin: true,
    ensureRainAdmin: async () => rainDelivery,
    prepareFallback: async () => {
      fallbackCalls += 1;
      return null;
    },
  });

  assert.equal(result, rainDelivery);
  assert.equal(fallbackCalls, 0);
});

test("a saved delivery from the configured Rain Admin provider is reused without a panel request", async () => {
  const savedDelivery = { provider_key: "panelpasargad" };
  let ensureCalls = 0;
  const result = await resolveWireGuardDelivery({
    savedDelivery,
    savedDeliveryIsConfiguredRainAdmin: true,
    canEnsureRainAdmin: true,
    ensureRainAdmin: async () => {
      ensureCalls += 1;
      return null;
    },
    prepareFallback: async () => null,
  });

  assert.equal(result, savedDelivery);
  assert.equal(ensureCalls, 0);
});

test("a saved delivery remains available when no Rain Admin extension is configured", async () => {
  const savedDelivery = { provider_key: "legacy-wg" };
  const result = await resolveWireGuardDelivery({
    savedDelivery,
    savedDeliveryIsConfiguredRainAdmin: false,
    canEnsureRainAdmin: false,
    ensureRainAdmin: async () => {
      assert.fail("No configured Rain Admin provider should be contacted.");
    },
    prepareFallback: async () => null,
  });

  assert.equal(result, savedDelivery);
});

test("a new service falls back to its normal WireGuard provider when Rain Admin is absent", async () => {
  const fallbackDelivery = { provider_key: "azadpanel-wg" };
  const result = await resolveWireGuardDelivery({
    savedDelivery: null,
    savedDeliveryIsConfiguredRainAdmin: false,
    canEnsureRainAdmin: true,
    ensureRainAdmin: async () => null,
    prepareFallback: async () => fallbackDelivery,
  });

  assert.equal(result, fallbackDelivery);
});
