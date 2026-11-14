import { requireNativeModule } from 'expo';
import type { TunnelConnectivityReport, WireGuardVpnStatus } from './vpn-engine';
import { isTunnelStopConfirmed } from './tunnel-stop-policy';
import { requireNativeProfileText, requireNativeString } from './native-profile-text';

type PulseVpnNativeModule = {
  isSupported(): Promise<boolean>;
  connectWireGuard(profileId: string, profileName: string, configText: string): Promise<WireGuardVpnStatus>;
  disconnectWireGuard(): Promise<WireGuardVpnStatus>;
  getWireGuardStatus(): Promise<WireGuardVpnStatus>;
  connectAmneziaWg(profileId: string, profileName: string, configText: string): Promise<WireGuardVpnStatus>;
  disconnectAmneziaWg(): Promise<WireGuardVpnStatus>;
  getAmneziaWgStatus(): Promise<WireGuardVpnStatus>;
  connectOpenVpn(
    profileId: string,
    profileName: string,
    configText: string,
    username: string,
    password: string,
  ): Promise<WireGuardVpnStatus>;
  disconnectOpenVpn(): Promise<WireGuardVpnStatus>;
  getOpenVpnStatus(): Promise<WireGuardVpnStatus>;
  probeTunnelConnectivity(): Promise<TunnelConnectivityReport>;
  getDiagnosticLog(): Promise<string>;
  setTunnelTestKeepScreenOn(enabled: boolean): Promise<boolean>;
};

type VpnTunnelProtocol = 'wireguard' | 'amneziawg' | 'openvpn';

const STATUS_TIMEOUT_MS = 2_500;
const DISCONNECT_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 150;

function nativeModule(): PulseVpnNativeModule {
  return requireNativeModule<PulseVpnNativeModule>('PulseVpnEngine');
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} timed out.`)), milliseconds);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getStatus(module: PulseVpnNativeModule, protocol: VpnTunnelProtocol) {
  const request =
    protocol === 'wireguard'
      ? module.getWireGuardStatus()
      : protocol === 'amneziawg'
        ? module.getAmneziaWgStatus()
        : module.getOpenVpnStatus();
  return withTimeout(request, STATUS_TIMEOUT_MS, `${protocol} status check`);
}

function requestDisconnect(module: PulseVpnNativeModule, protocol: VpnTunnelProtocol) {
  return protocol === 'wireguard'
    ? module.disconnectWireGuard()
    : protocol === 'amneziawg'
      ? module.disconnectAmneziaWg()
      : module.disconnectOpenVpn();
}

async function stopProtocol(
  module: PulseVpnNativeModule,
  protocol: VpnTunnelProtocol,
  deadline = Date.now() + DISCONNECT_TIMEOUT_MS,
) {
  const initial = await getStatus(module, protocol).catch(() => null);
  if (isTunnelStopConfirmed(protocol, initial)) return;
  await requestDisconnect(module, protocol).catch(() => undefined);

  while (Date.now() < deadline) {
    const current = await getStatus(module, protocol).catch(() => null);
    if (isTunnelStopConfirmed(protocol, current)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${protocol} did not confirm that its tunnel stopped.`);
}

export async function stopTunnelForProtocolSwitch(nextProtocol: VpnTunnelProtocol): Promise<void> {
  const module = nativeModule();
  const statuses = await Promise.all(
    (['wireguard', 'amneziawg', 'openvpn'] as const).map((protocol) =>
      getStatus(module, protocol).catch(() => null),
    ),
  );
  const activeOtherProtocols = (['wireguard', 'amneziawg', 'openvpn'] as const).filter(
    (protocol, index) =>
      protocol !== nextProtocol &&
      statuses[index] !== null &&
      !isTunnelStopConfirmed(protocol, statuses[index]),
  );
  await Promise.all(activeOtherProtocols.map((protocol) => stopProtocol(module, protocol)));
}

