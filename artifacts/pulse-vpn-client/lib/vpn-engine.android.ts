import { requireNativeModule } from 'expo-modules-core';
import type { TunnelConnectivityReport, WireGuardVpnStatus, XrayVpnState } from './vpn-engine';
import { normalizeXrayShareLinks, type XrayShareServer } from './xray-share-links';
import { buildSingBoxConfig } from './singbox-config';

type PulseVpnNativeModule = {
  requestPermission(): Promise<{ granted: boolean }>;
  isSupported(): Promise<boolean>;
  getSingBoxStatus(): Promise<XrayVpnState>;
  confirmSingBoxTraffic(attemptId: string): Promise<XrayVpnState>;
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

export type VpnTunnelProtocol = 'v2ray' | 'wireguard' | 'amneziawg' | 'openvpn';

const DISCONNECT_TIMEOUT_MS = 12_000;
const STATUS_CALL_TIMEOUT_MS = 2_500;
const DISCONNECT_POLL_INTERVAL_MS = 150;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} timed out.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function withinDeadline<T>(promise: Promise<T>, deadline: number, operation: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Error(`${operation} timed out.`));
  return withTimeout(promise, Math.min(remaining, STATUS_CALL_TIMEOUT_MS), operation);
}

const isWireGuardRunning = (status: WireGuardVpnStatus) =>
  status.isConnected ||
  ['CONNECTED', 'CONNECTING', 'DISCONNECTING'].includes(status.status) ||
  ['ACTIVE', 'CONNECTING', 'DISCONNECTING'].includes(status.tunnelState);

const nativeTunnelNeedsStop = (status: WireGuardVpnStatus) =>
  isWireGuardRunning(status) || status.status === 'ERROR' || status.tunnelState === 'ERROR';

const isXrayRunning = (state: XrayVpnState) =>
  ['connected', 'connecting', 'preparing', 'disconnecting'].includes(state.state);

async function readTunnelStates(module: PulseVpnNativeModule, deadline = Date.now() + DISCONNECT_TIMEOUT_MS) {
  const [xray, openvpn, wireguard, amneziawg] = await Promise.all([
    withinDeadline(module.getSingBoxStatus(), deadline, 'V2Ray status check'),
    withinDeadline(module.getOpenVpnStatus(), deadline, 'OpenVPN status check'),
    withinDeadline(module.getWireGuardStatus(), deadline, 'WireGuard status check'),
    withinDeadline(module.getAmneziaWgStatus(), deadline, 'AmneziaWG status check'),
  ]);
  return { xray, openvpn, wireguard, amneziawg };
}

function tunnelIsRunning(protocol: VpnTunnelProtocol, states: Awaited<ReturnType<typeof readTunnelStates>>) {
  if (protocol === 'v2ray') {
    return isXrayRunning(states.xray);
  }
  const state = protocol === 'openvpn' ? states.openvpn
    : protocol === 'wireguard' ? states.wireguard
      : states.amneziawg;
  return isWireGuardRunning(state);
}

function tunnelNeedsStop(protocol: VpnTunnelProtocol, states: Awaited<ReturnType<typeof readTunnelStates>>) {
  if (protocol === 'v2ray') return states.xray.state !== 'disconnected';
  const state = protocol === 'openvpn' ? states.openvpn
    : protocol === 'wireguard' ? states.wireguard
      : states.amneziawg;
  return nativeTunnelNeedsStop(state);
}

async function disconnectProtocol(
  module: PulseVpnNativeModule,
  protocol: VpnTunnelProtocol,
  deadline = Date.now() + DISCONNECT_TIMEOUT_MS,
) {
  if (protocol === 'v2ray') {
    const initial = await withinDeadline(module.getSingBoxStatus(), deadline, 'V2Ray status check');
    if (initial.state === 'disconnected') return;
    await withinDeadline(module.disconnectSingBox(), deadline, 'V2Ray disconnect');
    while (Date.now() < deadline) {
      if (!isXrayRunning(await withinDeadline(module.getSingBoxStatus(), deadline, 'V2Ray status check'))) return;
      await new Promise((resolve) => setTimeout(resolve, DISCONNECT_POLL_INTERVAL_MS));
    }
    throw new Error('The V2Ray tunnel did not stop within the allowed time.');
  }
  if (protocol === 'openvpn') {
    await stopOpenVpnAndWait(module, deadline);
    return;
  }
  const getStatus = protocol === 'wireguard' ? module.getWireGuardStatus : module.getAmneziaWgStatus;
  if (!nativeTunnelNeedsStop(await withinDeadline(getStatus(), deadline, `${protocol} status check`))) return;
  if (protocol === 'wireguard') {
    await withinDeadline(module.disconnectWireGuard(), deadline, 'WireGuard disconnect');
  } else {
    await withinDeadline(module.disconnectAmneziaWg(), deadline, 'AmneziaWG disconnect');
  }
  while (Date.now() < deadline) {
    const state = await withinDeadline(getStatus(), deadline, `${protocol} status check`);
    if (!isWireGuardRunning(state)) return;
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_POLL_INTERVAL_MS));
  }
  throw new Error(`${protocol === 'wireguard' ? 'WireGuard' : 'AmneziaWG'} did not confirm that its tunnel stopped.`);
}

/**
 * Stop any currently active Pulse tunnel before navigating to a different
 * protocol. Native connection methods repeat this handoff under their lock,
 * which protects direct routes and concurrent requests as well.
 */
