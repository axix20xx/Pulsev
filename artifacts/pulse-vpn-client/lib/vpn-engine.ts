export type XrayConnectionState =
  | 'disconnected'
  | 'preparing'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

export type XrayVpnState = {
  state: XrayConnectionState;
  profileId?: string;
  profileName?: string;
  error?: string;
  errorCode?: string;
};

export type WireGuardVpnStatus = {
  status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'DISCONNECTING' | 'ERROR' | 'UNKNOWN';
  tunnelState: 'ACTIVE' | 'INACTIVE' | 'CONNECTING' | 'DISCONNECTING' | 'ERROR' | 'UNKNOWN';
  isConnected: boolean;
  profileId?: string;
  profileName?: string;
  error?: string;
};

export async function isXrayEngineAvailable(): Promise<boolean> {
  return false;
}

export async function getXrayState(): Promise<XrayVpnState> {
  return { state: 'disconnected' };
}

export async function subscribeXrayState(
  _listener: (state: XrayVpnState) => void,
): Promise<() => void> {
  return () => undefined;
}

export async function connectXray(
  _profileId: string,
  _profileName: string,
  _subscriptionText: string,
): Promise<XrayVpnState> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}

export async function disconnectXray(): Promise<void> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}

export async function isWireGuardEngineAvailable(): Promise<boolean> {
  return false;
}

export async function getWireGuardStatus(): Promise<WireGuardVpnStatus> {
  return { status: 'DISCONNECTED', tunnelState: 'INACTIVE', isConnected: false };
}

export async function connectWireGuard(
  _profileId: string,
  _profileName: string,
  _configText: string,
): Promise<WireGuardVpnStatus> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}

export async function disconnectWireGuard(): Promise<void> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}

export async function isAmneziaWgEngineAvailable(): Promise<boolean> {
  return false;
}

export async function getAmneziaWgStatus(): Promise<WireGuardVpnStatus> {
  return { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
}

export async function connectAmneziaWg(
  _profileId: string,
  _profileName: string,
  _configText: string,
): Promise<WireGuardVpnStatus> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}

export async function disconnectAmneziaWg(): Promise<void> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}

export async function isOpenVpnEngineAvailable(): Promise<boolean> {
  return false;
}

export async function getOpenVpnStatus(): Promise<WireGuardVpnStatus> {
  return { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
}

export async function connectOpenVpn(
  _profileId: string,
  _profileName: string,
  _configText: string,
  _username: string,
  _password: string,
): Promise<WireGuardVpnStatus> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}

export async function disconnectOpenVpn(): Promise<void> {
  throw new Error('In-app VPN connections are supported only in the custom Android build.');
}
