import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/lib/azadpanel-retry-policy.ts", import.meta.url),
    ),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { isRetryableAzadPanelStatus } = await import(
  `data:text/javascript;base64,${code}`
);

test("AzadPanel permission and request errors are not automatically retried", () => {
  for (const status of [400, 401, 403, 404, 409]) {
    assert.equal(isRetryableAzadPanelStatus(status), false, `HTTP ${status}`);
  }
});

test("AzadPanel timeouts, rate limits, and server errors remain retryable", () => {
  for (const status of [408, 429, 500, 502, 503]) {
    assert.equal(isRetryableAzadPanelStatus(status), true, `HTTP ${status}`);
  }
});
