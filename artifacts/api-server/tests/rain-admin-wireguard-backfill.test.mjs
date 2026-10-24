import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/rain-admin-wireguard-backfill.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { rainAdminWireGuardBackfillPlan } = await import(`data:text/javascript;base64,${code}`);

test("Rain Admin WireGuard backfill accepts active unlimited services without expiry", () => {
  assert.deepEqual(
    rainAdminWireGuardBackfillPlan({
      status: "active",
      gb: 0,
      lastRemainingBytes: null,
      lastUsedBytes: 0,
      expiresAtUnix: null,
      nowUnix: 100,
    }),
    { eligible: true, expiresAtUnix: null },
  );
});

test("Rain Admin WireGuard backfill keeps an existing future expiry", () => {
  assert.deepEqual(
    rainAdminWireGuardBackfillPlan({
      status: "active",
      gb: 5,
      lastRemainingBytes: 2 * 1024 ** 3,
      lastUsedBytes: 3 * 1024 ** 3,
      expiresAtUnix: 200,
      nowUnix: 100,
    }),
    { eligible: true, expiresAtUnix: 200 },
  );
});

test("Rain Admin WireGuard backfill excludes inactive, expired, exhausted, and invalid services", () => {
  const base = {
    status: "active",
    gb: 5,
    lastRemainingBytes: null,
    lastUsedBytes: 0,
    expiresAtUnix: 200,
    nowUnix: 100,
  };
  assert.deepEqual(rainAdminWireGuardBackfillPlan({ ...base, status: "paused" }), {
    eligible: false,
    reason: "inactive",
  });
  assert.deepEqual(rainAdminWireGuardBackfillPlan({ ...base, expiresAtUnix: 100 }), {
    eligible: false,
    reason: "expired",
  });
  assert.deepEqual(rainAdminWireGuardBackfillPlan({ ...base, lastUsedBytes: 5 * 1024 ** 3 }), {
    eligible: false,
    reason: "quota_exhausted",
  });
  assert.deepEqual(rainAdminWireGuardBackfillPlan({ ...base, gb: "invalid" }), {
    eligible: false,
    reason: "invalid",
  });
});