export async function disconnectAllPulseTunnels(): Promise<void> {
  const module = nativeModule();
  await Promise.all(
    (['wireguard', 'amneziawg', 'openvpn'] as const).map((protocol) =>
      stopProtocol(module, protocol),
    ),
  );
}

export async function testTunnelConnectivity(): Promise<TunnelConnectivityReport> {
  return nativeModule().probeTunnelConnectivity();
}

export async function getDiagnosticLog(): Promise<string> {
  return nativeModule().getDiagnosticLog();
}

export async function setTunnelTestKeepScreenOn(enabled: boolean): Promise<boolean> {
  return nativeModule().setTunnelTestKeepScreenOn(enabled).catch(() => false);
}

export async function isWireGuardEngineAvailable(): Promise<boolean> {
  return nativeModule().isSupported().catch(() => false);
}

export async function isAmneziaWgEngineAvailable(): Promise<boolean> {
  return isWireGuardEngineAvailable();
}

export async function isOpenVpnEngineAvailable(): Promise<boolean> {
  return nativeModule().isSupported().catch(() => false);
}

export async function getWireGuardStatus(): Promise<WireGuardVpnStatus> {
  return withTimeout(nativeModule().getWireGuardStatus(), STATUS_TIMEOUT_MS, 'WireGuard status check');
}

export async function getAmneziaWgStatus(): Promise<WireGuardVpnStatus> {
  return withTimeout(nativeModule().getAmneziaWgStatus(), STATUS_TIMEOUT_MS, 'AmneziaWG status check');
}

export async function getOpenVpnStatus(): Promise<WireGuardVpnStatus> {
  return withTimeout(nativeModule().getOpenVpnStatus(), STATUS_TIMEOUT_MS, 'OpenVPN status check');
}

async function ensureReady() {
  const module = nativeModule();
  if (!(await module.isSupported())) {
    throw new Error('در حال حاضر این دستگاه از تونل VPN پشتیبانی نمی‌کند.');
  }
  return module;
}

export async function connectWireGuard(
  profileId: string,
  profileName: string,
  configText: string,
): Promise<WireGuardVpnStatus> {
  const module = await ensureReady();
  await stopTunnelForProtocolSwitch('wireguard');
  return module.connectWireGuard(
    requireNativeString(profileId, 'شناسه سرویس'),
    requireNativeString(profileName, 'نام سرور'),
    requireNativeProfileText(configText, 'WireGuard'),
  );
}

export async function disconnectWireGuard(): Promise<void> {
  await stopProtocol(nativeModule(), 'wireguard');
}

export async function connectAmneziaWg(
  profileId: string,
  profileName: string,
  configText: string,
): Promise<WireGuardVpnStatus> {
  const module = await ensureReady();
  await stopTunnelForProtocolSwitch('amneziawg');
  return module.connectAmneziaWg(
    requireNativeString(profileId, 'شناسه سرویس'),
    requireNativeString(profileName, 'نام سرور'),
    requireNativeProfileText(configText, 'AmneziaWG'),
  );
}

export async function disconnectAmneziaWg(): Promise<void> {
  await stopProtocol(nativeModule(), 'amneziawg');
}

export async function connectOpenVpn(
  profileId: string,
  profileName: string,
  configText: string,
  username: string,
  password: string,
): Promise<WireGuardVpnStatus> {
  const module = await ensureReady();
  await stopTunnelForProtocolSwitch('openvpn');
  return module.connectOpenVpn(
    requireNativeString(profileId, 'شناسه سرویس'),
    requireNativeString(profileName, 'نام سرور'),
    requireNativeProfileText(configText, 'OpenVPN'),
    requireNativeString(username, 'نام کاربری OpenVPN'),
    requireNativeString(password, 'رمز OpenVPN'),
  );
}

export async function disconnectOpenVpn(): Promise<void> {
  await stopProtocol(nativeModule(), 'openvpn');
}
