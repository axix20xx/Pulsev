export type WeeklyUsagePoint = {
  day: string;
  bytes: number;
  sampleBuckets: number;
  serviceCount: number;
  observed: boolean;
};

export type WeeklyUsageInsights = {
  expected_days: 7;
  observed_days: number;
  coverage_percent: number;
  total_bytes: number;
  average_daily_bytes: number | null;
  median_daily_bytes: number | null;
  volatility_percent: number | null;
  trend: "rising" | "stable" | "falling" | "insufficient";
  trend_percent_per_day: number | null;
  peak_day: string | null;
  peak_day_bytes: number | null;
  anomaly_days: Array<{ day: string; bytes: number; robust_score: number }>;
};

const MEBIBYTE = 1_048_576;
const ANOMALY_MIN_BYTES = 512 * MEBIBYTE;
const MAD_SCALE = 1.4826;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dayOrdinal(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) return null;
  return parsed.getTime() / 86_400_000;
}

function robustSlope(points: Array<{ day: string; bytes: number }>): number | null {
  if (points.length < 2) return null;
  const dated = points
    .flatMap((point) => {
      const ordinal = dayOrdinal(point.day);
      return ordinal === null ? [] : [{ ...point, ordinal }];
    });
  const slopes: number[] = [];
  for (let left = 0; left < dated.length; left += 1) {
    for (let right = left + 1; right < dated.length; right += 1) {
      const elapsedDays = dated[right].ordinal - dated[left].ordinal;
      if (elapsedDays > 0) slopes.push((dated[right].bytes - dated[left].bytes) / elapsedDays);
    }
  }
  return median(slopes);
}

export function analyzeWeeklyUsage(samples: readonly WeeklyUsagePoint[]): WeeklyUsageInsights {
  const points = samples
    .filter((sample) => sample.observed && sample.sampleBuckets > 0 && dayOrdinal(sample.day) !== null)
    .map((sample) => ({ day: sample.day, bytes: Math.max(0, Number(sample.bytes) || 0) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const values = points.map((point) => point.bytes);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const center = median(values);
  const absoluteDeviations = center === null ? [] : values.map((value) => Math.abs(value - center));
  const mad = median(absoluteDeviations);
  const scaledMad = mad === null ? null : mad * MAD_SCALE;
  const slope = points.length >= 5 ? robustSlope(points) : null;
  const trendPercent = slope !== null && center !== null && center > 0 ? (slope / center) * 100 : null;
  const trend = points.length < 5
    ? "insufficient"
    : trendPercent === null || Math.abs(trendPercent) < 10
      ? "stable"
      : trendPercent > 0
        ? "rising"
        : "falling";
  const anomalyThreshold = center === null
    ? null
    : Math.max(ANOMALY_MIN_BYTES, center * 1.5, (scaledMad ?? 0) * 3);
  const anomalyMinimum = center === null || anomalyThreshold === null
    ? null
    : Math.max(ANOMALY_MIN_BYTES, center * 2.5, center + anomalyThreshold);
  const anomalyDenominator = Math.max(scaledMad ?? 0, ANOMALY_MIN_BYTES / 3);
  const anomalyDays = points.length < 5 || anomalyMinimum === null
    ? []
    : points
      .filter((point) => point.bytes >= anomalyMinimum)
      .map((point) => ({
        day: point.day,
        bytes: point.bytes,
        robust_score: Number(((point.bytes - (center ?? 0)) / anomalyDenominator).toFixed(2)),
      }));
  const peakCandidate = points.reduce<(typeof points)[number] | null>(
    (current, point) => !current || point.bytes > current.bytes ? point : current,
    null,
  );
  const peak = peakCandidate && peakCandidate.bytes > 0 ? peakCandidate : null;

  return {
    expected_days: 7,
    observed_days: points.length,
    coverage_percent: Math.round((points.length / 7) * 100),
    total_bytes: values.reduce((sum, value) => sum + value, 0),
    average_daily_bytes: average,
    median_daily_bytes: center,
    volatility_percent: center !== null && center > 0 && scaledMad !== null
      ? Number((scaledMad / center * 100).toFixed(1))
      : null,
    trend,
    trend_percent_per_day: trendPercent === null ? null : Number(trendPercent.toFixed(1)),
    peak_day: peak?.day ?? null,
    peak_day_bytes: peak?.bytes ?? null,
    anomaly_days: anomalyDays,
  };
}
