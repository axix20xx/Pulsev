import { requireNativeModule } from 'expo-modules-core';
import type { ExpoXrayVpnState } from 'expo-xray-vpn';
import type { WireGuardVpnStatus, XrayVpnState } from './vpn-engine';
import { normalizeXrayShareLinks, type XrayShareServer } from './xray-share-links';

type XrayModule = typeof import('expo-xray-vpn').default;
type PulseVpnNativeModule = {
  requestPermission(): Promise<{ granted: boolean }>;
  isSupported(): Promise<boolean>;
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
};

let modulePromise: Promise<XrayModule> | undefined;

function loadModule(): Promise<XrayModule> {
  modulePromise ??= import('expo-xray-vpn').then((module) => module.default);
  return modulePromise;
}

function loadPulseNativeModule(): PulseVpnNativeModule {
  return requireNativeModule<PulseVpnNativeModule>('PulseVpnEngine');
}

function toState(state: ExpoXrayVpnState): XrayVpnState {
  return {
    state: state.state,
    profileId: state.profileId,
    profileName: state.profileName,
    connectedAt: state.connectedAt,
    lastChangedAt: state.lastChangedAt,
    error: state.error,
    errorCode: state.errorCode,
  };
}

function isIpLiteral(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, '');
  const ipv4Parts = address.split('.');
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  ) return true;
  return address.includes(':') && /^[0-9a-fA-F:.]+$/.test(address);
}

function removeInvalidSendThroughValues(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(removeInvalidSendThroughValues);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (typeof record.sendThrough === 'string' && !isIpLiteral(record.sendThrough)) {
    delete record.sendThrough;
  }
  Object.values(record).forEach(removeInvalidSendThroughValues);
}

async function assertNoOtherTunnel(protocol: 'xray' | 'wireguard' | 'amneziawg' | 'openvpn') {
  if (protocol !== 'xray') {
    try {
      const state = await (await loadModule()).getState();
      if (['connected', 'connecting', 'preparing', 'disconnecting'].includes(state.state)) {
        throw new Error('ابتدا اتصال فعال V2Ray را قطع کنید.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('اتصال فعال V2Ray')) throw error;
    }
  }
  if (protocol !== 'wireguard') {
    try {
      const status = await loadPulseNativeModule().getWireGuardStatus();
      if (status.isConnected || ['CONNECTING', 'DISCONNECTING'].includes(status.status)) {
        throw new Error('ابتدا اتصال فعال WireGuard را قطع کنید.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('اتصال فعال WireGuard')) throw error;
    }
  }
  if (protocol !== 'amneziawg') {
    try {
      const status = await loadPulseNativeModule().getAmneziaWgStatus();
      if (status.isConnected || ['CONNECTING', 'DISCONNECTING'].includes(status.status)) {
        throw new Error('ابتدا اتصال فعال AmneziaWG را قطع کنید.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('اتصال فعال AmneziaWG')) throw error;
    }
  }
  if (protocol !== 'openvpn') {
    try {
      const status = await loadPulseNativeModule().getOpenVpnStatus();
      if (status.isConnected || ['CONNECTING', 'DISCONNECTING'].includes(status.status)) {
        throw new Error('ابتدا اتصال فعال OpenVPN را قطع کنید.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('اتصال فعال OpenVPN')) throw error;
    }
  }
}

export async function isXrayEngineAvailable(): Promise<boolean> {
  try {
    const module = await loadModule();
    await module.getState();
    return true;
  } catch {
    // Expo Go does not contain this native module. Keep the app usable there,
    // but never report a tunnel as connected when the native engine is absent.
    return false;
  }
}

export async function getXrayState(): Promise<XrayVpnState> {
  const module = await loadModule();
  return toState(await module.getState());
}

export async function subscribeXrayState(
  listener: (state: XrayVpnState) => void,
): Promise<() => void> {
  const module = await loadModule();
  const subscription = module.addListener('onStateChange', (state) => {
    listener(toState(state));
  });
  return () => subscription.remove();
}

export async function connectXray(
  profileId: string,
  profileName: string,
  subscriptionText: string,
): Promise<XrayVpnState> {
  const module = await loadModule();
  await assertNoOtherTunnel('xray');
  const normalized = normalizeXrayShareLinks(subscriptionText);
  if (!normalized.text) throw new Error('The V2Ray subscription is empty.');
  if (!normalized.linkCount) {
    throw new Error('The V2Ray feed did not contain readable server links. Refresh the subscription and try again.');
  }

  const convertedConfigJson = await module.convertShareLinksToXrayJson(normalized.text);
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(convertedConfigJson);
  } catch {
    throw new Error('The subscription could not be converted to an Xray configuration.');
  }
  if (!parsedConfig || typeof parsedConfig !== 'object') {
    throw new Error('The subscription did not produce a valid Xray configuration.');
  }
  const outbounds = (parsedConfig as { outbounds?: unknown }).outbounds;
  if (!Array.isArray(outbounds) || outbounds.length === 0) {
    throw new Error('The V2Ray feed did not produce any usable connection profiles.');
  }
  removeInvalidSendThroughValues(parsedConfig);
  const xrayConfigJson = JSON.stringify(parsedConfig);

  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('Android VPN permission was not granted.');

  const current = await module.getState();
  if (current.state === 'connected' && current.profileId === profileId && current.profileName === profileName) {
    return toState(current);
  }
  if (current.state !== 'disconnected') {
    await module.disconnect();
    const deadline = Date.now() + 8_000;
    let state = await module.getState();
    while (state.state !== 'disconnected' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      state = await module.getState();
    }
    if (state.state !== 'disconnected') {
      throw new Error('The previous V2Ray tunnel did not stop; the selected server was not started.');
    }
  }

  await module.connect({
    profileId,
    profileName,
    xrayConfigJson,
  });
  return toState(await module.getState());
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

export async function disconnectXray(): Promise<void> {
  const module = await loadModule();
  const current = await module.getState();
  if (current.state === 'disconnected') return;
  await module.disconnect();
  const deadline = Date.now() + 8_000;
  let state = await module.getState();
  while (state.state !== 'disconnected' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    state = await module.getState();
  }
  if (state.state !== 'disconnected') {
    throw new Error('The V2Ray tunnel did not stop within the expected time.');
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
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectOpenVpn(profileId, profileName, configText, username, password);
}

export async function disconnectOpenVpn(): Promise<void> {
  await loadPulseNativeModule().disconnectOpenVpn();
}
