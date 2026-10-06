const truthyValues = new Set(["1", "true", "yes", "on"]);

export function isBackgroundWorkersPaused(
  value: unknown = process.env.PULSE_WORKERS_PAUSED,
): boolean {
  return typeof value === "string" && truthyValues.has(value.trim().toLowerCase());
}
