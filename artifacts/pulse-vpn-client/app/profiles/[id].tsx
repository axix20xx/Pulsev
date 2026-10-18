import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  downloadOpenVpnProfile,
  useDownloadAmneziaWgConfig,
  downloadWireGuardConfig,
  useGetIpsecAccount,
  useGetMobileDashboard,
  useGetOpenVpnAccount,
  useGetPublicSubscriptionFeed,
  useGetWireGuardAccount,
  useListMobileSubscriptions,
} from '@workspace/api-client-react';
import type { WireGuardLocation } from '@workspace/api-client-react';
import { Card, Heading, InlineState, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { getSubscriptionToken } from '@/lib/subscription-token';
import {
  connectAmneziaWg,
  connectOpenVpn,
  connectWireGuard,
  connectXray,
  disconnectXray,
  disconnectAmneziaWg,
  disconnectOpenVpn,
  disconnectWireGuard,
  getAmneziaWgStatus,
  getOpenVpnStatus,
  isAmneziaWgEngineAvailable,
  isOpenVpnEngineAvailable,
  getXrayState,
  getWireGuardStatus,
  isXrayEngineAvailable,
  isWireGuardEngineAvailable,
  subscribeXrayState,
  type WireGuardVpnStatus,
  type XrayVpnState,
} from '@/lib/vpn-engine';

function wireGuardRoute(configUrl: string): { provider: string; host: string } {
  const parsed = new URL(configUrl, 'https://pulse.invalid');
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  const index = segments.findIndex((segment, position) => segment === 'wireguard' && segments[position + 1] === 'config');
  const provider = index >= 0 ? segments[index + 2] : undefined;
  const host = index >= 0 ? segments[index + 3] : undefined;
  if (!provider || !host) throw new Error('نشانی پیکربندی WireGuard معتبر نیست.');
  return { provider, host };
}

function openVpnRoute(configUrl: string): { provider: string; host: string } {
  const parsed = new URL(configUrl, 'https://pulse.invalid');
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  const index = segments.findIndex((segment, position) => segment === 'openvpn' && segments[position + 1] === 'config');
  const provider = index >= 0 ? segments[index + 2] : undefined;
  const host = index >= 0 ? segments[index + 3] : undefined;
  if (!provider || !host) throw new Error('نشانی پیکربندی OpenVPN معتبر نیست.');
  return { provider, host };
}

export default function ProfileDetail() {
  const c = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const subscriptions = useListMobileSubscriptions();
  const dashboard = useGetMobileDashboard();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const item = (subscriptions.data ?? dashboard.data?.subscriptions ?? []).find((subscription) => subscription.id === id);
  const token = getSubscriptionToken(item?.subscription_url ?? null);
  const openVpn = useGetOpenVpnAccount(token, { query: { enabled: !!token && !!item?.openvpn_available, queryKey: ['/mobile-profile', token, 'openvpn'] } });
  const wireguard = useGetWireGuardAccount(token, { query: { enabled: !!token && !!item?.wireguard_available, queryKey: ['/mobile-profile', token, 'wireguard'] } });
  const ipsec = useGetIpsecAccount(token, { query: { enabled: !!token && !!item?.ipsec_available, queryKey: ['/mobile-profile', token, 'ipsec'] } });
  const amnezia = useDownloadAmneziaWgConfig(token, { query: { enabled: !!token && !!item?.awg_url, queryKey: ['/mobile-profile', token, 'amneziawg'] } });
  const subscriptionFeed = useGetPublicSubscriptionFeed(token, { query: { enabled: !!token && !!item?.subscription_url, queryKey: ['/mobile-profile', token, 'subscription-feed'] } });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openVpnStatus, setOpenVpnStatus] = useState<WireGuardVpnStatus>({
    status: 'UNKNOWN',
    tunnelState: 'UNKNOWN',
    isConnected: false,
  });
  const [openVpnEngineAvailable, setOpenVpnEngineAvailable] = useState(false);
  const [openVpnBusy, setOpenVpnBusy] = useState(false);
  const [openVpnError, setOpenVpnError] = useState<string | null>(null);
  const [xrayState, setXrayState] = useState<XrayVpnState>({ state: 'disconnected' });
  const [xrayEngineAvailable, setXrayEngineAvailable] = useState(false);
  const [xrayBusy, setXrayBusy] = useState(false);
  const [xrayActionError, setXrayActionError] = useState<string | null>(null);
  const [wireguardStatus, setWireguardStatus] = useState<WireGuardVpnStatus>({
    status: 'DISCONNECTED',
    tunnelState: 'INACTIVE',
    isConnected: false,
  });
  const [wireguardEngineAvailable, setWireguardEngineAvailable] = useState(false);
  const [wireguardBusy, setWireguardBusy] = useState(false);
  const [wireguardError, setWireguardError] = useState<string | null>(null);
  const [wireguardLocationId, setWireguardLocationId] = useState<string | null>(null);
  const [amneziaStatus, setAmneziaStatus] = useState<WireGuardVpnStatus>({
    status: 'UNKNOWN',
    tunnelState: 'UNKNOWN',
    isConnected: false,
  });
  const [amneziaEngineAvailable, setAmneziaEngineAvailable] = useState(false);
  const [amneziaBusy, setAmneziaBusy] = useState(false);
  const [amneziaError, setAmneziaError] = useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let removeStateListener: () => void = () => undefined;

    void isXrayEngineAvailable().then((available) => {
      if (!disposed) setXrayEngineAvailable(available);
    });
    void getXrayState().then((state) => {
      if (!disposed) setXrayState(state);
    }).catch(() => undefined);
    void subscribeXrayState((state) => {
      if (!disposed) setXrayState(state);
    }).then((remove) => {
      if (disposed) remove();
      else removeStateListener = remove;
    }).catch(() => undefined);

    return () => {
      disposed = true;
      removeStateListener();
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    const refreshOpenVpn = async () => {
      try {
        const status = await getOpenVpnStatus();
        if (!disposed) setOpenVpnStatus(status);
      } catch {
        // Expo Go does not include the native VPN module.
      }
    };
    void isOpenVpnEngineAvailable().then((available) => {
      if (!disposed) setOpenVpnEngineAvailable(available);
    });
    void refreshOpenVpn();
    const timer = setInterval(() => void refreshOpenVpn(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    const refreshAmnezia = async () => {
      try {
        const status = await getAmneziaWgStatus();
        if (!disposed) setAmneziaStatus(status);
      } catch {
        // Expo Go has no native tunnel module, so its state cannot be asserted.
      }
    };
    void isAmneziaWgEngineAvailable().then((available) => {
      if (!disposed) setAmneziaEngineAvailable(available);
    });
    void refreshAmnezia();
    const timer = setInterval(() => void refreshAmnezia(), 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    const refreshWireGuard = async () => {
      try {
        const status = await getWireGuardStatus();
        if (disposed) return;
        setWireguardStatus(status);
        if (!status.isConnected) setWireguardLocationId(null);
      } catch {
        // An unlinked native module is expected in Expo Go. It is not an active tunnel.
      }
    };
    void isWireGuardEngineAvailable().then((available) => {
      if (!disposed) setWireguardEngineAvailable(available);
    });
    void refreshWireGuard();
    const timer = setInterval(() => void refreshWireGuard(), 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  if (subscriptions.isLoading && dashboard.isLoading) return <Screen><View style={styles.loading}><ActivityIndicator color={c.primary} /><Text style={{ color: c.mutedForeground }}>در حال دریافت اطلاعات…</Text></View></Screen>;
  if (subscriptions.isError && dashboard.isError) return <Screen><InlineState title="اطلاعات دریافت نشد" detail="برای بازیابی جزئیات پروفایل، اتصال را بررسی کنید." retry={() => { subscriptions.refetch(); dashboard.refetch(); }} /></Screen>;
  if (!item) return <Screen><InlineState title="اشتراک پیدا نشد" detail="این اشتراک در حساب شما موجود نیست یا دسترسی آن تغییر کرده است." retry={() => router.replace('/(tabs)/profiles')} icon="search" /></Screen>;

  const protocols = [
    { key: 'openvpn', name: 'OpenVPN', available: item.openvpn_available, result: openVpn.data, error: openVpn.error, loading: openVpn.isLoading, rows: openVpn.data ? [
      ['سرور', openVpn.data.server], ['نام کاربری', openVpn.data.username],
      ...openVpn.data.locations.map((location) => [`موقعیت · ${location.name}`, location.config_url]),
    ] : [] },
    { key: 'wireguard', name: 'WireGuard', available: item.wireguard_available, result: wireguard.data, error: wireguard.error, loading: wireguard.isLoading, rows: wireguard.data ? [
      ['نام کاربری', wireguard.data.username],
      ...wireguard.data.locations.map((location) => [`موقعیت · ${location.name}`, location.config_url]),
    ] : [] },
    { key: 'ipsec', name: 'IPsec / IKEv2', available: item.ipsec_available, result: ipsec.data, error: ipsec.error, loading: ipsec.isLoading, rows: ipsec.data ? [
      ['شناسه ورود', ipsec.data.login], ['نام کاربری', ipsec.data.username], ['رمز عبور', ipsec.data.password],
      ...ipsec.data.locations.map((location) => [`موقعیت · ${location.name}`, `${location.server} · ${location.ikev2_remote_id}`]),
    ] : [] },
    { key: 'amneziawg', name: 'AmneziaWG', available: !!item.awg_url, result: amnezia.data, error: amnezia.error, loading: amnezia.isLoading, rows: amnezia.data ? [
      ['وضعیت پیکربندی', 'پروفایل برای این اشتراک دریافت شد'],
      ['اندازهٔ پیکربندی', `${amnezia.data.length} نویسه`],
    ] : [] },
    { key: 'v2ray', name: 'فید سازگار با V2Box', available: !!item.subscription_url, result: subscriptionFeed.data, error: subscriptionFeed.error, loading: subscriptionFeed.isLoading, rows: subscriptionFeed.data ? [
      ['نشانی اشتراک', item.subscription_url ?? '—'],
      ['تعداد خطوط فید', String(subscriptionFeed.data.split(/\r?\n/).filter(Boolean).length)],
    ] : [] },
  ];

  const handleXrayAction = async () => {
    if (!item || !token) return;
    setXrayBusy(true);
    setXrayActionError(null);
    try {
      if (xrayState.state === 'connected') {
        await disconnectXray();
      } else {
        if (item.status !== 'active') {
          throw new Error('این اشتراک فعال نیست.');
        }
        const remaining = Number(item.remaining_gb);
        if (Number.isFinite(remaining) && remaining <= 0) {
          throw new Error('حجم این اشتراک به پایان رسیده است.');
        }
        const freshFeed = await subscriptionFeed.refetch();
        if (freshFeed.isError) {
          throw new Error('دریافت فید اتصال V2Ray ناموفق بود؛ اتصال را بررسی و دوباره تلاش کنید.');
        }
        const source = freshFeed.data;
        if (typeof source !== 'string' || !source.trim()) {
          throw new Error('فید اتصال V2Ray خالی است؛ دوباره تلاش کنید.');
        }
        await connectXray(item.id, item.plan, source);
        setXrayState(await getXrayState());
      }
    } catch (error) {
      setXrayActionError(error instanceof Error ? error.message : 'اتصال برقرار نشد.');
      try {
        setXrayState(await getXrayState());
      } catch {
        // Keep the last confirmed state. An unavailable native module is not
        // treated as a connected tunnel.
      }
    } finally {
      setXrayBusy(false);
    }
  };

  const handleOpenVpnAction = async (location: NonNullable<typeof openVpn.data>['locations'][number]) => {
    if (!item || !token || !openVpn.data) return;
    setOpenVpnBusy(true);
    setOpenVpnError(null);
    try {
      const sameLocation =
        openVpnStatus.profileId === item.id &&
        openVpnStatus.profileName === location.name;
      if (openVpnStatus.isConnected && sameLocation) {
        await disconnectOpenVpn();
        setOpenVpnStatus(await getOpenVpnStatus());
        return;
      }
      if (openVpnStatus.isConnected) {
        throw new Error('ابتدا اتصال OpenVPN فعال را قطع کنید، سپس سرور دیگری را انتخاب کنید.');
      }
      if (openVpnStatus.status === 'CONNECTING' || openVpnStatus.status === 'DISCONNECTING') {
        throw new Error('لطفاً تا پایان تغییر وضعیت اتصال صبر کنید.');
      }
      if (item.status !== 'active') throw new Error('این اشتراک فعال نیست.');
      const remaining = Number(item.remaining_gb);
      if (Number.isFinite(remaining) && remaining <= 0) throw new Error('حجم این اشتراک به پایان رسیده است.');

      const { provider, host } = openVpnRoute(location.config_url);
      const configText = await downloadOpenVpnProfile(token, provider, host);
      const status = await connectOpenVpn(
        item.id,
        location.name,
        configText,
        openVpn.data.username,
        openVpn.data.password,
      );
      setOpenVpnStatus(status);
    } catch (error) {
      setOpenVpnError(error instanceof Error ? error.message : 'اتصال OpenVPN برقرار نشد.');
      try {
        setOpenVpnStatus(await getOpenVpnStatus());
      } catch {
        // Keep the last confirmed native state.
      }
    } finally {
      setOpenVpnBusy(false);
    }
  };

  const handleWireGuardAction = async (location: WireGuardLocation) => {
    if (!item || !token) return;
    setWireguardBusy(true);
    setWireguardError(null);
    try {
      if (wireguardStatus.isConnected && wireguardLocationId === location.id) {
        await disconnectWireGuard();
        setWireguardStatus(await getWireGuardStatus());
        setWireguardLocationId(null);
        return;
      }
      if (item.status !== 'active') throw new Error('این اشتراک فعال نیست.');
      const remaining = Number(item.remaining_gb);
      if (Number.isFinite(remaining) && remaining <= 0) throw new Error('حجم این اشتراک به پایان رسیده است.');

      const { provider, host } = wireGuardRoute(location.config_url);
      const configText = await downloadWireGuardConfig(token, provider, host);
      if (wireguardStatus.isConnected) await disconnectWireGuard();
      const status = await connectWireGuard(item.id, location.name, configText);
      setWireguardStatus(status);
      setWireguardLocationId(location.id);
    } catch (error) {
      setWireguardError(error instanceof Error ? error.message : 'اتصال WireGuard برقرار نشد.');
      try {
        setWireguardStatus(await getWireGuardStatus());
      } catch {
        // Keep the last confirmed native state.
      }
    } finally {
      setWireguardBusy(false);
    }
  };

  const handleAmneziaAction = async () => {
    if (!item || !token) return;
    setAmneziaBusy(true);
    setAmneziaError(null);
    try {
      if (amneziaStatus.isConnected && amneziaStatus.profileId === item.id) {
        await disconnectAmneziaWg();
        setAmneziaStatus(await getAmneziaWgStatus());
        return;
      }
      if (item.status !== 'active') throw new Error('این اشتراک فعال نیست.');
      const remaining = Number(item.remaining_gb);
      if (Number.isFinite(remaining) && remaining <= 0) throw new Error('حجم این اشتراک به پایان رسیده است.');

      const freshConfig = await amnezia.refetch();
      const configText = freshConfig.data;
      if (typeof configText !== 'string' || !configText.trim()) {
        throw new Error('پیکربندی AmneziaWG خالی است؛ دوباره تلاش کنید.');
      }
      const status = await connectAmneziaWg(item.id, item.plan, configText);
      setAmneziaStatus(status);
    } catch (error) {
      setAmneziaError(error instanceof Error ? error.message : 'اتصال AmneziaWG برقرار نشد.');
      try {
        setAmneziaStatus(await getAmneziaWgStatus());
      } catch {
        // Keep the last confirmed native state.
      }
    } finally {
      setAmneziaBusy(false);
    }
  };

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.back}><Feather name="arrow-right" size={19} color={c.primary} /><Text style={[styles.backText, { color: c.primary }]}>بازگشت</Text></Pressable>
        <Heading eyebrow="جزئیات اشتراک" title={item.plan} detail={item.provider_name} />
        <Card style={styles.subscriptionCard}>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>وضعیت</Text><Text style={[styles.detailValue, { color: item.status === 'active' ? c.success : c.warning }]}>{({ active: 'فعال', expired: 'پایان‌یافته', cancelled: 'لغوشده', pending: 'در انتظار' }[item.status])}</Text></View>
          <View style={[styles.rule, { backgroundColor: c.border }]} />
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>کد سرویس</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.service_code}</Ltr></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>نام کاربری</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.username ?? '—'}</Ltr></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>دادهٔ باقیمانده</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.remaining_gb} GB</Ltr></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>تاریخ پایان</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.expires_at ?? '—'}</Ltr></View>
        </Card>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>پروفایل‌های موجود</Text>
          <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>جزئیات از حساب سرویس خوانده می‌شود. هر اتصال فقط با تأیید واقعی موتور بومی نمایش داده می‌شود.</Text>
        </View>
        {!token ? <InlineState title="دسترسی پروفایل موجود نیست" detail="نشانی خصوصی این اشتراک در داده‌های حساب ثبت نشده است." icon="lock" /> : null}
        {!!item.subscription_url ? (
          <Card style={styles.connectionCard}>
            <View style={styles.connectionHeading}>
              <View style={[styles.protocolIcon, { backgroundColor: xrayState.state === 'connected' ? c.success + '22' : c.accent }]}>
                <Feather name="shield" size={18} color={xrayState.state === 'connected' ? c.success : c.primary} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.protocolTitle, { color: c.foreground }]}>اتصال V2Ray درون‌برنامه‌ای</Text>
                <Text style={[styles.protocolState, { color: xrayState.state === 'connected' ? c.success : c.mutedForeground }]}>
                  {xrayState.state === 'connected' ? 'اتصال برقرار است' : xrayState.state === 'connecting' || xrayState.state === 'preparing' ? 'در حال اتصال…' : xrayState.state === 'disconnecting' ? 'در حال قطع اتصال…' : 'آمادهٔ اتصال'}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !xrayEngineAvailable || xrayBusy || subscriptionFeed.isLoading }}
              disabled={!xrayEngineAvailable || xrayBusy || subscriptionFeed.isLoading || xrayState.state === 'connecting' || xrayState.state === 'preparing' || xrayState.state === 'disconnecting'}
              onPress={handleXrayAction}
              style={[
                styles.connectButton,
                { backgroundColor: xrayState.state === 'connected' ? c.destructive : c.primary },
                (!xrayEngineAvailable || xrayBusy || subscriptionFeed.isLoading) && styles.disabledButton,
              ]}
            >
              {xrayBusy ? <ActivityIndicator color={c.primaryForeground} size="small" /> : null}
              <Text style={[styles.connectButtonText, { color: c.primaryForeground }]}>
                {xrayState.state === 'connected' ? 'قطع اتصال' : xrayEngineAvailable ? 'اتصال امن' : 'نیازمند نسخهٔ Android سفارشی'}
              </Text>
            </Pressable>
            {!xrayEngineAvailable ? (
              <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>این پیش‌نمایش Expo Go موتور VPN را ندارد. اتصال V2Ray فقط پس از ساخت و نصب نسخهٔ بومی Android در دسترس است.</Text>
            ) : null}
            {xrayActionError ? <Text accessibilityRole="alert" style={[styles.fetchError, { color: c.destructive }]}>{xrayActionError}</Text> : null}
            {xrayState.state === 'error' ? <Text accessibilityRole="alert" style={[styles.fetchError, { color: c.destructive }]}>موتور اتصال خطا گزارش کرد؛ وضعیت اتصال برقرار نیست.</Text> : null}
          </Card>
        ) : null}
        {protocols.map((protocol) => (
          <Card key={protocol.key} style={{ padding: 0, overflow: 'hidden' }}>
            <Pressable accessibilityRole="button" onPress={() => setExpanded(expanded === protocol.key ? null : protocol.key)} style={styles.protocolHeader}>
              <View style={[styles.protocolIcon, { backgroundColor: protocol.available ? c.accent : c.secondary }]}><Feather name={protocol.available ? 'shield' : 'minus-circle'} size={18} color={protocol.available ? c.primary : c.mutedForeground} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.protocolTitle, { color: c.foreground }]}>{protocol.name}</Text>
                <Text style={[styles.protocolState, { color: protocol.available ? c.success : c.mutedForeground }]}>{protocol.available ? 'در دسترس برای مشاهده' : 'برای این اشتراک ارائه نشده'}</Text>
              </View>
              <Feather name={expanded === protocol.key ? 'chevron-up' : 'chevron-down'} size={17} color={c.mutedForeground} />
            </Pressable>
            {expanded === protocol.key && protocol.available ? (
              <View style={[styles.protocolBody, { borderTopColor: c.border }]}>
                {protocol.loading ? <ActivityIndicator color={c.primary} /> : null}
                {protocol.error ? (
                  <View style={styles.fetchFailed}>
                    <Text style={[styles.fetchError, { color: c.destructive }]}>اطلاعات پروفایل دریافت نشد.</Text>
                    <Pressable accessibilityRole="button" onPress={() => {
                      if (protocol.key === 'openvpn') openVpn.refetch();
                      if (protocol.key === 'wireguard') wireguard.refetch();
                      if (protocol.key === 'ipsec') ipsec.refetch();
                      if (protocol.key === 'amneziawg') amnezia.refetch();
                      if (protocol.key === 'v2ray') subscriptionFeed.refetch();
                    }} style={styles.shareButton}>
                      <Feather name="rotate-ccw" size={15} color={c.primary} /><Text style={[styles.shareText, { color: c.primary }]}>تلاش دوباره</Text>
                    </Pressable>
                  </View>
                ) : null}
                {protocol.result && protocol.rows.map(([title, value], index) => (
                  <View key={`${protocol.key}-${index}`} style={styles.secretRow}>
                    <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>{title}</Text>
                    <Ltr style={[styles.secretValue, { color: c.foreground }]}>{value || '—'}</Ltr>
                    {typeof value === 'string' && (value.startsWith('http') || title.includes('رمز')) ? (
                      <Pressable accessibilityRole="button" onPress={() => Share.share({ message: `${title}: ${value}` })} style={styles.shareButton}>
                        <Feather name="share" size={15} color={c.primary} /><Text style={[styles.shareText, { color: c.primary }]}>اشتراک‌گذاری</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {protocol.result && protocol.key === 'openvpn' && openVpn.data?.locations.map((location) => {
                  const isThisLocationConnected =
                    openVpnStatus.isConnected &&
                    openVpnStatus.profileId === item.id &&
                    openVpnStatus.profileName === location.name;
                  const openVpnChanging = openVpnStatus.status === 'CONNECTING' || openVpnStatus.status === 'DISCONNECTING';
                  return (
                    <View key={location.id} style={styles.wireguardLocation}>
                      <View style={styles.wireguardLocationHeading}>
                        <Feather name="globe" size={15} color={isThisLocationConnected ? c.success : c.primary} />
                        <Text style={[styles.protocolTitle, { color: c.foreground, flex: 1 }]}>{location.name}</Text>
                        {isThisLocationConnected ? <Text style={[styles.protocolState, { color: c.success }]}>متصل</Text> : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !openVpnEngineAvailable || openVpnBusy || openVpnChanging }}
                        disabled={!openVpnEngineAvailable || openVpnBusy || openVpnChanging}
                        onPress={() => void handleOpenVpnAction(location)}
                        style={[
                          styles.serverConnectButton,
                          { backgroundColor: isThisLocationConnected ? c.destructive : c.primary },
                          (!openVpnEngineAvailable || openVpnBusy || openVpnChanging) && styles.disabledButton,
                        ]}
                      >
                        {openVpnBusy || openVpnChanging ? <ActivityIndicator color={c.primaryForeground} size="small" /> : null}
                        <Text style={[styles.connectButtonText, { color: c.primaryForeground }]}>
                          {openVpnChanging ? 'در حال تغییر وضعیت اتصال…' : isThisLocationConnected ? 'قطع اتصال OpenVPN' : 'اتصال به این سرور'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
                {protocol.result && protocol.key === 'openvpn' && !openVpnEngineAvailable ? (
                  <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>برای اتصال OpenVPN باید نسخهٔ سفارشی Android نصب شود؛ Expo Go موتور بومی را ندارد.</Text>
                ) : null}
                {protocol.key === 'openvpn' && openVpnError ? (
                  <Text accessibilityRole="alert" style={[styles.fetchError, { color: c.destructive }]}>{openVpnError}</Text>
                ) : null}
                {protocol.result && protocol.key === 'wireguard' && wireguard.data?.locations.map((location) => (
                  <View key={location.id} style={styles.wireguardLocation}>
                    <View style={styles.wireguardLocationHeading}>
                      <Feather name="globe" size={15} color={c.primary} />
                      <Text style={[styles.protocolTitle, { color: c.foreground, flex: 1 }]}>{location.name}</Text>
                      {wireguardStatus.isConnected && wireguardLocationId === location.id ? (
                        <Text style={[styles.protocolState, { color: c.success }]}>متصل</Text>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !wireguardEngineAvailable || wireguardBusy }}
                      disabled={!wireguardEngineAvailable || wireguardBusy}
                      onPress={() => void handleWireGuardAction(location)}
                      style={[
                        styles.serverConnectButton,
                        { backgroundColor: wireguardStatus.isConnected && wireguardLocationId === location.id ? c.destructive : c.primary },
                        (!wireguardEngineAvailable || wireguardBusy) && styles.disabledButton,
                      ]}
                    >
                      {wireguardBusy ? <ActivityIndicator color={c.primaryForeground} size="small" /> : null}
                      <Text style={[styles.connectButtonText, { color: c.primaryForeground }]}>
                        {wireguardStatus.isConnected && wireguardLocationId === location.id ? 'قطع اتصال WireGuard' : 'اتصال به این سرور'}
                      </Text>
                    </Pressable>
                  </View>
                ))}
                {protocol.result && protocol.key === 'wireguard' && !wireguardEngineAvailable ? (
                  <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>برای اتصال WireGuard باید نسخهٔ سفارشی Android نصب شود؛ Expo Go موتور بومی را ندارد.</Text>
                ) : null}
                {protocol.key === 'wireguard' && wireguardError ? (
                  <Text accessibilityRole="alert" style={[styles.fetchError, { color: c.destructive }]}>{wireguardError}</Text>
                ) : null}
                {protocol.result && protocol.key === 'amneziawg' ? (
                  <View style={styles.wireguardLocation}>
                    <View style={styles.wireguardLocationHeading}>
                      <Feather name="shield" size={15} color={amneziaStatus.isConnected ? c.success : c.primary} />
                      <Text style={[styles.protocolTitle, { color: c.foreground, flex: 1 }]}>اتصال روی همین دستگاه</Text>
                      <Text style={[styles.protocolState, { color: amneziaStatus.isConnected ? c.success : c.mutedForeground }]}>
                        {amneziaStatus.isConnected && amneziaStatus.profileId === item.id ? 'متصل' : 'آمادهٔ اتصال'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !amneziaEngineAvailable || amneziaBusy }}
                      disabled={!amneziaEngineAvailable || amneziaBusy}
                      onPress={() => void handleAmneziaAction()}
                      style={[
                        styles.serverConnectButton,
                        { backgroundColor: amneziaStatus.isConnected && amneziaStatus.profileId === item.id ? c.destructive : c.primary },
                        (!amneziaEngineAvailable || amneziaBusy) && styles.disabledButton,
                      ]}
                    >
                      {amneziaBusy ? <ActivityIndicator color={c.primaryForeground} size="small" /> : null}
                      <Text style={[styles.connectButtonText, { color: c.primaryForeground }]}>
                        {amneziaStatus.isConnected && amneziaStatus.profileId === item.id ? 'قطع اتصال AmneziaWG' : 'اتصال امن'}
                      </Text>
                    </Pressable>
                    {!amneziaEngineAvailable ? (
                      <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>برای اتصال AmneziaWG باید نسخهٔ سفارشی Android نصب شود؛ Expo Go موتور بومی را ندارد.</Text>
                    ) : null}
                    {amneziaError ? <Text accessibilityRole="alert" style={[styles.fetchError, { color: c.destructive }]}>{amneziaError}</Text> : null}
                  </View>
                ) : null}
                {protocol.result && protocol.rows.length === 0 ? <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>موردی برای نمایش ثبت نشده است.</Text> : null}
              </View>
            ) : null}
          </Card>
        ))}
        <Card style={[styles.engineCard, { backgroundColor: c.accent, borderColor: c.accent }]}>
          <Feather name="info" size={18} color={c.primary} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.engineTitle, { color: c.accentForeground }]}>سایر موتورهای اتصال</Text>
            <Text style={[styles.sectionNote, { color: c.accentForeground }]}>موتورهای OpenVPN، WireGuard، AmneziaWG و IPsec هنوز به نسخهٔ بومی اضافه نشده‌اند. از برنامهٔ دیگری استفاده نمی‌شود و وضعیت اتصال ساختگی نمایش داده نخواهد شد.</Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40, gap: 14 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  subscriptionCard: { gap: 13 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14 },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right' },
  detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'right', flexShrink: 1 },
  rule: { height: 1 },
  section: { gap: 5, marginTop: 7 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, textAlign: 'right' },
  sectionNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  protocolHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  protocolIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  protocolTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'right' },
  protocolState: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  protocolBody: { padding: 15, gap: 14, borderTopWidth: 1 },
  connectionCard: { gap: 13 },
  connectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  connectButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  wireguardLocation: { padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D9E1E6', gap: 9 },
  wireguardLocationHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serverConnectButton: { minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  connectButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  disabledButton: { opacity: 0.55 },
  secretRow: { gap: 6, alignItems: 'stretch' },
  secretValue: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 19, textAlign: 'left' },
  shareButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  shareText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  fetchError: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'right', lineHeight: 19 },
  fetchFailed: { gap: 5, alignItems: 'flex-start' },
  engineCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 4 },
  engineTitle: { fontFamily: 'Inter_700Bold', fontSize: 13, textAlign: 'right' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
