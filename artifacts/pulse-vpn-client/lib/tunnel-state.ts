import type { VpnProtocol } from '@/hooks/VpnPreferences';
import type { WireGuardVpnStatus, XrayVpnState } from './vpn-engine';

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

export function isTunnelConnected(protocol: VpnProtocol, xray: XrayVpnState, native: WireGuardVpnStatus): boolean {
  return protocol === 'v2ray' ? xray.state === 'connected' : isNativeTunnelConnected(native);
}

export function isTunnelConnecting(protocol: VpnProtocol, xray: XrayVpnState, native: WireGuardVpnStatus): boolean {
  return protocol === 'v2ray'
    ? ['preparing', 'connecting', 'disconnecting'].includes(xray.state)
    : isNativeTunnelConnecting(native);
}

export function findActiveTunnelProtocol(
  protocols: readonly VpnProtocol[],
  xray: XrayVpnState,
  states: Record<VpnProtocol, WireGuardVpnStatus>,
): VpnProtocol | null {
  return protocols.find((protocol) => isTunnelConnected(protocol, xray, states[protocol]))
    ?? protocols.find((protocol) => isTunnelConnecting(protocol, xray, states[protocol]))
    ?? null;
}
