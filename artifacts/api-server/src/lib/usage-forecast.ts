export type UsageConfidence = "high" | "medium" | "low" | "insufficient";
export type UsageTrend = "rising" | "stable" | "falling" | "unknown";
export type UsageEndReason = "quota" | "validity" | "unknown";

export type DailyUsageSample = {
  day: string;
  bytes: number;
  sampleCount: number;
};

export type UsageRateEstimate = {
  averageDailyBytes: number | null;
  conservativeDailyBytes: number | null;
  highUsageDailyBytes: number | null;
  daysUntilEmpty: number | null;
  fastDaysUntilEmpty: number | null;
  slowDaysUntilEmpty: number | null;
  coverageDays: number;
  observedDays: number;
  sampleCount: number;
  confidence: UsageConfidence;
  trend: UsageTrend;
};

export type UsageLifecycleForecast = UsageRateEstimate & {
  projectedQuotaAt: string | null;
  projectedEndAt: string | null;
  projectedEndReason: UsageEndReason;
};

const MIN_DAILY_SAMPLES = 72;
const DAY_MS = 86_400_000;
const GB_BYTES = 1_073_741_824;

function dayEpoch(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const epoch = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(epoch) ? epoch : null;
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const ratio = position - lower;
  return sorted[lower]! * (1 - ratio) + sorted[upper]! * ratio;
}

