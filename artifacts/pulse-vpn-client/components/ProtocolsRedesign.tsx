import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetMobileDashboard } from '@workspace/api-client-react';
import { Card, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useVpnPreferences, type VpnProtocol } from '@/hooks/VpnPreferences';

const items: { id: VpnProtocol; name: string; description: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'v2ray', name: 'V2Box', description: 'VLESS · VMess · Trojan · SS · Hysteria 2', icon: 'radio' },
  { id: 'wireguard', name: 'WireGuard', description: 'تونل سبک با کلیدهای اختصاصی', icon: 'activity' },
  { id: 'openvpn', name: 'OpenVPN', description: 'اتصال سازگار با سرویس‌های رایج', icon: 'shield' },
  { id: 'amneziawg', name: 'AmneziaWG', description: 'پیکربندی اختصاصی Amnezia', icon: 'wind' },
];

export default function ProtocolsRedesign() {
  const c = useColors();
  const router = useRouter();
  const prefs = useVpnPreferences();
  const dashboard = useGetMobileDashboard();
  const active = (dashboard.data?.subscriptions ?? []).filter((item) => item.status === 'active' && Number(item.remaining_gb) > 0);
  const available: Record<VpnProtocol, boolean> = {
    v2ray: active.some((item) => !!item.subscription_url),
    wireguard: active.some((item) => item.wireguard_available),
    openvpn: active.some((item) => item.openvpn_available),
    amneziawg: active.some((item) => !!item.awg_url),
  };

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <View style={[styles.headerIcon, { backgroundColor: c.accent }]}><Feather name="radio" size={19} color={c.primary} /></View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.kicker, { color: c.primary }]}>TUNNEL ENGINES · SELECT YOUR ROUTE</Text>
            <Text style={[styles.title, { color: c.foreground }]}>مسیر اتصال</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>پروتکل موجود را انتخاب کنید. هیچ سرویسی بدون انتخاب شما آغاز نمی‌شود.</Text>
          </View>
        </View>
        <View style={[styles.summary, { backgroundColor: c.surfaceDeep }]}>
          <Feather name="lock" size={16} color="#FFFFFF" />
          <Text style={[styles.summaryText, { color: c.onDeep }]}>{dashboard.isLoading ? 'در حال بررسی دسترسی حساب…' : `${active.length} اشتراک فعال · موتورهای آماده بر اساس پروفایل واقعی شما`}</Text>
        </View>
        <View style={styles.grid}>
          {items.map((item, index) => {
            const chosen = prefs.protocol === item.id;
            const enabled = available[item.id];
            const accent = item.id === 'wireguard' ? c.success
              : item.id === 'openvpn' ? c.warning
                : item.id === 'amneziawg' ? c.secondaryForeground : c.primary;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen, disabled: !enabled }}
                testID={`protocol-${item.id}`}
                disabled={!enabled}
                onPress={() => {
                  prefs.chooseProtocol(item.id);
                  router.push(`/servers/${item.id}`);
                }}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: c.card,
                    borderColor: chosen ? accent : c.border,
                    opacity: !enabled ? 0.55 : pressed ? 0.8 : 1,
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                  },
                ]}
              >
                <View style={styles.tileTop}>
                  <View style={[styles.index, { backgroundColor: `${accent}16` }]}>
                    <Text style={[styles.indexText, { color: accent }]}>0{index + 1}</Text>
                  </View>
                  <View style={[styles.icon, { backgroundColor: `${accent}14` }]}>
                    <Feather name={item.icon} size={20} color={accent} />
                  </View>
                </View>
                <Text style={[styles.name, { color: c.foreground }]}>{item.name}</Text>
                <Text style={[styles.description, { color: c.mutedForeground }]}>{item.description}</Text>
                <View style={[styles.tileFoot, { borderTopColor: c.border }]}>
                  <View style={[styles.availabilityDot, { backgroundColor: enabled ? c.success : c.mutedForeground }]} />
                  <Text style={[styles.availability, { color: enabled ? c.success : c.mutedForeground }]}>
                    {dashboard.isLoading ? 'در حال بررسی' : enabled ? 'سرور در دسترس است' : 'برای اشتراک موجود نیست'}
                  </Text>
                  <Feather name={chosen ? 'check-circle' : 'arrow-up-left'} size={16} color={chosen ? accent : c.mutedForeground} />
                </View>
              </Pressable>
            );
          })}
        </View>
        {dashboard.isLoading ? <Card style={styles.loading}><ActivityIndicator color={c.primary} /><Text style={[styles.subtitle, { color: c.mutedForeground }]}>در حال بارگذاری حساب</Text></Card> : null}
        {dashboard.isError ? (
          <Card style={styles.loading}>
            <Feather name="wifi-off" size={19} color={c.warning} />
            <Text style={[styles.subtitle, { color: c.foreground }]}>دسترسی اشتراک دریافت نشد. اینترنت را بررسی و دوباره تلاش کنید.</Text>
            <Pressable accessibilityRole="button" testID="retry-protocols" onPress={() => void dashboard.refetch()}><Text style={[styles.retry, { color: c.primary }]}>تلاش دوباره</Text></Pressable>
          </Card>
        ) : null}
        <Text style={[styles.footnote, { color: c.mutedForeground }]}>وضعیت «تونل فعال» و نتیجهٔ آزمون اینترنت در برنامه جداگانه نمایش داده می‌شوند.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 38, gap: 19 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  headerIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1.1, textAlign: 'right' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'right' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  summary: { minHeight: 48, paddingHorizontal: 13, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 9 },
  summaryText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 10, textAlign: 'right', lineHeight: 17 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  tile: { width: '48.4%', minHeight: 198, borderRadius: 22, borderWidth: 1, padding: 14, gap: 9 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  index: { minWidth: 32, height: 25, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  indexText: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  icon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: 'Inter_700Bold', fontSize: 15, textAlign: 'right', marginTop: 2 },
  description: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'right', lineHeight: 16, minHeight: 31 },
  tileFoot: { marginTop: 'auto', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  availabilityDot: { width: 6, height: 6, borderRadius: 3 },
  availability: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 9, textAlign: 'right' },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  retry: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  footnote: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 18, textAlign: 'center', marginTop: 2 },
});
