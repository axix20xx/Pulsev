import test from "node:test";
import assert from "node:assert/strict";

const { estimateUsageRate, forecastUsageLifecycle, recommendUsagePackageGb } = await import("../src/lib/usage-forecast.ts");
const GB = 1_073_741_824;

function days(start, values, sampleCount = 200) {
  return values.map((bytes, index) => ({
    day: new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10),
    bytes,
    sampleCount,
  }));
}

test("returns insufficient instead of inventing a quota date from sparse history", () => {
  const estimate = estimateUsageRate(days("2026-10-01", [GB, GB], 200), 10 * GB);
  assert.equal(estimate.confidence, "insufficient");
  assert.equal(estimate.daysUntilEmpty, null);
});

test("estimates a stable daily rate and quota date from complete days", () => {
  const estimate = estimateUsageRate(days("2026-10-01", Array(10).fill(GB)), 10 * GB);
  assert.equal(estimate.confidence, "medium");
  assert.ok(Math.abs(estimate.averageDailyBytes - GB) < 1);
  assert.ok(Math.abs(estimate.daysUntilEmpty - 10) < 0.01);
});

test("clips an isolated traffic spike and retains useful rate estimates", () => {
  const history = days("2026-10-01", [GB, GB, GB, GB, 80 * GB, GB, GB, GB, GB, GB]);
  const estimate = estimateUsageRate(history, 10 * GB);
  assert.ok(estimate.averageDailyBytes < 3 * GB);
  assert.ok(estimate.daysUntilEmpty > 3);
});

test("reports rising usage from a recent sustained increase", () => {
  const history = days("2026-10-01", [...Array(10).fill(GB), ...Array(7).fill(3 * GB)]);
  const estimate = estimateUsageRate(history, 20 * GB);
  assert.equal(estimate.trend, "rising");
});

test("chooses earlier of quota forecast and time expiry", () => {
  const estimate = estimateUsageRate(days("2026-10-01", Array(10).fill(GB)), 10 * GB);
  const now = new Date("2026-10-20T00:00:00.000Z");
  const quotaFirst = forecastUsageLifecycle(estimate, "2026-11-10T00:00:00.000Z", now);
  assert.equal(quotaFirst.projectedEndReason, "quota");
  assert.equal(quotaFirst.projectedEndAt, quotaFirst.projectedQuotaAt);
  const expiryFirst = forecastUsageLifecycle(estimate, "2026-10-25T00:00:00.000Z", now);
  assert.equal(expiryFirst.projectedEndReason, "validity");
  assert.equal(expiryFirst.projectedEndAt, "2026-10-25T00:00:00.000Z");
});

test("does not claim quota exhaustion when observed usage is zero", () => {
  const estimate = estimateUsageRate(days("2026-10-01", Array(10).fill(0)), 10 * GB);
  const lifecycle = forecastUsageLifecycle(estimate, "2026-11-01T00:00:00.000Z", new Date("2026-10-20T00:00:00.000Z"));
  assert.equal(estimate.daysUntilEmpty, null);
  assert.equal(lifecycle.projectedEndReason, "validity");
});

test("recommends a rounded package with reserve only when evidence exists", () => {
  const estimate = estimateUsageRate(days("2026-10-01", Array(10).fill(2 * GB)), 20 * GB);
  assert.equal(recommendUsagePackageGb(estimate, 30), 70);
  assert.equal(recommendUsagePackageGb(estimateUsageRate([], 20 * GB), 30), null);
});
