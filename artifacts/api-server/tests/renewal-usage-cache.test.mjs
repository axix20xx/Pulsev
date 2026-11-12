import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadRenewalUsageCacheModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/renewal-usage-cache.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

test("renewal clears saved usage for every provider identity in one targeted query", async () => {
  const { clearRenewalUsageSnapshots } = await loadRenewalUsageCacheModule();
  const calls = [];

  await clearRenewalUsageSnapshots(async (sql, params) => {
    calls.push({ sql, params });
  }, 42, "service-user");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [42, "service-user"]);
  for (const table of [
    "reseller_service_usage_provider_accounts",
    "reseller_service_wireguard_provider_accounts",
    "reseller_service_v2ray_accounts",
    "reseller_service_openvpn_provider_accounts",
    "reseller_service_ipsec_accounts",
    "raven_service_accounts",
  ]) {
    assert.match(calls[0].sql, new RegExp(table));
  }
  assert.match(calls[0].sql, /COALESCE\(upload, 0\) \+ COALESCE\(download, 0\)/);
  assert.match(calls[0].sql, /panel_key <> 'rootvpn'/);
  assert.match(calls[0].sql, /DELETE FROM user_stats_cache/);
});
