import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadNames() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/public-profile-names.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

test("public VPN names and filenames use one provider-independent numbering scheme", async () => {
  const { publicProfileFilename, publicProfileName } = await loadNames();
  assert.equal(publicProfileName("wireguard", 2), "WireGuard · Server 02");
  assert.equal(publicProfileName("openvpn", 1), "OpenVPN · Server 01");
  assert.equal(
    publicProfileFilename(1073, "wireguard", 2, ".conf"),
    "PULSE-001073-WireGuard-02.conf",
  );
  assert.equal(
    publicProfileFilename("1073", "openvpn", 1, ".ovpn"),
    "PULSE-001073-OpenVPN-01.ovpn",
  );
  assert.equal(
    publicProfileFilename(1073, "wireguard", 3, ".mobileconfig"),
    "PULSE-001073-WireGuard-03.mobileconfig",
  );
});
