import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/lib/usage-analytics-window.ts", import.meta.url), "utf8");
const compiled = await transform(source, { loader: "ts", format: "esm" });
const { resolveUsageAnalyticsWindow, tehranDateKey } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`,
);
const tehranTime = (date) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tehran",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(date);

test("day range starts at Tehran midnight and compares the same elapsed time yesterday", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const window = resolveUsageAnalyticsWindow("day", undefined, undefined, now);
  assert.ok(window);
  assert.equal(tehranDateKey(window.fromAt), "2026-11-05");
  assert.equal(tehranTime(window.fromAt), "00:00");
  assert.equal(window.toAt.toISOString(), now.toISOString());
  assert.equal(tehranDateKey(window.previousFromAt), "2026-11-04");
  assert.equal(tehranTime(window.previousFromAt), "00:00");
  assert.equal(window.previousToAt.getTime() - window.previousFromAt.getTime(), window.toAt.getTime() - window.fromAt.getTime());
});

test("custom inclusive Persian-selected Gregorian dates become Tehran calendar boundaries", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const window = resolveUsageAnalyticsWindow("custom", "2026-11-02", "2026-11-03", now);
  assert.ok(window);
  assert.equal(tehranDateKey(window.fromAt), "2026-11-02");
  assert.equal(tehranTime(window.fromAt), "00:00");
  assert.equal(tehranDateKey(window.toAt), "2026-11-04");
  assert.equal(tehranTime(window.toAt), "00:00");
  assert.equal(window.toAt.getTime() - window.fromAt.getTime(), 2 * 24 * 60 * 60_000);
});

test("custom range rejects reversed, future, malformed, and over-retention dates", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  assert.equal(resolveUsageAnalyticsWindow("custom", "2026-11-04", "2026-11-03", now), null);
  assert.equal(resolveUsageAnalyticsWindow("custom", "2026-11-10", "2026-11-11", now), null);
  assert.equal(resolveUsageAnalyticsWindow("custom", "2026-02-31", "2026-03-01", now), null);
  assert.equal(resolveUsageAnalyticsWindow("custom", "2026-06-01", "2026-10-01", now), null);
});
