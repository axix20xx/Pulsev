import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let moduleNumber = 0;
async function loadCounters() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/awg-counters.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}#${++moduleNumber}`);
}

test("counter resets preserve service-period usage and count new traffic", async () => {
  const { reconcileAwgCounter } = await loadCounters();
  assert.deepEqual(reconcileAwgCounter(5, 100, 10), {
    rawBytes: 5,
    offsetBytes: -85,
    effectiveBytes: 90,
    resetDetected: true,
  });
  assert.deepEqual(reconcileAwgCounter(12, 5, -85), {
    rawBytes: 12,
    offsetBytes: -85,
    effectiveBytes: 97,
    resetDetected: false,
  });
});

test("replacing an AWG client carries its previous effective usage", async () => {
  const { awgOffsetForReplacementClient, effectiveAwgBytes } = await loadCounters();
  const offset = awgOffsetForReplacementClient(100, 15);
  assert.equal(offset, -85);
  assert.equal(effectiveAwgBytes(0, offset), 85);
  assert.equal(effectiveAwgBytes(7, offset), 92);
});
