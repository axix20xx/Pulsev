import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetMobileDashboard, useGetMobileSession } from '@workspace/api-client-react';
import { Card, InlineState, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useVpnPreferences, type VpnProtocol } from '@/hooks/VpnPreferences';
import { getAmneziaWgStatus, getOpenVpnStatus, getWireGuardStatus, getXrayState, subscribeXrayState, type WireGuardVpnStatus, type XrayVpnState, stopTunnelForProtocolSwitch } from '@/lib/vpn-engine';
import { findActiveTunnelProtocol, isTunnelConnected, isTunnelConnecting } from '@/lib/tunnel-state';

const protocols: { id: VpnProtocol; title: string; description: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'v2ray', title: 'V2Box', description: 'سازگار با sing-box', icon: 'radio' },
  { id: 'wireguard', title: 'WireGuard', description: 'سبک و سریع', icon: 'activity' },
  { id: 'openvpn', title: 'OpenVPN', description: 'پایدار و سازگار', icon: 'shield' },
  { id: 'amneziawg', title: 'AmneziaWG', description: 'پروفایل اختصاصی', icon: 'wind' },
];
const empty: WireGuardVpnStatus = { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
const fa = (v: number | string) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const supports = (s: { subscription_url?: string | null; openvpn_available?: boolean; wireguard_available?: boolean; awg_url?: string | null }, p: VpnProtocol) =>
  p === 'v2ray' ? !!s.subscription_url : p === 'openvpn' ? !!s.openvpn_available : p === 'wireguard' ? !!s.wireguard_available : !!s.awg_url;

export default function HomeRedesign() {
  const c = useColors();
  const router = useRouter();
  const prefs = useVpnPreferences();
  const dashboard = useGetMobileDashboard();
  const session = useGetMobileSession();
  const eligible = (dashboard.data?.subscriptions ?? []).filter((s) => s.status === 'active' && Number(s.remaining_gb) > 0);
  const selected = eligible.find((s) => s.id === prefs.subscriptionId);
  const [xray, setXray] = useState<XrayVpnState>({ state: 'disconnected' });
  const [openvpn, setOpenvpn] = useState(empty);
  const [wireguard, setWireguard] = useState(empty);
  const [awg, setAwg] = useState(empty);
  const [busyProtocol, setBusyProtocol] = useState<VpnProtocol | null>(null);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let inFlight = false;
    const refresh = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      const currentRevision = revision;
      try {
        const [x, o, w, a] = await Promise.all([
          getXrayState().catch(() => ({ state: 'disconnected' as const })),
          getOpenVpnStatus().catch(() => empty),
          getWireGuardStatus().catch(() => empty),
          getAmneziaWgStatus().catch(() => empty),
        ]);
        if (disposed || revision !== currentRevision) return;
        setXray(x); setOpenvpn(o); setWireguard(w); setAwg(a);
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(() => { setClock(Date.now()); void refresh(); }, 1800);
    let remove: () => void = () => undefined;
    void subscribeXrayState((state) => { if (!disposed) { revision += 1; setXray(state); } })
      .then((unsubscribe) => { if (disposed) unsubscribe(); else remove = unsubscribe; }).catch(() => undefined);
    return () => { disposed = true; clearInterval(timer); remove(); };
  }, []);

  const states: Record<VpnProtocol, WireGuardVpnStatus> = { v2ray: empty, openvpn, wireguard, amneziawg: awg };
  const order = protocols.map((p) => p.id);
  const activeProtocol = findActiveTunnelProtocol(order, xray, states);
  const isConnected = activeProtocol ? isTunnelConnected(activeProtocol, xray, states[activeProtocol]) : false;
  const isBusy = activeProtocol ? isTunnelConnecting(activeProtocol, xray, states[activeProtocol]) : false;
  const activeState = activeProtocol === 'v2ray' ? xray : activeProtocol ? states[activeProtocol] : null;
  const profileId = activeState && 'profileId' in activeState ? activeState.profileId : undefined;
  const profileName = activeState && 'profileName' in activeState ? activeState.profileName : undefined;
  const connectedAt = activeState && 'connectedAt' in activeState ? activeState.connectedAt : undefined;
  const seconds = isConnected && connectedAt ? Math.max(0, Math.floor((clock - connectedAt) / 1000)) : 0;
  const duration = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((v) => String(v).padStart(2, '0')).join(':');
  const available = selected ? protocols.filter((p) => supports(selected, p.id)) : [];

  const openProtocol = async (protocol: VpnProtocol) => {
    if (!selected || !supports(selected, protocol) || busyProtocol || isBusy) return;
    setBusyProtocol(protocol);
    try {
      await stopTunnelForProtocolSwitch(protocol);
      prefs.chooseSubscription(selected.id);
      prefs.chooseProtocol(protocol);
      router.push(`/servers/${protocol}`);
    } catch (error) {
      Alert.alert('تغییر مسیر انجام نشد', error instanceof Error ? error.message : 'اتصال قبلی قطع نشد؛ تونل جدید شروع نشد.', [{ text: 'متوجه شدم' }]);
    } finally { setBusyProtocol(null); }
  };
  const chooseSubscription = (id: string) => {
    const subscription = eligible.find((entry) => entry.id === id);
    if (subscription) prefs.chooseSubscription(subscription.id);
  };

  if (session.data?.authenticated === false) {
    return <Screen><InlineState title="برای ادامه وارد شوید" detail="برای دیدن اشتراک‌ها و انتخاب مسیر، وارد حساب Pulse شوید." retry={() => router.replace('/auth/otp')} icon="log-in" /></Screen>;
  }

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()} tintColor={c.primary} />}>
        <View style={styles.topbar}>
          <View style={styles.brand}><View style={[styles.mark, { backgroundColor: c.primary }]}><Feather name="activity" size={18} color={c.primaryForeground} /></View>
            <View><Text style={[styles.brandName, { color: c.foreground }]}>Pulse <Text style={{ color: c.primary }}>VPN</Text></Text><Text style={[styles.brandSub, { color: c.mutedForeground }]}>اتصال خصوصی، انتخاب شما</Text></View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="تنظیمات حساب" testID="home-account" onPress={() => router.push('/(tabs)/settings')} style={[styles.avatar, { backgroundColor: c.card, borderColor: c.border }]}><Feather name="user" size={18} color={c.foreground} /></Pressable>
        </View>

        <View style={styles.intro}>
          <Text style={[styles.kicker, { color: c.primary }]}>فضای امن شما</Text>
          <Text style={[styles.title, { color: c.foreground }]}>اول اشتراک،{'\n'}بعد اتصال.</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>مسیرهای قابل‌استفاده فقط از اشتراک انتخابی شما نمایش داده می‌شوند.</Text>
        </View>

        <View style={styles.sectionHead}>
          <View style={styles.step}><Text style={[styles.stepNum, { color: c.primary }]}>۰۱</Text><Text style={[styles.sectionTitle, { color: c.foreground }]}>انتخاب اشتراک</Text></View>
          <Pressable accessibilityRole="button" testID="home-subscriptions" onPress={() => router.push('/(tabs)/profiles')}><Text style={[styles.link, { color: c.primary }]}>همهٔ اشتراک‌ها</Text></Pressable>
        </View>
        {dashboard.isLoading ? <Card style={styles.loadingCard}><View style={[styles.skeleton, { backgroundColor: c.muted }]} /><View style={[styles.skeletonLine, { backgroundColor: c.muted }]} /></Card> : null}
        {!dashboard.isLoading && eligible.length > 1 ? (
          <View style={styles.subscriptionList}>
            {eligible.map((item, index) => {
              const isSelected = item.id === selected?.id;
              return <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: isSelected }} testID={`home-subscription-${item.id}`} onPress={() => chooseSubscription(item.id)}>
                <Card style={[styles.subscriptionCard, isSelected && { borderColor: c.primary, backgroundColor: c.accent }]}>
                  <View style={[styles.subGlyph, { backgroundColor: isSelected ? c.primary : c.secondary }]}><Feather name={isSelected ? 'check' : 'layers'} size={17} color={isSelected ? c.primaryForeground : c.mutedForeground} /></View>
                  <View style={styles.subCopy}><Text style={[styles.subName, { color: c.foreground }]} numberOfLines={1}>{item.plan}</Text><Text style={[styles.subMeta, { color: c.mutedForeground }]} numberOfLines={1}>{item.provider_name} · {fa(item.remaining_days ?? 0)} روز</Text></View>
                  <View style={styles.subUsage}><Ltr style={[styles.usageNumber, { color: c.foreground }]}>{fa(item.remaining_gb)} GB</Ltr><Text style={[styles.usageLabel, { color: c.mutedForeground }]}>باقی‌مانده</Text></View>
                  <Feather name={isSelected ? 'check-circle' : 'circle'} size={19} color={isSelected ? c.primary : c.border} />
                </Card>
              </Pressable>;
            })}
          </View>
        ) : null}
        {!dashboard.isLoading && eligible.length === 1 ? (
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: selected?.id === eligible[0].id }} testID="home-selected-subscription" onPress={() => chooseSubscription(eligible[0].id)}>
            <Card style={[styles.subscriptionCard, selected && { borderColor: c.primary, backgroundColor: c.accent }]}>
              <View style={[styles.subGlyph, { backgroundColor: selected ? c.primary : c.secondary }]}><Feather name={selected ? 'check' : 'layers'} size={17} color={selected ? c.primaryForeground : c.primary} /></View>
              <View style={styles.subCopy}><Text style={[styles.subName, { color: c.foreground }]}>{eligible[0].plan}</Text><Text style={[styles.subMeta, { color: c.mutedForeground }]}>{eligible[0].provider_name} · اشتراک فعال</Text></View>
              <View style={styles.subUsage}><Ltr style={[styles.usageNumber, { color: c.foreground }]}>{fa(eligible[0].remaining_gb)} GB</Ltr><Text style={[styles.usageLabel, { color: c.mutedForeground }]}>باقی‌مانده</Text></View>
              {selected ? <Feather name="check-circle" size={19} color={c.primary} /> : <Text style={[styles.link, { color: c.primary }]}>انتخاب</Text>}
            </Card>
          </Pressable>
        ) : null}
        {!dashboard.isLoading && eligible.length === 0 ? <Card style={styles.emptyCard}>
          <View style={[styles.emptyGlyph, { backgroundColor: c.secondary }]}><Feather name="layers" size={20} color={c.primary} /></View>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>اشتراک فعالی پیدا نشد</Text>
          <Text style={[styles.emptyDetail, { color: c.mutedForeground }]}>اشتراک‌های فعال و دارای حجم، اینجا برای انتخاب نمایش داده می‌شوند.</Text>
          <Pressable accessibilityRole="button" testID="home-open-profiles" onPress={() => router.push('/(tabs)/profiles')}><Text style={[styles.link, { color: c.primary }]}>مدیریت اشتراک‌ها</Text></Pressable>
        </Card> : null}
        {dashboard.isError ? <InlineState title="اطلاعات اشتراک دریافت نشد" detail="اتصال اینترنت را بررسی و دوباره تلاش کنید." retry={() => void dashboard.refetch()} /> : null}

        {selected ? <>
          <View style={styles.sectionHead}>
            <View style={styles.step}><Text style={[styles.stepNum, { color: c.primary }]}>۰۲</Text><Text style={[styles.sectionTitle, { color: c.foreground }]}>انتخاب پروتکل</Text></View>
            <Text style={[styles.contextLabel, { color: c.mutedForeground }]} numberOfLines={1}>{selected.plan}</Text>
          </View>
          {isConnected || isBusy ? <Pressable accessibilityRole="button" testID="home-manage-connection" onPress={() => router.push({ pathname: '/connection', params: { id: profileId ?? selected.id, protocol: activeProtocol ?? 'v2ray', location: profileName ?? '' } })}>
            <View style={[styles.connectionCard, { backgroundColor: c.surfaceDeep }]}>
              <View style={[styles.connectionGlyph, { backgroundColor: `${c.onDeep}20` }]}><Feather name={isConnected ? 'shield' : 'activity'} size={20} color={c.onDeep} /></View>
              <View style={styles.connectionCopy}><Text style={[styles.connectionTitle, { color: c.onDeep }]}>{isConnected ? 'تونل بومی فعال است' : 'اتصال در حال تغییر است'}</Text>
                <Text style={[styles.connectionMeta, { color: `${c.onDeep}B8` }]}>{protocols.find((p) => p.id === activeProtocol)?.title ?? 'VPN'} · {profileName ?? selected.plan}</Text></View>
              <View style={styles.connectionTime}><Ltr style={[styles.duration, { color: c.onDeep }]}>{isConnected ? duration : '—'}</Ltr><Text style={[styles.connectionMeta, { color: `${c.onDeep}B8` }]}>مدت اتصال</Text></View>
              <Feather name="chevron-left" size={17} color={c.onDeep} />
            </View>
          </Pressable> : null}
          {available.length ? <View style={styles.protocolList}>{available.map((protocol, index) => {
            const chosen = prefs.protocol === protocol.id;
            return <Pressable key={protocol.id} accessibilityRole="button" accessibilityState={{ selected: chosen, busy: busyProtocol === protocol.id }} testID={`home-protocol-${protocol.id}`} disabled={!!busyProtocol || isBusy}
              onPress={() => void openProtocol(protocol.id)} style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}>
              <Card style={styles.protocolCard}>
                <View style={[styles.protocolGlyph, { backgroundColor: chosen ? c.primary : c.secondary }]}>{busyProtocol === protocol.id ? <ActivityIndicator color={c.primaryForeground} size="small" /> : <Feather name={protocol.icon} size={18} color={chosen ? c.primaryForeground : c.primary} />}</View>
                <View style={styles.protocolCopy}><Text style={[styles.protocolName, { color: c.foreground }]}>{protocol.title}</Text><Text style={[styles.protocolHint, { color: c.mutedForeground }]}>{protocol.description}</Text></View>
                {chosen ? <View style={[styles.currentPill, { backgroundColor: c.accent }]}><Text style={[styles.currentText, { color: c.primary }]}>آخرین انتخاب</Text></View> : <Feather name="arrow-up-left" size={17} color={c.primary} />}
              </Card>
            </Pressable>;
          })}</View> : <Card style={styles.emptyCard}><Feather name="radio" size={20} color={c.mutedForeground} /><Text style={[styles.emptyTitle, { color: c.foreground }]}>مسیر اتصالی برای این اشتراک نیست</Text><Text style={[styles.emptyDetail, { color: c.mutedForeground }]}>جزئیات اشتراک را بررسی کنید یا اشتراک دیگری انتخاب کنید.</Text></Card>}
          {eligible.length > 1 ? <Pressable accessibilityRole="button" testID="home-change-subscription" onPress={() => router.push('/(tabs)/profiles')} style={styles.changeLink}><Feather name="repeat" size={14} color={c.primary} /><Text style={[styles.link, { color: c.primary }]}>تغییر اشتراک</Text></Pressable> : null}
        </> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 34, gap: 17 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: 0.2 },
  brandSub: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 },
  avatar: { width: 42, height: 42, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { alignItems: 'flex-end', gap: 6, paddingTop: 4, paddingBottom: 2 },
  kicker: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 39, textAlign: 'right' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  contextLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, maxWidth: '43%', textAlign: 'right' },
  subscriptionList: { gap: 9 },
  subscriptionCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 19 },
  subGlyph: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  subCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  subName: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  subMeta: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  subUsage: { alignItems: 'flex-end', gap: 3 },
  usageNumber: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  usageLabel: { fontFamily: 'Inter_400Regular', fontSize: 8 },
  loadingCard: { gap: 10 },
  skeleton: { height: 38, width: 38, borderRadius: 13 },
  skeletonLine: { height: 14, width: '55%', borderRadius: 7 },
  emptyCard: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  emptyGlyph: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, textAlign: 'center' },
  emptyDetail: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 17, textAlign: 'center' },
  connectionCard: { minHeight: 76, borderRadius: 22, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  connectionGlyph: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  connectionCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  connectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  connectionMeta: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  connectionTime: { alignItems: 'flex-end', gap: 3 },
  duration: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  protocolList: { gap: 9 },
  protocolCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 19 },
  protocolGlyph: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  protocolCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  protocolName: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  protocolHint: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  currentPill: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  currentText: { fontFamily: 'Inter_600SemiBold', fontSize: 8 },
  changeLink: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
});
