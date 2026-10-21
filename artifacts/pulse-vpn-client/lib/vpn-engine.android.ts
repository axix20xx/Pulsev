import { requireNativeModule } from 'expo-modules-core';
import type { TunnelConnectivityReport, WireGuardVpnStatus, XrayVpnState } from './vpn-engine';
import { normalizeXrayShareLinks, type XrayShareServer } from './xray-share-links';
import { buildSingBoxConfig } from './singbox-config';

type PulseVpnNativeModule = {
  requestPermission(): Promise<{ granted: boolean }>;
  isSupported(): Promise<boolean>;
  getSingBoxStatus(): Promise<XrayVpnState>;
  confirmSingBoxTraffic(): Promise<XrayVpnState>;
  connectSingBox(profileId: string, profileName: string, config: string): Promise<XrayVpnState>;
  disconnectSingBox(): Promise<XrayVpnState>;
  addListener(
    eventName: 'onSingBoxStateChange',
    listener: (state: XrayVpnState) => void,
  ): { remove(): void };
  connectWireGuard(profileId: string, profileName: string, configText: string): Promise<WireGuardVpnStatus>;
  disconnectWireGuard(): Promise<WireGuardVpnStatus>;
  getWireGuardStatus(): Promise<WireGuardVpnStatus>;
  connectAmneziaWg(profileId: string, profileName: string, configText: string): Promise<WireGuardVpnStatus>;
  disconnectAmneziaWg(): Promise<WireGuardVpnStatus>;
  getAmneziaWgStatus(): Promise<WireGuardVpnStatus>;
  connectOpenVpn(profileId: string, profileName: string, configText: string, username: string, password: string): Promise<WireGuardVpnStatus>;
  disconnectOpenVpn(): Promise<WireGuardVpnStatus>;
  getOpenVpnStatus(): Promise<WireGuardVpnStatus>;
  probeTcpServers(
    servers: Array<{ id: string; host: string; port: number }>,
    timeoutMs: number,
  ): Promise<Array<{ id: string; reachable: boolean; latencyMs: number | null }>>;
  probeTunnelConnectivity(): Promise<TunnelConnectivityReport>;
  getDiagnosticLog(): Promise<string>;
  setTunnelTestKeepScreenOn(enabled: boolean): Promise<boolean>;
};

function loadPulseNativeModule(): PulseVpnNativeModule {
  return requireNativeModule<PulseVpnNativeModule>('PulseVpnEngine');
}

async function assertNoOtherTunnel(protocol: 'xray' | 'wireguard' | 'amneziawg' | 'openvpn') {
  const module = loadPulseNativeModule();
  if (protocol !== 'xray') {
    const state = await module.getSingBoxStatus();
    if (['connected', 'connecting', 'preparing', 'disconnecting'].includes(state.state)) {
      throw new Error('ابتدا اتصال فعال V2Ray را قطع کنید.');
    }
  }
  if (protocol !== 'wireguard') {
    const status = await module.getWireGuardStatus();
    if (status.isConnected || ['CONNECTING', 'DISCONNECTING'].includes(status.status)) {
      throw new Error('ابتدا اتصال فعال WireGuard را قطع کنید.');
    }
  }
  if (protocol !== 'amneziawg') {
    const status = await module.getAmneziaWgStatus();
    if (status.isConnected || ['CONNECTING', 'DISCONNECTING'].includes(status.status)) {
      throw new Error('ابتدا اتصال فعال AmneziaWG را قطع کنید.');
    }
  }
  if (protocol !== 'openvpn') {
    const status = await module.getOpenVpnStatus();
    if (status.isConnected || ['CONNECTING', 'DISCONNECTING'].includes(status.status)) {
      throw new Error('ابتدا اتصال فعال OpenVPN را قطع کنید.');
    }
  }
}

export async function isXrayEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

export async function getXrayState(): Promise<XrayVpnState> {
  return loadPulseNativeModule().getSingBoxStatus();
}

export async function confirmXrayTraffic(): Promise<XrayVpnState> {
  return loadPulseNativeModule().confirmSingBoxTraffic();
}

export async function subscribeXrayState(
  listener: (state: XrayVpnState) => void,
): Promise<() => void> {
  const subscription = loadPulseNativeModule().addListener('onSingBoxStateChange', listener);
  return () => subscription.remove();
}

export async function connectXray(
  profileId: string,
  profileName: string,
  subscriptionText: string,
): Promise<XrayVpnState> {
  const module = loadPulseNativeModule();
  await assertNoOtherTunnel('xray');
  const normalized = normalizeXrayShareLinks(subscriptionText);
  if (!normalized.text) throw new Error('The V2Ray subscription is empty.');
  if (!normalized.linkCount) {
    throw new Error('The V2Ray feed did not contain readable server links. Refresh the subscription and try again.');
  }

  const singBoxConfigJson = buildSingBoxConfig(normalized.text, profileName);

  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('Android VPN permission was not granted.');

  const current = await module.getSingBoxStatus();
  if (current.state === 'connected' && current.profileId === profileId && current.profileName === profileName) {
    return current;
  }
  if (current.state !== 'disconnected') {
    await module.disconnectSingBox();
    const deadline = Date.now() + 8_000;
    let state = await module.getSingBoxStatus();
    while (state.state !== 'disconnected' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      state = await module.getSingBoxStatus();
    }
    if (state.state !== 'disconnected') {
      throw new Error('The previous V2Ray tunnel did not stop; the selected server was not started.');
    }
  }

  return module.connectSingBox(profileId, profileName, singBoxConfigJson);
}

