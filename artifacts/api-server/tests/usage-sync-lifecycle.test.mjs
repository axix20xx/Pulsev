import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let moduleNumber = 0;

async function loadUsageSyncModule(state) {
  globalThis.__usageSyncLifecycleTest = state;
  const stubs = new Map([
    ["db", `
      export const pool = globalThis.__usageSyncLifecycleTest.pool;
    `],
    ["amneziawg", `
      export class AwgApiError extends Error {}
      export async function disableAwgClient(clientId) {
        const state = globalThis.__usageSyncLifecycleTest;
        state.awgDisableCalls.push(clientId);
        return state.awgDisableResult;
      }
      export async function getAwgStats(clientId) {
        const state = globalThis.__usageSyncLifecycleTest;
        state.awgStatsCalls.push(clientId);
        if (state.awgStatsError) throw state.awgStatsError;
        return state.awgStats;
      }
    `],
    ["rain", `
      export async function readPanelUsages() {
        const state = globalThis.__usageSyncLifecycleTest;
        if (state.panelUsageError) throw state.panelUsageError;
        return state.panelUsages;
      }
      export async function disablePanelUser(...args) {
        const state = globalThis.__usageSyncLifecycleTest;
        state.panelDisableCalls.push(args);
        if (state.panelDisableError) throw state.panelDisableError;
        return state.panelDisableResult;
      }
    `],
    ["service-disable-guard", `
      export async function hasOtherActiveServiceWithUsername() {
        return globalThis.__usageSyncLifecycleTest.sharedUsername;
      }
    `],
    ["logger", `export const logger = { warn() {}, info() {}, error() {} };`],
    ["usage-history", `export async function recordUsageHistorySample() {}`],
  ]);

  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/usage-sync.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [{
      name: "offline-usage-sync-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: "db",
          namespace: "usage-sync-test",
        }));
        builder.onResolve({ filter: /^\.\// }, (args) => {
          if (!stubs.has(args.path.slice(2))) return null;
          return { path: args.path.slice(2), namespace: "usage-sync-test" };
        });
        builder.onLoad({ filter: /.*/, namespace: "usage-sync-test" }, (args) => ({
          contents: stubs.get(args.path),
          loader: "js",
        }));
      },
    }],
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}#${++moduleNumber}`);
}

function makeState({ expired = false, status = "active", pending = 0 } = {}) {
  const service = {
    id: 42,
    reseller_tg_id: 7,
    customer_id: null,
    customer_name: "Test",
    rain_username: "service-user-42",
    falco_config_id: null,
    awg_client_id: "awg-client-42",
    awg_offset_bytes: 0,
    awg_total: 0,
    expire_at: expired ? "2020-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z",
    last_used_bytes: 0,
    expired_in_db: expired,
    gb: 1,
    token: null,
    status,
    disable_reason: null,
    lifecycle_version: 0,
    remote_disable_pending: pending,
  };
  const state = {
    service,
    panelUsages: [],
    panelUsageError: null,
    panelDisableResult: { attempted: 2, disabled: 2 },
    panelDisableError: null,
    panelDisableCalls: [],
    awgDisableResult: true,
    awgDisableCalls: [],
    awgStats: { rxBytes: 1_073_741_824, txBytes: 0 },
    awgStatsError: null,
    awgStatsCalls: [],
    sharedUsername: false,
    serviceUpdates: [],
    sqlCalls: [],
  };
  state.pool = {
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {},
    }),
    query: async (sql, params = []) => {
      state.sqlCalls.push({ sql, params });
      if (sql.includes("FROM reseller_services svc")) {
        return { rows: [{ ...state.service }] };
      }
      if (sql.includes("UPDATE reseller_services")) {
        if (sql.includes("SET awg_rx")) return { rows: [], rowCount: 1 };
        state.serviceUpdates.push(params);
        return {
          rows: [{ lifecycle_version: Number(state.service.lifecycle_version) + 1 }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE service_provision_jobs")) return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE user_stats_cache")) return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO user_stats_cache")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected usage-sync SQL: ${sql}`);
    },
  };
  return state;
}

test("automatic quota disable targets mapped disabled Providers and AWG separately", async () => {
  const state = makeState();
  const usageSync = await loadUsageSyncModule(state);

  assert.equal(await usageSync.syncServiceUsageById(42), true);
  assert.equal(state.serviceUpdates.length, 1);
  assert.equal(state.serviceUpdates[0][5], true, "quota reached should disable the service");
  assert.equal(state.serviceUpdates[0][6], "حجم اشتراک به پایان رسیده است");
  assert.equal(state.serviceUpdates[0][7], true, "all provider and AWG shutdowns should complete");
  assert.equal(state.serviceUpdates[0][8], true, "confirmed AWG shutdown should clear its remote ID");
  assert.equal(state.panelDisableCalls.length, 1);
  assert.equal(state.panelDisableCalls[0][5].includeDisabledProviders, true);
  assert.deepEqual(state.awgDisableCalls, ["awg-client-42"]);
});

