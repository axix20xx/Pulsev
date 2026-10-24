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
const { hasWireGuardAccess } = await import(`data:text/javascript;base64,${code}`);

test("master-admin subscriptions get WireGuard access in public and mobile flows", () => {
  assert.equal(hasWireGuardAccess("900000001", 0, 900000001), true);
});

test("other resellers keep the explicit WireGuard permission requirement", () => {
  assert.equal(hasWireGuardAccess(900000002, 0, 900000001), false);
  assert.equal(hasWireGuardAccess(900000002, 1, 900000001), true);
});
