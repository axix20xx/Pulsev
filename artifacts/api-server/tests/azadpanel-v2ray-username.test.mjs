import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/lib/azadpanel-v2ray-username.ts", import.meta.url),
    ),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { azadPanelV2RayCollisionUsername } = await import(
  `data:text/javascript;base64,${code}`
);

test("V2Ray collision identity is stable and isolated to its service", () => {
  assert.equal(azadPanelV2RayCollisionUsername(1073), "pulsev2_1073");
  assert.equal(azadPanelV2RayCollisionUsername(1074), "pulsev2_1074");
});

test("invalid service IDs cannot produce a Provider username", () => {
  assert.equal(azadPanelV2RayCollisionUsername(0), null);
  assert.equal(azadPanelV2RayCollisionUsername(-1), null);
  assert.equal(azadPanelV2RayCollisionUsername(Number.NaN), null);
});
