import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  useDownloadAmneziaWgConfig,
  useGetMobileDashboard,
  useGetOpenVpnAccount,
  useGetPublicSubscriptionFeed,
  useGetWireGuardAccount,
  useListMobileSubscriptions,
} from '@workspace/api-client-react';
import { Card, InlineState, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { getSubscriptionToken } from '@/lib/subscription-token';
import { parseXrayShareLinks, type XrayShareServer } from '@/lib/xray-share-links';
import { useVpnPreferences, type VpnProtocol } from '@/hooks/VpnPreferences';
import { pingXrayServers } from '@/lib/vpn-engine';
import { friendlyServerName } from '@/lib/friendly-server-name';

const names: Record<VpnProtocol, string> = { v2ray: 'V2Box', openvpn: 'OpenVPN', wireguard: 'WireGuard', amneziawg: 'AmneziaWG' };
const descriptions: Record<VpnProtocol, string> = {
  v2ray: 'سرورهای سازگار با sing-box',
  openvpn: 'موقعیت‌های واقعی حساب OpenVPN',
  wireguard: 'موقعیت‌های واقعی حساب WireGuard',
  amneziawg: 'پیکربندی اختصاصی AmneziaWG',
};
function isProtocol(value: string): value is VpnProtocol {
  return value === 'v2ray' || value === 'openvpn' || value === 'wireguard' || value === 'amneziawg';
}
export default function ServerSelectionScreen() {
  const c = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ protocol?: string | string[]; smart?: string | string[] }>();
  const rawProtocol = Array.isArray(params.protocol) ? params.protocol[0] : params.protocol ?? '';
  const protocol: VpnProtocol | null = isProtocol(rawProtocol) ? rawProtocol : null;
  const smartRequested = (Array.isArray(params.smart) ? params.smart[0] : params.smart) === '1';
  const prefs = useVpnPreferences();
  const subscriptions = useListMobileSubscriptions();
  const dashboard = useGetMobileDashboard();
  const entries = subscriptions.data ?? dashboard.data?.subscriptions ?? [];
  const eligibleEntries = entries.filter((item) => item.status === 'active' && Number(item.remaining_gb) > 0);
  const selected = eligibleEntries.find((item) => item.id === prefs.subscriptionId)
    ?? eligibleEntries[0];
  const token = getSubscriptionToken(selected?.subscription_url ?? null);
  const openvpn = useGetOpenVpnAccount(token, { query: { enabled: !!token && protocol === 'openvpn' && !!selected?.openvpn_available, queryKey: ['/server-picker', token, 'openvpn'] } });
  const wireguard = useGetWireGuardAccount(token, { query: { enabled: !!token && protocol === 'wireguard' && !!selected?.wireguard_available, queryKey: ['/server-picker', token, 'wireguard'] } });
  const awg = useDownloadAmneziaWgConfig(token, { query: { enabled: !!token && protocol === 'amneziawg' && !!selected?.awg_url, queryKey: ['/server-picker', token, 'amneziawg'] } });
  const feed = useGetPublicSubscriptionFeed(token, { query: { enabled: !!token && protocol === 'v2ray' && !!selected?.subscription_url, queryKey: ['/server-picker', token, 'v2ray'] } });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const smartStarted = useRef(false);
  const xrayServers = useMemo(() => {
    if (typeof feed.data !== 'string') return [];
    return parseXrayShareLinks(feed.data).filter((server) => {
      if (!['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'hy2', 'tuic', 'socks', 'http'].includes(server.protocol)) return false;
      if (server.protocol !== 'ss' || !server.link.includes('?')) return true;
      try {
        return !new URL(server.link).searchParams.has('plugin');
      } catch {
        return false;
      }
    });
  }, [feed.data]);
  const servers = !selected ? [] : protocol === 'v2ray'
    ? xrayServers.map((server: XrayShareServer, index) => ({ id: server.id, name: friendlyServerName(server.name, index), location: '', latency: null as number | null }))
    : protocol === 'openvpn'
      ? (openvpn.data?.locations ?? []).map((server, index) => ({ id: server.name, name: friendlyServerName(server.name, index), location: '', latency: null as number | null }))
      : protocol === 'wireguard'
        ? (wireguard.data?.locations ?? []).map((server, index) => ({ id: server.name, name: friendlyServerName(server.name, index), location: '', latency: null as number | null }))
        : protocol === 'amneziawg' && typeof awg.data === 'string' && awg.data.trim()
          ? [{ id: 'amneziawg-config', name: 'پیکربندی این اشتراک', location: '', latency: null as number | null }]
          : [];
  const filtered = servers.filter((server) => `${server.name} ${server.location}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const loading = protocol === 'v2ray' ? feed.isLoading : protocol === 'openvpn' ? openvpn.isLoading : protocol === 'wireguard' ? wireguard.isLoading : protocol === 'amneziawg' ? awg.isLoading : false;
  const fetchError = protocol === 'v2ray' ? feed.error : protocol === 'openvpn' ? openvpn.error : protocol === 'wireguard' ? wireguard.error : protocol === 'amneziawg' ? awg.error : undefined;
  const refresh = () => {
    if (protocol === 'v2ray') void feed.refetch();
    if (protocol === 'openvpn') void openvpn.refetch();
    if (protocol === 'wireguard') void wireguard.refetch();
    if (protocol === 'amneziawg') void awg.refetch();
    void subscriptions.refetch();
  };
  const startConnection = async (server: typeof servers[number]) => {
    if (!protocol || !selected || busy) return;
    setError('');
    setBusy(true);
    prefs.chooseProtocol(protocol);
    prefs.chooseSubscription(selected.id);
    prefs.chooseServer(server.id, server.name);
    const routeParams: Record<string, string> = { id: selected.id, protocol };
    if (protocol === 'v2ray') routeParams.serverId = server.id;
    else if (protocol === 'openvpn' || protocol === 'wireguard') routeParams.location = server.id;
    try {
      router.push({ pathname: '/connection', params: routeParams });
    } catch {
      setBusy(false);
      setError('صفحهٔ اتصال باز نشد. دوباره تلاش کنید.');
      return;
    }
    setBusy(false);
  };
  const smart = async () => {
    if (!servers.length || busy) return;
    setBusy(true);
    try {
      let chosen = servers[0];
      if (protocol === 'v2ray') {
        const realServers = xrayServers;
        const pings = await pingXrayServers(realServers).catch(() => ({} as Record<string, number | null>));
        const fastest = [...realServers].sort((a, b) => (pings[a.id] ?? Number.POSITIVE_INFINITY) - (pings[b.id] ?? Number.POSITIVE_INFINITY))[0];
        if (fastest) chosen = servers.find((entry) => entry.id === fastest.id) ?? chosen;
      }
      await startConnection(chosen);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!smartRequested || smartStarted.current || loading || !servers.length || busy || !protocol) return;
    smartStarted.current = true;
    void smart();
  }, [smartRequested, loading, servers.length, busy, protocol]);
  if (!protocol) return <Screen><InlineState title="پروتکل شناخته نشد" detail="از صفحهٔ پروتکل‌ها یکی از چهار موتور پشتیبانی‌شده را انتخاب کنید." retry={() => router.replace('/(tabs)/protocols')} /></Screen>;

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={subscriptions.isRefetching || dashboard.isRefetching} onRefresh={refresh} tintColor={c.primary} />}
      >
        <Pressable accessibilityRole="button" testID="servers-back" onPress={() => router.back()} style={styles.back}>
          <Feather name="arrow-right" size={18} color={c.primary} /><Text style={[styles.backText, { color: c.primary }]}>بازگشت</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: c.primary }]}>SECURE ROUTE / {protocol.toUpperCase()}</Text>
          <Text style={[styles.title, { color: c.foreground }]}>{names[protocol]} Servers</Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>{descriptions[protocol]} · {selected?.plan ?? 'اشتراک انتخاب نشده'}</Text>
        </View>
        {eligibleEntries.length > 1 ? (
          <View style={styles.subscriptionRow}>
            {eligibleEntries.map((entry) => (
              <Pressable key={entry.id} accessibilityRole="button" testID={`server-subscription-${entry.id}`} onPress={() => prefs.chooseSubscription(entry.id)} style={[styles.subscriptionChip, { backgroundColor: entry.id === selected?.id ? c.accent : c.card, borderColor: entry.id === selected?.id ? c.primary : c.border }]}>
                <Text numberOfLines={1} style={[styles.chipText, { color: entry.id === selected?.id ? c.accentForeground : c.mutedForeground }]}>{entry.plan}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {servers.length ? (
          <>
            <Pressable accessibilityRole="button" testID="smart-connect" disabled={busy} onPress={smart} style={({ pressed }) => [styles.smart, { backgroundColor: c.primary, opacity: busy ? 0.55 : pressed ? 0.86 : 1 }]}>
              <Feather name="zap" size={17} color={c.primaryForeground} />
              <Text style={[styles.smartText, { color: c.primaryForeground }]}>{busy ? 'در حال آماده‌سازی…' : 'اتصال هوشمند'}</Text>
              <Text style={[styles.smartHint, { color: c.primaryForeground }]}>انتخاب سرور واقعی</Text>
            </Pressable>
            <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="search" size={17} color={c.mutedForeground} />
              <TextInput value={search} onChangeText={setSearch} placeholder="جست‌وجوی نام سرور" placeholderTextColor={c.mutedForeground} style={[styles.search, { color: c.foreground }]} testID="server-search" returnKeyType="search" />
              {search ? <Pressable accessibilityRole="button" accessibilityLabel="پاک کردن جست‌وجو" onPress={() => setSearch('')} hitSlop={8}><Feather name="x" size={17} color={c.mutedForeground} /></Pressable> : null}
            </View>
            <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: c.foreground }]}>سرورهای در دسترس</Text><Text style={[styles.count, { color: c.mutedForeground }]}>{servers.length} مورد</Text></View>
            {filtered.map((server, index) => {
              const chosen = prefs.serverId === server.id;
              return (
                <Card key={server.id} style={[styles.serverCard, chosen && { borderColor: c.primary }]}>
                  <View style={styles.serverRow}>
                    <View style={[styles.serverIcon, { backgroundColor: chosen ? c.accent : c.secondary }]}><Feather name={protocol === 'v2ray' ? 'radio' : 'globe'} size={17} color={c.primary} /></View>
                    <View style={styles.serverCopy}>
                      <Text style={[styles.serverName, { color: c.foreground }]} numberOfLines={1}>{server.name}</Text>
                      <Text style={[styles.serverMeta, { color: c.mutedForeground }]}>{server.latency == null ? 'تأخیر اندازه‌گیری نشده' : `${server.latency} ms`}</Text>
                    </View>
                    {chosen ? <Feather name="check-circle" size={19} color={c.primary} /> : null}
                  </View>
                  <Pressable accessibilityRole="button" testID={`connect-server-${index}`} disabled={busy} onPress={() => void startConnection(server)} style={({ pressed }) => [styles.connect, { backgroundColor: chosen ? c.secondary : c.accent, opacity: busy ? 0.55 : pressed ? 0.8 : 1 }]}>
                    <Text style={[styles.connectText, { color: chosen ? c.secondaryForeground : c.accentForeground }]}>{chosen ? 'اتصال به انتخاب‌شده' : 'انتخاب و اتصال'}</Text>
                    <Feather name="arrow-left" size={15} color={chosen ? c.secondaryForeground : c.accentForeground} />
                  </Pressable>
                </Card>
              );
            })}
            {!filtered.length ? <Text style={[styles.emptyText, { color: c.mutedForeground }]}>با این عبارت سروری پیدا نشد.</Text> : null}
          </>
        ) : null}
        {loading ? <View style={styles.state}><View style={[styles.skeleton, { backgroundColor: c.muted, width: '62%' }]} /><View style={[styles.skeleton, { backgroundColor: c.muted }]} /><View style={[styles.skeleton, { backgroundColor: c.muted }]} /></View> : null}
        {!loading && fetchError ? <InlineState title="سرورها دریافت نشدند" detail="اتصال را بررسی کنید و فهرست را دوباره تازه‌سازی کنید." retry={refresh} /> : null}
        {!loading && !fetchError && !servers.length ? (
          <Card style={styles.empty}>
            <Feather name="server" size={21} color={c.primary} />
            <Text style={[styles.emptyTitle, { color: c.foreground }]}>{selected ? 'برای این پروتکل سروری موجود نیست' : 'اشتراک فعالی پیدا نشد'}</Text>
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>{selected ? 'این اشتراک پیکربندی سازگار ارائه نمی‌دهد. پروتکل دیگری انتخاب کنید یا فهرست را تازه کنید.' : 'برای اتصال، ابتدا یک اشتراک فعال به حساب شما اضافه شود.'}</Text>
            <Pressable accessibilityRole="button" testID="refresh-servers" onPress={refresh} style={[styles.refresh, { borderColor: c.border }]}><Feather name="rotate-ccw" size={15} color={c.primary} /><Text style={[styles.refreshText, { color: c.primary }]}>تازه‌سازی فهرست</Text></Pressable>
          </Card>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}
        <Text style={[styles.privacy, { color: c.mutedForeground }]}>نشانی‌ها و مشخصات پیکربندی در این صفحه نمایش داده نمی‌شوند.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 34, gap: 13 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42, paddingHorizontal: 3 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  heading: { gap: 7, paddingTop: 6, paddingBottom: 3 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, textAlign: 'right' },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 19, textAlign: 'right' },
  subscriptionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  subscriptionChip: { maxWidth: '48%', borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  smart: { minHeight: 53, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15 },
  smartText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  smartHint: { marginLeft: 'auto', fontFamily: 'Inter_500Medium', fontSize: 10, opacity: 0.8 },
  searchBox: { minHeight: 48, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13 },
  search: { flex: 1, textAlign: 'right', fontFamily: 'Inter_400Regular', fontSize: 13, minHeight: 46 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  count: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  serverCard: { padding: 14, gap: 13, borderRadius: 18 },
  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  serverIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  serverCopy: { flex: 1, gap: 4 },
  serverName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'right' },
  serverMeta: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'right' },
  connect: { minHeight: 42, paddingHorizontal: 13, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  connectText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  state: { gap: 10 },
  skeleton: { height: 68, borderRadius: 17, opacity: 0.7 },
  empty: { alignItems: 'flex-end', gap: 12, paddingVertical: 21 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'right' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right', lineHeight: 20 },
  refresh: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  refreshText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  error: { textAlign: 'right', fontFamily: 'Inter_500Medium', fontSize: 12 },
  privacy: { textAlign: 'center', fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 17, marginTop: 4 },
});
