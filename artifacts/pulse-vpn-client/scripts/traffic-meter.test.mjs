import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTrafficRates } from '../lib/traffic-meter.ts';

test('calculates upload and download rates from native byte counters', () => {
  assert.deepEqual(
    calculateTrafficRates(
      { uploadBytes: 2_000, downloadBytes: 5_000 },
      { uploadBytes: 3_800, downloadBytes: 8_600 },
      1_800,
    ),
    { uploadBytesPerSecond: 1_000, downloadBytesPerSecond: 2_000 },
  );
});

test('does not invent a rate on the first sample or after counter resets', () => {
  assert.deepEqual(
    calculateTrafficRates(null, { uploadBytes: 100, downloadBytes: 100 }, 1_000),
    { uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 },
  );
  assert.deepEqual(
    calculateTrafficRates(
      { uploadBytes: 200, downloadBytes: 300 },
      { uploadBytes: 10, downloadBytes: 20 },
      1_000,
    ),
    { uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 },
  );
});

test('ignores implausible sample windows', () => {
  const previous = { uploadBytes: 0, downloadBytes: 0 };
  const current = { uploadBytes: 100_000, downloadBytes: 200_000 };
  assert.deepEqual(calculateTrafficRates(previous, current, 100), {
    uploadBytesPerSecond: 0,
    downloadBytesPerSecond: 0,
  });
  assert.deepEqual(calculateTrafficRates(previous, current, 31_000), {
    uploadBytesPerSecond: 0,
    downloadBytesPerSecond: 0,
  });
});
