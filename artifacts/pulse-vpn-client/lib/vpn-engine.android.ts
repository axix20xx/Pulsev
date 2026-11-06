import { requireNativeModule } from 'expo';
import type { TunnelConnectivityReport, WireGuardVpnStatus } from './vpn-engine';
import {
  isTunnelStopConfirmed,
  shouldRequestTunnelStop,
} from './tunnel-stop-policy';
import { requireNativeProfileText, requireNativeString } from './native-profile-text';

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
  probeTunnelConnectivity(): Promise<TunnelConnectivityReport>;
  getDiagnosticLog(): Promise<string>;
  setTunnelTestKeepScreenOn(enabled: boolean): Promise<boolean>;
};

function loadPulseNativeModule(): PulseVpnNativeModule {
  return requireNativeModule<PulseVpnNativeModule>('PulseVpnEngine');
}

export type VpnTunnelProtocol = 'wireguard' | 'amneziawg' | 'openvpn';

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

function getProtocolStatus(
  module: PulseVpnNativeModule,
  protocol: VpnTunnelProtocol,
  deadline: number,
): Promise<WireGuardVpnStatus> {
  if (protocol === 'openvpn') return withinDeadline(module.getOpenVpnStatus(), deadline, 'OpenVPN status check');
  if (protocol === 'wireguard') return withinDeadline(module.getWireGuardStatus(), deadline, 'WireGuard status check');
  return withinDeadline(module.getAmneziaWgStatus(), deadline, 'AmneziaWG status check');
}

async function requestProtocolStop(module: PulseVpnNativeModule, protocol: VpnTunnelProtocol, deadline: number) {
  if (protocol === 'openvpn') return withinDeadline(module.disconnectOpenVpn(), deadline, 'OpenVPN disconnect');
  if (protocol === 'wireguard') return withinDeadline(module.disconnectWireGuard(), deadline, 'WireGuard disconnect');
  return withinDeadline(module.disconnectAmneziaWg(), deadline, 'AmneziaWG disconnect');
}

async function disconnectProtocol(
  module: PulseVpnNativeModule,
  protocol: VpnTunnelProtocol,
  deadline = Date.now() + DISCONNECT_TIMEOUT_MS,
) {
  const initial = await getProtocolStatus(module, protocol, deadline).catch(() => null);
  if (initial && !shouldRequestTunnelStop(protocol, initial)) return;

  // A failed status read must not prevent a user-requested disconnect. Send the
  // engine-specific stop command, then require a fresh native status to confirm.
  await requestProtocolStop(module, protocol, deadline).catch(() => undefined);
  while (Date.now() < deadline) {
    const state = await getProtocolStatus(module, protocol, deadline).catch(() => null);
    if (isTunnelStopConfirmed(protocol, state)) return;
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_POLL_INTERVAL_MS));
  }
  throw new Error(`${protocol} did not confirm that its tunnel stopped.`);
}

async function verifyProtocolsStopped(
  module: PulseVpnNativeModule,
  protocols: readonly VpnTunnelProtocol[],
  deadline: number,
): Promise<void> {
  const checks = await Promise.allSettled(
    protocols.map((protocol) => getProtocolStatus(module, protocol, deadline)),
  );
  const notConfirmed = checks.flatMap((check, index) => {
    const protocol = protocols[index];
    if (check.status === 'rejected') return [`${protocol} (status unknown)`];
    return isTunnelStopConfirmed(protocol, check.value) ? [] : [protocol];
  });
  if (notConfirmed.length) {
    throw new Error(`Could not confirm that these Pulse tunnels stopped: ${notConfirmed.join(', ')}.`);
  }
}

/**
 * Stop any currently active Pulse tunnel before navigating to a different
 * protocol. Native connection methods repeat this handoff under their lock,
 * which protects direct routes and concurrent requests as well.
 */
