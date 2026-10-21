import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import {
  getAmneziaWgStatus, getOpenVpnStatus, getWireGuardStatus, getXrayState, testTunnelConnectivity,
  type TunnelConnectivityReport, type WireGuardVpnStatus, type XrayVpnState,
} from '@/lib/vpn-engine';
import type { VpnProtocol } from '@/hooks/VpnPreferences';

const empty: WireGuardVpnStatus = { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
const labels: Record<VpnProtocol, string> = { v2ray: 'V2Box', openvpn: 'OpenVPN', wireguard: 'WireGuard', amneziawg: 'AmneziaWG' };
const order: VpnProtocol[] = ['v2ray', 'wireguard', 'openvpn', 'amneziawg'];
const connected = (protocol: VpnProtocol, xray: XrayVpnState, native: WireGuardVpnStatus) =>
  protocol === 'v2ray' ? xray.state === 'connected'
    : native.isConnected || native.status === 'CONNECTED' || native.tunnelState === 'ACTIVE';
const fa = (value: string | number) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

export default function ActivityRedesign() {
  const c = useColors();
  const [xray, setXray] = useState<XrayVpnState>({ state: 'disconnected' });
  const [openvpn, setOpenvpn] = useState(empty);
  const [wireguard, setWireguard] = useState(empty);
  const [amnezia, setAmnezia] = useState(empty);
  const [report, setReport] = useState<TunnelConnectivityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const states: Record<VpnProtocol, WireGuardVpnStatus> = { v2ray: empty, openvpn, wireguard, amneziawg: amnezia };
  const activeProtocol = order.find((protocol) => connected(protocol, xray, states[protocol])) ?? null;

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const [x, o, w, a] = await Promise.all([
        getXrayState().catch(() => ({ state: 'disconnected' as const })),
        getOpenVpnStatus().catch(() => empty),
        getWireGuardStatus().catch(() => empty),
        getAmneziaWgStatus().catch(() => empty),
      ]);
      if (disposed) return;
      setXray(x); setOpenvpn(o); setWireguard(w); setAmnezia(a);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2200);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  const checkInternet = async () => {
    if (checking) return;
    setChecking(true);
    try { setReport(await testTunnelConnectivity()); }
    catch { setReport(null); }
    finally { setChecking(false); }
  };

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Text style={[styles.kicker, { color: c.primary }]}>LIVE DIAGNOSTICS</Text>
          <Text style={[styles.title, { color: c.foreground }]}>وضعیت زنده</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>وضعیت موتور با آزمون عبور اینترنت یکی نیست؛ هر دو را جدا می‌بینید.</Text>
        </View>
        <View style={[styles.hero, { backgroundColor: c.surfaceDeep }]}>
          <View style={styles.heroTop}>
          <View style={[styles.heroIcon, { backgroundColor: activeProtocol ? c.success : `${c.onDeep}1B` }]}>
              <Feather name={activeProtocol ? 'shield' : 'activity'} size={20} color={c.onDeep} />
            </View>
            <Text style={styles.heroCaption}>VPN ENGINE</Text>
          </View>
          <Text style={[styles.heroState, { color: c.onDeep }]}>{activeProtocol ? 'تونل بومی فعال است' : 'تونل فعالی نیست'}</Text>
          <Text style={[styles.heroDetail, { color: `${c.onDeep}B8` }]}>{activeProtocol ? labels[activeProtocol] : 'برای بررسی شبکه، ابتدا به یک سرور وصل شوید.'}</Text>
          <View style={styles.heroFoot}>
            <View style={[styles.dot, { backgroundColor: activeProtocol ? '#8CF0C9' : '#9EABBC' }]} />
            <Text style={[styles.heroFootText, { color: `${c.onDeep}D8` }]}>{activeProtocol ? 'وضعیت موتور: متصل' : 'وضعیت موتور: آفلاین'}</Text>
          </View>
        </View>

        <Card style={styles.checkCard}>
          <View style={[styles.checkGlyph, { backgroundColor: c.accent }]}><Feather name="globe" size={18} color={c.primary} /></View>
          <View style={styles.checkCopy}>
            <Text style={[styles.checkTitle, { color: c.foreground }]}>آزمون دسترسی اینترنت</Text>
            <Text style={[styles.checkDetail, { color: c.mutedForeground }]}>
              {report
                ? report.passed ? `پاسخ HTTPS دریافت شد · ${fa(new Date(report.testedAt).toLocaleTimeString())}` : 'تونل فعال است، اما درخواست‌های آزمایشی پاسخ نگرفتند.'
                : 'این آزمون جدا از وضعیت اتصال موتور اجرا می‌شود.'}
            </Text>
          </View>
          <Pressable accessibilityRole="button" testID="run-tunnel-check" disabled={!activeProtocol || checking} onPress={() => void checkInternet()} style={[styles.checkButton, { backgroundColor: c.primary, opacity: !activeProtocol || checking ? 0.5 : 1 }]}>
            {checking ? <ActivityIndicator color={c.primaryForeground} size="small" /> : <Feather name="play" size={15} color={c.primaryForeground} />}
            <Text style={[styles.checkButtonText, { color: c.primaryForeground }]}>{checking ? 'در حال بررسی' : 'آزمون'}</Text>
          </Pressable>
        </Card>

        <Text style={[styles.sectionTitle, { color: c.foreground }]}>موتورهای بومی</Text>
        <View style={styles.engineList}>
          {order.map((protocol, index) => {
            const up = connected(protocol, xray, states[protocol]);
            const status = protocol === 'v2ray' ? xray.state : states[protocol].status;
            const stateLabel = up ? 'متصل' : String(status).toLowerCase() === 'connecting' || xray.state === 'connecting' && protocol === 'v2ray' ? 'در حال اتصال' : 'آفلاین';
            return (
              <Card key={protocol} style={styles.engineRow}>
                <View style={[styles.engineIcon, { backgroundColor: up ? `${c.success}18` : c.secondary }]}>
                  <Feather name={protocol === 'v2ray' ? 'radio' : protocol === 'wireguard' ? 'activity' : protocol === 'openvpn' ? 'shield' : 'wind'} size={17} color={up ? c.success : c.mutedForeground} />
                </View>
                <View style={styles.engineCopy}>
                  <Text style={[styles.engineName, { color: c.foreground }]}>{labels[protocol]}</Text>
                  <Text style={[styles.engineHint, { color: c.mutedForeground }]}>{protocol === 'v2ray' ? 'sing-box' : 'موتور اندروید'}</Text>
                </View>
                <View style={[styles.stateTag, { backgroundColor: up ? `${c.success}15` : c.secondary }]}>
                  <View style={[styles.dot, { backgroundColor: up ? c.success : c.mutedForeground }]} />
                  <Text style={[styles.stateText, { color: up ? c.success : c.mutedForeground }]}>{stateLabel}</Text>
                </View>
                {index === 0 ? <View style={styles.hidden} /> : null}
              </Card>
            );
          })}
        </View>
        {report && !report.passed ? (
          <Card style={styles.report}>
            <Feather name="alert-triangle" size={17} color={c.warning} />
            <Text style={[styles.reportText, { color: c.foreground }]}>{report.endpoints.find((endpoint) => !endpoint.success)?.error ?? 'آزمون اینترنت ناموفق بود؛ اتصال موتور همچنان جداگانه نمایش داده می‌شود.'}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 23, paddingBottom: 40, gap: 17 },
  header: { gap: 6, alignItems: 'flex-end' },
  kicker: { fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1.5 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'right' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  hero: { minHeight: 176, borderRadius: 23, padding: 18, gap: 8 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  heroCaption: { fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1.4 },
  heroState: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'right', marginTop: 6 },
  heroDetail: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'flex-end', marginTop: 'auto' },
  heroFootText: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  checkCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  checkGlyph: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  checkCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  checkTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  checkDetail: { fontFamily: 'Inter_400Regular', fontSize: 9, lineHeight: 15, textAlign: 'right' },
  checkButton: { minHeight: 37, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10 },
  checkButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, textAlign: 'right', marginTop: 2 },
  engineList: { gap: 9 },
  engineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 17 },
  engineIcon: { width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  engineCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  engineName: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  engineHint: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  stateTag: { minHeight: 27, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  stateText: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  hidden: { display: 'none' },
  report: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  reportText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 17, textAlign: 'right' },
});
