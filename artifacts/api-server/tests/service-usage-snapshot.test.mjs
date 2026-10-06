import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/service-usage-snapshot.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { serviceUsageBytes, storedPanelUsageSql } = await import(`data:text/javascript;base64,${code}`);

test("adds effective AWG usage when the saved combined total is behind", () => {
  assert.equal(serviceUsageBytes({
    lastUsedBytes: 11,
    panelUsageBytes: 10,
    awgTotalBytes: 5,
    awgOffsetBytes: 2,
  }), 13);
});

test("does not add AWG a second time when the combined total is current", () => {
  assert.equal(serviceUsageBytes({
    lastUsedBytes: 15,
    panelUsageBytes: 10,
    awgTotalBytes: 5,
    awgOffsetBytes: 0,
  }), 15);
});

test("never lowers a previously saved combined total when a source snapshot is stale", () => {
  assert.equal(serviceUsageBytes({
    lastUsedBytes: 25,
    panelUsageBytes: 12,
    awgTotalBytes: 8,
    awgOffsetBytes: 3,
  }), 25);
});

test("panel snapshot SQL reads only the latest saved row per configured panel", () => {
  const sql = storedPanelUsageSql("svc");
  assert.match(sql, /ORDER BY usage\.id DESC\s+LIMIT 1/);
  assert.match(sql, /panel\.is_enabled = 1/);
  assert.throws(() => storedPanelUsageSql("svc; DROP TABLE reseller_services"), /Invalid SQL alias/);
});