export async function stopTunnelForProtocolSwitch(nextProtocol: VpnTunnelProtocol): Promise<void> {
  const module = loadPulseNativeModule();
  const deadline = Date.now() + DISCONNECT_TIMEOUT_MS;
  const protocols: VpnTunnelProtocol[] = ['wireguard', 'openvpn', 'amneziawg'];
  const previousProtocols = protocols.filter((protocol) => protocol !== nextProtocol);
  await Promise.allSettled(previousProtocols.map((protocol) => disconnectProtocol(module, protocol, deadline)));
  await verifyProtocolsStopped(module, previousProtocols, Date.now() + STATUS_CALL_TIMEOUT_MS);
}

/**
 * User-initiated disconnect is an app-wide action: stop every Pulse-owned
 * engine that reports an active/transitioning tunnel, then verify all states.
 * Other VPN apps are never addressed by these engine-specific commands.
 */
export async function disconnectAllPulseTunnels(): Promise<void> {
  const module = loadPulseNativeModule();
  const deadline = Date.now() + DISCONNECT_TIMEOUT_MS;
  const protocols: VpnTunnelProtocol[] = ['openvpn', 'wireguard', 'amneziawg'];
  await Promise.allSettled(protocols.map((protocol) => disconnectProtocol(module, protocol, deadline)));
  await verifyProtocolsStopped(module, protocols, Date.now() + STATUS_CALL_TIMEOUT_MS);
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
  const nativeProfileId = requireNativeString(profileId, 'شناسه سرویس');
  const nativeProfileName = requireNativeString(profileName, 'نام سرور');
  const nativeConfigText = requireNativeProfileText(configText, 'WireGuard');
  const module = loadPulseNativeModule();
  await stopTunnelForProtocolSwitch('wireguard');
  if (!(await module.isSupported())) throw new Error('این دستگاه از WireGuard پشتیبانی نمی‌کند.');
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectWireGuard(nativeProfileId, nativeProfileName, nativeConfigText);
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
  const nativeProfileId = requireNativeString(profileId, 'شناسه سرویس');
  const nativeProfileName = requireNativeString(profileName, 'نام سرور');
  const nativeConfigText = requireNativeProfileText(configText, 'AmneziaWG');
  const module = loadPulseNativeModule();
  await stopTunnelForProtocolSwitch('amneziawg');
  if (!(await module.isSupported())) throw new Error('این دستگاه از AmneziaWG پشتیبانی نمی‌کند.');
  const permission = await module.requestPermission();
  if (!permission.granted) throw new Error('دسترسی VPN داده نشد.');
  return module.connectAmneziaWg(nativeProfileId, nativeProfileName, nativeConfigText);
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
  const initial = await getProtocolStatus(module, 'openvpn', deadline).catch(() => null);
  if (initial && !shouldRequestTunnelStop('openvpn', initial)) return;
  await requestProtocolStop(module, 'openvpn', deadline).catch(() => undefined);
  let status = await getProtocolStatus(module, 'openvpn', deadline).catch(() => null);
  while (!isTunnelStopConfirmed('openvpn', status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_POLL_INTERVAL_MS));
    status = await getProtocolStatus(module, 'openvpn', deadline).catch(() => null);
  }
  if (!isTunnelStopConfirmed('openvpn', status)) {
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
  const nativeProfileId = requireNativeString(profileId, 'شناسه سرویس');
  const nativeProfileName = requireNativeString(profileName, 'نام سرور');
  const nativeConfigText = requireNativeProfileText(configText, 'OpenVPN');
  const nativeUsername = requireNativeString(username, 'نام کاربری OpenVPN');
  const nativePassword = requireNativeString(password, 'رمز OpenVPN');
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
  return module.connectOpenVpn(
    nativeProfileId,
    nativeProfileName,
    nativeConfigText,
    nativeUsername,
    nativePassword,
  );
}

export async function disconnectOpenVpn(): Promise<void> {
  await disconnectProtocol(loadPulseNativeModule(), 'openvpn');
}