function weightedRobustMean(rows: Array<{ epoch: number; bytes: number; sampleCount: number }>, anchor: number): number | null {
  if (!rows.length) return null;
  const values = rows.map((row) => row.bytes);
  const center = quantile(values, 0.5) ?? 0;
  const deviations = values.map((value) => Math.abs(value - center));
  const mad = quantile(deviations, 0.5) ?? 0;
  const q90 = quantile(values, 0.9) ?? center;
  const robustUpper = mad > 0 ? center + 4.4478 * mad : center;
  const upper = Math.min(q90, robustUpper);
  let weightedBytes = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const ageDays = Math.max(0, (anchor - row.epoch) / DAY_MS);
    const recencyWeight = Math.pow(2, -ageDays / 7);
    const completenessWeight = Math.min(1, row.sampleCount / MIN_DAILY_SAMPLES);
    const weight = recencyWeight * completenessWeight;
    const clippedBytes = Math.min(upper, row.bytes);
    weightedBytes += clippedBytes * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedBytes / totalWeight : null;
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function estimateUsageRate(samples: DailyUsageSample[], remainingBytes: number): UsageRateEstimate {
  const rows = samples
    .map((sample) => ({
      epoch: dayEpoch(String(sample.day)),
      bytes: Math.max(0, Number(sample.bytes)),
      sampleCount: Math.max(0, Math.floor(Number(sample.sampleCount))),
    }))
    .filter((sample): sample is { epoch: number; bytes: number; sampleCount: number } =>
      sample.epoch !== null &&
      Number.isFinite(sample.bytes) &&
      Number.isFinite(sample.sampleCount) &&
      sample.sampleCount >= MIN_DAILY_SAMPLES
    )
    .sort((a, b) => a.epoch - b.epoch);
  const observedDays = rows.length;
  const sampleCount = rows.reduce((sum, row) => sum + row.sampleCount, 0);
  const coverageDays = observedDays > 1
    ? Math.max(0, Math.round((rows[observedDays - 1]!.epoch - rows[0]!.epoch) / DAY_MS))
    : 0;
  const coverageRatio = observedDays / Math.max(1, coverageDays + 1);
  if (observedDays < 3 || coverageDays < 2) {
    return {
      averageDailyBytes: null,
      conservativeDailyBytes: null,
      highUsageDailyBytes: null,
      daysUntilEmpty: null,
      fastDaysUntilEmpty: null,
      slowDaysUntilEmpty: null,
      coverageDays,
      observedDays,
      sampleCount,
      confidence: "insufficient",
      trend: "unknown",
    };
  }

  const latestEpoch = rows[observedDays - 1]!.epoch;
  const recentRows = rows.filter((row) => latestEpoch - row.epoch <= 6 * DAY_MS);
  const baselineRate = weightedRobustMean(rows, latestEpoch);
  const recentRate = weightedRobustMean(recentRows, latestEpoch);
  const averageDailyBytes = baselineRate === null
    ? recentRate
    : recentRate === null
      ? baselineRate
      : baselineRate * 0.35 + recentRate * 0.65;
  const conservativeDailyBytes = quantile(rows.map((row) => row.bytes), 0.25);
  const highUsageDailyBytes = quantile(rows.map((row) => row.bytes), 0.75);
  const safeRemaining = Math.max(0, Number(remainingBytes) || 0);
  const daysUntilEmpty = averageDailyBytes && averageDailyBytes > 0
    ? safeRemaining / averageDailyBytes
    : null;
  const fastDaysUntilEmpty = highUsageDailyBytes && highUsageDailyBytes > 0
    ? safeRemaining / highUsageDailyBytes
    : null;
  const slowDaysUntilEmpty = conservativeDailyBytes && conservativeDailyBytes > 0
    ? safeRemaining / conservativeDailyBytes
    : null;

  const priorRows = rows.filter((row) => latestEpoch - row.epoch > 6 * DAY_MS);
  const recentMedian = median(recentRows.map((row) => row.bytes));
  const priorMedian = median(priorRows.map((row) => row.bytes));
  const trend: UsageTrend = recentMedian === null
    ? "unknown"
    : priorMedian === null
      ? recentMedian > 0 ? "rising" : "stable"
      : priorMedian === 0
        ? recentMedian > 0 ? "rising" : "stable"
        : recentMedian >= priorMedian * 1.2
          ? "rising"
          : recentMedian <= priorMedian * 0.8
            ? "falling"
            : "stable";

  const confidence: UsageConfidence = observedDays >= 14 && coverageRatio >= 0.7
    ? "high"
    : observedDays >= 7 && coverageRatio >= 0.5
      ? "medium"
      : "low";
  return {
    averageDailyBytes: averageDailyBytes === null ? null : Math.max(0, averageDailyBytes),
    conservativeDailyBytes,
    highUsageDailyBytes,
    daysUntilEmpty,
    fastDaysUntilEmpty,
    slowDaysUntilEmpty,
    coverageDays,
    observedDays,
    sampleCount,
    confidence,
    trend,
  };
}

export function forecastUsageLifecycle(
  estimate: UsageRateEstimate,
  expiresAt: Date | string | null,
  now: Date,
): UsageLifecycleForecast {
  const quotaAt = estimate.daysUntilEmpty === null
    ? null
    : new Date(now.getTime() + estimate.daysUntilEmpty * DAY_MS);
  const expiry = expiresAt === null ? null : new Date(expiresAt);
  const validExpiry = expiry && Number.isFinite(expiry.getTime()) ? expiry : null;
  const projectedEnd = quotaAt && validExpiry
    ? quotaAt.getTime() <= validExpiry.getTime() ? quotaAt : validExpiry
    : quotaAt ?? validExpiry;
  const projectedEndReason: UsageEndReason = !projectedEnd
    ? "unknown"
    : quotaAt && projectedEnd === quotaAt
      ? "quota"
      : "validity";
  return {
    ...estimate,
    projectedQuotaAt: quotaAt?.toISOString() ?? null,
    projectedEndAt: projectedEnd?.toISOString() ?? null,
    projectedEndReason,
  };
}

export function recommendUsagePackageGb(estimate: UsageRateEstimate, days = 30): number | null {
  const rate = estimate.highUsageDailyBytes ?? estimate.averageDailyBytes;
  if (
    estimate.confidence === "insufficient" ||
    rate === null ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isFinite(days) ||
    days <= 0
  ) {
    return null;
  }
  const usageWithReserveGb = (rate * days * 1.15) / GB_BYTES;
  if (!Number.isFinite(usageWithReserveGb) || usageWithReserveGb <= 0) return null;
  return Math.ceil(Math.max(5, usageWithReserveGb) / 5) * 5;
}
