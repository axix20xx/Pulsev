import assert from "node:assert/strict";
import test from "node:test";
import { collectWireGuardProviderProfiles } from "../src/lib/wireguard-provider-profile-collector.ts";

test("keeps healthy WireGuard provider profiles when another provider is down", async () => {
  const requestOrder = [];
  const result = await collectWireGuardProviderProfiles(
    [{ key: "offline" }, { key: "healthy" }, { key: "disabled" }],
    (provider) => provider.key,
    async (provider) => provider.key !== "disabled",
    async (provider) => {
      requestOrder.push(provider.key);
      if (provider.key === "offline") throw new Error("provider unavailable");
      return [`${provider.key}-server.conf`];
    },
  );

  assert.deepEqual(requestOrder, ["offline", "healthy"]);
  assert.deepEqual(result, {
    providers: [{ providerKey: "healthy", profiles: ["healthy-server.conf"] }],
    failedProviderKeys: ["offline"],
  });
});

test("reports an unavailable provider without inventing an empty archive", async () => {
  const result = await collectWireGuardProviderProfiles(
    [{ key: "empty" }],
    (provider) => provider.key,
    async () => true,
    async () => [],
  );

  assert.deepEqual(result, { providers: [], failedProviderKeys: ["empty"] });
});
