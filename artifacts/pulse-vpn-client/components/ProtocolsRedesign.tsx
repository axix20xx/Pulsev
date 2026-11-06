import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetMobileDashboard } from '@workspace/api-client-react';
import { Card, InlineState, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useVpnPreferences, type AvailableVpnProtocol } from '@/hooks/VpnPreferences';
import { stopTunnelForProtocolSwitch } from '@/lib/vpn-engine';

const items: { id: AvailableVpnProtocol; name: string; description: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'wireguard', name: 'WireGuard', description: 'تونل سبک با کلیدهای اختصاصی', icon: 'activity' },
  { id: 'openvpn', name: 'OpenVPN', description: 'اتصال استاندارد و سازگار', icon: 'shield' },
  { id: 'amneziawg', name: 'AmneziaWG', description: 'پروفایل اختصاصی Amnezia', icon: 'wind' },
];
const supported = (s: { subscription_url?: string | null; openvpn_available?: boolean; wireguard_available?: boolean; awg_url?: string | null }, p: AvailableVpnProtocol) =>
  p === 'openvpn' ? !!s.openvpn_available : p === 'wireguard' ? !!s.wireguard_available : !!s.awg_url;

export default function ProtocolsRedesign() {
  const c = useColors();
  const router = useRouter();
  const prefs = useVpnPreferences();
  const dashboard = useGetMobileDashboard();
  const [switchingProtocol, setSwitchingProtocol] = useState<AvailableVpnProtocol | null>(null);
  const eligible = (dashboard.data?.subscriptions ?? []).filter((s) => s.status === 'active' && Number(s.remaining_gb) > 0);
  const selected = eligible.find((s) => s.id === prefs.subscriptionId);
  const available = selected ? items.filter((item) => supported(selected, item.id)) : [];

  const chooseSubscription = (id: string) => {
    const subscription = eligible.find((entry) => entry.id === id);
    if (subscription) prefs.chooseSubscription(subscription.id);
  };
  const openProtocol = async (protocol: AvailableVpnProtocol) => {
    if (!selected || !supported(selected, protocol) || switchingProtocol) return;
    setSwitchingProtocol(protocol);
    try {
      await stopTunnelForProtocolSwitch(protocol);
      prefs.chooseSubscription(selected.id);
      prefs.chooseProtocol(protocol);
      router.push(`/servers/${protocol}`);
    } catch (error) {
      Alert.alert('تغییر مسیر انجام نشد', error instanceof Error ? error.message : 'اتصال قبلی قطع نشد؛ تونل جدید شروع نشد.', [{ text: 'متوجه شدم' }]);
    } finally { setSwitchingProtocol(null); }
  };

  if (dashboard.isError) return <Screen><InlineState title="اطلاعات اشتراک دریافت نشد" detail="اتصال را بررسی کنید و دوباره تلاش کنید." retry={() => void dashboard.refetch()} /></Screen>;

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <View style={[styles.headerIcon, { backgroundColor: c.accent }]}><Feather name="radio" size={19} color={c.primary} /></View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.kicker, { color: c.primary }]}>پیکربندی اشتراک</Text>
            <Text style={[styles.title, { color: c.foreground }]}>پروتکل‌ها</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>هر مسیر از تنظیمات واقعی اشتراک انتخابی شما می‌آید.</Text>
          </View>
        </View>
        <View style={[styles.stepHead, { borderBottomColor: c.border }]}>
          <View style={styles.stepLabel}><Text style={[styles.stepNum, { color: c.primary }]}>۰۱</Text><Text style={[styles.sectionTitle, { color: c.foreground }]}>اشتراک مورد استفاده</Text></View>
          <Pressable accessibilityRole="button" testID="protocols-manage-subscriptions" onPress={() => router.push('/(tabs)/profiles')}><Text style={[styles.link, { color: c.primary }]}>مدیریت</Text></Pressable>
        </View>
        {dashboard.isLoading ? <Card style={styles.loadingCard}>
          <View style={[styles.loadingBar, { backgroundColor: c.muted, width: '48%' }]} />
          <View style={[styles.loadingBar, { backgroundColor: c.muted, width: '74%' }]} />
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>در حال دریافت اشتراک‌ها…</Text>
        </Card> : null}
        {!dashboard.isLoading && eligible.length > 1 ? <View style={styles.subscriptionList}>
          {eligible.map((subscription) => {
            const chosen = selected?.id === subscription.id;
            return <Pressable key={subscription.id} accessibilityRole="radio" accessibilityState={{ selected: chosen }} testID={`protocol-subscription-${subscription.id}`} onPress={() => chooseSubscription(subscription.id)}>
              <Card style={[styles.subscriptionCard, chosen && { backgroundColor: c.accent, borderColor: c.primary }]}>
                <View style={[styles.subscriptionIcon, { backgroundColor: chosen ? c.primary : c.secondary }]}><Feather name={chosen ? 'check' : 'layers'} size={16} color={chosen ? c.primaryForeground : c.mutedForeground} /></View>
                <View style={styles.subscriptionCopy}><Text style={[styles.subscriptionName, { color: c.foreground }]} numberOfLines={1}>{subscription.plan}</Text><Text style={[styles.subscriptionMeta, { color: c.mutedForeground }]} numberOfLines={1}>{subscription.provider_name}</Text></View>
                <Text style={[styles.remaining, { color: c.foreground }]}>{subscription.remaining_gb} GB</Text>
                <Feather name={chosen ? 'check-circle' : 'circle'} size={18} color={chosen ? c.primary : c.border} />
              </Card>
            </Pressable>;
          })}
        </View> : null}
        {!dashboard.isLoading && eligible.length === 1 ? <Pressable accessibilityRole="radio" accessibilityState={{ selected: selected?.id === eligible[0].id }} testID={`protocol-subscription-${eligible[0].id}`} onPress={() => chooseSubscription(eligible[0].id)}>
          <Card style={[styles.subscriptionCard, selected && { backgroundColor: c.accent, borderColor: c.primary }]}>
            <View style={[styles.subscriptionIcon, { backgroundColor: selected ? c.primary : c.secondary }]}><Feather name={selected ? 'check' : 'layers'} size={16} color={selected ? c.primaryForeground : c.primary} /></View>
            <View style={styles.subscriptionCopy}><Text style={[styles.subscriptionName, { color: c.foreground }]}>{eligible[0].plan}</Text><Text style={[styles.subscriptionMeta, { color: c.mutedForeground }]}>{eligible[0].provider_name} · فعال</Text></View>
            <Text style={[styles.remaining, { color: c.foreground }]}>{eligible[0].remaining_gb} GB</Text>
            {selected ? <Feather name="check-circle" size={18} color={c.primary} /> : <Text style={[styles.link, { color: c.primary }]}>انتخاب</Text>}
          </Card>
        </Pressable> : null}
        {!dashboard.isLoading && eligible.length === 0 ? <Card style={styles.empty}>
          <Feather name="layers" size={22} color={c.primary} />
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>اشتراک فعالی نیست</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>ابتدا یک اشتراک فعال و دارای حجم به حساب اضافه کنید.</Text>
          <Pressable accessibilityRole="button" testID="protocols-open-profiles" onPress={() => router.push('/(tabs)/profiles')}><Text style={[styles.link, { color: c.primary }]}>دیدن اشتراک‌ها</Text></Pressable>
        </Card> : null}

        {selected ? <>
          <View style={styles.stepHead}>
            <View style={styles.stepLabel}><Text style={[styles.stepNum, { color: c.primary }]}>۰۲</Text><Text style={[styles.sectionTitle, { color: c.foreground }]}>مسیرهای این اشتراک</Text></View>
            <Text style={[styles.context, { color: c.mutedForeground }]} numberOfLines={1}>{selected.plan}</Text>
          </View>
          {available.length ? <View style={styles.protocolList}>
            {available.map((item, index) => {
              const chosen = prefs.protocol === item.id;
              return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: chosen, busy: switchingProtocol === item.id }} testID={`protocol-${item.id}`} disabled={!!switchingProtocol}
                onPress={() => void openProtocol(item.id)} style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}>
                <Card style={[styles.protocolCard, chosen && { borderColor: c.primary }]}>
                  <View style={styles.protocolTop}>
                    <View style={[styles.index, { backgroundColor: c.secondary }]}><Text style={[styles.indexText, { color: c.primary }]}>۰{index + 1}</Text></View>
                    <View style={[styles.protocolIcon, { backgroundColor: chosen ? c.primary : c.accent }]}>{switchingProtocol === item.id ? <ActivityIndicator color={c.primaryForeground} size="small" /> : <Feather name={item.icon} size={20} color={chosen ? c.primaryForeground : c.primary} />}</View>
                  </View>
                  <Text style={[styles.protocolName, { color: c.foreground }]}>{item.name}</Text>
                  <Text style={[styles.protocolDescription, { color: c.mutedForeground }]}>{item.description}</Text>
                  <View style={[styles.protocolFoot, { borderTopColor: c.border }]}>
                    <Text style={[styles.availability, { color: c.success }]}>{switchingProtocol === item.id ? 'در حال توقف تونل قبلی…' : chosen ? 'آخرین مسیر انتخاب‌شده' : 'آمادهٔ انتخاب'}</Text>
                    <Feather name={chosen ? 'check-circle' : 'arrow-up-left'} size={16} color={chosen ? c.primary : c.mutedForeground} />
                  </View>
                </Card>
              </Pressable>;
            })}
          </View> : <Card style={styles.empty}><Feather name="radio" size={22} color={c.mutedForeground} /><Text style={[styles.sectionTitle, { color: c.foreground }]}>پروتکلی برای این اشتراک ارائه نشده</Text><Text style={[styles.subtitle, { color: c.mutedForeground }]}>اشتراک دیگری انتخاب کنید یا جزئیات سرویس را بررسی کنید.</Text></Card>}
        </> : eligible.length > 1 ? <Card style={styles.prompt}>
          <View style={[styles.promptIcon, { backgroundColor: c.secondary }]}><Feather name="arrow-up" size={17} color={c.primary} /></View>
          <View style={styles.promptCopy}><Text style={[styles.sectionTitle, { color: c.foreground }]}>ابتدا اشتراک را انتخاب کنید</Text><Text style={[styles.subtitle, { color: c.mutedForeground }]}>تا انتخاب اشتراک، هیچ پروتکلی نمایش داده نمی‌شود.</Text></View>
        </Card> : null}
        <Text style={[styles.footnote, { color: c.mutedForeground }]}>انتخاب پروتکل، سرورهای واقعی همان اشتراک را باز می‌کند. تونل فقط پس از انتخاب سرور آغاز می‌شود.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 34, gap: 15 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  headerIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, textAlign: 'right' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  stepHead: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  stepLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  subscriptionList: { gap: 8 },
  subscriptionCard: { minHeight: 61, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 18 },
  subscriptionIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  subscriptionCopy: { flex: 1, gap: 3, alignItems: 'flex-end' },
  subscriptionName: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  subscriptionMeta: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  remaining: { fontFamily: 'Inter_600SemiBold', fontSize: 10, writingDirection: 'ltr' },
  loadingCard: { minHeight: 88, alignItems: 'flex-end', justifyContent: 'center', gap: 10 },
  loadingBar: { height: 10, borderRadius: 6 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  promptIcon: { width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  promptCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  context: { maxWidth: '42%', fontFamily: 'Inter_500Medium', fontSize: 9, textAlign: 'right' },
  protocolList: { gap: 11 },
  protocolCard: { minHeight: 154, borderRadius: 21, padding: 14, gap: 8 },
  protocolTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  index: { minWidth: 30, height: 24, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  indexText: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  protocolIcon: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  protocolName: { fontFamily: 'Inter_700Bold', fontSize: 14, textAlign: 'right' },
  protocolDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 19, textAlign: 'right' },
  protocolFoot: { marginTop: 'auto', paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  availability: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  footnote: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 2 },
});