test("AWG-only quota exhaustion completes when there are no panel targets", async () => {
  const state = makeState();
  state.panelDisableResult = { attempted: 0, disabled: 0 };
  const usageSync = await loadUsageSyncModule(state);

  await usageSync.syncServiceUsageById(42);
  assert.equal(state.serviceUpdates[0][5], true);
  assert.equal(state.serviceUpdates[0][7], true, "zero panel targets are complete");
  assert.equal(state.serviceUpdates[0][8], true, "AWG must still be confirmed and cleared");
  assert.deepEqual(state.awgDisableCalls, ["awg-client-42"]);
});

test("quota shutdown waits for a fresh usage snapshot", async () => {
  const state = makeState();
  state.awgStatsError = new Error("synthetic AWG stats outage");
  const usageSync = await loadUsageSyncModule(state);

  await usageSync.syncServiceUsageById(42);
  assert.equal(state.serviceUpdates[0][5], false, "stale quota data must not disable an active service");
  assert.equal(state.panelDisableCalls.length, 0);
  assert.equal(state.awgDisableCalls.length, 0);
});

test("automatic date expiry uses the same full provider and AWG shutdown path", async () => {
  const state = makeState({ expired: true });
  state.awgStatsError = new Error("synthetic AWG stats outage");
  const usageSync = await loadUsageSyncModule(state);

  assert.equal(await usageSync.syncServiceUsageById(42), true);
  assert.equal(state.serviceUpdates[0][5], true, "expired service should be disabled");
  assert.equal(state.serviceUpdates[0][6], "تاریخ اعتبار اشتراک به پایان رسیده است");
  assert.equal(state.serviceUpdates[0][7], true);
  assert.equal(state.serviceUpdates[0][8], true);
  assert.equal(state.panelDisableCalls[0][5].includeDisabledProviders, true);
  assert.deepEqual(state.awgDisableCalls, ["awg-client-42"]);
  assert.deepEqual(state.awgStatsCalls, ["awg-client-42"], "expiry must not depend on fresh usage reads");
});

test("automatic shutdown stays pending and retries when any mapped Provider fails", async () => {
  const state = makeState({ expired: true });
  state.panelDisableResult = { attempted: 2, disabled: 1 };
  const usageSync = await loadUsageSyncModule(state);

  await usageSync.syncServiceUsageById(42);
  assert.equal(state.serviceUpdates[0][7], false, "incomplete provider disable must remain pending");
  assert.equal(state.serviceUpdates[0][8], true, "successful AWG deletion can clear only the AWG ID");

  state.service.status = "disabled";
  state.service.remote_disable_pending = 1;
  state.service.awg_client_id = null;
  state.panelDisableResult = { attempted: 2, disabled: 2 };
  await usageSync.syncServiceUsageById(42);
  assert.equal(state.panelDisableCalls.length, 2, "pending service should retry provider shutdown");
  assert.equal(state.panelDisableCalls[1][5].includeDisabledProviders, true);
  assert.equal(state.serviceUpdates[1][7], true, "confirmed retry should clear pending state");
  assert.equal(state.awgDisableCalls.length, 1, "already-confirmed AWG should not be deleted again");
});

test("automatic shutdown stays pending and retries when AWG deletion fails", async () => {
  const state = makeState({ expired: true });
  state.awgDisableResult = false;
  const usageSync = await loadUsageSyncModule(state);

  await usageSync.syncServiceUsageById(42);
  assert.equal(state.serviceUpdates[0][7], false);
  assert.equal(state.serviceUpdates[0][8], false, "failed AWG deletion must preserve its client ID");

  state.service.status = "disabled";
  state.service.remote_disable_pending = 1;
  state.awgDisableResult = true;
  await usageSync.syncServiceUsageById(42);
  assert.equal(state.awgDisableCalls.length, 2);
  assert.equal(state.serviceUpdates[1][7], true);
  assert.equal(state.serviceUpdates[1][8], true);
});

test("automatic expiry stays locally disabled and pending if Provider shutdown throws", async () => {
  const state = makeState({ expired: true });
  state.awgStatsError = new Error("synthetic AWG stats outage");
  state.panelUsageError = new Error("synthetic Provider usage read outage");
  state.panelDisableError = new Error("synthetic Provider database outage");
  state.awgDisableResult = false;
  const usageSync = await loadUsageSyncModule(state);

  await usageSync.syncServiceUsageById(42);
  assert.equal(state.serviceUpdates[0][5], true, "expiry disables the local service despite remote errors");
  assert.equal(state.serviceUpdates[0][7], false, "remote shutdown remains pending");
  assert.equal(state.serviceUpdates[0][8], false, "failed AWG deletion keeps its client ID");
  assert.equal(state.panelDisableCalls[0][5].includeDisabledProviders, true);

  state.service.status = "disabled";
  state.service.remote_disable_pending = 1;
  state.panelDisableError = null;
  state.panelUsageError = null;
  state.awgStatsError = null;
  state.awgDisableResult = true;
  await usageSync.syncServiceUsageById(42);
  assert.equal(state.panelDisableCalls.length, 2);
  assert.equal(state.serviceUpdates[1][7], true, "a successful retry clears pending state");
  assert.equal(state.serviceUpdates[1][8], true, "a successful AWG retry clears its ID");
});
