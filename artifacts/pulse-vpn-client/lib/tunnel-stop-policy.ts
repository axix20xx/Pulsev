import type { ConnectionProtocol } from './connection-identity';
import type { WireGuardVpnStatus } from './vpn-engine';

export type NativeTunnelStatus = WireGuardVpnStatus;

export function tunnelStatusReportsRunning(
  _protocol: ConnectionProtocol,
  status: NativeTunnelStatus,
): boolean {
  const native = status;
  return native.isConnected
    || ['CONNECTED', 'CONNECTING', 'DISCONNECTING'].includes(native.status)
    || ['ACTIVE', 'CONNECTING', 'DISCONNECTING'].includes(native.tunnelState);
}

export function shouldRequestTunnelStop(
  protocol: ConnectionProtocol,
  status: NativeTunnelStatus | null,
): boolean {
  if (!status) return true;
  return tunnelStatusReportsRunning(protocol, status)
    || status.status === 'ERROR'
    || status.tunnelState === 'ERROR';
}

export function isTunnelStopConfirmed(
  protocol: ConnectionProtocol,
  status: NativeTunnelStatus | null,
): boolean {
  return status !== null && !tunnelStatusReportsRunning(protocol, status);
}
