import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTunnelStopConfirmed,
  shouldRequestTunnelStop,
} from '../lib/tunnel-stop-policy.ts';

const disconnected = {
  status: 'DISCONNECTED',
  tunnelState: 'INACTIVE',
  isConnected: false,
};

test('requests an engine stop when native status is unavailable', () => {
  assert.equal(shouldRequestTunnelStop('openvpn', null), true);
  assert.equal(isTunnelStopConfirmed('openvpn', null), false);
});

test('does not stop an already inactive engine but cleans up native error state', () => {
  assert.equal(shouldRequestTunnelStop('wireguard', disconnected), false);
  assert.equal(shouldRequestTunnelStop('amneziawg', {
    ...disconnected,
    status: 'ERROR',
  }), true);
});

test('requires every positive native running signal to clear before confirming stop', () => {
  assert.equal(isTunnelStopConfirmed('openvpn', {
    status: 'DISCONNECTED',
    tunnelState: 'ACTIVE',
    isConnected: false,
  }), false);
  assert.equal(isTunnelStopConfirmed('openvpn', disconnected), true);
  assert.equal(isTunnelStopConfirmed('amneziawg', disconnected), true);
});
