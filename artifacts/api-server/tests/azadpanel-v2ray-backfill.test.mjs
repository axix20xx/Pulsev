import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/lib/azadpanel-v2ray-backfill.ts", import.meta.url),
    ),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const {
  azadPanelV2RayBackfillPlan,
  hasAzadPanelV2RayBackfillProviderResult,
} = await import(
  `data:text/javascript;base64,${code}`
);

const GB = 1_073_741_824;

test("V2Ray backfill uses the service's latest remaining quota and exact expiry", () => {
  assert.deepEqual(
    azadPanelV2RayBackfillPlan(
      {
        status: "active",
        gb: 50,
        lastRemainingBytes: 12.5 * GB,
        lastUsedBytes: 1 * GB,
        expiresAtUnix: 2_000,
      },
      1_000,
    ),
    { eligible: true, quotaGb: 12.5, expiresAtUnix: 2_000 },
  );
});

test("V2Ray backfill derives remaining quota when no snapshot exists", () => {
  const plan = azadPanelV2RayBackfillPlan({
    status: "active",
    gb: 40,
    lastRemainingBytes: null,
    lastUsedBytes: 10 * GB,
    expiresAtUnix: null,
  });
  assert.deepEqual(plan, { eligible: true, quotaGb: 30, expiresAtUnix: null });
});

test("V2Ray backfill cannot silently complete without a result from its target Provider", () => {
  assert.equal(hasAzadPanelV2RayBackfillProviderResult([], ["azad_v2ray"]), false);
  assert.equal(
    hasAzadPanelV2RayBackfillProviderResult(
      [{ key: "other_provider", status: 200 }],
      ["azad_v2ray"],
    ),
    false,
  );
  assert.equal(
    hasAzadPanelV2RayBackfillProviderResult(
      [{ key: "azad_v2ray", status: 403 }],
      ["azad_v2ray"],
    ),
    true,
  );
});

test("unlimited services remain unlimited in the V2Ray backfill", () => {
  assert.deepEqual(
    azadPanelV2RayBackfillPlan({
      status: "active",
      gb: 0,
      lastRemainingBytes: 0,
      lastUsedBytes: 0,
      expiresAtUnix: null,
    }),
    { eligible: true, quotaGb: 0, expiresAtUnix: null },
  );
});

test("inactive, expired, exhausted, and invalid services are not backfilled", () => {
  const base = {
    status: "active",
    gb: 10,
    lastRemainingBytes: GB,
    lastUsedBytes: 0,
    expiresAtUnix: 2_000,
  };
  assert.equal(
    azadPanelV2RayBackfillPlan({ ...base, status: "disabled" }, 1_000).reason,
    "inactive",
  );
  assert.equal(
    azadPanelV2RayBackfillPlan({ ...base, expiresAtUnix: 1_000 }, 1_000).reason,
    "expired",
  );
  assert.equal(
    azadPanelV2RayBackfillPlan({ ...base, lastRemainingBytes: 0 }, 1_000)
      .reason,
    "quota_exhausted",
  );
  assert.equal(
    azadPanelV2RayBackfillPlan({ ...base, gb: Number.NaN }, 1_000).reason,
    "invalid",
  );
});
