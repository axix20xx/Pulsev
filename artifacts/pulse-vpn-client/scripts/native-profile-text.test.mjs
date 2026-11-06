import test from 'node:test';
import assert from 'node:assert/strict';
import { requireNativeProfileText, requireNativeString } from '../lib/native-profile-text.ts';

test('accepts raw native profile text without changing its contents', () => {
  const profile = '[Interface]\nPrivateKey = example\nAddress = 10.0.0.2/32\n';
  assert.equal(requireNativeProfileText(profile, 'WireGuard'), profile);
});

test('rejects object responses before they reach the Kotlin bridge', () => {
  assert.throws(
    () => requireNativeProfileText({ type: 'Buffer', data: [1, 2, 3] }, 'WireGuard'),
    /به‌صورت متن معتبر دریافت نشد/,
  );
  assert.throws(
    () => requireNativeProfileText('[object Object]', 'AmneziaWG'),
    /به‌صورت متن معتبر دریافت نشد/,
  );
});

test('requires non-empty string identifiers at the native boundary', () => {
  assert.equal(requireNativeString('service-1', 'شناسه سرویس'), 'service-1');
  assert.throws(() => requireNativeString({ id: 'service-1' }, 'شناسه سرویس'), /باید متن معتبر باشد/);
});
