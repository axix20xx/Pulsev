import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findActiveTunnelProtocol,
  isNativeTunnelConnected,
  isNativeTunnelConnecting,
} from '../lib/tunnel-state.ts';

test('keeps a native tunnel active when the engine and TUN callbacks arrive separately', () => {
  assert.equal(isNativeTunnelConnected({
    status: 'CONNECTED',
    tunnelState: 'INACTIVE',
    isConnected: false,
  }), true);
  assert.equal(isNativeTunnelConnected({
    status: 'DISCONNECTED',
    tunnelState: 'ACTIVE',
    isConnected: false,
  }), true);
  assert.equal(isNativeTunnelConnected({
    status: 'UNKNOWN',
    tunnelState: 'UNKNOWN',
    isConnected: true,
  }), true);
});

test('marks native tunnels disconnected only after every native signal is down', () => {
  assert.equal(isNativeTunnelConnected({
    status: 'DISCONNECTED',
    tunnelState: 'INACTIVE',
    isConnected: false,
  }), false);
});

test('finds the active protocol even when its native state fields briefly disagree', () => {
  const unknown = { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
  const states = {
    openvpn: { status: 'CONNECTED', tunnelState: 'INACTIVE', isConnected: false },
    wireguard: unknown,
    amneziawg: unknown,
  };

  assert.equal(findActiveTunnelProtocol(['openvpn', 'wireguard', 'amneziawg'], states), 'openvpn');
});

test('keeps connecting and disconnecting states visible as transitional', () => {
  assert.equal(isNativeTunnelConnecting({
    status: 'DISCONNECTED',
    tunnelState: 'DISCONNECTING',
    isConnected: false,
  }), true);
});