export async function stopTunnelForProtocolSwitch(nextProtocol: VpnTunnelProtocol): Promise<void> {
  const module = loadPulseNativeModule();
  const deadline = Date.now() + DISCONNECT_TIMEOUT_MS;
  const states = await readTunnelStates(module, deadline);
  const protocols: VpnTunnelProtocol[] = ['v2ray', 'wireguard', 'openvpn', 'amneziawg'];
  for (const protocol of protocols) {
    if (protocol !== nextProtocol && tunnelNeedsStop(protocol, states)) {
      await disconnectProtocol(module, protocol, deadline);
    }
  }
  const latest = await readTunnelStates(module, deadline);
  const stillRunning = protocols.find((protocol) => protocol !== nextProtocol && tunnelIsRunning(protocol, latest));
  if (stillRunning) throw new Error(`The previous ${stillRunning} tunnel is still active; the new protocol was not started.`);
}

/**
 * User-initiated disconnect is an app-wide action: stop every Pulse-owned
 * engine that reports an active/transitioning tunnel, then verify all states.
 * Other VPN apps are never addressed by these engine-specific commands.
 */
export async function disconnectAllPulseTunnels(): Promise<void> {
  const module = loadPulseNativeModule();
  const deadline = Date.now() + DISCONNECT_TIMEOUT_MS;
  const protocols: VpnTunnelProtocol[] = ['v2ray', 'openvpn', 'wireguard', 'amneziawg'];
  const before = await readTunnelStates(module, deadline);
  const active = protocols.filter((protocol) => tunnelNeedsStop(protocol, before));
  if (active.length === 0) return;

  const results = await Promise.allSettled(
    active.map((protocol) => disconnectProtocol(module, protocol, deadline)),
  );
  const after = await readTunnelStates(module, deadline);
  const remaining = protocols.filter((protocol) => tunnelIsRunning(protocol, after));
  if (remaining.length > 0) {
    throw new Error(`Pulse could not confirm that these tunnels stopped: ${remaining.join(', ')}.`);
  }
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
}

export async function isXrayEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

export async function getXrayState(): Promise<XrayVpnState> {
  return withTimeout(loadPulseNativeModule().getSingBoxStatus(), STATUS_CALL_TIMEOUT_MS, 'V2Ray status check');
}

export async function confirmXrayTraffic(attemptId: string): Promise<XrayVpnState> {
  return loadPulseNativeModule().confirmSingBoxTraffic(attemptId);
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
  await stopTunnelForProtocolSwitch('v2ray');
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
  await disconnectProtocol(loadPulseNativeModule(), 'v2ray');
}

export async function isWireGuardEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

export async function getWireGuardStatus(): Promise<WireGuardVpnStatus> {
  return withTimeout(loadPulseNativeModule().getWireGuardStatus(), STATUS_CALL_TIMEOUT_MS, 'WireGuard status check');
}

export async function connectWireGuard(
  profileId: string,
  profileName: string,
  configText: string,
): Promise<WireGuardVpnStatus> {
  const module = loadPulseNativeModule();
  await stopTunnelForProtocolSwitch('wireguard');
  if (!(await module.isSupported())) throw new Error('این دستگاه از WireGuard پشتیبانی نمی‌کند.');
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectWireGuard(profileId, profileName, configText);
}

export async function disconnectWireGuard(): Promise<void> {
  await disconnectProtocol(loadPulseNativeModule(), 'wireguard');
}

export async function isAmneziaWgEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

export async function getAmneziaWgStatus(): Promise<WireGuardVpnStatus> {
  return withTimeout(loadPulseNativeModule().getAmneziaWgStatus(), STATUS_CALL_TIMEOUT_MS, 'AmneziaWG status check');
}

export async function connectAmneziaWg(
  profileId: string,
  profileName: string,
  configText: string,
): Promise<WireGuardVpnStatus> {
  const module = loadPulseNativeModule();
  await stopTunnelForProtocolSwitch('amneziawg');
  if (!(await module.isSupported())) throw new Error('این دستگاه از AmneziaWG پشتیبانی نمی‌کند.');
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectAmneziaWg(profileId, profileName, configText);
}

export async function disconnectAmneziaWg(): Promise<void> {
  await disconnectProtocol(loadPulseNativeModule(), 'amneziawg');
}

export async function isOpenVpnEngineAvailable(): Promise<boolean> {
  try {
    return await loadPulseNativeModule().isSupported();
  } catch {
    return false;
  }
}

async function stopOpenVpnAndWait(
  module: ReturnType<typeof loadPulseNativeModule>,
  deadline = Date.now() + DISCONNECT_TIMEOUT_MS,
): Promise<void> {
  const initial = await withinDeadline(module.getOpenVpnStatus(), deadline, 'OpenVPN status check');
  if (!nativeTunnelNeedsStop(initial)) return;

  await withinDeadline(module.disconnectOpenVpn(), deadline, 'OpenVPN disconnect');
  let status = await withinDeadline(module.getOpenVpnStatus(), deadline, 'OpenVPN status check');
  while (isWireGuardRunning(status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_POLL_INTERVAL_MS));
    status = await withinDeadline(module.getOpenVpnStatus(), deadline, 'OpenVPN status check');
  }
  if (isWireGuardRunning(status)) {
    throw new Error('The previous OpenVPN tunnel did not stop; the new server was not started.');
  }
}

export async function getOpenVpnStatus(): Promise<WireGuardVpnStatus> {
  return withTimeout(loadPulseNativeModule().getOpenVpnStatus(), STATUS_CALL_TIMEOUT_MS, 'OpenVPN status check');
}

export async function connectOpenVpn(
  profileId: string,
  profileName: string,
  configText: string,
  username: string,
  password: string,
): Promise<WireGuardVpnStatus> {
  const module = loadPulseNativeModule();
  await stopTunnelForProtocolSwitch('openvpn');
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
  await disconnectProtocol(loadPulseNativeModule(), 'openvpn');
}
