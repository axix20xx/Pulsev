import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadProfileBuilder() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/wireguard-mobileconfig.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

const config = (host, extra = "") => `[Interface]
PrivateKey = client-private-key
Address = 10.0.0.2/32
${extra}
[Peer]
PublicKey = server-public-key
Endpoint = ${host}:51820
AllowedIPs = 0.0.0.0/0, ::/0
`;

test("one iOS profile contains independent tunnels for every selected WireGuard server", async () => {
  const { createWireGuardMobileConfigBundle } = await loadProfileBuilder();
  const profile = createWireGuardMobileConfigBundle([
    { config: config("edge-one.example"), hostId: "edge-one", locationName: "Edge One" },
    { config: config("edge-two.example"), hostId: "edge-two", locationName: "Edge & Two" },
  ], 79, "wireguard");

  assert.match(profile, /<key>PayloadContent<\/key>\s*<array>/);
  assert.equal((profile.match(/<key>VPNSubType<\/key>/g) ?? []).length, 2);
  assert.equal((profile.match(/<key>WgQuickConfig<\/key>/g) ?? []).length, 2);
  assert.match(profile, /edge-one\.example:51820/);
  assert.match(profile, /edge-two\.example:51820/);
  assert.match(profile, /Pulse WireGuard - Edge &amp; Two/);
  assert.match(profile, /<key>VPNSubType<\/key><string>com\.wireguard\.ios<\/string>/);
  assert.match(profile, /<string>com\.pulse\.wireguard\.service-79\.location-edge-one\.vpn<\/string>/);
});

test("an AmneziaWG iOS profile keeps AWG settings inside the tunnel payload", async () => {
  const { createWireGuardMobileConfigBundle } = await loadProfileBuilder();
  const profile = createWireGuardMobileConfigBundle([
    {
      config: config("awg.example", "Jc = 4\nJmin = 40\nJmax = 80\nS1 = 23"),
      hostId: "amneziawg",
      locationName: "AmneziaWG",
    },
  ], 81, "amneziawg");

  assert.match(profile, /com\.pulse\.amneziawg\.service-81\.location-amneziawg\.vpn/);
  assert.ok(profile.includes("Jc = 4\nJmin = 40\nJmax = 80\nS1 = 23"));
  assert.match(profile, /<key>VPNSubType<\/key><string>org\.amnezia\.awg<\/string>/);
});

test("renewed configs keep the same iOS profile and tunnel UUIDs for in-place replacement", async () => {
  const { createWireGuardMobileConfigBundle } = await loadProfileBuilder();
  const beforeRenewal = createWireGuardMobileConfigBundle([
    { config: config("old-endpoint.example"), hostId: "awg-main", locationName: "Main" },
  ], 91, "amneziawg");
  const afterRenewal = createWireGuardMobileConfigBundle([
    { config: config("new-endpoint.example"), hostId: "awg-main", locationName: "Main" },
  ], 91, "amneziawg");
  const uuidPattern = /<key>PayloadUUID<\/key><string>([^<]+)<\/string>/g;
  const beforeUuids = [...beforeRenewal.matchAll(uuidPattern)].map((match) => match[1]);
  const afterUuids = [...afterRenewal.matchAll(uuidPattern)].map((match) => match[1]);

  assert.deepEqual(afterUuids, beforeUuids);
  assert.match(afterRenewal, /new-endpoint\.example:51820/);
  assert.doesNotMatch(afterRenewal, /old-endpoint\.example:51820/);
  assert.match(beforeRenewal, /<key>PayloadIdentifier<\/key><string>com\.pulse\.amneziawg\.service-91\.servers-[a-f0-9]{16}\.profile<\/string>/);
});

test("unsupported options and duplicate tunnel identities are rejected", async () => {
  const { createWireGuardMobileConfigBundle } = await loadProfileBuilder();
  assert.throws(() => createWireGuardMobileConfigBundle([
    { config: config("edge.example", "PreUp = unsafe"), hostId: "edge", locationName: "Edge" },
  ], 82), /unsupported by iOS/);
  assert.throws(() => createWireGuardMobileConfigBundle([
    { config: config("edge-one.example"), hostId: "same", locationName: "One" },
    { config: config("edge-two.example"), hostId: "same", locationName: "Two" },
  ], 82), /duplicate server identities/);
});
