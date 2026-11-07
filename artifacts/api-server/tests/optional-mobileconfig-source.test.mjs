import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadSourceRunner() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/optional-mobileconfig-source.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

test("a failed optional provider is recorded without blocking a healthy provider", async () => {
  const { loadOptionalMobileConfigSource } = await loadSourceRunner();
  const skipped = new Set();
  const failures = [];
  const onFailure = (source, error) => failures.push({ source, message: error.message });

  const failed = await loadOptionalMobileConfigSource(
    "wireguard",
    async () => { throw new Error("HTTP 521"); },
    skipped,
    onFailure,
  );
  const healthy = await loadOptionalMobileConfigSource(
    "openvpn",
    async () => "valid profile",
    skipped,
    onFailure,
  );

  assert.equal(failed, undefined);
  assert.equal(healthy, "valid profile");
  assert.deepEqual([...skipped], ["wireguard"]);
  assert.deepEqual(failures, [{ source: "wireguard", message: "HTTP 521" }]);
});
