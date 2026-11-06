import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadModule(path) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const text = outputFiles[0].text;
  const code = Buffer.from(text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}
const identity = await loadModule("../src/lib/provider-disable-identity.ts");
const cancellation = await loadModule("../src/lib/service-cancellation-policy.ts");

test("disable uses the saved OpenVPN username for its exact provider", () => {
  assert.equal(identity.providerDisableUsername("service-user", "azad-openvpn", {
    openVpn: new Map([["azad-openvpn", "provider-specific-user"]]),
  }), "provider-specific-user");
});

test("disable uses saved identities for newly added providers and falls back for legacy panels", () => {
  const mapped = new Map([["new-provider", "mapped-provider-user"]]);
  assert.equal(identity.providerDisableUsername("service-user", "new-provider", { usage: mapped }), "mapped-provider-user");
  assert.equal(identity.providerDisableUsername("service-user", "legacy-provider", { usage: mapped }), "service-user");
});

test("disable resolves identities for each saved protocol-specific Provider account", () => {
  const identities = {
    usage: new Map([["marzban-main", "marzban-user"]]),
    wireGuard: new Map([["wg-main", "wg-user"]]),
    v2ray: new Map([["xray-main", "xray-user"]]),
    openVpn: new Map([["openvpn-main", "openvpn-user"]]),
    ipsec: { providerKey: "ipsec-main", username: "ipsec-user" },
  };
  assert.equal(identity.providerDisableUsername("service-user", "marzban-main", identities), "marzban-user");
  assert.equal(identity.providerDisableUsername("service-user", "wg-main", identities), "wg-user");
  assert.equal(identity.providerDisableUsername("service-user", "xray-main", identities), "xray-user");
  assert.equal(identity.providerDisableUsername("service-user", "openvpn-main", identities), "openvpn-user");
  assert.equal(identity.providerDisableUsername("service-user", "ipsec-main", identities), "ipsec-user");
});

test("AWG usage history is not mistaken for a panel-provider account", () => {
  assert.equal(identity.isDedicatedAwgUsageProviderKey("amneziawg"), true);
  assert.equal(identity.isDedicatedAwgUsageProviderKey(" AmneziaWG "), true);
  assert.equal(identity.isDedicatedAwgUsageProviderKey("raven-main"), false);
  assert.deepEqual(
    [...identity.panelBackedProviderKeys(["amneziawg", "raven-main", null, "  "])],
    ["raven-main"],
  );
});

test("Raven is targeted only when this service has a saved account on that provider", () => {
  assert.equal(identity.hasMappedRavenAccount("raven-main", new Set(["raven-main"])), true);
  assert.equal(identity.hasMappedRavenAccount("raven-main", new Set()), false);
});

test("cancel approval retries remote disable when local service status is already disabled but pending", () => {
  assert.equal(cancellation.needsRemoteProviderDisable("active", 0), true);
  assert.equal(cancellation.needsRemoteProviderDisable("disabled", 1), true);
  assert.equal(cancellation.needsRemoteProviderDisable("disabled", 0), false);
  assert.equal(cancellation.needsRemoteProviderDisable(null, 1), false);
});

test("zero panel targets are complete while partial panel shutdown remains pending", () => {
  assert.equal(cancellation.allRemoteProvidersDisabled(0, 0), true);
  assert.equal(cancellation.allRemoteProvidersDisabled(2, 1), false);
  assert.equal(cancellation.allRemoteProvidersDisabled(2, 2), true);
});
