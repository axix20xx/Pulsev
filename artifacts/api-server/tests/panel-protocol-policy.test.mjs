import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/panel-protocol-policy.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const {
  azadPanelExpectedCore,
  azadPanelXraySubscriptionLinks,
  azadPanelXraySubscriptionPath,
  isAzadPanelCoreCandidate,
  isStandardServiceProvisioningPanel,
} =
  await import(`data:text/javascript;base64,${code}`);

test("OpenVPN core selection excludes WireGuard- and IPsec-specific panels", () => {
  assert.equal(isAzadPanelCoreCandidate("azadpanel_wireguard", "openvpn"), false);
  assert.equal(isAzadPanelCoreCandidate("azadpanel_ipsec", "openvpn"), false);
  assert.equal(isAzadPanelCoreCandidate("azadpanel_openvpn", "openvpn"), true);
  assert.equal(isAzadPanelCoreCandidate("azadpanel_v2ray", "openvpn"), false);
  assert.equal(isAzadPanelCoreCandidate("azadpanel", "openvpn"), true);
});

test("generic service provisioning never targets protocol-specific AzadPanel rows", () => {
  assert.equal(isStandardServiceProvisioningPanel("azadpanel_wireguard"), false);
  assert.equal(isStandardServiceProvisioningPanel("azadpanel_ipsec"), false);
  assert.equal(isStandardServiceProvisioningPanel("azadpanel_openvpn"), true);
  assert.equal(isStandardServiceProvisioningPanel("azadpanel_v2ray"), true);
  assert.equal(isStandardServiceProvisioningPanel("marzban"), true);
});

test("AzadPanel core lookup only checks matching protocol rows plus legacy generic rows", () => {
  assert.equal(isAzadPanelCoreCandidate("azadpanel_wireguard", "wireguard"), true);
  assert.equal(isAzadPanelCoreCandidate("azadpanel_ipsec", "ipsec"), true);
  assert.equal(isAzadPanelCoreCandidate("azadpanel_openvpn", "wireguard"), false);
  assert.equal(isAzadPanelCoreCandidate("azadpanel_v2ray", "xray"), true);
  assert.equal(isAzadPanelCoreCandidate("azadpanel", "ipsec"), true);
});

test("AzadPanel V2Ray uses the Xray core and the documented live-link route", () => {
  assert.equal(azadPanelExpectedCore("azadpanel_v2ray"), "xray");
  assert.equal(azadPanelXraySubscriptionPath("cust/user"), "/api/xray/user/cust%2Fuser/link");
});

test("AzadPanel Xray prefers its dynamic subscription URL and falls back to returned links", () => {
  assert.deepEqual(
    azadPanelXraySubscriptionLinks({
      username: "customer",
      subscription_url: "/sub/token",
      links: ["vless://static-config"],
    }),
    ["/sub/token", "vless://static-config"],
  );
  assert.deepEqual(
    azadPanelXraySubscriptionLinks({ data: { links: ["vless://one", "vless://one", "vmess://two"] } }),
    ["vless://one", "vmess://two"],
  );
});
