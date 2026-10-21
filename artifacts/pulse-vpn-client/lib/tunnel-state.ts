import type { VpnProtocol } from '@/hooks/VpnPreferences';
import type { WireGuardVpnStatus, XrayVpnState } from './vpn-engine';

export function isNativeTunnelConnected(status: WireGuardVpnStatus): boolean {
  return status.status === 'CONNECTED' && status.tunnelState === 'ACTIVE';
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
