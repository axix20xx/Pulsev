const nonNegativeBytes = (value: unknown): number => {
  const bytes = Number(value);
  return Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0;
};

const signedBytes = (value: unknown): number => {
  const bytes = Number(value);
  return Number.isFinite(bytes) ? Math.round(bytes) : 0;
};

export function effectiveAwgBytes(rawBytes: unknown, offsetBytes: unknown): number {
  return Math.max(0, nonNegativeBytes(rawBytes) - signedBytes(offsetBytes));
}

export function reconcileAwgCounter(
  rawBytesInput: unknown,
  previousRawBytesInput: unknown,
  previousOffsetBytesInput: unknown,
): { rawBytes: number; offsetBytes: number; effectiveBytes: number; resetDetected: boolean } {
  const rawBytes = nonNegativeBytes(rawBytesInput);
  const previousRawBytes = nonNegativeBytes(previousRawBytesInput);
  let offsetBytes = signedBytes(previousOffsetBytesInput);
  const resetDetected = previousRawBytes > 0 && rawBytes < previousRawBytes * 0.5;

  if (resetDetected) {
    const previousEffectiveBytes = effectiveAwgBytes(previousRawBytes, offsetBytes);
    // Keep the service-period total continuous when the remote counter restarts.
    offsetBytes = rawBytes - previousEffectiveBytes;
  }

  return {
    rawBytes,
    offsetBytes,
    effectiveBytes: effectiveAwgBytes(rawBytes, offsetBytes),
    resetDetected,
  };
}

export function awgOffsetForReplacementClient(
  previousRawBytes: unknown,
  previousOffsetBytes: unknown,
): number {
  // A new remote client starts at zero. A negative baseline carries forward the
  // service-period usage without discarding quota already consumed.
  return -effectiveAwgBytes(previousRawBytes, previousOffsetBytes);
}
