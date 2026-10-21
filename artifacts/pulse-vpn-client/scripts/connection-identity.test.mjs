import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectionAttemptKey,
  matchesConnectionTarget,
} from '../lib/connection-identity.ts';

const active = {
  subscriptionId: 'sub-1',
  protocol: 'v2ray',
  serverId: 'server-a',
};

test('a requested V2Ray server must match the active server, not just the subscription', () => {
  assert.equal(matchesConnectionTarget(active, {
    subscriptionId: 'sub-1',
    protocol: 'v2ray',
    serverId: 'server-a',
  }), true);
  assert.equal(matchesConnectionTarget(active, {
    subscriptionId: 'sub-1',
    protocol: 'v2ray',
    serverId: 'server-b',
  }), false);
});

test('smart connect can reuse an active server for the same subscription and protocol', () => {
  assert.equal(matchesConnectionTarget(active, {
    subscriptionId: 'sub-1',
    protocol: 'v2ray',
  }), true);
});

test('connection identity keys separate subscription, protocol, server, and config version', () => {
  const base = { subscriptionId: 'sub-1', protocol: 'v2ray', serverId: 'server-a' };
  const key = connectionAttemptKey(base, 0);
  assert.notEqual(key, connectionAttemptKey({ ...base, serverId: 'server-b' }, 0));
  assert.notEqual(key, connectionAttemptKey({ ...base, subscriptionId: 'sub-2' }, 0));
  assert.notEqual(key, connectionAttemptKey({ ...base, protocol: 'openvpn' }, 0));
  assert.notEqual(
    connectionAttemptKey({ ...base, configVersion: '2' }, 0),
    connectionAttemptKey({ ...base, configVersion: '3' }, 0),
  );
});

