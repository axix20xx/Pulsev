import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import { Card, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import {
  getAmneziaWgStatus, getOpenVpnStatus, getWireGuardStatus, testTunnelConnectivity,
  type TunnelConnectivityReport, type WireGuardVpnStatus,
} from '@/lib/vpn-engine';
import type { VpnProtocol } from '@/hooks/VpnPreferences';
import { findActiveTunnelProtocol, isTunnelConnected, isTunnelConnecting } from '@/lib/tunnel-state';

const empty: WireGuardVpnStatus = { status: 'UNKNOWN', tunnelState: 'UNKNOWN', isConnected: false };
const labels: Partial<Record<VpnProtocol, string>> = { openvpn: 'OpenVPN', wireguard: 'WireGuard', amneziawg: 'AmneziaWG' };
const order: VpnProtocol[] = ['wireguard', 'openvpn', 'amneziawg'];
const fa = (value: string | number) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

export default function ActivityRedesign() {
  const c = useColors();
  const isFocused = useIsFocused();
  const [openvpn, setOpenvpn] = useState(empty);
  const [wireguard, setWireguard] = useState(empty);
  const [amnezia, setAmnezia] = useState(empty);
  const [report, setReport] = useState<TunnelConnectivityReport | null>(null);
  const [reportIdentity, setReportIdentity] = useState<string | null>(null);
  const [reportError, setReportError] = useState('');
  const [checking, setChecking] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const states = { openvpn, wireguard, amneziawg: amnezia } as unknown as Record<VpnProtocol, WireGuardVpnStatus>;
  const activeProtocol = findActiveTunnelProtocol(order, states);
  const activeStatus = activeProtocol ? states[activeProtocol] ?? empty : null;
  const activeIdentity = activeProtocol && activeStatus
    ? JSON.stringify([activeProtocol, activeStatus.profileId ?? null, activeStatus.profileName ?? null])
    : null;
  const activeIdentityRef = useRef(activeIdentity);
  const pollInFlightRef = useRef(false);
  activeIdentityRef.current = activeIdentity;
  const activeReport = reportIdentity === activeIdentity ? report : null;

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (disposed || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const [o, w, a] = await Promise.all([
          getOpenVpnStatus().catch(() => empty),
          getWireGuardStatus().catch(() => empty),
          getAmneziaWgStatus().catch(() => empty),
        ]);
        if (disposed) return;
        setOpenvpn(o); setWireguard(w); setAmnezia(a);
        setStatusReady(true);
      } finally {
        pollInFlightRef.current = false;
      }
    };
    if (isFocused) {
      setStatusReady(false);
      void refresh();
    }
    const timer = isFocused ? setInterval(() => void refresh(), 3000) : null;
    return () => { disposed = true; if (timer) clearInterval(timer); };
  }, [isFocused]);

  useEffect(() => {
    setReport(null);
    setReportIdentity(null);
    setReportError('');
  }, [activeIdentity]);

  const checkInternet = async () => {
    if (checking || !activeProtocol) return;
    const identityAtStart = activeIdentityRef.current;
    setChecking(true);
    setReportError('');
    try {
      const result = await testTunnelConnectivity();
      if (identityAtStart === activeIdentityRef.current) {
        setReport(result);
        setReportIdentity(identityAtStart);
      }
    } catch {
      if (identityAtStart === activeIdentityRef.current) {
        setReport(null);
        setReportError('آزمون اینترنت انجام نشد. اتصال را بررسی و دوباره تلاش کنید.');
      }
    }
    finally { setChecking(false); }
  };

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Text style={[styles.kicker, { color: c.primary }]}>گزارش زندهٔ اتصال</Text>
          <Text style={[styles.title, { color: c.foreground }]}>وضعیت زنده</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>به‌سادگی می‌بینید اتصال برقرار است و اینترنت از مسیر امن کار می‌کند.</Text>
        </View>
        <View style={[styles.hero, { backgroundColor: c.surfaceDeep }]}>
          <View style={styles.heroTop}>
          <View style={[styles.heroIcon, { backgroundColor: activeProtocol ? c.success : `${c.onDeep}1B` }]}>
              <Feather name={activeProtocol ? 'shield' : 'activity'} size={20} color={c.onDeep} />
            </View>
            <Text style={styles.heroCaption}>اتصال Pulse</Text>
          </View>
            <Text style={[styles.heroState, { color: c.onDeep }]}>{statusReady ? activeProtocol ? 'اتصال امن برقرار است' : 'اتصال فعالی نیست' : 'در حال بررسی وضعیت'}</Text>
            <Text style={[styles.heroDetail, { color: `${c.onDeep}B8` }]}>{!statusReady ? 'چند لحظه صبر کنید.' : activeProtocol ? labels[activeProtocol] : 'برای شروع، از صفحهٔ خانه یک اتصال انتخاب کنید.'}</Text>
          <View style={styles.heroFoot}>
            <View style={[styles.dot, { backgroundColor: activeProtocol ? c.success : c.mutedForeground }]} />
            <Text style={[styles.heroFootText, { color: `${c.onDeep}D8` }]}>{!statusReady ? 'در حال دریافت وضعیت' : activeProtocol ? 'اتصال برقرار است' : 'هنوز وصل نشده‌اید'}</Text>
          </View>
        </View>

        <Card style={styles.checkCard}>
          <View style={[styles.checkGlyph, { backgroundColor: c.accent }]}><Feather name="globe" size={18} color={c.primary} /></View>
          <View style={styles.checkCopy}>
              <Text style={[styles.checkTitle, { color: c.foreground }]}>بررسی اینترنت</Text>
            <Text style={[styles.checkDetail, { color: c.mutedForeground }]}>
              {reportError || (activeReport
                ? activeReport.passed ? `اتصال اینترنت بررسی شد · ${fa(new Date(activeReport.testedAt).toLocaleTimeString())}` : 'اتصال برقرار است، اما اینترنت پاسخ نداد.'
                : 'بررسی می‌کنیم اینترنت از مسیر امن در دسترس باشد.')}
            </Text>
          </View>
          <Pressable accessibilityRole="button" testID="run-tunnel-check" disabled={!statusReady || !activeProtocol || checking} onPress={() => void checkInternet()} style={[styles.checkButton, { backgroundColor: c.primary, opacity: !statusReady || !activeProtocol || checking ? 0.5 : 1 }]}>
            {checking ? <ActivityIndicator color={c.primaryForeground} size="small" /> : <Feather name="play" size={15} color={c.primaryForeground} />}
            <Text style={[styles.checkButtonText, { color: c.primaryForeground }]}>{!statusReady ? 'در حال دریافت' : checking ? 'در حال بررسی' : 'بررسی'}</Text>
          </Pressable>
        </Card>

        <Text style={[styles.sectionTitle, { color: c.foreground }]}>موتورهای بومی</Text>
        <View style={styles.engineList}>
        {order.map((protocol) => {
            const up = isTunnelConnected(protocol, states[protocol]);
            const connecting = isTunnelConnecting(protocol, states[protocol]);
            const stateLabel = up ? 'متصل' : connecting ? 'در حال اتصال' : 'قطع';
            return (
              <Card key={protocol} style={styles.engineRow}>
                <View style={[styles.engineIcon, { backgroundColor: up ? `${c.success}18` : c.secondary }]}>
                  <Feather name={protocol === 'wireguard' ? 'activity' : protocol === 'openvpn' ? 'shield' : 'wind'} size={17} color={up ? c.success : c.mutedForeground} />
                </View>
                <View style={styles.engineCopy}>
                  <Text style={[styles.engineName, { color: c.foreground }]}>{labels[protocol] ?? protocol}</Text>
                  <Text style={[styles.engineHint, { color: c.mutedForeground }]}>وضعیت لحظه‌ای</Text>
                </View>
                <View style={[styles.stateTag, { backgroundColor: up ? `${c.success}15` : c.secondary }]}>
                  <View style={[styles.dot, { backgroundColor: up ? c.success : c.mutedForeground }]} />
                  {statusReady ? <Text style={[styles.stateText, { color: up ? c.success : c.mutedForeground }]}>{stateLabel}</Text> : <View style={[styles.statusSkeleton, { backgroundColor: c.muted }]} />}
                </View>
              </Card>
            );
          })}
        </View>
        {activeReport && !activeReport.passed ? (
          <Card style={styles.report}>
            <Feather name="alert-triangle" size={17} color={c.warning} />
            <Text style={[styles.reportText, { color: c.foreground }]}>آزمون اینترنت پاسخ نگرفت؛ وضعیت تونل همچنان از موتور دستگاه گزارش می‌شود.</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 18 },
  header: { gap: 6, alignItems: 'flex-end' },
  kicker: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'right' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 21, textAlign: 'right' },
  hero: { minHeight: 182, borderRadius: 27, padding: 19, gap: 9 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  heroCaption: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  heroState: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'right', marginTop: 6 },
  heroDetail: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'flex-end', marginTop: 'auto' },
  heroFootText: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  checkCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  checkGlyph: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  checkCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  checkTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  checkDetail: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 17, textAlign: 'right' },
  checkButton: { minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10 },
  checkButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, textAlign: 'right', marginTop: 2 },
  engineList: { gap: 9 },
  engineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 17 },
  engineIcon: { width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  engineCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  engineName: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  engineHint: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  stateTag: { minHeight: 27, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  stateText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  statusSkeleton: { width: 44, height: 8, borderRadius: 4 },
  hidden: { display: 'none' },
  report: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  reportText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 19, textAlign: 'right', flexShrink: 1 },
});
