import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/worker-mode.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(result.outputFiles[0].text).toString("base64");
const { isBackgroundWorkersPaused } = await import(`data:text/javascript;base64,${code}`);

test("recognizes explicit worker pause values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(isBackgroundWorkersPaused(value), true, value);
  }
});

test("leaves workers enabled for unset, false, and unknown values", () => {
  for (const value of [null, "", "0", "false", "off", "unexpected"]) {
    assert.equal(isBackgroundWorkersPaused(value), false, String(value));
  }
});
