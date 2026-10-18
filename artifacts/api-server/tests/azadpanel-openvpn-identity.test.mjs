import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/lib/azadpanel-openvpn-identity.ts", import.meta.url));
const { outputFiles } = await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { text } = outputFiles[0];
const {
  azadPanelOpenVpnCollisionUsername,
  shouldUseAzadPanelOpenVpnCollision,
} = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);

test("OpenVPN ownership 403 uses a deterministic service-only identity", () => {
  assert.equal(azadPanelOpenVpnCollisionUsername(1073), "pulseovpn_1073");
  assert.equal(shouldUseAzadPanelOpenVpnCollision({
    status: 403,
    providerUsername: "u643_635d6e",
    serviceUsername: "u643_635d6e",
    serviceId: 1073,
  }), true);
});

test("working original OpenVPN accounts are never moved to a collision identity", () => {
  assert.equal(shouldUseAzadPanelOpenVpnCollision({
    status: 200,
    providerUsername: "legacy-user",
    serviceUsername: "legacy-user",
    serviceId: 1073,
  }), false);
  assert.equal(shouldUseAzadPanelOpenVpnCollision({
    status: 403,
    providerUsername: "pulseovpn_1073",
    serviceUsername: "legacy-user",
    serviceId: 1073,
  }), false);
});

test("timeouts and other HTTP failures do not trigger OpenVPN collision fallback", () => {
  for (const status of [0, 401, 404, 409, 429, 500]) {
    assert.equal(shouldUseAzadPanelOpenVpnCollision({
      status,
      providerUsername: "legacy-user",
      serviceUsername: "legacy-user",
      serviceId: 1073,
    }), false);
  }
  assert.equal(azadPanelOpenVpnCollisionUsername(undefined), null);
  assert.equal(azadPanelOpenVpnCollisionUsername(Number.MAX_SAFE_INTEGER + 1), null);
});
