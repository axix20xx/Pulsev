export type ConnectionProtocol = 'openvpn' | 'wireguard' | 'amneziawg';

export interface ConnectionIdentity {
  subscriptionId: string;
  protocol: ConnectionProtocol;
  /**
   * A concrete server/location ID. Null means that the request is for any
   * server on this subscription and protocol (for example, smart connect).
   */
  serverId?: string | null;
  configVersion?: string | null;
}

export function connectionAttemptKey(identity: ConnectionIdentity, retry: number): string {
  return JSON.stringify([
    identity.subscriptionId,
    identity.protocol,
    identity.serverId ?? null,
    identity.configVersion ?? null,
    retry,
  ]);
}

export function matchesConnectionTarget(
  active: ConnectionIdentity | null,
  requested: ConnectionIdentity,
): boolean {
  if (!active) return false;
  if (
    active.subscriptionId !== requested.subscriptionId ||
    active.protocol !== requested.protocol
  ) return false;
  if (requested.configVersion != null && active.configVersion !== requested.configVersion) {
    return false;
  }
  return requested.serverId == null || active.serverId === requested.serverId;
}
