import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  downloadOpenVpnProfile,
  downloadWireGuardConfig,
  useDownloadAmneziaWgConfig,
  useGetMobileDashboard,
  useGetOpenVpnAccount,
  useGetWireGuardAccount,
  useListMobileSubscriptions,
} from '@workspace/api-client-react';
import type { WireGuardLocation } from '@workspace/api-client-react';
import { Card, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useAppearance } from '@/hooks/Appearance';
import { connectionAttemptKey, matchesConnectionTarget, type ConnectionIdentity } from '@/lib/connection-identity';
import { getSubscriptionToken } from '@/lib/subscription-token';
import { isNativeTunnelConnected, isNativeTunnelConnecting } from '@/lib/tunnel-state';
import {
  connectAmneziaWg,
  connectOpenVpn,
  connectWireGuard,
  disconnectAllPulseTunnels,
  getAmneziaWgStatus,
  getOpenVpnStatus,
  getWireGuardStatus,
  isAmneziaWgEngineAvailable,
  isOpenVpnEngineAvailable,
  isWireGuardEngineAvailable,
  setTunnelTestKeepScreenOn,
  testTunnelConnectivity,
  type TunnelConnectivityReport,
  type WireGuardVpnStatus,
} from '@/lib/vpn-engine';
import { calculateTrafficRates, type TrafficCounters, type TrafficRates } from '@/lib/traffic-meter';

type Protocol = 'openvpn' | 'wireguard' | 'amneziawg';
type Phase = 'loading' | 'preparing' | 'connecting' | 'monitoring' | 'disconnecting' | 'error';

const initialTunnelStatus: WireGuardVpnStatus = {
  status: 'UNKNOWN',
  tunnelState: 'UNKNOWN',
  isConnected: false,
};

const protocolNames: Record<Protocol, string> = {
  openvpn: 'OpenVPN',
  wireguard: 'WireGuard',
  amneziawg: 'AmneziaWG',
};

const protocolIcons: Record<Protocol, keyof typeof Feather.glyphMap> = {
  openvpn: 'shield',
  wireguard: 'wifi',
  amneziawg: 'activity',
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function routeParts(configUrl: string, protocol: 'openvpn' | 'wireguard') {
  const parsed = new URL(configUrl, 'https://pulse.invalid');
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  const index = segments.findIndex((segment, position) =>
    segment === protocol && segments[position + 1] === 'config',
  );
  const provider = segments[index + 2];
  const host = segments[index + 3];
  if (index < 0 || !provider || !host) throw new Error(`نشانی پیکربندی ${protocolNames[protocol]} معتبر نیست.`);
  return { provider, host };
}

function getErrorMessage(error: unknown, token: string | null) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const safe = token ? raw.split(token).join('') : raw;
  if (/permission|authorization|اجازه/i.test(safe)) return 'برای ایجاد تونل، درخواست مجوز VPN را تأیید کنید.';
  if (/timeout|timed out|مهلت/i.test(safe)) return 'اتصال بیش از حد طول کشید. شبکه و سرور را بررسی و دوباره تلاش کنید.';
  if (/network|fetch|internet|اینترنت/i.test(safe)) return 'دریافت تنظیمات ممکن نشد. اتصال اینترنت را بررسی کنید.';
  const firstLine = safe.split(/\r?\n/, 1)[0].trim();
  if (/[\u0600-\u06FF]/.test(firstLine)) return firstLine.slice(0, 120);
  return 'اتصال برقرار نشد. اشتراک و اینترنت را بررسی و دوباره تلاش کنید.';
}

