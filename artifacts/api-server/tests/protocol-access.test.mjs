import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/protocol-access.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { hasWireGuardAccess, isWireGuardServiceAvailable } = await import(`data:text/javascript;base64,${code}`);

test("master-admin subscriptions get WireGuard access in public and mobile flows", () => {
  assert.equal(hasWireGuardAccess("900000001", 0, 900000001), true);
});

test("other resellers keep the explicit WireGuard permission requirement", () => {
  assert.equal(hasWireGuardAccess(900000002, 0, 900000001), false);
  assert.equal(hasWireGuardAccess(900000002, 1, 900000001), true);
});

test("mobile WireGuard remains available for unlimited active services", () => {
  assert.equal(isWireGuardServiceAvailable({
    enabled: true,
    status: "active",
    totalBytes: 0,
    remainingBytes: 0,
  }), true);
});

test("mobile WireGuard stays hidden for exhausted, expired, or unauthorized services", () => {
  const base = {
    enabled: true,
    status: "active",
    totalBytes: 100,
    remainingBytes: 0,
    nowMs: 1_000,
    expiresAtMs: 2_000,
  };
  assert.equal(isWireGuardServiceAvailable(base), false);
  assert.equal(isWireGuardServiceAvailable({ ...base, enabled: false, remainingBytes: 50 }), false);
  assert.equal(isWireGuardServiceAvailable({ ...base, status: "expired", remainingBytes: 50 }), false);
  assert.equal(isWireGuardServiceAvailable({ ...base, remainingBytes: 50, expiresAtMs: 999 }), false);
});
