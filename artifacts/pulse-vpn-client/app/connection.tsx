import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
  useGetPublicSubscriptionFeed,
  useGetWireGuardAccount,
  useListMobileSubscriptions,
} from '@workspace/api-client-react';
import type { WireGuardLocation } from '@workspace/api-client-react';
import { Card, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { getSubscriptionToken } from '@/lib/subscription-token';
import { normalizeXrayShareLinks } from '@/lib/xray-share-links';
import {
  connectAmneziaWg,
  connectOpenVpn,
  connectWireGuard,
  connectXray,
  disconnectAmneziaWg,
  disconnectOpenVpn,
  disconnectWireGuard,
  disconnectXray,
  getAmneziaWgStatus,
  getOpenVpnStatus,
  getWireGuardStatus,
  getXrayState,
  isAmneziaWgEngineAvailable,
  isOpenVpnEngineAvailable,
  isWireGuardEngineAvailable,
  isXrayEngineAvailable,
  subscribeXrayState,
  type WireGuardVpnStatus,
  type XrayVpnState,
} from '@/lib/vpn-engine';

type Protocol = 'v2ray' | 'openvpn' | 'wireguard' | 'amneziawg';
type Phase = 'loading' | 'preparing' | 'connecting' | 'monitoring' | 'disconnecting' | 'error';

const initialTunnelStatus: WireGuardVpnStatus = {
  status: 'UNKNOWN',
  tunnelState: 'UNKNOWN',
  isConnected: false,
};

const protocolNames: Record<Protocol, string> = {
  v2ray: 'V2Ray · Xray',
  openvpn: 'OpenVPN',
  wireguard: 'WireGuard',
  amneziawg: 'AmneziaWG',
};

const protocolIcons: Record<Protocol, keyof typeof Feather.glyphMap> = {
  v2ray: 'radio',
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
  const safe = token ? raw.split(token).join('[نشانی خصوصی حذف شد]') : raw;
  return safe.trim() || 'اتصال برقرار نشد. وضعیت موتور را بررسی و دوباره تلاش کنید.';
}

function isBusyStatus(status: string) {
  return ['CONNECTING', 'DISCONNECTING'].includes(status);
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

function fa(value: number | string) {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function nativeStateIsConnected(status: WireGuardVpnStatus) {
  return status.isConnected || status.status === 'CONNECTED' || status.tunnelState === 'ACTIVE';
}

function nativeStateIsConnecting(status: WireGuardVpnStatus) {
  return isBusyStatus(status.status) || isBusyStatus(status.tunnelState);
}

async function disconnectTunnel(protocol: Protocol) {
  if (protocol === 'v2ray') await disconnectXray();
  else if (protocol === 'openvpn') await disconnectOpenVpn();
  else if (protocol === 'wireguard') await disconnectWireGuard();
  else await disconnectAmneziaWg();
}

export default function ConnectionScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Platform.OS === 'web' ? 0 : insets.bottom;
  const params = useLocalSearchParams<{ id?: string | string[]; protocol?: string | string[]; location?: string | string[] }>();
  const id = first(params.id);
  const rawProtocol = first(params.protocol);
  const protocol = (['v2ray', 'openvpn', 'wireguard', 'amneziawg'] as const).find((value) => value === rawProtocol);
  const locationName = first(params.location) ?? '';

  const subscriptions = useListMobileSubscriptions();
  const dashboard = useGetMobileDashboard();
  const item = (subscriptions.data ?? dashboard.data?.subscriptions ?? []).find((subscription) => subscription.id === id);
  const token = getSubscriptionToken(item?.subscription_url ?? null);
  const openVpn = useGetOpenVpnAccount(token, { query: { queryKey: ['connection-screen', token, 'openvpn'], enabled: !!token && protocol === 'openvpn' && !!item?.openvpn_available } });
  const wireguard = useGetWireGuardAccount(token, { query: { queryKey: ['connection-screen', token, 'wireguard'], enabled: !!token && protocol === 'wireguard' && !!item?.wireguard_available } });
  const amnezia = useDownloadAmneziaWgConfig(token, { query: { queryKey: ['connection-screen', token, 'amneziawg'], enabled: !!token && protocol === 'amneziawg' && !!item?.awg_url } });
  const feed = useGetPublicSubscriptionFeed(token, { query: { queryKey: ['connection-screen', token, 'v2ray-feed'], enabled: !!token && protocol === 'v2ray' && !!item?.subscription_url } });

  const [xrayStatus, setXrayStatus] = useState<XrayVpnState>({ state: 'disconnected' });
  const [openVpnStatus, setOpenVpnStatus] = useState(initialTunnelStatus);
  const [wireguardStatus, setWireguardStatus] = useState(initialTunnelStatus);
  const [amneziaStatus, setAmneziaStatus] = useState(initialTunnelStatus);
  const [engineAvailability, setEngineAvailability] = useState<Record<Protocol, boolean>>({
    v2ray: false,
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
  const timedOutAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let removeXrayListener: () => void = () => undefined;
    const loadStatus = async () => {
      const [xray, openvpn, wg, awg, xrayAvailable, openvpnAvailable, wgAvailable, awgAvailable] = await Promise.all([
        getXrayState().catch(() => ({ state: 'disconnected' as const })),
        getOpenVpnStatus().catch(() => initialTunnelStatus),
        getWireGuardStatus().catch(() => initialTunnelStatus),
        getAmneziaWgStatus().catch(() => initialTunnelStatus),
        isXrayEngineAvailable().catch(() => false),
        isOpenVpnEngineAvailable().catch(() => false),
        isWireGuardEngineAvailable().catch(() => false),
        isAmneziaWgEngineAvailable().catch(() => false),
      ]);
      if (disposed) return;
      setXrayStatus(xray);
      setOpenVpnStatus(openvpn);
      setWireguardStatus(wg);
      setAmneziaStatus(awg);
      setEngineAvailability({ v2ray: xrayAvailable, openvpn: openvpnAvailable, wireguard: wgAvailable, amneziawg: awgAvailable });
      setNativeReady(true);
    };

    void loadStatus();
    void subscribeXrayState((state) => {
      if (!disposed) setXrayStatus(state);
    }).then((remove) => {
      if (disposed) remove();
      else removeXrayListener = remove;
    }).catch(() => undefined);
    const timer = setInterval(() => {
      void Promise.all([
        getXrayState().then((state) => { if (!disposed) setXrayStatus(state); }).catch(() => undefined),
        getOpenVpnStatus().then((status) => { if (!disposed) setOpenVpnStatus(status); }).catch(() => undefined),
        getWireGuardStatus().then((status) => { if (!disposed) setWireguardStatus(status); }).catch(() => undefined),
        getAmneziaWgStatus().then((status) => { if (!disposed) setAmneziaStatus(status); }).catch(() => undefined),
      ]);
    }, 1500);
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      disposed = true;
      removeXrayListener();
      clearInterval(timer);
      clearInterval(clockTimer);
    };
  }, []);

  const activeProtocol = useMemo<Protocol | null>(() => {
    if (xrayStatus.state === 'connected' || xrayStatus.state === 'connecting' || xrayStatus.state === 'preparing' || xrayStatus.state === 'disconnecting') return 'v2ray';
    if (nativeStateIsConnected(openVpnStatus) || nativeStateIsConnecting(openVpnStatus)) return 'openvpn';
    if (nativeStateIsConnected(wireguardStatus) || nativeStateIsConnecting(wireguardStatus)) return 'wireguard';
    if (nativeStateIsConnected(amneziaStatus) || nativeStateIsConnecting(amneziaStatus)) return 'amneziawg';
    return null;
  }, [xrayStatus.state, openVpnStatus, wireguardStatus, amneziaStatus]);

  const activeState = activeProtocol === 'v2ray' ? xrayStatus
    : activeProtocol === 'openvpn' ? openVpnStatus
      : activeProtocol === 'wireguard' ? wireguardStatus
        : activeProtocol === 'amneziawg' ? amneziaStatus : null;
  const connected = activeProtocol === 'v2ray'
    ? xrayStatus.state === 'connected'
    : activeProtocol
      ? nativeStateIsConnected(activeState as WireGuardVpnStatus)
      : false;
  const connecting = activeProtocol === 'v2ray'
    ? xrayStatus.state === 'connecting' || xrayStatus.state === 'preparing' || xrayStatus.state === 'disconnecting'
    : activeProtocol
      ? nativeStateIsConnecting(activeState as WireGuardVpnStatus)
      : false;
  const isRequestedProtocolActive = !!protocol && activeProtocol === protocol;
  const activeProfileId = activeProtocol === 'v2ray' ? xrayStatus.profileId : (activeState as WireGuardVpnStatus | null)?.profileId;
  const activeProfileName = activeProtocol === 'v2ray' ? xrayStatus.profileName : (activeState as WireGuardVpnStatus | null)?.profileName;
  const sameRequestedProfile = !!item && isRequestedProtocolActive && activeProfileId === item.id
    && (!locationName || activeProfileName === locationName);

  const profileLoading = protocol === 'v2ray' ? feed.isLoading
    : protocol === 'openvpn' ? openVpn.isLoading
      : protocol === 'wireguard' ? wireguard.isLoading
        : protocol === 'amneziawg' ? amnezia.isLoading : false;
  const profileError = protocol === 'v2ray' ? feed.error
    : protocol === 'openvpn' ? openVpn.error
      : protocol === 'wireguard' ? wireguard.error
        : protocol === 'amneziawg' ? amnezia.error : undefined;

  useEffect(() => {
    if (!protocol || !item || !token || !nativeReady || profileLoading) return;
    const key = `${item.id}:${protocol}:${locationName}:${retry}`;
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
        setPhase('error');
        setActionError(`ابتدا اتصال فعال ${protocolNames[activeProtocol]} را قطع کنید.`);
      }
      return;
    }

    attemptKeyRef.current = key;
    setActionError(null);
    setAttemptStartedAt(null);
    setPhase('preparing');
    void (async () => {
      try {
        if (protocol === 'v2ray') {
          const fresh = await feed.refetch();
          const source = fresh.data;
          if (fresh.isError || typeof source !== 'string' || !source.trim()) {
            throw fresh.error ?? new Error('فید V2Ray خالی است یا دریافت نشد.');
          }
          setPhase('connecting');
          setAttemptStartedAt(Date.now());
          void connectXray(item.id, item.plan, source)
            .then(() => setPhase('monitoring'))
            .catch((error) => {
              setActionError(getErrorMessage(error, token));
              setPhase('error');
            });
          return;
        }

        if (protocol === 'openvpn') {
          const fresh = await openVpn.refetch();
          const account = fresh.data;
          if (fresh.isError || !account) throw fresh.error ?? new Error('پروفایل OpenVPN در دسترس نیست.');
          const location = account.locations.find((entry) => entry.name === locationName) ?? account.locations[0];
          if (!location) throw new Error('برای OpenVPN سروری در پروفایل پیدا نشد.');
          const { provider, host } = routeParts(location.config_url, 'openvpn');
          const config = await downloadOpenVpnProfile(token, provider, host);
          setPhase('connecting');
          setAttemptStartedAt(Date.now());
          void connectOpenVpn(item.id, location.name, config, account.username, account.password)
            .then(() => setPhase('monitoring'))
            .catch((error) => {
              setActionError(getErrorMessage(error, token));
              setPhase('error');
            });
          return;
        }

        if (protocol === 'wireguard') {
          const fresh = await wireguard.refetch();
          const account = fresh.data;
          if (fresh.isError || !account) throw fresh.error ?? new Error('پروفایل WireGuard در دسترس نیست.');
          const location: WireGuardLocation | undefined =
            account.locations.find((entry) => entry.name === locationName) ?? account.locations[0];
          if (!location) throw new Error('برای WireGuard سروری در پروفایل پیدا نشد.');
          const { provider, host } = routeParts(location.config_url, 'wireguard');
          const config = await downloadWireGuardConfig(token, provider, host);
          setPhase('connecting');
          setAttemptStartedAt(Date.now());
          void connectWireGuard(item.id, location.name, config)
            .then(() => setPhase('monitoring'))
            .catch((error) => {
              setActionError(getErrorMessage(error, token));
              setPhase('error');
            });
          return;
        }

        const fresh = await amnezia.refetch();
        const config = fresh.data;
        if (fresh.isError || typeof config !== 'string' || !config.trim()) {
          throw fresh.error ?? new Error('پروفایل AmneziaWG خالی است یا دریافت نشد.');
        }
        setPhase('connecting');
        setAttemptStartedAt(Date.now());
        void connectAmneziaWg(item.id, item.plan, config)
          .then(() => setPhase('monitoring'))
          .catch((error) => {
            setActionError(getErrorMessage(error, token));
            setPhase('error');
          });
      } catch (error) {
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

  const nativeError = activeProtocol === 'v2ray' || (!activeProtocol && protocol === 'v2ray')
    ? xrayStatus.error
    : activeProtocol === 'openvpn' || (!activeProtocol && protocol === 'openvpn')
      ? openVpnStatus.error
      : activeProtocol === 'wireguard' || (!activeProtocol && protocol === 'wireguard')
        ? wireguardStatus.error
        : activeProtocol === 'amneziawg' || (!activeProtocol && protocol === 'amneziawg')
          ? amneziaStatus.error : null;
  const selectedStatus = protocol === 'v2ray' ? xrayStatus.state
    : protocol === 'openvpn' ? openVpnStatus.status
      : protocol === 'wireguard' ? wireguardStatus.status
        : protocol === 'amneziawg' ? amneziaStatus.status : 'UNKNOWN';
  const selectedError = protocol === 'v2ray' ? xrayStatus.state === 'error'
    : protocol === 'openvpn' ? openVpnStatus.status === 'ERROR' || !!openVpnStatus.error
      : protocol === 'wireguard' ? wireguardStatus.status === 'ERROR' || !!wireguardStatus.error
        : protocol === 'amneziawg' ? amneziaStatus.status === 'ERROR' || !!amneziaStatus.error : false;
  const statusError = !connected && selectedError ? nativeError ?? 'موتور بومی خطا گزارش کرد.' : null;
  const connectedAt = activeProtocol === 'v2ray' ? xrayStatus.connectedAt
    : (activeState as WireGuardVpnStatus | null)?.connectedAt;
  const duration = connected && connectedAt ? formatDuration(connectedAt, clock) : null;
  const attemptElapsed = attemptStartedAt ? clock - attemptStartedAt : 0;
  const slowAttempt = connecting && attemptElapsed >= 45_000;
  const hasTransferCounters = activeProtocol === 'openvpn'
    && ((activeState as WireGuardVpnStatus | null)?.downloadBytes != null
      || (activeState as WireGuardVpnStatus | null)?.uploadBytes != null);
  const transferIn = hasTransferCounters ? formatBytes((activeState as WireGuardVpnStatus | null)?.downloadBytes) : '—';
  const transferOut = hasTransferCounters ? formatBytes((activeState as WireGuardVpnStatus | null)?.uploadBytes) : '—';
  const statusColor = connected ? c.success : actionError || statusError || phase === 'error' ? c.destructive : connecting || phase === 'preparing' ? c.warning : c.mutedForeground;
  const statusTitle = connected ? 'اتصال امن برقرار است'
    : connecting ? 'در حال برقراری اتصال'
      : phase === 'preparing' ? 'در حال آماده‌سازی پروفایل'
        : actionError || statusError || phase === 'error' ? 'اتصال برقرار نشد'
          : 'اتصال قطع است';
  const statusDetail = connected
    ? 'موتور بومی دستگاه اتصال را تأیید کرده است.'
    : slowAttempt
      ? 'اتصال بیشتر از حد معمول طول کشیده است. وضعیت را بررسی کنید یا تونل را قطع کنید.'
      : connecting
        ? 'درخواست به موتور بومی Android ارسال شده است؛ منتظر پاسخ واقعی سرور هستیم.'
        : phase === 'preparing'
          ? 'پروفایل از اشتراک دریافت و برای موتور اتصال آماده می‌شود.'
          : actionError || statusError || (phase === 'error' ? 'اتصال کامل نشد. جزئیات خطا را پایین‌تر ببینید.' : 'برای شروع، از دکمهٔ تلاش دوباره استفاده کنید.');

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
    const remainingMs = Math.max(0, 75_000 - (Date.now() - attemptId));
    const timer = setTimeout(() => {
      if (timedOutAttemptRef.current === attemptId) return;
      timedOutAttemptRef.current = attemptId;
      const timeoutMessage =
        `مهلت اتصال ${protocolNames[protocol]} پس از ۷۵ ثانیه تمام شد. اتصال متوقف شد؛ دسترسی شبکه، مشخصات حساب و سرور انتخاب‌شده را بررسی کنید.`;
      setActionError(timeoutMessage);
      setDisconnecting(true);
      setPhase('disconnecting');
      void (async () => {
        let finalMessage = timeoutMessage;
        try {
          await disconnectTunnel(protocol);
        } catch (error) {
          finalMessage += `\n${getErrorMessage(error, token)}`;
        }
        const [xray, openvpn, wg, awg] = await Promise.all([
          getXrayState().catch(() => ({ state: 'disconnected' as const })),
          getOpenVpnStatus().catch(() => initialTunnelStatus),
          getWireGuardStatus().catch(() => initialTunnelStatus),
          getAmneziaWgStatus().catch(() => initialTunnelStatus),
        ]);
        setXrayStatus(xray);
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
  }, [connecting, connected, phase, actionError, statusError, attemptStartedAt, protocol, token]);

  const disconnectActive = async () => {
    const target = activeProtocol ?? protocol;
    if (!target) return;
    setAttemptStartedAt(null);
    timedOutAttemptRef.current = null;
    setDisconnecting(true);
    setActionError(null);
    setPhase('disconnecting');
    try {
      await disconnectTunnel(target);
      setPhase('monitoring');
    } catch (error) {
      setActionError(getErrorMessage(error, token));
      setPhase('error');
    } finally {
      setDisconnecting(false);
      const [xray, openvpn, wg, awg] = await Promise.all([
        getXrayState().catch(() => ({ state: 'disconnected' as const })),
        getOpenVpnStatus().catch(() => initialTunnelStatus),
        getWireGuardStatus().catch(() => initialTunnelStatus),
        getAmneziaWgStatus().catch(() => initialTunnelStatus),
      ]);
      setXrayStatus(xray);
      setOpenVpnStatus(openvpn);
      setWireguardStatus(wg);
      setAmneziaStatus(awg);
    }
  };

  const retryConnection = () => {
    attemptKeyRef.current = null;
    timedOutAttemptRef.current = null;
    setActionError(null);
    setAttemptStartedAt(null);
    setPhase('loading');
    setRetry((value) => value + 1);
  };

  const protocolAvailable = protocol && item
    ? protocol === 'v2ray' ? !!item.subscription_url
      : protocol === 'openvpn' ? !!item.openvpn_available
        : protocol === 'wireguard' ? !!item.wireguard_available
          : !!item.awg_url
    : false;

  return (
    <Screen style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="بازگشت" onPress={() => router.back()} style={[styles.backButton, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="arrow-right" size={19} color={c.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.topEyebrow, { color: c.mutedForeground }]}>PULSE SECURE · ANDROID</Text>
            <Text style={[styles.topTitle, { color: c.foreground }]}>وضعیت اتصال</Text>
          </View>
          <View style={[styles.liveMark, { backgroundColor: c.accent }]}>
            <View style={[styles.liveDot, { backgroundColor: connected ? c.success : connecting ? c.warning : c.mutedForeground }]} />
            <Text style={[styles.liveText, { color: c.accentForeground }]}>زنده</Text>
          </View>
        </View>

        {!item || subscriptions.isLoading && dashboard.isLoading ? (
          <Card style={styles.loadingCard}>
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={[styles.bodyText, { color: c.mutedForeground }]}>در حال دریافت جزئیات اشتراک…</Text>
          </Card>
        ) : (
          <>
            <LinearGradient
              colors={[c.card, c.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, { borderColor: c.border }]}
            >
              <View style={styles.heroTopline}>
                <View style={[styles.statusPill, { backgroundColor: connected ? `${c.success}18` : connecting ? `${c.warning}20` : `${c.mutedForeground}14` }]}>
                  <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusPillText, { color: statusColor }]}>{connected ? 'متصل' : connecting ? 'در حال اتصال' : phase === 'preparing' ? 'آماده‌سازی' : 'آفلاین'}</Text>
                </View>
                <Text style={[styles.heroKicker, { color: c.mutedForeground }]}>NATIVE TUNNEL</Text>
              </View>

              <View style={styles.heroCenter}>
                <View style={[styles.orbitOuter, { borderColor: `${statusColor}38` }]}>
                  <View style={[styles.orbitInner, { backgroundColor: connected ? `${c.success}16` : c.accent }]}>
                    {connecting ? <ActivityIndicator color={statusColor} size="large" /> : <Feather name={connected ? 'shield' : protocol ? protocolIcons[protocol] : 'shield'} size={34} color={statusColor} />}
                  </View>
                </View>
                <Text style={[styles.statusTitle, { color: c.foreground }]}>{statusTitle}</Text>
                <Text style={[styles.statusDetail, { color: c.mutedForeground }]}>{statusDetail}</Text>
              </View>

              <View style={[styles.heroFooter, { borderTopColor: c.border }]}>
                <View style={styles.heroMeta}>
                  <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>پروتکل</Text>
                  <Text style={[styles.metaValue, { color: c.foreground }]}>{activeProtocol ? protocolNames[activeProtocol] : protocol ? protocolNames[protocol] : '—'}</Text>
                </View>
                <View style={[styles.metaDivider, { backgroundColor: c.border }]} />
                <View style={styles.heroMeta}>
                  <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>مدت اتصال</Text>
                  <Ltr style={[styles.metaValue, { color: c.foreground }]}>{duration ?? (connecting ? '…' : '—')}</Ltr>
                </View>
              </View>
            </LinearGradient>

            {slowAttempt ? (
              <View style={[styles.notice, { backgroundColor: `${c.warning}14`, borderColor: `${c.warning}55` }]}>
                <Feather name="clock" size={18} color={c.warning} />
                <Text style={[styles.noticeText, { color: c.foreground }]}>هنوز پاسخ نهایی موتور دریافت نشده. می‌توانید اتصال را همین‌جا قطع کنید؛ وضعیت «متصل» فقط پس از تأیید واقعی نمایش داده می‌شود.</Text>
              </View>
            ) : null}

            {(actionError || statusError || phase === 'error') ? (
              <View style={[styles.errorCard, { backgroundColor: `${c.destructive}0A`, borderColor: `${c.destructive}55` }]}>
                <View style={styles.errorHeading}>
                  <Feather name="alert-triangle" size={19} color={c.destructive} />
                  <Text style={[styles.errorTitle, { color: c.destructive }]}>جزئیات خطا</Text>
                </View>
                <Text selectable style={[styles.errorText, { color: c.foreground }]}>{actionError ?? statusError ?? 'اتصال کامل نشد. دوباره تلاش کنید.'}</Text>
                {activeProtocol && activeState && 'status' in activeState ? (
                  <Text style={[styles.errorCode, { color: c.mutedForeground }]}>ENGINE STATUS · {activeState.status} · {activeState.tunnelState}</Text>
                ) : activeProtocol === 'v2ray' && xrayStatus.errorCode ? (
                  <Text style={[styles.errorCode, { color: c.mutedForeground }]}>ENGINE CODE · {xrayStatus.errorCode}</Text>
                ) : protocol && selectedStatus !== 'UNKNOWN' ? (
                  <Text style={[styles.errorCode, { color: c.mutedForeground }]}>ENGINE STATUS · {selectedStatus}</Text>
                ) : null}
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
              {(!connected || actionError || statusError) && protocol ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={retryConnection}
                  disabled={!protocolAvailable || profileLoading || !nativeReady || !!activeProtocol}
                  style={({ pressed }) => [styles.retryButton, { backgroundColor: c.primary, opacity: pressed ? 0.88 : (!protocolAvailable || profileLoading || !nativeReady || !!activeProtocol) ? 0.55 : 1 }]}
                >
                  {profileLoading || phase === 'preparing' ? <ActivityIndicator color={c.primaryForeground} /> : <Feather name="rotate-ccw" size={17} color={c.primaryForeground} />}
                  <Text style={[styles.actionText, { color: c.primaryForeground }]}>تلاش دوباره برای اتصال</Text>
                </Pressable>
              ) : null}
            </View>

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
              {protocol === 'v2ray' && feed.data ? <DetailRow label="سرورهای فید" value={`${fa(normalizeXrayShareLinks(feed.data).linkCount)} سرور`} color={c.foreground} muted={c.mutedForeground} border={c.border} /> : null}
              <DetailRow label="دادهٔ باقی‌مانده" value={`${item.remaining_gb} GB`} ltr color={c.foreground} muted={c.mutedForeground} border={c.border} />
              <DetailRow label="زمان باقی‌مانده" value={item.remaining_days == null ? '—' : `${fa(item.remaining_days)} روز`} color={c.foreground} muted={c.mutedForeground} border={c.border} />
              {transferIn || transferOut ? (
                <View style={styles.transferGrid}>
                  {transferIn ? <TransferMetric label="دریافت‌شده" value={transferIn} icon="download" color={c} /> : null}
                  {transferOut ? <TransferMetric label="ارسال‌شده" value={transferOut} icon="upload" color={c} /> : null}
                </View>
              ) : null}
              {protocol === 'v2ray' ? <Text style={[styles.note, { color: c.mutedForeground }]}>برای فید رمزگذاری‌شده، پیوندهای سرور پیش از تبدیل بومی به‌صورت ایمن بازخوانی می‌شوند.</Text> : null}
            </Card>

            <Card style={styles.engineCard}>
              <View style={[styles.sectionIcon, { backgroundColor: connected ? `${c.success}18` : c.secondary }]}>
                <Feather name={protocol ? protocolIcons[protocol] : 'shield'} size={17} color={connected ? c.success : c.primary} />
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={[styles.engineTitle, { color: c.foreground }]}>{activeProtocol ? protocolNames[activeProtocol] : protocol ? protocolNames[protocol] : 'موتور اتصال'}</Text>
                <Text style={[styles.note, { color: c.mutedForeground }]}>
                  {nativeReady && protocol && engineAvailability[protocol]
                    ? 'وضعیت بالا مستقیماً از موتور بومی دستگاه خوانده می‌شود.'
                    : 'برای اتصال واقعی به نسخهٔ بومی Android نیاز است؛ این صفحه وضعیت ساختگی نمایش نمی‌دهد.'}
                </Text>
              </View>
              <View style={[styles.engineState, { backgroundColor: connected ? `${c.success}18` : c.secondary }]}>
                <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
              </View>
            </Card>
          </>
        )}
      </ScrollView>
      <View style={[styles.bottomNav, { backgroundColor: c.card, borderColor: c.border, paddingBottom: safeBottom, marginBottom: -safeBottom }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="خانه" onPress={() => router.replace('/')} style={styles.bottomNavItem}>
          <Feather name="grid" size={20} color={c.mutedForeground} />
          <Text style={[styles.bottomNavLabel, { color: c.mutedForeground }]}>خانه</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="اشتراک‌ها" accessibilityState={{ selected: true }} onPress={() => router.replace('/(tabs)/profiles')} style={[styles.bottomNavItem, { backgroundColor: `${c.primary}12` }]}>
          <Feather name="layers" size={20} color={c.primary} />
          <Text style={[styles.bottomNavLabel, { color: c.primary }]}>اشتراک‌ها</Text>
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
  content: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 34, gap: 15 },
  bottomNav: { minHeight: 58, paddingTop: 5, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', elevation: 12, shadowColor: '#101828', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: -5 } },
  bottomNavItem: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 14 },
  bottomNavLabel: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  topBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  backButton: { width: 42, height: 42, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  topEyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.1, textAlign: 'right' },
  topTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'right', marginTop: 2 },
  liveMark: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  hero: { borderWidth: 1, borderRadius: 28, padding: 19, overflow: 'hidden' },
  heroTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  statusPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  heroKicker: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.2 },
  heroCenter: { alignItems: 'center', paddingTop: 24, paddingBottom: 19, gap: 10 },
  orbitOuter: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  orbitInner: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'center', marginTop: 2 },
  statusDetail: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  heroFooter: { borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  heroMeta: { flex: 1, alignItems: 'center', gap: 5 },
  metaLabel: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  metaValue: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'center' },
  metaDivider: { height: 27, width: 1 },
  notice: { borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  errorCard: { borderWidth: 1, borderRadius: 19, padding: 15, gap: 9 },
  errorHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  errorCode: { fontFamily: 'Inter_500Medium', fontSize: 9, letterSpacing: 0.5, textAlign: 'left' },
  primaryActions: { gap: 9 },
  disconnectButton: { minHeight: 54, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  retryButton: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  actionText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  infoCard: { padding: 16, gap: 0 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  sectionIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, textAlign: 'right' },
  sectionCaption: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'right', marginTop: 2 },
  detailRow: { minHeight: 43, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'right', flexShrink: 1, maxWidth: '66%' },
  transferGrid: { flexDirection: 'row', gap: 8, paddingTop: 11 },
  transferMetric: { flex: 1, minHeight: 62, borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'right' },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  engineCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  engineTitle: { fontFamily: 'Inter_700Bold', fontSize: 13, textAlign: 'right' },
  engineState: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  loadingCard: { minHeight: 230, alignItems: 'center', justifyContent: 'center' },
  bodyText: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
});
