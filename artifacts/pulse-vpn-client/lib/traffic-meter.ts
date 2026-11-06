export type TrafficCounters = {
  uploadBytes: number;
  downloadBytes: number;
};

export type TrafficRates = {
  uploadBytesPerSecond: number;
  downloadBytesPerSecond: number;
};

function safeCounter(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function calculateTrafficRates(
  previous: TrafficCounters | null,
  current: TrafficCounters,
  elapsedMs: number,
): TrafficRates {
  if (!previous || !Number.isFinite(elapsedMs) || elapsedMs < 250 || elapsedMs > 30_000) {
    return { uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 };
  }

  const previousUpload = safeCounter(previous.uploadBytes);
  const previousDownload = safeCounter(previous.downloadBytes);
  const currentUpload = safeCounter(current.uploadBytes);
  const currentDownload = safeCounter(current.downloadBytes);

  // A new tunnel or reset counters must not produce a negative or misleading rate.
  if (currentUpload < previousUpload || currentDownload < previousDownload) {
    return { uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 };
  }

  return {
    uploadBytesPerSecond: Math.round((currentUpload - previousUpload) * 1000 / elapsedMs),
    downloadBytesPerSecond: Math.round((currentDownload - previousDownload) * 1000 / elapsedMs),
  };
}
