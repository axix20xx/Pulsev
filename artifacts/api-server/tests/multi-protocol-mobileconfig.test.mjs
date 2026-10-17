import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadProfileBuilder() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/multi-protocol-mobileconfig.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

const wireguardConfig = (host) => `[Interface]
PrivateKey = client-private-key
Address = 10.0.0.2/32

[Peer]
PublicKey = server-public-key
Endpoint = ${host}:51820
AllowedIPs = 0.0.0.0/0
`;

const openVpnConfig = `client
dev tun
proto udp
remote vpn-one.example 1194
remote vpn-two.example 1194
auth-user-pass /client/credentials.txt
<ca>
-----BEGIN CERTIFICATE-----
line-one & line-two
-----END CERTIFICATE-----
</ca>
`;

test("one stable profile contains only the supported VPN protocol entries supplied to it", async () => {
  const { createMultiProtocolMobileConfigBundle } = await loadProfileBuilder();
  const entries = [
    { protocol: "openvpn", config: openVpnConfig, serverId: "azad-openvpn", serverName: "OpenVPN" },
    { protocol: "wireguard", config: wireguardConfig("wg.example"), serverId: "wg-one", serverName: "WireGuard" },
    { protocol: "amneziawg", config: wireguardConfig("awg.example"), serverId: "awg-main", serverName: "AmneziaWG" },
  ];
  const profile = createMultiProtocolMobileConfigBundle(entries, 125);
  const reordered = createMultiProtocolMobileConfigBundle([...entries].reverse(), 125);

  assert.equal((profile.match(/<key>PayloadType<\/key><string>com\.apple\.vpn\.managed<\/string>/g) ?? []).length, 3);
  assert.match(profile, /net\.openvpn\.connect\.app/);
  assert.match(profile, /com\.wireguard\.ios/);
  assert.match(profile, /org\.amnezia\.awg/);
  assert.match(profile, /remote\.2<\/key><string>vpn-two\.example 1194/);
  assert.match(profile, /<key>ca<\/key><string>-----BEGIN CERTIFICATE-----\\nline-one &amp; line-two\\n-----END CERTIFICATE-----<\/string>/);
  assert.match(profile, /auth-user-pass<\/key><string>NOARGS<\/string>/);
  assert.match(profile, /<key>PayloadIdentifier<\/key><string>com\.pulse\.service-125\.all-vpn\.profile<\/string>/);
  assert.deepEqual(
    [...profile.matchAll(/<key>PayloadUUID<\/key><string>([^<]+)<\/string>/g)].map((match) => match[1]).sort(),
    [...reordered.matchAll(/<key>PayloadUUID<\/key><string>([^<]+)<\/string>/g)].map((match) => match[1]).sort(),
  );
});

test("OpenVPN profile paths and unsupported local directives are rejected instead of shipped broken", async () => {
  const { createMultiProtocolMobileConfigBundle } = await loadProfileBuilder();
  assert.throws(() => createMultiProtocolMobileConfigBundle([
    {
      protocol: "openvpn",
      config: "client\nremote vpn.example 1194\nca /etc/openvpn/ca.pem\n",
      serverId: "openvpn",
      serverName: "OpenVPN",
    },
  ], 126), /must contain inline data/);
  assert.throws(() => createMultiProtocolMobileConfigBundle([
    {
      protocol: "openvpn",
      config: "client\nremote vpn.example 1194\nup /tmp/custom-script\n",
      serverId: "openvpn",
      serverName: "OpenVPN",
    },
  ], 126), /cannot be represented safely/);
});

test("OpenVPN TLS Crypt v2 inline key material is kept inside the app configuration", async () => {
  const { createMultiProtocolMobileConfigBundle } = await loadProfileBuilder();
  const profile = createMultiProtocolMobileConfigBundle([
    {
      protocol: "openvpn",
      config: `${openVpnConfig}<tls-crypt-v2>\n-----BEGIN OpenVPN tls-crypt-v2 client key-----\nopaque-key-material\n-----END OpenVPN tls-crypt-v2 client key-----\n</tls-crypt-v2>\n`,
      serverId: "azad-openvpn",
      serverName: "OpenVPN",
    },
  ], 128);

  assert.match(profile, /<key>tls-crypt-v2<\/key><string>-----BEGIN OpenVPN tls-crypt-v2 client key-----\\nopaque-key-material\\n-----END OpenVPN tls-crypt-v2 client key-----<\/string>/);
  assert.doesNotMatch(profile, /invalid directive/i);
});

test("combined profiles reject duplicate server identities and invalid tunnel configs", async () => {
  const { createMultiProtocolMobileConfigBundle } = await loadProfileBuilder();
  assert.throws(() => createMultiProtocolMobileConfigBundle([
    { protocol: "wireguard", config: wireguardConfig("one.example"), serverId: "same", serverName: "One" },
    { protocol: "wireguard", config: wireguardConfig("two.example"), serverId: "same", serverName: "Two" },
  ], 127), /duplicate server identities/);
  assert.throws(() => createMultiProtocolMobileConfigBundle([
    { protocol: "amneziawg", config: "[Interface]\nPrivateKey = x\n", serverId: "awg", serverName: "AWG" },
  ], 127), /cannot be represented as an iOS configuration/);
});
