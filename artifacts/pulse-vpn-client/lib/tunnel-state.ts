import type { VpnProtocol } from '@/hooks/VpnPreferences';
import type { WireGuardVpnStatus } from './vpn-engine';

export function isNativeTunnelConnected(status: WireGuardVpnStatus): boolean {
  // Native engines can briefly publish the engine state and Android's TUN
  // state in separate callbacks. Any positive native signal means the tunnel
  // must be shown as active until both have been explicitly stopped.
  return status.isConnected || status.status === 'CONNECTED' || status.tunnelState === 'ACTIVE';
}

export function isNativeTunnelConnecting(status: WireGuardVpnStatus): boolean {
  return ['CONNECTING', 'DISCONNECTING'].includes(status.status)
    || ['CONNECTING', 'DISCONNECTING'].includes(status.tunnelState);
}

export function isTunnelConnected(_protocol: VpnProtocol, native: WireGuardVpnStatus): boolean {
  return isNativeTunnelConnected(native);
}

export function isTunnelConnecting(_protocol: VpnProtocol, native: WireGuardVpnStatus): boolean {
  return isNativeTunnelConnecting(native);
}

export function findActiveTunnelProtocol(
  protocols: readonly VpnProtocol[],
  states: Record<VpnProtocol, WireGuardVpnStatus>,
): VpnProtocol | null {
  return protocols.find((protocol) => isTunnelConnected(protocol, states[protocol]))
    ?? protocols.find((protocol) => isTunnelConnecting(protocol, states[protocol]))
    ?? null;
}