function formatDuration(connectedAt?: number, now = Date.now()) {
  if (!connectedAt || connectedAt <= 0) return null;
  const seconds = Math.max(0, Math.floor((now - connectedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatBytes(value?: number) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatRate(value: number) {
  if (value < 1024) return `${fa(value)} B/s`;
  if (value < 1024 ** 2) return `${fa((value / 1024).toFixed(1))} KB/s`;
  return `${fa((value / 1024 ** 2).toFixed(1))} MB/s`;
}

function fa(value: number | string) {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function nativeStateIsConnected(status: WireGuardVpnStatus) {
  return isNativeTunnelConnected(status);
}

function nativeStateIsConnecting(status: WireGuardVpnStatus) {
  return isNativeTunnelConnecting(status);
}

export default function ConnectionScreen() {
  const c = useColors();
  const { themeMode } = useAppearance();
  const systemColorScheme = useColorScheme();
  const statusBarStyle = themeMode === 'dark' || (themeMode === 'system' && systemColorScheme === 'dark')
    ? 'light'
    : 'dark';
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const safeBottom = Platform.OS === 'web' ? 0 : insets.bottom;
  const params = useLocalSearchParams<{ id?: string | string[]; protocol?: string | string[]; location?: string | string[] }>();
  const id = first(params.id);
  const rawProtocol = first(params.protocol);
  const protocol = (['openvpn', 'wireguard', 'amneziawg'] as const).find((value) => value === rawProtocol);
  const locationName = first(params.location) ?? '';

  const subscriptions = useListMobileSubscriptions();
  const dashboard = useGetMobileDashboard();
  const item = (subscriptions.data ?? dashboard.data?.subscriptions ?? []).find((subscription) => subscription.id === id);
  const token = getSubscriptionToken(item?.subscription_url ?? null);
  const openVpn = useGetOpenVpnAccount(token, { query: { queryKey: ['connection-screen', token, 'openvpn'], enabled: !!token && protocol === 'openvpn' && !!item?.openvpn_available } });
  const wireguard = useGetWireGuardAccount(token, { query: { queryKey: ['connection-screen', token, 'wireguard'], enabled: !!token && protocol === 'wireguard' && !!item?.wireguard_available } });
  const amnezia = useDownloadAmneziaWgConfig(token, { query: { queryKey: ['connection-screen', token, 'amneziawg'], enabled: !!token && protocol === 'amneziawg' && !!item?.awg_url }, request: { responseType: 'text' } });

  const [openVpnStatus, setOpenVpnStatus] = useState(initialTunnelStatus);
  const [wireguardStatus, setWireguardStatus] = useState(initialTunnelStatus);
  const [amneziaStatus, setAmneziaStatus] = useState(initialTunnelStatus);
  const [engineAvailability, setEngineAvailability] = useState<Record<Protocol, boolean>>({
    openvpn: false,
    wireguard: false,
    amneziawg: false,
  });
  const [nativeReady, setNativeReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [attemptStartedAt, setAttemptStartedAt] = useState<number | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const attemptKeyRef = useRef<string | null>(null);
  const suppressedConnectionKeyRef = useRef<string | null>(null);
  const connectionAttemptGenerationRef = useRef(0);
  const connectionIdentityRef = useRef<string | null>(null);
  const statusRefreshInFlightRef = useRef(false);
  const cancelAttemptOnUnmountRef = useRef(false);
  const timedOutAttemptRef = useRef<number | null>(null);
  const [trafficReport, setTrafficReport] = useState<TunnelConnectivityReport | null>(null);
  const [trafficTestError, setTrafficTestError] = useState<string | null>(null);
  const [trafficTesting, setTrafficTesting] = useState(false);
  const [trafficRates, setTrafficRates] = useState<TrafficRates>({ uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 });
  const trafficSampleRef = useRef<{ identity: string; counters: TrafficCounters; at: number } | null>(null);
  const [stabilityTest, setStabilityTest] = useState({
    running: false,
    checks: 0,
    passed: 0,
    failed: 0,
    startedAt: null as number | null,
  });
  const probeInFlightRef = useRef(false);
  const stabilityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stabilityEndAtRef = useRef<number | null>(null);

  const stopStabilityTest = useCallback(() => {
    if (stabilityTimerRef.current) clearInterval(stabilityTimerRef.current);
    stabilityTimerRef.current = null;
    stabilityEndAtRef.current = null;
    setStabilityTest((current) => ({ ...current, running: false }));
    void setTunnelTestKeepScreenOn(false);
  }, []);

  const runTunnelConnectivityTest = useCallback(async () => {
    if (probeInFlightRef.current) return null;
    const generationAtStart = connectionAttemptGenerationRef.current;
    const identityAtStart = connectionIdentityRef.current;
    const isCurrentTest = () =>
      connectionAttemptGenerationRef.current === generationAtStart
      && connectionIdentityRef.current === identityAtStart;
    probeInFlightRef.current = true;
    setTrafficTesting(true);
    setTrafficTestError(null);
    try {
      const report = await testTunnelConnectivity();
      if (!isCurrentTest()) return null;
      setTrafficReport(report);
      if (stabilityEndAtRef.current !== null) {
        setStabilityTest((current) => ({
          ...current,
          checks: current.checks + 1,
          passed: current.passed + (report.passed ? 1 : 0),
          failed: current.failed + (report.passed ? 0 : 1),
        }));
      }
      if (stabilityEndAtRef.current !== null && Date.now() >= stabilityEndAtRef.current) {
        stopStabilityTest();
      }
      return report;
    } catch (error) {
      if (!isCurrentTest()) return null;
      const message = getErrorMessage(error, token);
      setTrafficTestError(message);
      if (stabilityEndAtRef.current !== null) {
        setStabilityTest((current) => ({
          ...current,
          checks: current.checks + 1,
          failed: current.failed + 1,
        }));
      }
      return null;
    } finally {
      probeInFlightRef.current = false;
      setTrafficTesting(false);
    }
  }, [stopStabilityTest, token]);

  const startStabilityTest = useCallback(async () => {
    if (stabilityTimerRef.current) clearInterval(stabilityTimerRef.current);
    const startedAt = Date.now();
    stabilityEndAtRef.current = startedAt + 5 * 60 * 1000;
    setStabilityTest({ running: true, checks: 0, passed: 0, failed: 0, startedAt });
    void setTunnelTestKeepScreenOn(true);
    stabilityTimerRef.current = setInterval(() => {
      if (stabilityEndAtRef.current !== null && Date.now() >= stabilityEndAtRef.current) {
        stopStabilityTest();
        return;
      }
      void runTunnelConnectivityTest();
    }, 15_000);
    await runTunnelConnectivityTest();
  }, [runTunnelConnectivityTest, stopStabilityTest]);

  useEffect(() => () => {
    if (stabilityTimerRef.current) clearInterval(stabilityTimerRef.current);
    stabilityTimerRef.current = null;
    stabilityEndAtRef.current = null;
    void setTunnelTestKeepScreenOn(false);
  }, []);

  const statusStates: Record<Protocol, WireGuardVpnStatus> = {
    openvpn: openVpnStatus,
    wireguard: wireguardStatus,
    amneziawg: amneziaStatus,
  };
  const protocolOrder: Protocol[] = protocol
    ? [protocol, ...(['openvpn', 'wireguard', 'amneziawg'] as Protocol[]).filter((value) => value !== protocol)]
    : ['openvpn', 'wireguard', 'amneziawg'];
  const activeProtocol = protocolOrder.find((candidate) => nativeStateIsConnected(statusStates[candidate]))
    ?? protocolOrder.find((candidate) => nativeStateIsConnecting(statusStates[candidate]))
    ?? null;
  const activeState = activeProtocol ? statusStates[activeProtocol] : null;
  const nativeTunnelActive = !!activeState && nativeStateIsConnected(activeState);
  const connected = nativeTunnelActive;
  const connecting = !!activeState && nativeStateIsConnecting(activeState);
  const trafficVerificationPending = nativeTunnelActive
    && (!trafficReport || trafficTesting) && !trafficTestError;
  const trafficVerificationFailed = nativeTunnelActive && !trafficTesting
    && (!!trafficTestError || (!!trafficReport && !trafficReport.passed));
  const visualConnecting = connecting;
  const isRequestedProtocolActive = !!protocol && activeProtocol === protocol;
  const activeProfileId = activeState?.profileId;
  const activeProfileName = activeState?.profileName;
  const activeConnectionIdentity: ConnectionIdentity | null = activeProtocol && activeProfileId
    ? {
        subscriptionId: activeProfileId,
        protocol: activeProtocol,
        serverId: activeProfileName,
      }
    : null;
  const requestedConnectionIdentity: ConnectionIdentity | null = item && protocol
    ? {
        subscriptionId: item.id,
        protocol,
        serverId: locationName || null,
      }
    : null;
  connectionIdentityRef.current = activeConnectionIdentity
    ? connectionAttemptKey(activeConnectionIdentity, 0)
    : null;
  const sameRequestedProfile = !!requestedConnectionIdentity
    && isRequestedProtocolActive
    && matchesConnectionTarget(activeConnectionIdentity, requestedConnectionIdentity);
  const fastPolling = phase === 'connecting' || connecting;
  const statusRef = useRef({ openvpn: openVpnStatus, wireguard: wireguardStatus, amneziawg: amneziaStatus });
  statusRef.current = { openvpn: openVpnStatus, wireguard: wireguardStatus, amneziawg: amneziaStatus };
  const initialPollDoneRef = useRef(false);

  useEffect(() => {
    if (!isFocused) {
      initialPollDoneRef.current = false;
      return;
    }
    let disposed = false;
    const poll = async (includeAll = false) => {
      if (disposed || statusRefreshInFlightRef.current) return;
      statusRefreshInFlightRef.current = true;
      const previous = statusRef.current;
      const detectedActive = (['openvpn', 'wireguard', 'amneziawg'] as Protocol[])
        .find((candidate) => nativeStateIsConnected(previous[candidate]) || nativeStateIsConnecting(previous[candidate]));
      const targets = includeAll || !initialPollDoneRef.current
        ? (['openvpn', 'wireguard', 'amneziawg'] as Protocol[])
        : Array.from(new Set([protocol, detectedActive].filter((candidate): candidate is Protocol => !!candidate)));
      try {
        const results = await Promise.all(targets.map(async (candidate) => {
          const status = candidate === 'openvpn'
            ? await getOpenVpnStatus().catch(() => initialTunnelStatus)
            : candidate === 'wireguard'
              ? await getWireGuardStatus().catch(() => initialTunnelStatus)
              : await getAmneziaWgStatus().catch(() => initialTunnelStatus);
          return [candidate, status] as const;
        }));
        if (disposed) return;
        for (const [candidate, status] of results) {
          if (candidate === 'openvpn') setOpenVpnStatus(status);
          else if (candidate === 'wireguard') setWireguardStatus(status);
          else setAmneziaStatus(status);
        }
        if (!initialPollDoneRef.current) {
          const availability = protocol === 'openvpn'
            ? await isOpenVpnEngineAvailable().catch(() => false)
            : protocol === 'wireguard'
              ? await isWireGuardEngineAvailable().catch(() => false)
              : protocol === 'amneziawg'
                ? await isAmneziaWgEngineAvailable().catch(() => false)
                : false;
          if (!disposed && protocol) setEngineAvailability({ openvpn: protocol === 'openvpn' && availability, wireguard: protocol === 'wireguard' && availability, amneziawg: protocol === 'amneziawg' && availability });
          if (!disposed) setNativeReady(true);
          initialPollDoneRef.current = true;
        }
      } finally {
        statusRefreshInFlightRef.current = false;
      }
    };
    void poll(false);
    const timer = setInterval(() => void poll(false), fastPolling ? 1_000 : 3_000);
    const clockTimer = setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearInterval(clockTimer);
    };
  }, [fastPolling, isFocused, protocol]);

  useEffect(() => {
    if (nativeTunnelActive) cancelAttemptOnUnmountRef.current = false;
  }, [nativeTunnelActive]);

  useEffect(() => () => {
    connectionAttemptGenerationRef.current += 1;
    if (cancelAttemptOnUnmountRef.current) {
      void disconnectAllPulseTunnels().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!isFocused) stopStabilityTest();
  }, [isFocused, stopStabilityTest]);

  const autoProbeSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFocused) return;
    if (!nativeTunnelActive || !activeProtocol) {
      autoProbeSessionRef.current = null;
      if (stabilityEndAtRef.current !== null) stopStabilityTest();
      return;
    }

    const sessionKey = `${activeProtocol}:${activeProfileId ?? ''}:${activeProfileName ?? ''}`;
    if (trafficReport?.passed) {
      autoProbeSessionRef.current = sessionKey;
      return;
    }
    if (autoProbeSessionRef.current === sessionKey) return;
    autoProbeSessionRef.current = sessionKey;
    const timer = setTimeout(() => {
      void runTunnelConnectivityTest();
    }, 1_000);
    return () => {
      clearTimeout(timer);
    };
  }, [activeProfileId, activeProfileName, activeProtocol, isFocused, nativeTunnelActive, runTunnelConnectivityTest, stopStabilityTest, trafficReport?.passed]);

  const profileLoading = protocol === 'openvpn' ? openVpn.isLoading
      : protocol === 'wireguard' ? wireguard.isLoading
        : protocol === 'amneziawg' ? amnezia.isLoading : false;
  const profileError = protocol === 'openvpn' ? openVpn.error
      : protocol === 'wireguard' ? wireguard.error
        : protocol === 'amneziawg' ? amnezia.error : undefined;

  useEffect(() => {
    if (!protocol || !item || !profileLoading) return;
    const timer = setTimeout(() => {
      setActionError('دریافت تنظیمات سرور بیش از ۳۰ ثانیه طول کشید. اتصال اینترنت را بررسی و دوباره تلاش کنید.');
      setPhase('error');
    }, 30_000);
    return () => clearTimeout(timer);
  }, [item?.id, profileLoading, protocol, retry]);

  useEffect(() => {
    if (!protocol || !item || !token || !nativeReady || profileLoading) return;
    const key = connectionAttemptKey({
      subscriptionId: item.id,
      protocol,
      serverId: locationName || null,
    }, retry);
    if (suppressedConnectionKeyRef.current === key) return;
    if (attemptKeyRef.current === key) return;

    if (profileError) {
      attemptKeyRef.current = key;
      setPhase('error');
      setActionError(getErrorMessage(profileError, token));
      return;
    }
    if (item.status !== 'active') {
      attemptKeyRef.current = key;
      setPhase('error');
      setActionError('این اشتراک فعال نیست.');
      return;
    }
    const remaining = Number(item.remaining_gb);
    if (Number.isFinite(remaining) && remaining <= 0) {
      attemptKeyRef.current = key;
      setPhase('error');
      setActionError('حجم این اشتراک به پایان رسیده است.');
      return;
    }
    if (!engineAvailability[protocol]) {
      attemptKeyRef.current = key;
      setPhase('error');
      setActionError('این موتور در پیش‌نمایش Expo Go در دسترس نیست؛ برای اتصال، نسخهٔ بومی Android را نصب کنید.');
      return;
    }
    if (activeProtocol) {
      if (sameRequestedProfile) {
        attemptKeyRef.current = key;
        setPhase('monitoring');
        setAttemptStartedAt(null);
      } else {
        attemptKeyRef.current = key;
        cancelAttemptOnUnmountRef.current = true;
        const operationId = ++connectionAttemptGenerationRef.current;
        const isCurrentAttempt = () =>
          connectionAttemptGenerationRef.current === operationId && attemptKeyRef.current === key;
        setActionError(null);
        setPhase('disconnecting');
        setDisconnecting(true);
        void (async () => {
          try {
            await disconnectAllPulseTunnels();
            if (!isCurrentAttempt()) return;
            const [openvpn, wg, awg] = await Promise.all([
              getOpenVpnStatus(), getWireGuardStatus(), getAmneziaWgStatus(),
            ]);
            if (!isCurrentAttempt()) return;
            setOpenVpnStatus(openvpn);
            setWireguardStatus(wg);
            setAmneziaStatus(awg);
            attemptKeyRef.current = null;
            setAttemptStartedAt(null);
            setPhase('loading');
            setRetry((current) => current + 1);
          } catch (error) {
            if (!isCurrentAttempt()) return;
            setActionError(getErrorMessage(error, token));
            setPhase('error');
          } finally {
            if (isCurrentAttempt()) setDisconnecting(false);
          }
        })();
      }
      return;
    }

    attemptKeyRef.current = key;
    const operationId = ++connectionAttemptGenerationRef.current;
    cancelAttemptOnUnmountRef.current = true;
    const isCurrentAttempt = () =>
      connectionAttemptGenerationRef.current === operationId && attemptKeyRef.current === key;
    setActionError(null);
    setTrafficReport(null);
    setTrafficTestError(null);
    setAttemptStartedAt(null);
    setPhase('preparing');
    void (async () => {
      try {
        if (protocol === 'openvpn') {
          const fresh = await openVpn.refetch();
          if (!isCurrentAttempt()) return;
          const account = fresh.data;
          if (fresh.isError || !account) throw fresh.error ?? new Error('پروفایل OpenVPN در دسترس نیست.');
          const location = locationName
            ? account.locations.find((entry) => entry.name === locationName)
            : account.locations[0];
          if (!location) throw new Error('برای OpenVPN سروری در پروفایل پیدا نشد.');
          const { provider, host } = routeParts(location.config_url, 'openvpn');
          const config = await downloadOpenVpnProfile(token, provider, host, { responseType: 'text' });
          if (!isCurrentAttempt()) return;
          setPhase('connecting');
          setAttemptStartedAt(Date.now());
          const status = await connectOpenVpn(item.id, location.name, config, account.username, account.password);
          if (!isCurrentAttempt()) return;
          setOpenVpnStatus(status);
          setPhase('monitoring');
          return;
        }

        if (protocol === 'wireguard') {
          const fresh = await wireguard.refetch();
          if (!isCurrentAttempt()) return;
          const account = fresh.data;
          if (fresh.isError || !account) throw fresh.error ?? new Error('پروفایل WireGuard در دسترس نیست.');
          const location: WireGuardLocation | undefined = locationName
            ? account.locations.find((entry) => entry.name === locationName)
            : account.locations[0];
          if (!location) throw new Error('برای WireGuard سروری در پروفایل پیدا نشد.');
          const { provider, host } = routeParts(location.config_url, 'wireguard');
          const config = await downloadWireGuardConfig(token, provider, host, { responseType: 'text' });
          if (!isCurrentAttempt()) return;
          setPhase('connecting');
          setAttemptStartedAt(Date.now());
          const status = await connectWireGuard(item.id, location.name, config);
          if (!isCurrentAttempt()) return;
          setWireguardStatus(status);
          setPhase('monitoring');
          return;
        }

        const fresh = await amnezia.refetch();
        if (!isCurrentAttempt()) return;
        const config = fresh.data;
        if (fresh.isError || typeof config !== 'string' || !config.trim()) {
          throw fresh.error ?? new Error('پروفایل AmneziaWG خالی است یا دریافت نشد.');
        }
        setPhase('connecting');
        setAttemptStartedAt(Date.now());
        const status = await connectAmneziaWg(item.id, item.plan, config);
        if (!isCurrentAttempt()) return;
        setAmneziaStatus(status);
        setPhase('monitoring');
      } catch (error) {
        if (!isCurrentAttempt()) return;
        setActionError(getErrorMessage(error, token));
        setPhase('error');
      }
    })();
  }, [
    protocol,
    item?.id,
    item?.plan,
    item?.status,
    item?.remaining_gb,
    token,
    locationName,
    nativeReady,
    profileLoading,
    profileError,
    engineAvailability,
    activeProtocol,
    sameRequestedProfile,
    retry,
  ]);

  const nativeError = activeProtocol === 'openvpn' || (!activeProtocol && protocol === 'openvpn')
      ? openVpnStatus.error
      : activeProtocol === 'wireguard' || (!activeProtocol && protocol === 'wireguard')
        ? wireguardStatus.error
        : activeProtocol === 'amneziawg' || (!activeProtocol && protocol === 'amneziawg')
          ? amneziaStatus.error : null;
  const selectedStatus = protocol === 'openvpn' ? openVpnStatus.status
      : protocol === 'wireguard' ? wireguardStatus.status
        : protocol === 'amneziawg' ? amneziaStatus.status : 'UNKNOWN';
  const selectedError = protocol === 'openvpn' ? openVpnStatus.status === 'ERROR' || !!openVpnStatus.error
      : protocol === 'wireguard' ? wireguardStatus.status === 'ERROR' || !!wireguardStatus.error
        : protocol === 'amneziawg' ? amneziaStatus.status === 'ERROR' || !!amneziaStatus.error : false;
  const statusError = !nativeTunnelActive && selectedError
    ? getErrorMessage(new Error(nativeError ?? ''), token)
    : null;
  const connectedAt = activeState?.connectedAt;
  const duration = nativeTunnelActive && connectedAt ? formatDuration(connectedAt, clock) : null;
  const attemptElapsed = attemptStartedAt ? clock - attemptStartedAt : 0;
  const slowAttempt = connecting && attemptElapsed >= 45_000;
  const nativeCounters = activeProtocol && activeState
    ? {
        downloadBytes: (activeState as WireGuardVpnStatus).downloadBytes ?? 0,
        uploadBytes: (activeState as WireGuardVpnStatus).uploadBytes ?? 0,
      }
    : null;
  const transferIn = nativeCounters ? formatBytes(nativeCounters.downloadBytes) : null;
  const transferOut = nativeCounters ? formatBytes(nativeCounters.uploadBytes) : null;
  const counterIdentity = activeProtocol && activeState
    ? `${activeProtocol}:${activeState.profileId ?? ''}:${activeState.profileName ?? ''}`
    : '';
  useEffect(() => {
    if (!nativeCounters || !counterIdentity) {
      trafficSampleRef.current = null;
      setTrafficRates({ uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 });
      return;
    }
    const now = Date.now();
    const previous = trafficSampleRef.current;
    if (!previous || previous.identity !== counterIdentity) {
      trafficSampleRef.current = { identity: counterIdentity, counters: nativeCounters, at: now };
      setTrafficRates({ uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 });
      return;
    }
    setTrafficRates(calculateTrafficRates(previous.counters, nativeCounters, now - previous.at));
    trafficSampleRef.current = { identity: counterIdentity, counters: nativeCounters, at: now };
  }, [counterIdentity, nativeCounters?.downloadBytes, nativeCounters?.uploadBytes]);
  const statusColor = connected ? c.success
    : actionError || statusError || trafficVerificationFailed || phase === 'error' ? c.destructive
      : visualConnecting || phase === 'preparing' ? c.warning : c.mutedForeground;
  const statusTitle = connected && trafficReport?.passed ? 'اتصال امن برقرار است'
    : connected ? 'تونل VPN متصل است'
    : connecting ? 'در حال برقراری اتصال'
      : nativeTunnelActive && (trafficTesting || trafficVerificationPending) ? 'در حال بررسی اینترنت'
        : trafficVerificationFailed ? 'اینترنت تأیید نشد'
          : phase === 'preparing' ? 'در حال آماده‌سازی پروفایل'
            : actionError || statusError || phase === 'error' ? 'اتصال برقرار نشد'
              : 'اتصال قطع است';
  const statusDetail = connected && trafficReport?.passed
    ? 'اتصال امن برقرار است و اینترنت هم در دسترس است.'
    : connected && trafficVerificationFailed
      ? 'خود تونل فعال است؛ اما آزمون اینترنت پاسخ نگرفت. این نتیجه به معنی قطع بودن موتور VPN نیست.'
      : connected
        ? 'اتصال برقرار است؛ یک بررسی کوتاه اینترنت در حال انجام است.'
    : nativeTunnelActive && (trafficTesting || trafficVerificationPending)
      ? 'بررسی می‌کنیم اینترنت از همین اتصال در دسترس باشد.'
      : trafficVerificationFailed
        ? 'موتور تونل فعال است، اما اینترنت از مسیر VPN تأیید نشد. جزئیات آزمون را بررسی کنید.'
    : slowAttempt
      ? 'اتصال بیشتر از حد معمول طول کشیده است. وضعیت را بررسی کنید یا تونل را قطع کنید.'
      : connecting
        ? 'درخواست اتصال ارسال شد؛ منتظر پاسخ سرور هستیم.'
        : phase === 'preparing'
          ? 'پروفایل از اشتراک دریافت و برای موتور اتصال آماده می‌شود.'
          : actionError || statusError || (phase === 'error' ? 'اتصال کامل نشد. جزئیات خطا را پایین‌تر ببینید.' : 'برای شروع، از دکمهٔ تلاش دوباره استفاده کنید.');

  useEffect(() => {
    if (!connected) return;
    if (actionError) setActionError(null);
    if (phase === 'error') setPhase('monitoring');
  }, [actionError, connected, phase]);

  useEffect(() => {
    const pendingNativeAttempt = connecting || phase === 'connecting' || phase === 'monitoring';
    if (
      !pendingNativeAttempt ||
      connected ||
      actionError ||
      statusError ||
      attemptStartedAt == null ||
      !protocol
    ) return;
    const attemptId = attemptStartedAt;
    if (timedOutAttemptRef.current === attemptId) return;
    const remainingMs = Math.max(0, 45_000 - (Date.now() - attemptId));
    const generationAtStart = connectionAttemptGenerationRef.current;
    const keyAtStart = attemptKeyRef.current;
    if (!keyAtStart) return;
    const timer = setTimeout(() => {
      if (
        connectionAttemptGenerationRef.current !== generationAtStart ||
        attemptKeyRef.current !== keyAtStart
      ) return;
      if (timedOutAttemptRef.current === attemptId) return;
      timedOutAttemptRef.current = attemptId;
      const timeoutMessage = 'اتصال پس از ۴۵ ثانیه متوقف شد. اینترنت، اشتراک و سرور انتخاب‌شده را بررسی کنید.';
      setActionError(timeoutMessage);
      stopStabilityTest();
      setDisconnecting(true);
      setPhase('disconnecting');
      void (async () => {
        let finalMessage = timeoutMessage;
        try {
          await disconnectAllPulseTunnels();
        } catch (error) {
          finalMessage += `\n${getErrorMessage(error, token)}`;
        }
        if (
          connectionAttemptGenerationRef.current !== generationAtStart ||
          attemptKeyRef.current !== keyAtStart
        ) return;
        const [openvpn, wg, awg] = await Promise.all([
          getOpenVpnStatus().catch(() => initialTunnelStatus),
          getWireGuardStatus().catch(() => initialTunnelStatus),
          getAmneziaWgStatus().catch(() => initialTunnelStatus),
        ]);
        if (
          connectionAttemptGenerationRef.current !== generationAtStart ||
          attemptKeyRef.current !== keyAtStart
        ) return;
        setOpenVpnStatus(openvpn);
        setWireguardStatus(wg);
        setAmneziaStatus(awg);
        setAttemptStartedAt(null);
        setActionError(finalMessage);
        setPhase('error');
        setDisconnecting(false);
      })();
    }, remainingMs);
    return () => clearTimeout(timer);
  }, [connecting, connected, phase, actionError, statusError, attemptStartedAt, protocol, token, stopStabilityTest, openVpnStatus.diagnostic]);

  const disconnectActive = async () => {
    if (disconnecting) return;
    const currentKey = item && protocol
      ? connectionAttemptKey({
          subscriptionId: item.id,
          protocol,
          serverId: locationName || null,
        }, retry)
      : null;
    if (currentKey) suppressedConnectionKeyRef.current = currentKey;
    const operationId = ++connectionAttemptGenerationRef.current;
    const isCurrentDisconnect = () => connectionAttemptGenerationRef.current === operationId;
    cancelAttemptOnUnmountRef.current = false;
    attemptKeyRef.current = null;
    stopStabilityTest();
    setAttemptStartedAt(null);
    timedOutAttemptRef.current = null;
    setDisconnecting(true);
    setActionError(null);
    setPhase('disconnecting');
    try {
      await disconnectAllPulseTunnels();
      if (isCurrentDisconnect()) setPhase('monitoring');
    } catch (error) {
      if (isCurrentDisconnect()) {
        setActionError(getErrorMessage(error, token));
        setPhase('error');
      }
    } finally {
      const [openvpn, wg, awg] = await Promise.all([
        getOpenVpnStatus().catch(() => initialTunnelStatus),
        getWireGuardStatus().catch(() => initialTunnelStatus),
        getAmneziaWgStatus().catch(() => initialTunnelStatus),
      ]);
      if (isCurrentDisconnect()) {
        setOpenVpnStatus(openvpn);
        setWireguardStatus(wg);
        setAmneziaStatus(awg);
        setDisconnecting(false);
      }
    }
  };

  const retryConnection = () => {
    if (disconnecting) return;
    connectionAttemptGenerationRef.current += 1;
    suppressedConnectionKeyRef.current = null;
    setTrafficReport(null);
    setTrafficTestError(null);
    attemptKeyRef.current = null;
    timedOutAttemptRef.current = null;
    setActionError(null);
    setAttemptStartedAt(null);
    setPhase('loading');
    setRetry((value) => value + 1);
    if (protocol === 'openvpn') void openVpn.refetch();
    else if (protocol === 'wireguard') void wireguard.refetch();
    else if (protocol === 'amneziawg') void amnezia.refetch();
  };

  const protocolAvailable = protocol && item
    ? protocol === 'openvpn' ? !!item.openvpn_available
      : protocol === 'wireguard' ? !!item.wireguard_available
        : !!item.awg_url
    : false;

  return (
    <Screen style={styles.screen}>
      <StatusBar style={statusBarStyle} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="بازگشت" onPress={() => router.back()} style={[styles.backButton, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="arrow-right" size={19} color={c.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.topEyebrow, { color: c.mutedForeground }]} numberOfLines={1}>{item ? `${item.customer_name} · ${item.plan}` : 'PULSE · اتصال امن'}</Text>
            <Text style={[styles.topTitle, { color: c.foreground }]}>وضعیت اتصال</Text>
          </View>
          <View style={[styles.liveMark, { backgroundColor: c.accent }]}>
            <View style={[styles.liveDot, { backgroundColor: connected ? c.success : visualConnecting ? c.warning : trafficVerificationFailed ? c.destructive : c.mutedForeground }]} />
            <Text style={[styles.liveText, { color: c.accentForeground }]}>
              {connected ? 'متصل' : visualConnecting || phase === 'preparing' ? 'در حال اتصال' : 'قطع'}
            </Text>
          </View>
        </View>

        {!item && id && (subscriptions.isLoading || dashboard.isLoading) ? (
          <Card style={styles.loadingCard}>
            <View style={[styles.loadingMark, { backgroundColor: c.muted }]} />
            <View style={[styles.loadingLine, { backgroundColor: c.muted, width: '60%' }]} />
            <View style={[styles.loadingLine, { backgroundColor: c.muted, width: '82%' }]} />
            <Text style={[styles.bodyText, { color: c.mutedForeground }]}>در حال دریافت جزئیات اشتراک…</Text>
          </Card>
        ) : !item ? (
          <Card style={styles.loadingCard}>
            <Feather name="alert-circle" size={25} color={c.warning} />
            <Text style={[styles.engineTitle, { color: c.foreground }]}>اشتراک انتخاب نشد</Text>
            <Text style={[styles.bodyText, { color: c.mutedForeground }]}>برای اتصال، یک اشتراک فعال را انتخاب کنید. هیچ اشتراک دیگری به‌صورت خودکار جایگزین نمی‌شود.</Text>
            <Pressable accessibilityRole="button" testID="choose-connection-subscription" onPress={() => router.replace('/(tabs)/profiles')} style={[styles.retryButton, { backgroundColor: c.primary }]}>
              <Text style={[styles.actionText, { color: c.primaryForeground }]}>انتخاب اشتراک</Text>
            </Pressable>
          </Card>
        ) : (
          <>
            <LinearGradient
              colors={connected ? [c.surfaceDeep, c.success] : [c.surfaceDeep, c.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, { borderColor: `${c.onDeep}22` }]}
            >
              <View style={styles.heroTopline}>
                <View style={[styles.statusPill, { backgroundColor: `${c.onDeep}20` }]}>
                  <View style={[styles.liveDot, { backgroundColor: connected ? c.success : visualConnecting ? c.warning : trafficVerificationFailed ? c.warning : c.onDeep }]} />
                  <Text style={[styles.statusPillText, { color: c.onDeep }]}>{connected ? trafficReport?.passed ? 'تونل و اینترنت فعال' : 'تونل فعال' : connecting ? 'در حال اتصال' : visualConnecting ? 'در حال اتصال' : trafficVerificationFailed ? 'بررسی اینترنت ناموفق' : phase === 'preparing' ? 'آماده‌سازی' : 'آفلاین'}</Text>
                </View>
                <Text style={[styles.heroKicker, { color: `${c.onDeep}A6` }]}>اتصال Pulse</Text>
              </View>

              <View style={styles.heroCenter}>
                <View style={[styles.orbitOuter, { borderColor: `${c.onDeep}44` }]}>
                  <View style={[styles.orbitInner, { backgroundColor: `${c.onDeep}20` }]}>
                    {visualConnecting ? <ActivityIndicator color={c.onDeep} size="large" /> : <Feather name={connected ? 'shield' : protocol ? protocolIcons[protocol] : 'shield'} size={34} color={c.onDeep} />}
                  </View>
                </View>
                <Text style={[styles.statusTitle, { color: c.onDeep }]}>{statusTitle}</Text>
                <Text style={[styles.statusDetail, { color: `${c.onDeep}C7` }]}>{statusDetail}</Text>
              </View>

              <View style={[styles.heroFooter, { borderTopColor: `${c.onDeep}35` }]}>
                <View style={styles.heroMeta}>
                  <Text style={[styles.metaLabel, { color: `${c.onDeep}9C` }]}>پروتکل</Text>
                  <Text style={[styles.metaValue, { color: c.onDeep }]}>{activeProtocol ? protocolNames[activeProtocol] : protocol ? protocolNames[protocol] : '—'}</Text>
                </View>
                <View style={[styles.metaDivider, { backgroundColor: `${c.onDeep}48` }]} />
                <View style={styles.heroMeta}>
                  <Text style={[styles.metaLabel, { color: `${c.onDeep}9C` }]}>مدت اتصال</Text>
                  <Ltr style={[styles.metaValue, { color: c.onDeep }]}>{duration ?? (connecting ? '…' : '—')}</Ltr>
                </View>
              </View>
            </LinearGradient>

            {slowAttempt ? (
              <View style={[styles.notice, { backgroundColor: `${c.warning}14`, borderColor: `${c.warning}55` }]}>
                <Feather name="clock" size={18} color={c.warning} />
                <Text style={[styles.noticeText, { color: c.foreground }]}>هنوز پاسخ نهایی موتور دریافت نشده است. وضعیت خود تونل و نتیجهٔ آزمون اینترنت جداگانه نمایش داده می‌شوند؛ در صورت نیاز اتصال را قطع کنید.</Text>
              </View>
            ) : null}

            {!connected && (actionError || statusError || phase === 'error') ? (
              <View style={[styles.errorCard, { backgroundColor: `${c.destructive}0A`, borderColor: `${c.destructive}55` }]}>
                <View style={styles.errorHeading}>
                  <Feather name="alert-triangle" size={19} color={c.destructive} />
                  <Text style={[styles.errorTitle, { color: c.destructive }]}>جزئیات خطا</Text>
                </View>
                <Text selectable style={[styles.errorText, { color: c.foreground }]}>{actionError ?? statusError ?? 'اتصال کامل نشد. دوباره تلاش کنید.'}</Text>
                {activeProtocol || (protocol && selectedStatus !== 'UNKNOWN') ? (
                  <Text style={[styles.errorCode, { color: c.mutedForeground }]}>وضعیت تونل از موتور بومی دستگاه بررسی می‌شود.</Text>
                ) : null}
              </View>
            ) : null}

            {connected && trafficVerificationFailed ? (
              <View style={[styles.notice, { backgroundColor: `${c.warning}12`, borderColor: `${c.warning}55` }]}>
                <Feather name="alert-circle" size={18} color={c.warning} />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={[styles.errorTitle, { color: c.warning }]}>تونل فعال است؛ اینترنت تأیید نشد</Text>
                  <Text selectable style={[styles.noticeText, { color: c.foreground }]}>
                    {trafficTestError ?? (trafficReport ? trafficReport.vpnActive ? 'اتصال فعاله، اما اینترنت پاسخ نداد.' : 'دستگاه اتصال فعالی گزارش نمی‌کند.' : 'بررسی اینترنت پاسخی نگرفت. اتصال را بررسی و دوباره امتحان کنید.')}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.primaryActions}>
              {(activeProtocol || connecting || phase === 'preparing') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="قطع اتصال"
                  onPress={() => void disconnectActive()}
                  disabled={disconnecting}
                  style={({ pressed }) => [styles.disconnectButton, { backgroundColor: c.destructive, opacity: pressed ? 0.86 : disconnecting ? 0.6 : 1 }]}
                >
                  {disconnecting ? <ActivityIndicator color={c.destructiveForeground} /> : <Feather name="power" size={19} color={c.destructiveForeground} />}
                  <Text style={[styles.actionText, { color: c.destructiveForeground }]}>{disconnecting ? 'در حال قطع اتصال…' : `قطع اتصال${activeProtocol ? ` ${protocolNames[activeProtocol]}` : ''}`}</Text>
                </Pressable>
              ) : null}
              {!nativeTunnelActive && !connecting && protocol ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={retryConnection}
                  disabled={!protocolAvailable || profileLoading || !nativeReady || !!activeProtocol || disconnecting}
                  style={({ pressed }) => [styles.retryButton, { backgroundColor: c.primary, opacity: pressed ? 0.88 : (!protocolAvailable || profileLoading || !nativeReady || !!activeProtocol || disconnecting) ? 0.55 : 1 }]}
                >
                  {profileLoading || phase === 'preparing' ? <ActivityIndicator color={c.primaryForeground} /> : <Feather name="rotate-ccw" size={17} color={c.primaryForeground} />}
                  <Text style={[styles.actionText, { color: c.primaryForeground }]}>تلاش دوباره برای اتصال</Text>
                </Pressable>
              ) : null}
            </View>

            {nativeTunnelActive && activeProtocol ? (
              <Card style={styles.trafficCard}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionIcon, { backgroundColor: trafficReport?.passed ? `${c.success}18` : c.secondary }]}>
                    <Feather name="activity" size={17} color={trafficReport?.passed ? c.success : c.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.sectionTitle, { color: c.foreground }]}>آزمون واقعی اینترنت</Text>
                    <Text style={[styles.sectionCaption, { color: c.mutedForeground }]}>بررسی می‌کنیم اینترنت از مسیر امن در دسترس باشد.</Text>
                  </View>
                </View>

                <View style={[styles.trafficSummary, { backgroundColor: trafficReport?.passed ? `${c.success}12` : c.secondary, borderColor: c.border }]}>
                  {trafficTesting ? <ActivityIndicator size="small" color={c.primary} /> : (
                    <View style={[styles.liveDot, { backgroundColor: trafficReport?.passed ? c.success : trafficReport ? c.destructive : c.mutedForeground }]} />
                  )}
                  <Text style={[styles.trafficSummaryText, { color: trafficReport?.passed ? c.success : trafficReport ? c.destructive : c.mutedForeground }]}>
                    {trafficTesting ? 'در حال بررسی اینترنت…'
                      : trafficReport?.passed ? 'اینترنت از مسیر امن در دسترس است'
                        : trafficReport ? trafficReport.vpnActive ? 'اتصال فعاله، اما اینترنت پاسخ نداد' : 'دستگاه اتصال فعالی گزارش نمی‌کند'
                          : 'بررسی اینترنت هنوز انجام نشده است'}
                  </Text>
                </View>

                {trafficReport?.endpoints.map((endpoint) => (
                  <View key={endpoint.endpoint} style={[styles.trafficEndpoint, { borderBottomColor: c.border }]}>
                    <View style={[styles.endpointDot, { backgroundColor: endpoint.success ? c.success : c.destructive }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.endpointTitle, { color: c.foreground }]}>{endpoint.endpoint.includes('google.com') ? 'بررسی مسیر یک' : 'بررسی مسیر دو'}</Text>
                      <Text style={[styles.endpointDetail, { color: endpoint.success ? c.success : c.mutedForeground }]}>
                        {endpoint.success
                          ? 'پاسخ دریافت شد'
                          : 'پاسخی دریافت نشد'}
                      </Text>
                    </View>
                    <Text style={[styles.endpointLatency, { color: c.mutedForeground }]}>{endpoint.latencyMs == null ? '—' : `${fa(endpoint.latencyMs)} ms`}</Text>
                  </View>
                ))}

                {trafficTestError ? <Text style={[styles.trafficError, { color: c.destructive }]}>{trafficTestError}</Text> : null}
                {stabilityTest.running || stabilityTest.checks > 0 ? (
                  <View style={[styles.stabilityStats, { backgroundColor: c.secondary, borderColor: c.border }]}>
                    <Text style={[styles.note, { color: c.foreground }]}>
                      بررسی اتصال {stabilityTest.running ? 'در حال اجراست' : 'متوقف شده'} · {fa(stabilityTest.checks)} بار بررسی · {fa(stabilityTest.passed)} موفق · {fa(stabilityTest.failed)} ناموفق
                    </Text>
                    <Text style={[styles.sectionCaption, { color: c.mutedForeground }]}>بررسی کوتاه‌مدت برای اطمینان از پایداری اتصال.</Text>
                  </View>
                ) : null}

                <View style={styles.testActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="آزمون ترافیک VPN"
                    disabled={trafficTesting}
                    onPress={() => void runTunnelConnectivityTest()}
                    style={({ pressed }) => [styles.testButton, { backgroundColor: c.primary, opacity: pressed ? 0.86 : trafficTesting ? 0.6 : 1 }]}
                  >
                    {trafficTesting ? <ActivityIndicator size="small" color={c.primaryForeground} /> : <Feather name="wifi" size={15} color={c.primaryForeground} />}
                    <Text style={[styles.testButtonText, { color: c.primaryForeground }]}>آزمون همین حالا</Text>
                  </Pressable>
                  {stabilityTest.running ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="توقف آزمون پایداری"
                      onPress={stopStabilityTest}
                      style={({ pressed }) => [styles.testButton, styles.testButtonSecondary, { borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
                    >
                      <Feather name="square" size={14} color={c.foreground} />
                      <Text style={[styles.testButtonText, { color: c.foreground }]}>توقف آزمون</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="شروع آزمون پایداری پنج دقیقه‌ای"
                      disabled={trafficTesting}
                      onPress={() => void startStabilityTest()}
                      style={({ pressed }) => [styles.testButton, styles.testButtonSecondary, { borderColor: c.border, opacity: pressed ? 0.75 : trafficTesting ? 0.55 : 1 }]}
                    >
                      <Feather name="clock" size={15} color={c.primary} />
                      <Text style={[styles.testButtonText, { color: c.foreground }]}>بررسی پایداری</Text>
                    </Pressable>
                  )}
                </View>
              </Card>
            ) : null}

            <Card style={styles.infoCard}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: c.secondary }]}>
                  <Feather name="layers" size={17} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: c.foreground }]}>جزئیات سرویس</Text>
                  <Text style={[styles.sectionCaption, { color: c.mutedForeground }]}>اطلاعات اشتراک و موتور انتخاب‌شده</Text>
                </View>
              </View>
              <DetailRow label="کد سرویس" value={item.service_code} ltr color={c.foreground} muted={c.mutedForeground} border={c.border} />
              <DetailRow label="نام طرح" value={item.plan} color={c.foreground} muted={c.mutedForeground} border={c.border} />
              <DetailRow label="ارائه‌دهنده" value={item.provider_name} color={c.foreground} muted={c.mutedForeground} border={c.border} />
              <DetailRow label="وضعیت اشتراک" value={item.status === 'active' ? 'فعال' : item.status} color={item.status === 'active' ? c.success : c.warning} muted={c.mutedForeground} border={c.border} />
              <DetailRow label="سرور انتخاب‌شده" value={activeProfileName || locationName || (protocol ? protocolNames[protocol] : '—')} color={c.foreground} muted={c.mutedForeground} border={c.border} />
              <DetailRow label="دادهٔ باقی‌مانده" value={`${item.remaining_gb} GB`} ltr color={c.foreground} muted={c.mutedForeground} border={c.border} />
              <DetailRow label="زمان باقی‌مانده" value={item.remaining_days == null ? '—' : `${fa(item.remaining_days)} روز`} color={c.foreground} muted={c.mutedForeground} border={c.border} />
              {nativeCounters ? (
                <View style={styles.transferGrid}>
                  {transferIn ? <TransferMetric label="دریافت‌شده" value={transferIn} icon="download" color={c} /> : null}
                  {transferOut ? <TransferMetric label="ارسال‌شده" value={transferOut} icon="upload" color={c} /> : null}
                  <TransferMetric label="سرعت دریافت" value={formatRate(trafficRates.downloadBytesPerSecond)} icon="download" color={c} />
                  <TransferMetric label="سرعت ارسال" value={formatRate(trafficRates.uploadBytesPerSecond)} icon="upload" color={c} />
                </View>
              ) : null}
            </Card>

            <Card style={styles.engineCard}>
              <View style={[styles.sectionIcon, { backgroundColor: connected ? `${c.success}18` : c.secondary }]}>
                <Feather name={protocol ? protocolIcons[protocol] : 'shield'} size={17} color={connected ? c.success : c.primary} />
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={[styles.engineTitle, { color: c.foreground }]}>{activeProtocol ? protocolNames[activeProtocol] : protocol ? protocolNames[protocol] : 'موتور اتصال'}</Text>
                <Text style={[styles.note, { color: c.mutedForeground }]}>
                  {nativeReady && protocol && engineAvailability[protocol]
                    ? 'این وضعیت از اتصال واقعی دستگاه گرفته می‌شود.'
                    : 'اتصال فقط با نسخهٔ نصب‌شدهٔ برنامه روی Android برقرار می‌شود.'}
                </Text>
              </View>
              <View style={[styles.engineState, { backgroundColor: connected ? `${c.success}18` : c.secondary }]}>
                <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
              </View>
            </Card>
          </>
        )}
      </ScrollView>
      <View style={[styles.bottomNav, { backgroundColor: c.background, borderColor: c.border, paddingBottom: safeBottom, marginBottom: -safeBottom }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="خانه" onPress={() => router.replace('/(tabs)')} style={styles.bottomNavItem}>
          <Feather name="grid" size={20} color={c.mutedForeground} />
          <Text style={[styles.bottomNavLabel, { color: c.mutedForeground }]}>خانه</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="پروتکل‌ها" onPress={() => router.replace('/(tabs)/protocols')} style={styles.bottomNavItem}>
          <Feather name="radio" size={20} color={c.mutedForeground} />
          <Text style={[styles.bottomNavLabel, { color: c.mutedForeground }]}>مسیرها</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="وضعیت" accessibilityState={{ selected: true }} onPress={() => router.replace('/(tabs)/activity')} style={[styles.bottomNavItem, { backgroundColor: `${c.primary}12` }]}>
          <Feather name="activity" size={20} color={c.primary} />
          <Text style={[styles.bottomNavLabel, { color: c.primary }]}>وضعیت</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="تنظیمات" onPress={() => router.replace('/(tabs)/settings')} style={styles.bottomNavItem}>
          <Feather name="sliders" size={20} color={c.mutedForeground} />
          <Text style={[styles.bottomNavLabel, { color: c.mutedForeground }]}>تنظیمات</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function DetailRow({ label, value, color, muted, border, ltr = false }: {
  label: string;
  value: string;
  color: string;
  muted: string;
  border: string;
  ltr?: boolean;
}) {
  return (
    <View style={[styles.detailRow, { borderBottomColor: border }]}>
      <Text style={[styles.detailLabel, { color: muted }]}>{label}</Text>
      {ltr ? <Ltr style={[styles.detailValue, { color }]}>{value || '—'}</Ltr> : <Text style={[styles.detailValue, { color }]}>{value || '—'}</Text>}
    </View>
  );
}

function TransferMetric({ label, value, icon, color }: {
  label: string;
  value: string;
  icon: 'download' | 'upload';
  color: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.transferMetric, { backgroundColor: color.secondary, borderColor: color.border }]}>
      <Feather name={icon} size={14} color={color.primary} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.metricLabel, { color: color.mutedForeground }]}>{label}</Text>
        <Ltr style={[styles.metricValue, { color: color.foreground }]}>{value}</Ltr>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  content: { paddingHorizontal: 19, paddingTop: 13, paddingBottom: 42, gap: 15 },
  bottomNav: { minHeight: 61, paddingTop: 5, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  bottomNavItem: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 14 },
  bottomNavLabel: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  topBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  backButton: { width: 48, height: 48, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  topEyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textAlign: 'right' },
  topTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'right', marginTop: 2 },
  liveMark: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  hero: { borderWidth: 1, borderRadius: 31, padding: 20, overflow: 'hidden' },
  heroTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  statusPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  heroKicker: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  heroCenter: { alignItems: 'center', paddingTop: 24, paddingBottom: 19, gap: 10 },
  orbitOuter: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  orbitInner: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'center', marginTop: 2 },
  statusDetail: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 22, textAlign: 'center', maxWidth: 300 },
  heroFooter: { borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  heroMeta: { flex: 1, alignItems: 'center', gap: 5 },
  metaLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  metaValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'center' },
  metaDivider: { height: 27, width: 1 },
  notice: { borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  errorCard: { borderWidth: 1, borderRadius: 19, padding: 15, gap: 9 },
  errorHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 21, textAlign: 'right', flexShrink: 1 },
  errorCode: { fontFamily: 'Inter_500Medium', fontSize: 9, letterSpacing: 0.5, textAlign: 'left' },
  primaryActions: { gap: 9 },
  trafficCard: { padding: 15, gap: 10 },
  trafficSummary: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  trafficSummaryText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'right', lineHeight: 19 },
  trafficEndpoint: { minHeight: 45, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  endpointDot: { width: 7, height: 7, borderRadius: 4 },
  endpointTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textAlign: 'left' },
  endpointDetail: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'left' },
  endpointLatency: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textAlign: 'left' },
  trafficError: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  stabilityStats: { borderWidth: 1, borderRadius: 13, padding: 10, gap: 4 },
  testActions: { gap: 8, paddingTop: 2 },
  testButton: { minHeight: 48, borderRadius: 13, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  testButtonSecondary: { borderWidth: 1 },
  testButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  disconnectButton: { minHeight: 54, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  retryButton: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  actionText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  infoCard: { padding: 16, gap: 0 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  sectionIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, textAlign: 'right' },
  sectionCaption: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right', marginTop: 2 },
  detailRow: { minHeight: 43, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'right', flexShrink: 1, maxWidth: '66%' },
  transferGrid: { flexDirection: 'row', gap: 8, paddingTop: 11 },
  transferMetric: { flex: 1, minHeight: 62, borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  engineCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  engineTitle: { fontFamily: 'Inter_700Bold', fontSize: 13, textAlign: 'right' },
  engineState: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  loadingCard: { minHeight: 230, alignItems: 'center', justifyContent: 'center' },
  loadingMark: { width: 48, height: 48, borderRadius: 16 },
  loadingLine: { height: 11, borderRadius: 6 },
  bodyText: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
});
