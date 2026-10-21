import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useGetMobileDashboard, useGetMobileSession } from '@workspace/api-client-react';
import { Card, InlineState, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useVpnPreferences, type VpnProtocol } from '@/hooks/VpnPreferences';
import {
  getAmneziaWgStatus, getOpenVpnStatus, getWireGuardStatus, getXrayState,
  subscribeXrayState, type WireGuardVpnStatus, type XrayVpnState,
} from '@/lib/vpn-engine';
import { stopTunnelForProtocolSwitch } from '@/lib/vpn-engine';
import { findActiveTunnelProtocol, isTunnelConnected, isTunnelConnecting } from '@/lib/tunnel-state';

const protocols: { id: VpnProtocol; title: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'v2ray', title: 'V2Box', icon: 'radio' },
  { id: 'wireguard', title: 'WireGuard', icon: 'activity' },
  { id: 'openvpn', title: 'OpenVPN', icon: 'shield' },
  { id: 'amneziawg', title: 'AmneziaWG', icon: 'wind' },
];
const emptyTunnel: WireGuardVpnStatus = { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
const protocolTitle = (protocol: VpnProtocol) => protocols.find((item) => item.id === protocol)?.title ?? 'VPN';
const fa = (value: number | string) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

export default function HomeRedesign() {
  const c = useColors();
  const router = useRouter();
  const prefs = useVpnPreferences();
  const dashboard = useGetMobileDashboard();
  const session = useGetMobileSession();
  const subscriptions = dashboard.data?.subscriptions ?? [];
  const eligible = subscriptions.filter((item) => item.status === 'active' && Number(item.remaining_gb) > 0);
  const selected = eligible.find((item) => item.id === prefs.subscriptionId) ?? eligible[0];
  const [xray, setXray] = useState<XrayVpnState>({ state: 'disconnected' });
  const [openvpn, setOpenvpn] = useState(emptyTunnel);
  const [wireguard, setWireguard] = useState(emptyTunnel);
  const [amnezia, setAmnezia] = useState(emptyTunnel);
  const [clock, setClock] = useState(Date.now());
  const [switchingProtocol, setSwitchingProtocol] = useState<VpnProtocol | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const [x, o, w, a] = await Promise.all([
        getXrayState().catch(() => ({ state: 'disconnected' as const })),
        getOpenVpnStatus().catch(() => emptyTunnel),
        getWireGuardStatus().catch(() => emptyTunnel),
        getAmneziaWgStatus().catch(() => emptyTunnel),
      ]);
      if (disposed) return;
      setXray(x); setOpenvpn(o); setWireguard(w); setAmnezia(a);
    };
    void refresh();
    const timer = setInterval(() => {
      setClock(Date.now());
      void refresh();
    }, 1800);
    let remove: () => void = () => undefined;
    void subscribeXrayState((state) => { if (!disposed) setXray(state); }).then((unsubscribe) => {
      if (disposed) unsubscribe(); else remove = unsubscribe;
    }).catch(() => undefined);
    return () => { disposed = true; clearInterval(timer); remove(); };
  }, []);

  const states: Record<VpnProtocol, WireGuardVpnStatus> = {
    v2ray: emptyTunnel, openvpn, wireguard, amneziawg: amnezia,
  };
  const orderedProtocols = protocols.map((item) => item.id);
  const activeProtocol = findActiveTunnelProtocol(orderedProtocols, xray, states);
  const active = activeProtocol ? isTunnelConnected(activeProtocol, xray, states[activeProtocol]) : false;
  const busy = activeProtocol ? isTunnelConnecting(activeProtocol, xray, states[activeProtocol]) : false;
  const activeName = activeProtocol ? protocolTitle(activeProtocol) : null;
  const activeState = activeProtocol === 'v2ray' ? xray : activeProtocol ? states[activeProtocol] : null;
  const profileId = activeState && 'profileId' in activeState ? activeState.profileId : undefined;
  const profileName = activeState && 'profileName' in activeState ? activeState.profileName : undefined;
  const connectedAt = activeState && 'connectedAt' in activeState ? activeState.connectedAt : undefined;
  const elapsed = active && connectedAt ? Math.max(0, Math.floor((clock - connectedAt) / 1000)) : 0;
  const duration = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
  const availability: Record<VpnProtocol, boolean> = {
    v2ray: eligible.some((item) => !!item.subscription_url),
    openvpn: eligible.some((item) => item.openvpn_available),
    wireguard: eligible.some((item) => item.wireguard_available),
    amneziawg: eligible.some((item) => !!item.awg_url),
  };
  const defaultProtocol = prefs.protocol && availability[prefs.protocol]
    ? prefs.protocol
    : protocols.find((item) => availability[item.id])?.id ?? 'v2ray';

  const chooseProtocol = (protocol: VpnProtocol, smart = false) => {
    if (busy || switchingProtocol || !availability[protocol]) return;
    setSwitchingProtocol(protocol);
    void (async () => {
      try {
        await stopTunnelForProtocolSwitch(protocol);
        prefs.chooseProtocol(protocol);
        router.push({ pathname: '/servers/[protocol]', params: { protocol, ...(smart ? { smart: '1' } : {}) } });
      } catch (error) {
        Alert.alert(
          'تغییر پروتکل انجام نشد',
          error instanceof Error ? error.message : 'اتصال قبلی قطع نشد؛ تونل جدید شروع نشد.',
          [{ text: 'متوجه شدم' }],
        );
      } finally {
        setSwitchingProtocol(null);
      }
    })();
  };
  const manageActive = () => {
    if (!activeProtocol) return;
    router.push({
      pathname: '/connection',
      params: { id: profileId ?? selected?.id ?? '', protocol: activeProtocol, location: profileName ?? '' },
    });
  };

  if (session.data?.authenticated === false) {
    return <Screen><InlineState title="برای ادامه وارد شوید" detail="برای بارگذاری اشتراک و سرورهای شما، وارد حساب Pulse شوید." retry={() => router.replace('/auth/otp')} icon="log-in" /></Screen>;
  }

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()} tintColor={c.primary} />}
      >
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={[styles.brandMark, { backgroundColor: c.primary }]}><Feather name="activity" size={19} color={c.primaryForeground} /></View>
            <View style={{ gap: 2 }}>
              <Text style={[styles.brandName, { color: c.foreground }]}>PULSE <Text style={{ color: c.primary }}>VPN</Text></Text>
              <Text style={[styles.brandTag, { color: c.mutedForeground }]}>CONNECTION CONTROL</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" testID="home-account" onPress={() => router.push('/(tabs)/settings')} style={[styles.avatar, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="user" size={18} color={c.foreground} />
          </Pressable>
        </View>

        <View style={styles.pageTitle}>
          <Text style={[styles.overline, { color: c.primary }]}>فضای اتصال خصوصی</Text>
          <Text style={[styles.title, { color: c.foreground }]}>اینترنتت،{'\n'}با مسیر امن.</Text>
        </View>

        <LinearGradient
          colors={active ? [c.surfaceDeep, c.success] : [c.surfaceDeep, c.primary]}
          start={{ x: 0.05, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={[styles.secureLabel, { backgroundColor: `${c.onDeep}20` }]}>
              <View style={[styles.statusDot, { backgroundColor: active ? c.success : busy ? c.warning : c.onDeep }]} />
              <Text style={[styles.secureText, { color: c.onDeep }]}>{active ? 'تونل فعال' : busy ? 'در حال اتصال' : 'آمادهٔ اتصال'}</Text>
            </View>
            <Text style={[styles.heroKicker, { color: `${c.onDeep}A6` }]}>NATIVE VPN</Text>
          </View>
          <View style={styles.heroMain}>
            <View style={styles.heroCopy}>
              <Text style={[styles.heroHeadline, { color: c.onDeep }]}>{active ? 'اتصال برقرار است' : busy ? 'در حال اتصال…' : 'حفاظت، با یک لمس'}</Text>
              <Text style={[styles.heroDetail, { color: `${c.onDeep}C7` }]}>
                {active
                  ? `${activeName} · ${profileName ?? prefs.serverName ?? 'سرور متصل'}`
                  : busy ? 'وضعیت از موتور بومی دریافت می‌شود.' : 'یک سرور واقعی انتخاب کنید و تونل بومی را روشن کنید.'}
              </Text>
            </View>
            <View style={[styles.shieldRing, { borderColor: `${c.onDeep}64`, backgroundColor: `${c.onDeep}20` }]}>
              {busy ? <ActivityIndicator color={c.onDeep} size="large" /> : <Feather name={active ? 'shield' : 'lock'} size={34} color={c.onDeep} />}
            </View>
          </View>
          <View style={[styles.heroBottom, { borderTopColor: `${c.onDeep}35` }]}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatLabel, { color: `${c.onDeep}9C` }]}>پروتکل</Text>
              <Text style={[styles.heroStatValue, { color: c.onDeep }]}>{activeName ?? protocolTitle(prefs.protocol ?? 'v2ray')}</Text>
            </View>
            <View style={[styles.heroDivider, { backgroundColor: `${c.onDeep}48` }]} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatLabel, { color: `${c.onDeep}9C` }]}>{active ? 'مدت تونل' : 'وضعیت'}</Text>
              <Ltr style={[styles.heroStatValue, { color: c.onDeep }]}>{active ? duration : 'READY'}</Ltr>
            </View>
            <Pressable
              accessibilityRole="button"
              testID={active ? 'home-manage-connection' : 'home-smart-connect'}
              onPress={active ? manageActive : () => chooseProtocol(defaultProtocol, true)}
              disabled={busy || (!active && !availability.v2ray && !availability.openvpn && !availability.wireguard && !availability.amneziawg)}
              style={({ pressed }) => [styles.heroAction, { opacity: pressed ? 0.78 : 1 }]}
            >
              <Feather name={active ? 'arrow-up-left' : 'zap'} size={17} color={c.primary} />
              <Text style={[styles.heroActionText, { color: c.primary }]}>{active ? 'مدیریت' : 'اتصال'}</Text>
            </Pressable>
          </View>
        </LinearGradient>

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>انتخاب مسیر</Text>
          <Pressable accessibilityRole="button" testID="all-protocols" onPress={() => router.push('/(tabs)/protocols')}>
            <Text style={[styles.sectionLink, { color: c.primary }]}>همهٔ پروتکل‌ها</Text>
          </Pressable>
        </View>
        <View style={styles.protocolGrid}>
          {protocols.map((item) => {
            const selectedProtocol = prefs.protocol === item.id;
            const enabled = availability[item.id];
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedProtocol, disabled: !enabled || busy }}
                testID={`home-protocol-${item.id}`}
                disabled={!enabled || busy}
                onPress={() => chooseProtocol(item.id)}
                style={({ pressed }) => [
                  styles.protocolTile,
                  {
                    backgroundColor: selectedProtocol ? c.primary : c.card,
                    borderColor: selectedProtocol ? c.primary : c.border,
                    opacity: enabled ? pressed ? 0.78 : 1 : 0.48,
                  },
                ]}
              >
                <View style={[styles.protocolIcon, { backgroundColor: selectedProtocol ? `${c.onDeep}24` : c.secondary }]}>
                  <Feather name={item.icon} size={18} color={selectedProtocol ? c.onDeep : c.primary} />
                </View>
                <Text style={[styles.protocolName, { color: selectedProtocol ? c.onDeep : c.foreground }]}>{item.title}</Text>
                <Text style={[styles.protocolAvailability, { color: selectedProtocol ? `${c.onDeep}B8` : c.mutedForeground }]}>{enabled ? selectedProtocol ? 'انتخاب شده' : 'آماده' : 'ناموجود'}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>اشتراک من</Text>
          <Pressable accessibilityRole="button" testID="home-subscriptions" onPress={() => router.push('/(tabs)/profiles')}>
            <Text style={[styles.sectionLink, { color: c.primary }]}>جزئیات</Text>
          </Pressable>
        </View>
        {selected ? (
          <Pressable accessibilityRole="button" testID="home-selected-subscription" onPress={() => router.push(`/profiles/${selected.id}`)}>
            <Card style={styles.subscriptionCard}>
              <View style={[styles.subscriptionGlyph, { backgroundColor: c.accent }]}><Feather name="layers" size={19} color={c.primary} /></View>
              <View style={styles.subscriptionCopy}>
                <Text style={[styles.subscriptionPlan, { color: c.foreground }]} numberOfLines={1}>{selected.plan}</Text>
                <Text style={[styles.subscriptionProvider, { color: c.mutedForeground }]} numberOfLines={1}>{selected.provider_name} · {selected.status === 'active' ? 'فعال' : 'غیرفعال'}</Text>
              </View>
              <View style={styles.subscriptionUsage}>
                <Ltr style={[styles.usageValue, { color: c.foreground }]}>{fa(selected.remaining_gb)} GB</Ltr>
                <Text style={[styles.usageLabel, { color: c.mutedForeground }]}>باقی‌مانده</Text>
              </View>
              <Feather name="chevron-left" size={16} color={c.mutedForeground} />
            </Card>
          </Pressable>
        ) : dashboard.isLoading ? (
          <Card style={styles.emptyCard}><ActivityIndicator color={c.primary} /><Text style={[styles.emptyText, { color: c.mutedForeground }]}>در حال دریافت اطلاعات اشتراک…</Text></Card>
        ) : (
          <Card style={styles.emptyCard}><Feather name="layers" size={20} color={c.mutedForeground} /><Text style={[styles.emptyText, { color: c.mutedForeground }]}>اشتراک فعالی برای این حساب پیدا نشد.</Text></Card>
        )}
        {dashboard.isError ? <InlineState title="اطلاعات دریافت نشد" detail="اتصال اینترنت و نشست حساب را بررسی کنید." retry={() => void dashboard.refetch()} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 21, paddingTop: 16, paddingBottom: 34, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontFamily: 'Inter_700Bold', fontSize: 14, letterSpacing: 1.1 },
  brandTag: { fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1.25 },
  avatar: { width: 42, height: 42, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { alignItems: 'flex-end', gap: 6, paddingTop: 2 },
  overline: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 29, lineHeight: 40, textAlign: 'right' },
  hero: { minHeight: 245, borderRadius: 27, padding: 19, justifyContent: 'space-between', overflow: 'hidden' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secureLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: 'transparent' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  secureText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  heroKicker: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.6 },
  heroMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 13 },
  heroCopy: { flex: 1, gap: 9, alignItems: 'flex-end' },
  heroHeadline: { fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'right' },
  heroDetail: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  shieldRing: { width: 82, height: 82, borderRadius: 41, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heroBottom: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingTop: 13 },
  heroStat: { minWidth: 72, gap: 4, alignItems: 'flex-end' },
  heroStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  heroStatValue: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  heroDivider: { width: 1, height: 28 },
  heroAction: { minHeight: 39, paddingHorizontal: 12, borderRadius: 13, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  heroActionText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  sectionLink: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  protocolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  protocolTile: { width: '48.5%', minHeight: 111, borderWidth: 1, borderRadius: 19, padding: 13, gap: 7, alignItems: 'flex-end' },
  protocolIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  protocolName: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  protocolAvailability: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  subscriptionCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  subscriptionGlyph: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  subscriptionCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  subscriptionPlan: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  subscriptionProvider: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  subscriptionUsage: { alignItems: 'flex-end', gap: 3 },
  usageValue: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  usageLabel: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  emptyCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
});
