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
const { serviceCanUseAwg, serviceUsageBytes, storedPanelUsageSql } = await import(`data:text/javascript;base64,${code}`);

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

test("signed AWG carry-forward offsets preserve quota usage after a remote counter reset", () => {
  assert.equal(serviceUsageBytes({
    lastUsedBytes: 0,
    panelUsageBytes: 5,
    awgTotalBytes: 10,
    awgOffsetBytes: -5,
  }), 20);
});

test("IPsec usage is added with all provider usage in the shared service total", () => {
  assert.equal(serviceUsageBytes({
    lastUsedBytes: 0,
    panelUsageBytes: 11, // provider rows, including OpenVPN and IPsec
    awgTotalBytes: 3,
    awgOffsetBytes: 1,
  }), 13);
});

test("AWG actions require an active, unexpired service with quota remaining", () => {
  const active = {
    status: "active",
    expiresAt: new Date(Date.now() + 60_000),
    totalBytes: 100,
    usedBytes: 99,
  };
  assert.equal(serviceCanUseAwg(active), true);
  assert.equal(serviceCanUseAwg({ ...active, usedBytes: 100 }), false);
  assert.equal(serviceCanUseAwg({ ...active, status: "disabled" }), false);
  assert.equal(serviceCanUseAwg({ ...active, expiresAt: new Date(Date.now() - 1) }), false);
  assert.equal(serviceCanUseAwg({ ...active, remoteDisablePending: 1 }), false);
});

test("panel snapshot SQL reads only the latest saved row per configured panel", () => {
  const sql = storedPanelUsageSql("svc");
  assert.match(sql, /ORDER BY usage\.id DESC\s+LIMIT 1/);
  assert.match(sql, /panel\.is_enabled = 1/);
  assert.match(sql, /reseller_service_ipsec_accounts ipsec_account/);
  assert.match(sql, /panel\.kind = 'azadpanel_ipsec' THEN ipsec_account\.provider_username/);
  assert.match(sql, /reseller_service_openvpn_provider_accounts openvpn_account/);
  assert.match(sql, /panel\.kind IN \('azadpanel', 'azadpanel_openvpn'\)[\s\S]*COALESCE\(openvpn_account\.provider_username, svc\.rain_username\)/);
  assert.match(sql, /'azadpanel_ipsec'/);
  assert.match(sql, /'rain_admin_wireguard'/);
  assert.throws(() => storedPanelUsageSql("svc; DROP TABLE reseller_services"), /Invalid SQL alias/);
});
