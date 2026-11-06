import assert from "node:assert/strict";
import test from "node:test";

const { analyzeWeeklyUsage } = await import("../src/lib/weekly-usage-insights.ts");
const days = [
  "2026-10-31",
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
];
const series = (values, observed = values.map(() => true)) => values.map((bytes, index) => ({
  day: days[index],
  bytes,
  sampleBuckets: observed[index] ? 288 : 0,
  serviceCount: observed[index] ? 3 : 0,
  observed: observed[index],
}));

test("weekly insight coverage excludes missing days instead of treating them as zero", () => {
  const result = analyzeWeeklyUsage(series([100, 0, 200, 0, 300, 0, 0], [true, false, true, false, true, false, false]));
  assert.equal(result.observed_days, 3);
  assert.equal(result.coverage_percent, 43);
  assert.equal(result.average_daily_bytes, 200);
  assert.equal(result.total_bytes, 600);
  assert.equal(result.trend, "insufficient");
});

test("weekly insights identify robust trends and peak day", () => {
  const result = analyzeWeeklyUsage(series([100, 120, 140, 160, 180, 200, 220]));
  assert.equal(result.trend, "rising");
  assert.ok(result.trend_percent_per_day > 10);
  assert.equal(result.peak_day, "2026-11-06");
  assert.equal(result.observed_days, 7);
});

test("weekly anomaly detection flags an isolated spike without confusing it with missing data", () => {
  const result = analyzeWeeklyUsage(series([100, 110, 105, 115, 100, 110, 2_000_000_000]));
  assert.equal(result.anomaly_days.length, 1);
  assert.equal(result.anomaly_days[0].day, "2026-11-06");
  assert.ok(result.anomaly_days[0].robust_score > 3);
});

test("insufficient and all-zero histories do not invent a trend or volatility", () => {
  const sparse = analyzeWeeklyUsage(series([0, 0, 0, 0, 0, 0, 0], [true, true, false, false, false, false, false]));
  assert.equal(sparse.trend, "insufficient");
  assert.equal(sparse.volatility_percent, null);
  const complete = analyzeWeeklyUsage(series([0, 0, 0, 0, 0, 0, 0]));
  assert.equal(complete.trend, "stable");
  assert.equal(complete.average_daily_bytes, 0);
  assert.equal(complete.volatility_percent, null);
  assert.equal(complete.peak_day, null);
  assert.equal(complete.anomaly_days.length, 0);
});
