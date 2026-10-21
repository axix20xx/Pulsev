import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearXrayServerHealth,
  getXrayServerHealth,
  hasFreshXrayTcpResults,
  mergeXrayTcpResults,
  rankXrayServers,
  recordXrayTrafficValidation,
} from '../lib/xray-server-health.ts';

test('keeps measured health separate for each subscription', () => {
  clearXrayServerHealth();
  mergeXrayTcpResults('sub-a', [{ id: 'node-a', reachable: true, latencyMs: 70 }], 1_000);

  assert.equal(getXrayServerHealth('sub-a')['node-a']?.latencyMs, 70);
  assert.deepEqual(getXrayServerHealth('sub-b'), {});
});

test('treats only recent TCP measurements as fresh', () => {
  clearXrayServerHealth();
  mergeXrayTcpResults('sub-a', [
    { id: 'node-a', reachable: true, latencyMs: 70 },
    { id: 'node-b', reachable: false, latencyMs: null },
  ], 10_000);

  assert.equal(hasFreshXrayTcpResults('sub-a', ['node-a', 'node-b'], 99_000), true);
  assert.equal(hasFreshXrayTcpResults('sub-a', ['node-a'], 101_000), false);
});

test('ranks previously traffic-verified configs before faster TCP-only nodes', () => {
  clearXrayServerHealth();
  const servers = [
    { id: 'node-fast', protocol: 'vless' },
    { id: 'node-working', protocol: 'vless' },
  ];
  mergeXrayTcpResults('sub-a', [
    { id: 'node-fast', reachable: true, latencyMs: 25 },
    { id: 'node-working', reachable: true, latencyMs: 180 },
  ], 20_000);
  recordXrayTrafficValidation('sub-a', 'node-working', true, 21_000);

  assert.deepEqual(
    rankXrayServers('sub-a', servers, 22_000).map((server) => server.id),
    ['node-working', 'node-fast'],
  );
});

test('does not misclassify UDP configs from a failed TCP probe', () => {
  clearXrayServerHealth();
  const servers = [
    { id: 'udp', protocol: 'hysteria2' },
    { id: 'tcp', protocol: 'vless' },
  ];
  mergeXrayTcpResults('sub-a', [
    { id: 'udp', reachable: false, latencyMs: null },
    { id: 'tcp', reachable: false, latencyMs: null },
  ], 30_000);

  assert.deepEqual(
    rankXrayServers('sub-a', servers, 31_000).map((server) => server.id),
    ['udp', 'tcp'],
  );
});

test('demotes recently traffic-failed configs but keeps them available as fallback', () => {
  clearXrayServerHealth();
  const servers = [
    { id: 'failed', protocol: 'vless' },
    { id: 'unknown', protocol: 'vless' },
  ];
  recordXrayTrafficValidation('sub-a', 'failed', false, 40_000);

  assert.deepEqual(
    rankXrayServers('sub-a', servers, 41_000).map((server) => server.id),
    ['unknown', 'failed'],
  );
});
