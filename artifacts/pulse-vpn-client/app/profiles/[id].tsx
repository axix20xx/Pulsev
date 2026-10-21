import React from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useGetMobileDashboard, useListMobileSubscriptions } from '@workspace/api-client-react';
import { Card, InlineState, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useVpnPreferences, type VpnProtocol } from '@/hooks/VpnPreferences';
import { stopTunnelForProtocolSwitch } from '@/lib/vpn-engine';

const fa = (value: number | string) => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const labels = { active: 'فعال', expired: 'پایان‌یافته', cancelled: 'لغوشده', pending: 'در انتظار' };
const protocolRows: { id: VpnProtocol; title: string; detail: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'v2ray', title: 'V2Box', detail: 'سرویس سازگار با sing-box', icon: 'radio' },
  { id: 'openvpn', title: 'OpenVPN', detail: 'اتصال استاندارد و پایدار', icon: 'shield' },
  { id: 'wireguard', title: 'WireGuard', detail: 'اتصال سبک و مدرن', icon: 'activity' },
  { id: 'amneziawg', title: 'AmneziaWG', detail: 'پروفایل مبهم‌سازی اختصاصی', icon: 'wind' },
];

export default function ProfileDetail() {
  const c = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const subscriptions = useListMobileSubscriptions();
  const dashboard = useGetMobileDashboard();
  const prefs = useVpnPreferences();
  const items = subscriptions.data ?? dashboard.data?.subscriptions ?? [];
  const item = items.find((entry) => entry.id === id);
  if (subscriptions.isLoading && dashboard.isLoading) {
    return <Screen><View style={styles.loading}><View style={[styles.skeleton, { backgroundColor: c.muted }]} /><View style={[styles.skeleton, { backgroundColor: c.muted }]} /></View></Screen>;
  }
  if (subscriptions.isError && dashboard.isError) {
    return <Screen><InlineState title="اطلاعات دریافت نشد" detail="برای بازیابی جزئیات اشتراک اتصال را بررسی کنید." retry={() => { void subscriptions.refetch(); void dashboard.refetch(); }} /></Screen>;
  }
  if (!item) return <Screen><InlineState title="اشتراک پیدا نشد" detail="این اشتراک در حساب شما موجود نیست یا دسترسی آن تغییر کرده است." retry={() => router.replace('/(tabs)/profiles')} icon="search" /></Screen>;

  const availability: Record<VpnProtocol, boolean> = {
    v2ray: !!item.subscription_url,
    openvpn: item.openvpn_available,
    wireguard: item.wireguard_available,
    amneziawg: !!item.awg_url,
  };
  const openServers = (protocol: VpnProtocol) => {
    if (!availability[protocol]) return;
    void (async () => {
      try {
        await stopTunnelForProtocolSwitch(protocol);
        prefs.chooseSubscription(item.id);
        prefs.chooseProtocol(protocol);
        router.push(`/servers/${protocol}`);
      } catch (error) {
        // A failed handoff leaves the current VPN active and does not navigate
        // into a screen that would misleadingly imply the new protocol started.
        Alert.alert(
          'تغییر پروتکل انجام نشد',
          error instanceof Error ? error.message : 'اتصال قبلی قطع نشد؛ تونل جدید شروع نشد.',
          [{ text: 'متوجه شدم' }],
        );
      }
    })();
  };
  const usedPercent = Math.max(0, Math.min(100, item.usage_percent));
  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={subscriptions.isRefetching} onRefresh={() => void subscriptions.refetch()} tintColor={c.primary} />}>
        <Pressable accessibilityRole="button" testID="subscription-back" onPress={() => router.back()} style={styles.back}><Feather name="arrow-right" size={18} color={c.primary} /><Text style={[styles.backText, { color: c.primary }]}>بازگشت</Text></Pressable>
        <LinearGradient colors={[c.surfaceDeep, c.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.summaryHero}>
          <View style={styles.statusLine}>
            <View style={[styles.statusPill, { backgroundColor: `${c.onDeep}20` }]}>
              <View style={[styles.dot, { backgroundColor: item.status === 'active' ? c.success : c.warning }]} />
              <Text style={[styles.statusText, { color: c.onDeep }]}>{labels[item.status]}</Text>
            </View>
            <Text style={[styles.heroKicker, { color: `${c.onDeep}A6` }]}>اشتراک Pulse</Text>
          </View>
          <View style={styles.planHeading}>
            <Text style={[styles.planTitle, { color: c.onDeep }]}>{item.plan}</Text>
            <Text style={[styles.planProvider, { color: `${c.onDeep}C7` }]}>{item.provider_name}</Text>
          </View>
          <View style={styles.usageLabelRow}><Text style={[styles.muted, { color: `${c.onDeep}B8` }]}>مصرف‌شده از طرح</Text><Ltr style={[styles.usageValue, { color: c.onDeep }]}>{fa(item.used_gb)} / {fa(item.total_gb)} GB</Ltr></View>
          <View style={[styles.progress, { backgroundColor: `${c.onDeep}32` }]}><View style={[styles.progressFill, { width: `${usedPercent}%`, backgroundColor: c.onDeep }]} /></View>
          <View style={styles.metricGrid}>
            <View style={styles.metric}><Text style={[styles.muted, { color: `${c.onDeep}B8` }]}>باقی‌ماندهٔ حجم</Text><Ltr style={[styles.metricValue, { color: c.onDeep }]}>{fa(item.remaining_gb)} GB</Ltr></View>
            <View style={[styles.metricRule, { backgroundColor: `${c.onDeep}44` }]} />
            <View style={styles.metric}><Text style={[styles.muted, { color: `${c.onDeep}B8` }]}>روز باقی‌مانده</Text><Text style={[styles.metricValue, { color: c.onDeep }]}>{item.remaining_days == null ? '—' : fa(item.remaining_days)}</Text></View>
          </View>
        </LinearGradient>
        <Card style={styles.serviceInfo}>
          <View style={styles.infoHeading}>
            <View style={[styles.infoGlyph, { backgroundColor: c.secondary }]}><Feather name="hash" size={16} color={c.primary} /></View>
            <View style={{ flex: 1, alignItems: 'flex-end', gap: 3 }}>
              <Text style={[styles.infoTitle, { color: c.foreground }]}>شناسهٔ سرویس</Text>
              <Text style={[styles.muted, { color: c.mutedForeground }]}>مشخصات این اشتراک</Text>
            </View>
          </View>
          <View style={styles.infoRow}><Text style={[styles.muted, { color: c.mutedForeground }]}>کد سرویس</Text><Ltr style={[styles.infoValue, { color: c.foreground }]}>{item.service_code}</Ltr></View>
          <View style={styles.infoRow}><Text style={[styles.muted, { color: c.mutedForeground }]}>پایان اشتراک</Text><Text style={[styles.infoValue, { color: c.foreground }]}>{item.expires_at ? new Date(item.expires_at).toLocaleDateString('fa-IR') : 'ثبت نشده'}</Text></View>
        </Card>
        <View style={styles.sectionTitle}>
          <Text style={[styles.headTitle, { color: c.foreground }]}>روش‌های اتصال</Text>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>فقط پیکربندی واقعی همین اشتراک</Text>
        </View>
        {protocolRows.map((row, index) => {
          const available = availability[row.id];
          return (
            <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ disabled: !available }} disabled={!available} testID={`subscription-protocol-${row.id}`} onPress={() => openServers(row.id)} style={({ pressed }) => [{ opacity: !available ? 0.55 : pressed ? 0.82 : 1 }]}>
              <Card style={styles.protocolRow}>
                <View style={[styles.protocolIcon, { backgroundColor: available ? c.accent : c.secondary }]}><Feather name={row.icon} size={18} color={available ? c.primary : c.mutedForeground} /></View>
                <View style={styles.protocolCopy}>
                  <Text style={[styles.protocolTitle, { color: c.foreground }]}>{row.title}</Text>
                  <Text style={[styles.protocolDetail, { color: c.mutedForeground }]}>{available ? row.detail : 'برای این اشتراک ارائه نشده'}</Text>
                </View>
                {available ? <Feather name="chevron-left" size={17} color={c.primary} /> : <Feather name="minus" size={16} color={c.mutedForeground} />}
              </Card>
            </Pressable>
          );
        })}
        <Card style={styles.privacyNote}>
          <Feather name="lock" size={16} color={c.primary} />
          <Text style={[styles.noteText, { color: c.mutedForeground }]}>اطلاعات ورود، لینک خصوصی، کلیدها و فایل پیکربندی در صفحهٔ اشتراک نمایش داده نمی‌شوند.</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 42, gap: 13 },
  back: { alignSelf: 'flex-start', minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  summaryHero: { gap: 14, borderRadius: 25, padding: 18, overflow: 'hidden' },
  statusLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { minHeight: 27, paddingHorizontal: 10, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  heroKicker: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1 },
  planHeading: { alignItems: 'flex-end', gap: 4, paddingVertical: 2 },
  planTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'right' },
  planProvider: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  usageLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  muted: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  usageValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  progress: { height: 6, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  metricGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 2 },
  metric: { flex: 1, gap: 7, alignItems: 'center' },
  metricRule: { width: 1, height: 34 },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  infoValue: { fontFamily: 'Inter_500Medium', fontSize: 11, textAlign: 'right' },
  serviceInfo: { gap: 13, borderRadius: 21 },
  infoHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 1 },
  infoGlyph: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  sectionTitle: { gap: 4, alignItems: 'flex-end', marginTop: 6 },
  headTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  protocolRow: { minHeight: 70, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18 },
  protocolIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  protocolCopy: { flex: 1, gap: 5, alignItems: 'flex-end' },
  protocolTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  protocolDetail: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'right' },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  loading: { gap: 12 },
  skeleton: { height: 125, borderRadius: 20, opacity: 0.65 },
});