export async function pingXrayServers(
  servers: readonly XrayShareServer[],
): Promise<Record<string, number | null>> {
  const native = loadPulseNativeModule();
  const results: Record<string, number | null> = Object.fromEntries(
    servers.map((server) => [server.id, null]),
  );
  try {
    const probes = await native.probeTcpServers(
      servers.map((server) => ({
        id: server.id,
        host: server.host ?? '',
        port: server.port ?? 0,
      })),
      1100,
    );
    for (const probe of probes) {
      results[probe.id] = probe.reachable ? probe.latencyMs : null;
    }
  } catch {
    // Unavailable probes must not prevent the client from trying a real profile.
  }
  return results;
}

export async function testTunnelConnectivity(): Promise<TunnelConnectivityReport> {
  return loadPulseNativeModule().probeTunnelConnectivity();
}

export async function getDiagnosticLog(): Promise<string> {
  return loadPulseNativeModule().getDiagnosticLog();
}

export async function setTunnelTestKeepScreenOn(enabled: boolean): Promise<boolean> {
  try {
    return await loadPulseNativeModule().setTunnelTestKeepScreenOn(enabled);
  } catch {
    return false;
  }
}

export async function disconnectXray(): Promise<void> {
  const module = loadPulseNativeModule();
  const current = await module.getSingBoxStatus();
  if (current.state === 'disconnected') return;
  await module.disconnectSingBox();
  const deadline = Date.now() + 8_000;
  let state = await module.getSingBoxStatus();
  while (state.state !== 'disconnected' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    state = await module.getSingBoxStatus();
  }
  if (state.state !== 'disconnected') {
    throw new Error('The sing-box V2Ray tunnel did not stop within the expected time.');
  }
}

export async function isWireGuardEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

export async function getWireGuardStatus(): Promise<WireGuardVpnStatus> {
  return loadPulseNativeModule().getWireGuardStatus();
}

export async function connectWireGuard(
  profileId: string,
  profileName: string,
  configText: string,
): Promise<WireGuardVpnStatus> {
  const module = loadPulseNativeModule();
  await assertNoOtherTunnel('wireguard');
  if (!(await module.isSupported())) throw new Error('این دستگاه از WireGuard پشتیبانی نمی‌کند.');
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectWireGuard(profileId, profileName, configText);
}

export async function disconnectWireGuard(): Promise<void> {
  await loadPulseNativeModule().disconnectWireGuard();
}

export async function isAmneziaWgEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

export async function getAmneziaWgStatus(): Promise<WireGuardVpnStatus> {
  return loadPulseNativeModule().getAmneziaWgStatus();
}

export async function connectAmneziaWg(
  profileId: string,
  profileName: string,
  configText: string,
): Promise<WireGuardVpnStatus> {
  const module = loadPulseNativeModule();
  await assertNoOtherTunnel('amneziawg');
  if (!(await module.isSupported())) throw new Error('این دستگاه از AmneziaWG پشتیبانی نمی‌کند.');
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectAmneziaWg(profileId, profileName, configText);
}

export async function disconnectAmneziaWg(): Promise<void> {
  await loadPulseNativeModule().disconnectAmneziaWg();
}

export async function isOpenVpnEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

const OPENVPN_DISCONNECT_TIMEOUT_MS = 10_000;
const OPENVPN_POLL_INTERVAL_MS = 150;

async function stopOpenVpnAndWait(module: ReturnType<typeof loadPulseNativeModule>): Promise<void> {
  const initial = await module.getOpenVpnStatus();
  if (initial.status === 'DISCONNECTED' || initial.tunnelState === 'INACTIVE') return;

  await module.disconnectOpenVpn();
  if (initial.status === 'UNKNOWN' && initial.tunnelState === 'UNKNOWN') return;

  const deadline = Date.now() + OPENVPN_DISCONNECT_TIMEOUT_MS;
  let status = await module.getOpenVpnStatus();
  while (status.status !== 'DISCONNECTED' && status.tunnelState !== 'INACTIVE' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPENVPN_POLL_INTERVAL_MS));
    status = await module.getOpenVpnStatus();
  }
  if (status.status !== 'DISCONNECTED' && status.tunnelState !== 'INACTIVE') {
    throw new Error('The previous OpenVPN tunnel did not stop; the new server was not started.');
  }
}

export async function getOpenVpnStatus(): Promise<WireGuardVpnStatus> {
  return loadPulseNativeModule().getOpenVpnStatus();
}

export async function connectOpenVpn(
  profileId: string,
  profileName: string,
  configText: string,
  username: string,
  password: string,
): Promise<WireGuardVpnStatus> {
  const module = loadPulseNativeModule();
  await assertNoOtherTunnel('openvpn');
  if (!(await module.isSupported())) throw new Error('این دستگاه از OpenVPN پشتیبانی نمی‌کند.');
  const current = await module.getOpenVpnStatus();
  if (
    ['CONNECTED', 'CONNECTING', 'DISCONNECTING', 'ERROR'].includes(current.status) ||
    ['ACTIVE', 'CONNECTING', 'DISCONNECTING'].includes(current.tunnelState)
  ) {
    await stopOpenVpnAndWait(module);
  }
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectOpenVpn(profileId, profileName, configText, username, password);
}

export async function disconnectOpenVpn(): Promise<void> {
  await stopOpenVpnAndWait(loadPulseNativeModule());
}
