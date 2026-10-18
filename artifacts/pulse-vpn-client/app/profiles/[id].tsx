import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  useDownloadAmneziaWgConfig,
  useGetIpsecAccount,
  useGetMobileDashboard,
  useGetOpenVpnAccount,
  useGetPublicSubscriptionFeed,
  useGetWireGuardAccount,
  useListMobileSubscriptions,
} from '@workspace/api-client-react';
import { Card, Heading, InlineState, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

function privateToken(value: string | null): string {
  if (!value) return '';
  try {
    const path = new URL(value).pathname.split('/').filter(Boolean);
    return path[path.length - 1] ?? '';
  } catch {
    return value.split('/').filter(Boolean).pop() ?? '';
  }
}

export default function ProfileDetail() {
  const c = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const subscriptions = useListMobileSubscriptions();
  const dashboard = useGetMobileDashboard();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const item = (subscriptions.data ?? dashboard.data?.subscriptions ?? []).find((subscription) => subscription.id === id);
  const token = privateToken(item?.subscription_url ?? null);
  const openVpn = useGetOpenVpnAccount(token, { query: { enabled: !!token && !!item?.openvpn_available, queryKey: ['/mobile-profile', token, 'openvpn'] } });
  const wireguard = useGetWireGuardAccount(token, { query: { enabled: !!token && !!item?.wireguard_available, queryKey: ['/mobile-profile', token, 'wireguard'] } });
  const ipsec = useGetIpsecAccount(token, { query: { enabled: !!token && !!item?.ipsec_available, queryKey: ['/mobile-profile', token, 'ipsec'] } });
  const amnezia = useDownloadAmneziaWgConfig(token, { query: { enabled: !!token && !!item?.awg_url, queryKey: ['/mobile-profile', token, 'amneziawg'] } });
  const subscriptionFeed = useGetPublicSubscriptionFeed(token, { query: { enabled: !!token && !!item?.subscription_url, queryKey: ['/mobile-profile', token, 'subscription-feed'] } });
  const [expanded, setExpanded] = useState<string | null>(null);

  if (subscriptions.isLoading && dashboard.isLoading) return <Screen><View style={styles.loading}><ActivityIndicator color={c.primary} /><Text style={{ color: c.mutedForeground }}>در حال دریافت اطلاعات…</Text></View></Screen>;
  if (subscriptions.isError && dashboard.isError) return <Screen><InlineState title="اطلاعات دریافت نشد" detail="برای بازیابی جزئیات پروفایل، اتصال را بررسی کنید." retry={() => { subscriptions.refetch(); dashboard.refetch(); }} /></Screen>;
  if (!item) return <Screen><InlineState title="اشتراک پیدا نشد" detail="این اشتراک در حساب شما موجود نیست یا دسترسی آن تغییر کرده است." retry={() => router.replace('/(tabs)/profiles')} icon="search" /></Screen>;

  const protocols = [
    { key: 'openvpn', name: 'OpenVPN', available: item.openvpn_available, result: openVpn.data, error: openVpn.error, loading: openVpn.isLoading, rows: openVpn.data ? [
      ['سرور', openVpn.data.server], ['نام کاربری', openVpn.data.username],
      ...openVpn.data.locations.map((location) => [`موقعیت · ${location.name}`, location.config_url]),
    ] : [] },
    { key: 'wireguard', name: 'WireGuard', available: item.wireguard_available, result: wireguard.data, error: wireguard.error, loading: wireguard.isLoading, rows: wireguard.data ? [
      ['نام کاربری', wireguard.data.username],
      ...wireguard.data.locations.map((location) => [`موقعیت · ${location.name}`, location.config_url]),
    ] : [] },
    { key: 'ipsec', name: 'IPsec / IKEv2', available: item.ipsec_available, result: ipsec.data, error: ipsec.error, loading: ipsec.isLoading, rows: ipsec.data ? [
      ['شناسه ورود', ipsec.data.login], ['نام کاربری', ipsec.data.username], ['رمز عبور', ipsec.data.password],
      ...ipsec.data.locations.map((location) => [`موقعیت · ${location.name}`, `${location.server} · ${location.ikev2_remote_id}`]),
    ] : [] },
    { key: 'amneziawg', name: 'AmneziaWG', available: !!item.awg_url, result: amnezia.data, error: amnezia.error, loading: amnezia.isLoading, rows: amnezia.data ? [
      ['وضعیت پیکربندی', 'پروفایل برای این اشتراک دریافت شد'],
      ['اندازهٔ پیکربندی', `${amnezia.data.length} نویسه`],
    ] : [] },
    { key: 'v2ray', name: 'فید سازگار با V2Box', available: !!item.subscription_url, result: subscriptionFeed.data, error: subscriptionFeed.error, loading: subscriptionFeed.isLoading, rows: subscriptionFeed.data ? [
      ['نشانی اشتراک', item.subscription_url ?? '—'],
      ['تعداد خطوط فید', String(subscriptionFeed.data.split(/\r?\n/).filter(Boolean).length)],
    ] : [] },
  ];

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.back}><Feather name="arrow-right" size={19} color={c.primary} /><Text style={[styles.backText, { color: c.primary }]}>بازگشت</Text></Pressable>
        <Heading eyebrow="جزئیات اشتراک" title={item.plan} detail={item.provider_name} />
        <Card style={styles.subscriptionCard}>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>وضعیت</Text><Text style={[styles.detailValue, { color: item.status === 'active' ? c.success : c.warning }]}>{({ active: 'فعال', expired: 'پایان‌یافته', cancelled: 'لغوشده', pending: 'در انتظار' }[item.status])}</Text></View>
          <View style={[styles.rule, { backgroundColor: c.border }]} />
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>کد سرویس</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.service_code}</Ltr></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>نام کاربری</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.username ?? '—'}</Ltr></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>دادهٔ باقیمانده</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.remaining_gb} GB</Ltr></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: c.mutedForeground }]}>تاریخ پایان</Text><Ltr style={[styles.detailValue, { color: c.foreground }]}>{item.expires_at ?? '—'}</Ltr></View>
        </Card>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>پروفایل‌های موجود</Text>
          <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>جزئیات زیر از حساب سرویس خوانده می‌شود. اتصال VPN از داخل این برنامه هنوز در دسترس نیست.</Text>
        </View>
        {!token ? <InlineState title="دسترسی پروفایل موجود نیست" detail="نشانی خصوصی این اشتراک در داده‌های حساب ثبت نشده است." icon="lock" /> : null}
        {protocols.map((protocol) => (
          <Card key={protocol.key} style={{ padding: 0, overflow: 'hidden' }}>
            <Pressable accessibilityRole="button" onPress={() => setExpanded(expanded === protocol.key ? null : protocol.key)} style={styles.protocolHeader}>
              <View style={[styles.protocolIcon, { backgroundColor: protocol.available ? c.accent : c.secondary }]}><Feather name={protocol.available ? 'shield' : 'minus-circle'} size={18} color={protocol.available ? c.primary : c.mutedForeground} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.protocolTitle, { color: c.foreground }]}>{protocol.name}</Text>
                <Text style={[styles.protocolState, { color: protocol.available ? c.success : c.mutedForeground }]}>{protocol.available ? 'در دسترس برای مشاهده' : 'برای این اشتراک ارائه نشده'}</Text>
              </View>
              <Feather name={expanded === protocol.key ? 'chevron-up' : 'chevron-down'} size={17} color={c.mutedForeground} />
            </Pressable>
            {expanded === protocol.key && protocol.available ? (
              <View style={[styles.protocolBody, { borderTopColor: c.border }]}>
                {protocol.loading ? <ActivityIndicator color={c.primary} /> : null}
                {protocol.error ? (
                  <View style={styles.fetchFailed}>
                    <Text style={[styles.fetchError, { color: c.destructive }]}>اطلاعات پروفایل دریافت نشد.</Text>
                    <Pressable accessibilityRole="button" onPress={() => {
                      if (protocol.key === 'openvpn') openVpn.refetch();
                      if (protocol.key === 'wireguard') wireguard.refetch();
                      if (protocol.key === 'ipsec') ipsec.refetch();
                      if (protocol.key === 'amneziawg') amnezia.refetch();
                      if (protocol.key === 'v2ray') subscriptionFeed.refetch();
                    }} style={styles.shareButton}>
                      <Feather name="rotate-ccw" size={15} color={c.primary} /><Text style={[styles.shareText, { color: c.primary }]}>تلاش دوباره</Text>
                    </Pressable>
                  </View>
                ) : null}
                {protocol.result && protocol.rows.map(([title, value], index) => (
                  <View key={`${protocol.key}-${index}`} style={styles.secretRow}>
                    <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>{title}</Text>
                    <Ltr style={[styles.secretValue, { color: c.foreground }]}>{value || '—'}</Ltr>
                    {typeof value === 'string' && (value.startsWith('http') || title.includes('رمز')) ? (
                      <Pressable accessibilityRole="button" onPress={() => Share.share({ message: `${title}: ${value}` })} style={styles.shareButton}>
                        <Feather name="share" size={15} color={c.primary} /><Text style={[styles.shareText, { color: c.primary }]}>اشتراک‌گذاری</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {protocol.result && protocol.rows.length === 0 ? <Text style={[styles.sectionNote, { color: c.mutedForeground }]}>موردی برای نمایش ثبت نشده است.</Text> : null}
              </View>
            ) : null}
          </Card>
        ))}
        <Card style={[styles.engineCard, { backgroundColor: c.accent, borderColor: c.accent }]}>
          <Feather name="info" size={18} color={c.primary} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.engineTitle, { color: c.accentForeground }]}>اتصال درون‌برنامه‌ای فعال نیست</Text>
            <Text style={[styles.sectionNote, { color: c.accentForeground }]}>این نسخه هنوز موتورهای بومی OpenVPN، WireGuard، AmneziaWG و V2Ray را ندارد. هیچ وضعیت اتصالی جعل نمی‌شود و برنامهٔ VPN دیگری باز نخواهد شد.</Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40, gap: 14 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  subscriptionCard: { gap: 13 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14 },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right' },
  detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'right', flexShrink: 1 },
  rule: { height: 1 },
  section: { gap: 5, marginTop: 7 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, textAlign: 'right' },
  sectionNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'right' },
  protocolHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  protocolIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  protocolTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'right' },
  protocolState: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  protocolBody: { padding: 15, gap: 14, borderTopWidth: 1 },
  secretRow: { gap: 6, alignItems: 'stretch' },
  secretValue: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 19, textAlign: 'left' },
  shareButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  shareText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  fetchError: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'right', lineHeight: 19 },
  fetchFailed: { gap: 5, alignItems: 'flex-start' },
  engineCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 4 },
  engineTitle: { fontFamily: 'Inter_700Bold', fontSize: 13, textAlign: 'right' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
