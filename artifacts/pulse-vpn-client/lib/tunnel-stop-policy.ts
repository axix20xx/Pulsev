import type { ConnectionProtocol } from './connection-identity';
import type { WireGuardVpnStatus, XrayVpnState } from './vpn-engine';

export type NativeTunnelStatus = WireGuardVpnStatus | XrayVpnState;

export function tunnelStatusReportsRunning(
  protocol: ConnectionProtocol,
  status: NativeTunnelStatus,
): boolean {
  if (protocol === 'v2ray') {
    return ['connected', 'connecting', 'preparing', 'disconnecting'].includes(
      (status as XrayVpnState).state,
    );
  }
  const native = status as WireGuardVpnStatus;
  return native.isConnected
    || ['CONNECTED', 'CONNECTING', 'DISCONNECTING'].includes(native.status)
    || ['ACTIVE', 'CONNECTING', 'DISCONNECTING'].includes(native.tunnelState);
}

export function shouldRequestTunnelStop(
  protocol: ConnectionProtocol,
  status: NativeTunnelStatus | null,
): boolean {
  if (!status) return true;
  if (protocol === 'v2ray') return (status as XrayVpnState).state !== 'disconnected';
  const native = status as WireGuardVpnStatus;
  return tunnelStatusReportsRunning(protocol, native)
    || native.status === 'ERROR'
    || native.tunnelState === 'ERROR';
}

export function isTunnelStopConfirmed(
  protocol: ConnectionProtocol,
  status: NativeTunnelStatus | null,
): boolean {
  return status !== null && !tunnelStatusReportsRunning(protocol, status);
}
