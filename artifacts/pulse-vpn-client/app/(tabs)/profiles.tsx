import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetMobileSession, useListMobileSubscriptions } from '@workspace/api-client-react';
import { Card, Heading, InlineState, Ltr, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

const fa = (value: number | string) => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const label = (status: string) => ({ active: 'فعال', expired: 'پایان‌یافته', cancelled: 'لغوشده', pending: 'در انتظار' }[status] ?? status);

export default function Profiles() {
  const c = useColors();
  const router = useRouter();
  const query = useListMobileSubscriptions();
  const session = useGetMobileSession();
  if (query.isLoading) return <Screen><View style={{ gap: 13, marginTop: 10 }}>{[1, 2, 3].map((n) => <View key={n} style={[styles.skeleton, { backgroundColor: c.muted }]} />)}</View></Screen>;
  if (session.data?.authenticated === false) return <Screen><InlineState title="از حساب خارج شده‌اید" detail="برای دیدن اشتراک‌ها دوباره وارد حساب شوید." retry={() => router.replace('/auth/otp')} icon="log-in" /></Screen>;
  if (query.isError) return <Screen><InlineState title="اشتراک‌ها بارگذاری نشدند" detail="اتصال را بررسی کنید و دوباره تلاش کنید." retry={() => query.refetch()} /></Screen>;
  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <FlatList
        data={query.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={c.primary} />}
        ListHeaderComponent={<Heading eyebrow="مدیریت خصوصی" title="اشتراک‌های من" detail="اطلاعات و پروفایل‌های هر سرویس را جداگانه ببینید." />}
        ListEmptyComponent={
          <Card style={styles.empty}>
            <Feather name="layers" size={25} color={c.primary} />
            <Text style={[styles.title, { color: c.foreground }]}>اشتراکی ثبت نشده</Text>
            <Text style={[styles.description, { color: c.mutedForeground }]}>اشتراک‌های متعلق به حساب شما پس از ثبت توسط فروشنده در این فهرست نمایش داده می‌شوند.</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" testID={`subscription-${item.id}`} onPress={() => router.push(`/profiles/${item.id}`)}>
            <Card style={styles.item}>
              <View style={styles.topline}>
                <View style={[styles.badge, { backgroundColor: item.status === 'active' ? c.accent : c.secondary }]}>
                  <Text style={[styles.badgeText, { color: item.status === 'active' ? c.accentForeground : c.mutedForeground }]}>{label(item.status)}</Text>
                </View>
                <Feather name="chevron-left" size={19} color={c.mutedForeground} />
              </View>
              <Text style={[styles.title, { color: c.foreground }]}>{item.plan}</Text>
              <Text style={[styles.description, { color: c.mutedForeground }]}>{item.provider_name}</Text>
              <View style={[styles.separator, { backgroundColor: c.border }]} />
              <View style={styles.metrics}>
                <View style={styles.metric}>
                  <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>حجم باقی‌مانده</Text>
                  <Ltr style={[styles.metricValue, { color: c.foreground }]}>{fa(item.remaining_gb)} GB</Ltr>
                </View>
                <View style={styles.metric}>
                  <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>پایان اشتراک</Text>
                  <Text style={[styles.metricValue, { color: c.foreground }]}>{item.remaining_days == null ? '—' : `${fa(item.remaining_days)} روز`}</Text>
                </View>
              </View>
              {item.status === 'expired' ? <Text style={[styles.expired, { color: c.warning }]}>این اشتراک منقضی شده است.</Text> : null}
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 40, gap: 14 },
  item: { gap: 9 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 30 },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 17, textAlign: 'right' },
  description: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right', lineHeight: 19 },
  separator: { height: 1, marginVertical: 3 },
  metrics: { flexDirection: 'row', justifyContent: 'space-between' },
  metric: { gap: 5 },
  metricLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  metricValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  expired: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'right', marginTop: 3 },
  empty: { alignItems: 'center', paddingVertical: 26 },
  skeleton: { height: 170, borderRadius: 22, opacity: 0.7 },
});
