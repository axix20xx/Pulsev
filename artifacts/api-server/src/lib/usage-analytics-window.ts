export type UsageAnalyticsRange = "6h" | "12h" | "day" | "week" | "month" | "custom";

export interface UsageAnalyticsWindow {
  fromAt: Date;
  toAt: Date;
  previousFromAt: Date;
  previousToAt: Date;
  bucketInterval: string;
}

const TEHRAN_TIME_ZONE = "Asia/Tehran";
const tehranPartsFormatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
  timeZone: TEHRAN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsOf(value: Date): Record<string, number> {
  return tehranPartsFormatter.formatToParts(value).reduce<Record<string, number>>((result, part) => {
    if (part.type !== "literal") result[part.type] = Number(part.value);
    return result;
  }, {});
}

export function tehranDateKey(value: Date): string {
  const parts = partsOf(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function dateOrdinal(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function tehranMidnightUtc(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetWallClockAsUtc = Date.UTC(year, month - 1, day);
  let guess = targetWallClockAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = partsOf(new Date(guess));
    const observedWallClockAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    guess += targetWallClockAsUtc - observedWallClockAsUtc;
  }
  return new Date(guess);
}

export function resolveUsageAnalyticsWindow(
  range: UsageAnalyticsRange,
  fromDate: string | undefined,
  toDate: string | undefined,
  now = new Date(),
): UsageAnalyticsWindow | null {
  let fromAt: Date;
  let toAt = now;
  let previousFromAt: Date;
  let previousToAt: Date;

  if (range === "custom") {
    if (!fromDate || !toDate || !isValidDateKey(fromDate) || !isValidDateKey(toDate)) return null;
    const today = tehranDateKey(now);
    if (fromDate > toDate || toDate > today) return null;
    const inclusiveDays = dateOrdinal(toDate) - dateOrdinal(fromDate) + 1;
    if (inclusiveDays > 120) return null;
    fromAt = tehranMidnightUtc(fromDate);
    const dayAfterEnd = tehranMidnightUtc(shiftDateKey(toDate, 1));
    toAt = new Date(Math.min(dayAfterEnd.getTime(), now.getTime()));
    const duration = toAt.getTime() - fromAt.getTime();
    if (duration <= 0) return null;
    previousToAt = fromAt;
    previousFromAt = new Date(fromAt.getTime() - duration);
  } else if (range === "day") {
    const today = tehranDateKey(now);
    fromAt = tehranMidnightUtc(today);
    const duration = now.getTime() - fromAt.getTime();
    previousFromAt = tehranMidnightUtc(shiftDateKey(today, -1));
    previousToAt = new Date(previousFromAt.getTime() + duration);
  } else {
    const durationByRange: Record<Exclude<UsageAnalyticsRange, "custom">, number> = {
      "6h": 6 * 60 * 60_000,
      "12h": 12 * 60 * 60_000,
      day: 24 * 60 * 60_000,
      week: 7 * 24 * 60 * 60_000,
      month: 30 * 24 * 60 * 60_000,
    };
    const duration = durationByRange[range];
    fromAt = new Date(now.getTime() - duration);
    previousToAt = fromAt;
    previousFromAt = new Date(fromAt.getTime() - duration);
  }

  const duration = toAt.getTime() - fromAt.getTime();
  const bucketInterval = range === "6h"
    ? "15 minutes"
    : range === "12h"
      ? "30 minutes"
      : duration <= 12 * 60 * 60_000
        ? "15 minutes"
        : duration <= 24 * 60 * 60_000
          ? "30 minutes"
          : duration <= 48 * 60 * 60_000
            ? "1 hour"
            : "1 day";

  return { fromAt, toAt, previousFromAt, previousToAt, bucketInterval };
}
