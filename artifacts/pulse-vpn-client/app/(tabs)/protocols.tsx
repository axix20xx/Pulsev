import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetMobileDashboard } from '@workspace/api-client-react';
import { Card, Heading, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useVpnPreferences, type VpnProtocol } from '@/hooks/VpnPreferences';

const choices: { id: VpnProtocol; title: string; subtitle: string; icon: keyof typeof Feather.glyphMap; motif: string }[] = [
  { id: 'v2ray', title: 'V2Box', subtitle: 'اتصال منعطف با انتقال‌های سازگار sing-box', icon: 'radio', motif: '01 / FLEX' },
  { id: 'openvpn', title: 'OpenVPN', subtitle: 'پروتکل پایدار با سازگاری گسترده', icon: 'shield', motif: '02 / TRUST' },
  { id: 'wireguard', title: 'WireGuard', subtitle: 'سبک، سریع و مبتنی بر فناوری نو', icon: 'activity', motif: '03 / LIGHT' },
  { id: 'amneziawg', title: 'AmneziaWG', subtitle: 'ارتباط WireGuard با پیکربندی مبهم‌سازی', icon: 'wind', motif: '04 / PRIVATE' },
];

export default function ProtocolsScreen() {
  const c = useColors();
  const router = useRouter();
  const dashboard = useGetMobileDashboard();
  const prefs = useVpnPreferences();
  const subscriptions = (dashboard.data?.subscriptions ?? []).filter((item) => item.status === 'active' && Number(item.remaining_gb) > 0);
  const availability: Record<VpnProtocol, boolean> = {
    v2ray: subscriptions.some((item) => !!item.subscription_url),
    openvpn: subscriptions.some((item) => item.openvpn_available),
    wireguard: subscriptions.some((item) => item.wireguard_available),
    amneziawg: subscriptions.some((item) => !!item.awg_url),
  };
  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.kicker}><View style={[styles.kickerLine, { backgroundColor: c.primary }]} /><Text style={[styles.kickerText, { color: c.primary }]}>PULSE / ENGINE SELECT</Text></View>
        <Heading eyebrow="اتصال بر پایهٔ انتخاب شما" title="پروتکل‌ها" detail="پروتکل مورداعتماد خود را انتخاب کنید؛ تغییر انتخاب بدون تأیید شما انجام نمی‌شود." />
        <View style={styles.list}>
          {choices.map((item, index) => {
            const selected = prefs.protocol === item.id;
            const available = availability[item.id];
            return (
              <Pressable key={item.id} accessibilityRole="button" testID={`protocol-${item.id}`} onPress={() => {
                prefs.chooseProtocol(item.id);
                router.push(`/servers/${item.id}`);
              }}>
                <Card style={[styles.protocolCard, selected && { borderColor: c.primary, backgroundColor: c.accent }]}>
                  <View style={styles.row}>
                    <View style={[styles.iconFrame, { backgroundColor: selected ? c.primary : c.secondary, borderColor: selected ? c.primary : c.border }]}><Feather name={item.icon} size={20} color={selected ? c.primaryForeground : c.primary} /></View>
                    <View style={styles.copy}>
                      <View style={styles.titleLine}>
                        <Text style={[styles.title, { color: c.foreground }]}>{item.title}</Text>
                        <Text style={[styles.index, { color: c.mutedForeground }]}>{item.motif}</Text>
                      </View>
                      <Text style={[styles.description, { color: c.mutedForeground }]}>{item.subtitle}</Text>
                    </View>
                    <Feather name="chevron-left" size={18} color={c.mutedForeground} />
                  </View>
                  <View style={[styles.foot, { borderTopColor: c.border }]}>
                    <View style={styles.availability}>
                      <View style={[styles.dot, { backgroundColor: available ? c.success : c.mutedForeground }]} />
                      <Text style={[styles.availableText, { color: available ? c.success : c.mutedForeground }]}>{dashboard.isLoading ? 'در حال بررسی' : available ? 'پیکربندی موجود' : 'برای اشتراک‌های فعلی موجود نیست'}</Text>
                    </View>
                    {selected ? <Text style={[styles.selectedText, { color: c.primary }]}>انتخاب‌شده</Text> : null}
                  </View>
                  <View style={[styles.rail, { backgroundColor: index === 3 ? '#8074C9' : c.primary, opacity: selected ? 1 : 0.34 }]} />
                </Card>
              </Pressable>
            );
          })}
        </View>
        {dashboard.isError ? <Text style={[styles.note, { color: c.warning }]}>دسترسی‌پذیری سرورها هنوز از حساب دریافت نشده است. برای تازه‌سازی، صفحهٔ خانه را پایین بکشید.</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 34, gap: 14 },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 },
  kickerLine: { height: 2, width: 25 },
  kickerText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.5 },
  list: { gap: 12 },
  protocolCard: { padding: 17, gap: 14, overflow: 'hidden', borderRadius: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconFrame: { width: 46, height: 46, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 5 },
  titleLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  index: { fontFamily: 'Inter_500Medium', fontSize: 9, letterSpacing: 1 },
  description: { textAlign: 'right', fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 19 },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  availability: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  availableText: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  selectedText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  rail: { position: 'absolute', left: 0, top: 15, bottom: 15, width: 2 },
  note: { textAlign: 'right', fontSize: 12, lineHeight: 20, fontFamily: 'Inter_400Regular' },
});
