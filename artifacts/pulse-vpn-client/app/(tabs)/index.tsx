import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetMobileDashboard, useGetMobileSession } from '@workspace/api-client-react';
import { Card, InlineState, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useVpnPreferences, type VpnProtocol } from '@/hooks/VpnPreferences';
import {
  getAmneziaWgStatus, getOpenVpnStatus, getWireGuardStatus, getXrayState,
  isAmneziaWgEngineAvailable, isOpenVpnEngineAvailable, isWireGuardEngineAvailable, isXrayEngineAvailable,
  subscribeXrayState, type WireGuardVpnStatus, type XrayVpnState,
} from '@/lib/vpn-engine';

type EngineSnapshot = { protocol: VpnProtocol; active: boolean; busy: boolean; profileId?: string; profileName?: string; connectedAt?: number };
const emptyTunnel: WireGuardVpnStatus = { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
const connectedForProtocol = (protocol: VpnProtocol, xray: XrayVpnState, native: WireGuardVpnStatus) =>
  protocol === 'v2ray' ? xray.state === 'connected'
    : native.isConnected || native.status === 'CONNECTED' || native.tunnelState === 'ACTIVE';
const busyForProtocol = (protocol: VpnProtocol, xray: XrayVpnState, native: WireGuardVpnStatus) =>
  protocol === 'v2ray' ? ['preparing', 'connecting', 'disconnecting'].includes(xray.state)
    : ['CONNECTING', 'DISCONNECTING'].includes(native.status) || ['CONNECTING', 'DISCONNECTING'].includes(native.tunnelState);

export default function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const prefs = useVpnPreferences();
  const dashboard = useGetMobileDashboard();
  const session = useGetMobileSession();
  const subscriptions = dashboard.data?.subscriptions ?? [];
  const chosenSubscription = subscriptions.find((item) => item.id === prefs.subscriptionId)
    ?? subscriptions.find((item) => item.status === 'active') ?? subscriptions[0];
  const [xray, setXray] = useState<XrayVpnState>({ state: 'disconnected' });
  const [openvpn, setOpenvpn] = useState(emptyTunnel);
  const [wireguard, setWireguard] = useState(emptyTunnel);
  const [amnezia, setAmnezia] = useState(emptyTunnel);
  const [engineAvailable, setEngineAvailable] = useState<Record<VpnProtocol, boolean>>({ v2ray: false, openvpn: false, wireguard: false, amneziawg: false });
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const eligibleSubscriptions = subscriptions.filter((entry) => entry.status === 'active' && Number(entry.remaining_gb) > 0);
  const availability: Record<VpnProtocol, boolean> = {
    v2ray: eligibleSubscriptions.some((entry) => !!entry.subscription_url),
    openvpn: eligibleSubscriptions.some((entry) => entry.openvpn_available),
    wireguard: eligibleSubscriptions.some((entry) => entry.wireguard_available),
    amneziawg: eligibleSubscriptions.some((entry) => !!entry.awg_url),
  };

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const [xs, ov, wg, awg, xa, oa, wa, aa] = await Promise.all([
        getXrayState().catch(() => ({ state: 'disconnected' as const })),
        getOpenVpnStatus().catch(() => emptyTunnel),
        getWireGuardStatus().catch(() => emptyTunnel),
        getAmneziaWgStatus().catch(() => emptyTunnel),
        isXrayEngineAvailable().catch(() => false),
        isOpenVpnEngineAvailable().catch(() => false),
        isWireGuardEngineAvailable().catch(() => false),
        isAmneziaWgEngineAvailable().catch(() => false),
      ]);
      if (disposed) return;
      setXray(xs); setOpenvpn(ov); setWireguard(wg); setAmnezia(awg);
      setEngineAvailable({ v2ray: xa, openvpn: oa, wireguard: wa, amneziawg: aa });
    };
    void refresh();
    const poll = setInterval(() => {
      setClock(Date.now());
      void Promise.all([
        getXrayState().then((s) => { if (!disposed) setXray(s); }).catch(() => undefined),
        getOpenVpnStatus().then((s) => { if (!disposed) setOpenvpn(s); }).catch(() => undefined),
        getWireGuardStatus().then((s) => { if (!disposed) setWireguard(s); }).catch(() => undefined),
        getAmneziaWgStatus().then((s) => { if (!disposed) setAmnezia(s); }).catch(() => undefined),
      ]);
    }, 2500);
    let remove: () => void = () => undefined;
    void subscribeXrayState((state) => { if (!disposed) setXray(state); }).then((unsubscribe) => {
      if (disposed) unsubscribe(); else remove = unsubscribe;
    }).catch(() => undefined);
    return () => { disposed = true; clearInterval(poll); remove(); };
  }, []);

  const engineStates: Record<VpnProtocol, WireGuardVpnStatus> = { v2ray: emptyTunnel, openvpn, wireguard, amneziawg: amnezia };
  const active = useMemo<EngineSnapshot | null>(() => {
    const protocols: VpnProtocol[] = ['v2ray', 'openvpn', 'wireguard', 'amneziawg'];
    for (const protocol of protocols) {
      const native = engineStates[protocol];
      if (connectedForProtocol(protocol, xray, native) || busyForProtocol(protocol, xray, native)) {
        const state = protocol === 'v2ray' ? xray : native;
        return {
          protocol,
          active: connectedForProtocol(protocol, xray, native),
          busy: busyForProtocol(protocol, xray, native),
          profileId: 'profileId' in state ? state.profileId : undefined,
          profileName: 'profileName' in state ? state.profileName : undefined,
          connectedAt: 'connectedAt' in state ? state.connectedAt : undefined,
        };
      }
    }
    return null;
  }, [amnezia, engineStates, openvpn, wireguard, xray]);
  const protocol = prefs.protocol;
  const selectedAvailability = protocol ? availability[protocol] : false;
  const selectedName = protocol ? ({ v2ray: 'V2Box', openvpn: 'OpenVPN', wireguard: 'WireGuard', amneziawg: 'AmneziaWG' } as const)[protocol] : 'انتخاب نشده';
  const activeName = active ? ({ v2ray: 'V2Box', openvpn: 'OpenVPN', wireguard: 'WireGuard', amneziawg: 'AmneziaWG' } as const)[active.protocol] : null;
  const duration = active?.active && active.connectedAt && active.connectedAt > 0
    ? [Math.floor((clock - active.connectedAt) / 3_600_000), Math.floor((clock - active.connectedAt) / 60_000) % 60, Math.floor((clock - active.connectedAt) / 1000) % 60]
      .map((part) => String(Math.max(0, part)).padStart(2, '0')).join(':')
    : null;

  const openServers = (smart: boolean) => {
    if (busy || !prefs.ready) return;
    setBusy(true);
    let selectedProtocol = prefs.protocol;
    if (!selectedProtocol) {
      const order: VpnProtocol[] = ['v2ray', 'wireguard', 'openvpn', 'amneziawg'];
      selectedProtocol = order.find((candidate) => availability[candidate]) ?? null;
      if (selectedProtocol) prefs.chooseProtocol(selectedProtocol);
    }
    if (!selectedProtocol || !availability[selectedProtocol]) {
      setBusy(false);
      return;
    }
    router.push({ pathname: '/servers/[protocol]', params: { protocol: selectedProtocol, ...(smart ? { smart: '1' } : {}) } });
    setBusy(false);
  };

  if (session.data?.authenticated === false) {
    return <Screen><InlineState title="برای ادامه وارد شوید" detail="با شمارهٔ موبایل حساب Pulse خود وارد شوید تا اشتراک‌های واقعی شما بارگذاری شوند." retry={() => router.replace('/auth/otp')} icon="log-in" /></Screen>;
  }

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()} tintColor={c.primary} />}
      >
        <View style={styles.topline}>
          <View style={styles.brandRow}><View style={[styles.logo, { borderColor: c.primary }]}><Feather name="activity" size={17} color={c.primary} /></View><Text style={[styles.brand, { color: c.foreground }]}>PULSE<Text style={{ color: c.primary }}>VPN</Text></Text></View>
          <Pressable accessibilityRole="button" testID="open-account" onPress={() => router.push('/(tabs)/settings')} hitSlop={10}><Feather name="user" size={20} color={c.mutedForeground} /></Pressable>
        </View>
        <View style={styles.greeting}>
          <Text style={[styles.eyebrow, { color: c.primary }]}>PRIVATE CONNECTION / 1.0.26</Text>
          <Text style={[styles.hello, { color: c.foreground }]}>آرام و مطمئن،{'\n'}با انتخاب شما.</Text>
        </View>
        <View style={[styles.orbStage, { borderColor: c.border }]}>
          <View style={[styles.orbit, { borderColor: active?.active ? c.primary : c.border }]} />
          <View style={[styles.orbitInner, { borderColor: c.border }]} />
          <View style={[styles.orb, { backgroundColor: active?.active ? c.accent : c.card, borderColor: active?.active ? c.primary : c.border }]}>
            <Feather name={active?.active ? 'shield' : active?.busy ? 'loader' : 'lock'} size={31} color={active?.active ? c.primary : c.mutedForeground} />
            <View style={[styles.orbDot, { backgroundColor: active?.active ? c.success : active?.busy ? c.warning : c.mutedForeground }]} />
          </View>
          <Text style={[styles.connectionLabel, { color: c.foreground }]}>{active?.busy ? 'در حال برقراری' : active?.active ? 'تونل فعال' : 'اتصال برقرار نیست'}</Text>
          <Text style={[styles.connectionDetail, { color: c.mutedForeground }]}>{active?.active ? 'این صفحه وضعیت موتور را می‌خواند؛ تأیید اینترنت را در صفحهٔ اتصال ببینید.' : active?.busy ? 'وضعیت اتصال از موتور بومی دریافت می‌شود.' : 'هنگام اتصال، وضعیت واقعی موتور نمایش داده می‌شود.'}</Text>
          {duration ? <Text style={[styles.duration, { color: c.primary }]}>مدت فعال بودن تونل · {duration}</Text> : null}
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !prefs.ready || !subscriptions.length }} disabled={busy || !prefs.ready || !subscriptions.length} testID="smart-connect-home" onPress={() => openServers(true)} style={({ pressed }) => [styles.primaryAction, { backgroundColor: c.primary, opacity: busy || !prefs.ready || !subscriptions.length ? 0.5 : pressed ? 0.85 : 1 }]}>
            <Feather name="zap" size={17} color={c.primaryForeground} /><Text style={[styles.primaryActionText, { color: c.primaryForeground }]}>اتصال هوشمند</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !prefs.ready || !subscriptions.length }} disabled={busy || !prefs.ready || !subscriptions.length} testID="manual-connect-home" onPress={() => openServers(false)} style={({ pressed }) => [styles.secondaryAction, { borderColor: c.border, backgroundColor: c.card, opacity: busy || !prefs.ready || !subscriptions.length ? 0.5 : pressed ? 0.82 : 1 }]}>
            <Feather name="map-pin" size={16} color={c.primary} /><Text style={[styles.secondaryActionText, { color: c.foreground }]}>انتخاب سرور</Text>
          </Pressable>
        </View>
        {active?.active ? (
          <Pressable accessibilityRole="button" testID="manage-active-connection" onPress={() => router.push({ pathname: '/connection', params: { id: active.profileId ?? chosenSubscription?.id ?? '', protocol: active.protocol, location: active.profileName ?? '' } })}>
            <Card style={styles.activeCard}><View style={styles.activeLeft}><Feather name="arrow-left" size={16} color={c.primary} /><Text style={[styles.activeLink, { color: c.primary }]}>مدیریت اتصال</Text></View><View style={styles.activeInfo}><Text style={[styles.activeTitle, { color: c.foreground }]}>{activeName} · {active.profileName ?? prefs.serverName ?? 'سرور انتخاب‌شده'}</Text><Text style={[styles.activeSub, { color: c.mutedForeground }]}>موتور فعال است؛ نتیجهٔ HTTPS باید تأیید شود</Text></View></Card>
          </Pressable>
        ) : null}
        <View style={[styles.protocolStrip, { borderColor: c.border, backgroundColor: c.card }]}>
          <View style={styles.protocolGlyph}><Feather name="radio" size={16} color={c.primary} /></View>
          <View style={styles.protocolCopy}><Text style={[styles.protocolCaption, { color: c.mutedForeground }]}>پروتکل انتخاب‌شده</Text><Text style={[styles.protocolValue, { color: c.foreground }]}>{selectedName}</Text></View>
          <Pressable accessibilityRole="button" testID="change-protocol-home" onPress={() => router.push('/(tabs)/protocols')} style={styles.changeProtocol}><Text style={[styles.changeText, { color: c.primary }]}>تغییر</Text><Feather name="chevron-left" size={16} color={c.primary} /></Pressable>
        </View>
        <Pressable accessibilityRole="button" testID="selected-server-shortcut" onPress={() => protocol ? router.push({ pathname: '/servers/[protocol]', params: { protocol } }) : router.push('/(tabs)/protocols')}>
          <View style={[styles.serverStrip, { borderColor: c.border }]}>
            <Feather name="map-pin" size={16} color={c.primary} />
            <View style={styles.serverStripCopy}>
              <Text style={[styles.protocolCaption, { color: c.mutedForeground }]}>سرور انتخاب‌شده</Text>
              <Text style={[styles.protocolValue, { color: c.foreground }]} numberOfLines={1}>{prefs.serverName ?? 'هنوز سروری انتخاب نشده'}</Text>
            </View>
            <Feather name="chevron-left" size={16} color={c.mutedForeground} />
          </View>
        </Pressable>
        {!dashboard.isLoading && !subscriptions.length ? (
          <Card style={styles.noSubscription}>
            <Feather name="layers" size={19} color={c.primary} />
            <View style={{ flex: 1, gap: 4 }}><Text style={[styles.noSubTitle, { color: c.foreground }]}>اشتراک در دسترس نیست</Text><Text style={[styles.noSubDetail, { color: c.mutedForeground }]}>برای حساب شما هنوز اشتراک فعالی ثبت نشده است.</Text></View>
          </Card>
        ) : null}
        {dashboard.isError ? <InlineState title="اطلاعات حساب دریافت نشد" detail="برای اتصال باید اطلاعات اشتراک واقعی بارگذاری شود." retry={() => void dashboard.refetch()} /> : null}
        {protocol && !selectedAvailability && subscriptions.length ? <Text style={[styles.protocolUnavailable, { color: c.warning }]}>{selectedName} برای اشتراک‌های موجود پیکربندی ندارد؛ پروتکل دیگری را خودتان انتخاب کنید.</Text> : null}
        {active?.busy && !active.active ? <Text style={[styles.protocolUnavailable, { color: c.warning }]}>درخواست جاری هنوز نهایی نشده است. تا پایان تلاش، اتصال تازه‌ای آغاز نکنید.</Text> : null}
        {active?.active && !engineAvailable[active.protocol] ? <Text style={[styles.protocolUnavailable, { color: c.warning }]}>وضعیت موتور در دسترس نیست؛ اتصال را تأییدشده تلقی نکنید.</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 30, gap: 17 },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 32, height: 32, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: 'Inter_700Bold', letterSpacing: 1.5, fontSize: 13 },
  greeting: { alignItems: 'flex-end', gap: 7, marginTop: 3 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.6 },
  hello: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 37, textAlign: 'right' },
  orbStage: { minHeight: 238, borderWidth: 1, borderRadius: 25, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', gap: 8, paddingVertical: 20 },
  orbit: { position: 'absolute', width: 192, height: 192, borderRadius: 96, borderWidth: 1, opacity: 0.55 },
  orbitInner: { position: 'absolute', width: 154, height: 154, borderRadius: 77, borderWidth: 1, opacity: 0.7 },
  orb: { width: 112, height: 112, borderRadius: 56, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  orbDot: { position: 'absolute', top: 15, right: 17, width: 8, height: 8, borderRadius: 4 },
  connectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 3 },
  connectionDetail: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 17, textAlign: 'center', paddingHorizontal: 20 },
  duration: { fontFamily: 'Inter_600SemiBold', fontSize: 10, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 10 },
  primaryAction: { flex: 1.1, minHeight: 52, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryActionText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  secondaryAction: { flex: 0.9, minHeight: 52, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  protocolStrip: { borderRadius: 17, borderWidth: 1, minHeight: 66, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  protocolGlyph: { width: 37, height: 37, borderRadius: 13, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  protocolCopy: { flex: 1, gap: 4 },
  protocolCaption: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'right' },
  protocolValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'right' },
  changeProtocol: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingHorizontal: 3 },
  changeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  serverStrip: { minHeight: 62, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  serverStripCopy: { flex: 1, gap: 5, alignItems: 'flex-end' },
  activeCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  activeLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  activeLink: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  activeInfo: { flex: 1, gap: 5, alignItems: 'flex-end', paddingLeft: 8 },
  activeTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'right' },
  activeSub: { fontFamily: 'Inter_400Regular', fontSize: 9, textAlign: 'right' },
  noSubscription: { flexDirection: 'row', alignItems: 'center' },
  noSubTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'right' },
  noSubDetail: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  protocolUnavailable: { textAlign: 'right', fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 19 },
});
