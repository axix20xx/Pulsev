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
  azadPanelXrayUserPath,
  isAzadPanelCoreCandidate,
  isStandardServiceProvisioningPanel,
  mergeAzadPanelXraySubscriptionFeeds,
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
  assert.equal(azadPanelXrayUserPath("cust/user"), "/api/user/cust%2Fuser");
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
  assert.deepEqual(
    azadPanelXraySubscriptionLinks({
      subscription_url: "https://azad.example/sub/public-token",
      links: ["vless://direct-node"],
    }),
    ["https://azad.example/sub/public-token", "vless://direct-node"],
  );
});

test("AzadPanel Xray merges direct VLESS/SS links with the live feed without duplicates", () => {
  const liveLink = "vless://uuid@live.example:443?type=tcp#Live";
  const extraVless = "vless://uuid@extra.example:8443?type=tcp#Extra";
  const extraShadowsocks = "ss://cipher:password@ss.example:9443#SS";
  const merged = mergeAzadPanelXraySubscriptionFeeds(
    [{ text: `${liveLink}\n`, encoded: true }],
    [liveLink, extraVless, extraShadowsocks, extraVless],
  );

  assert.deepEqual(merged, [
    { text: `${liveLink}\n`, encoded: true },
    { text: `${extraVless}\n${extraShadowsocks}`, encoded: false },
  ]);
});

test("AzadPanel Xray includes direct links when the dynamic subscription is unavailable", () => {
  const directLink = "vless://uuid@node.example:443?security=reality#Node";
  assert.deepEqual(
    mergeAzadPanelXraySubscriptionFeeds([], [directLink]),
    [{ text: directLink, encoded: false }],
  );
});
