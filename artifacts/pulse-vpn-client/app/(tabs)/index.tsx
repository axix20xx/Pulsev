import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetMobileDashboard, useGetMobileSession } from '@workspace/api-client-react';
import { ActionButton, Card, Heading, InlineState, Ltr, Screen, sharedStyles } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

const persianDigits = (value: number | string) => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function statusCopy(status: string) {
  if (status === 'active') return 'فعال';
  if (status === 'expired') return 'پایان‌یافته';
  if (status === 'cancelled') return 'لغوشده';
  return 'در انتظار';
}

export default function Dashboard() {
  const c = useColors();
  const router = useRouter();
  const dashboard = useGetMobileDashboard();
  const session = useGetMobileSession();
  const list = dashboard.data?.subscriptions ?? [];
  const current = list.find((item) => item.status === 'active') ?? list[0];

  if (dashboard.isLoading) return (
    <Screen>
      <View style={{ gap: 15, marginTop: 12 }}>
        <View style={[styles.skeleton, { backgroundColor: c.muted, width: '48%', height: 22 }]} />
        <View style={[styles.skeleton, { backgroundColor: c.muted, height: 138 }]} />
        <View style={[styles.skeleton, { backgroundColor: c.muted, height: 175 }]} />
      </View>
    </Screen>
  );
  if (session.data?.authenticated === false) return <Screen><InlineState title="از حساب خارج شده‌اید" detail="برای دیدن اشتراک‌ها با شماره موبایل خود وارد شوید." retry={() => router.replace('/auth/otp')} icon="log-in" /></Screen>;
  if (dashboard.isError) return <Screen><InlineState title="بارگذاری انجام نشد" detail="اطلاعات حساب در دسترس نیست. دوباره تلاش کنید." retry={() => dashboard.refetch()} /></Screen>;
  if (!dashboard.data) return <Screen><InlineState title="نشست در دسترس نیست" detail="برای دیدن اطلاعات اشتراک، دوباره وارد حساب شوید." retry={() => router.replace('/auth/otp')} icon="log-in" /></Screen>;

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => dashboard.refetch()} tintColor={c.primary} />}
      >
        <View style={styles.topline}>
          <View style={{ gap: 4 }}>
            <Text style={[styles.brand, { color: c.primary }]}>PULSE</Text>
            <Text style={[styles.welcome, { color: c.foreground }]}>سلام، {dashboard.data.customer.name}</Text>
          </View>
          <View style={[styles.brandMark, { backgroundColor: c.accent }]}><Feather name="activity" size={20} color={c.primary} /></View>
        </View>
        <Heading eyebrow="نمای کلی حساب" title="وضعیت اشتراک" detail="مدیریت خصوصی سرویس‌های Pulse شما" />

        {current ? (
          <Card style={[styles.summary, { backgroundColor: c.surfaceDeep, borderColor: c.surfaceDeep }]}>
            <View style={sharedStyles.row}>
              <View style={[styles.pill, { backgroundColor: current.status === 'active' ? 'rgba(169,221,189,0.18)' : 'rgba(255,255,255,0.1)' }]}>
                <View style={[styles.dot, { backgroundColor: current.status === 'active' ? '#9AC9A8' : '#D9B786' }]} />
                <Text style={styles.pillText}>{statusCopy(current.status)}</Text>
              </View>
              <Feather name="shield" size={20} color="#A7C7B3" />
            </View>
            <Text style={styles.plan}>{current.plan}</Text>
            <Text style={styles.provider}>{current.provider_name}</Text>
            <View style={styles.divider} />
            <View style={styles.metricRow}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>حجم باقی‌مانده</Text>
                <Ltr style={styles.metricValue}>{persianDigits(current.remaining_gb)} <Text style={styles.metricUnit}>GB</Text></Ltr>
              </View>
              <View style={[styles.metricLine, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>روز باقی‌مانده</Text>
                <Text style={styles.metricValue}>{current.remaining_days == null ? '—' : persianDigits(current.remaining_days)}</Text>
              </View>
            </View>
            {current.status === 'active' ? (
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, current.usage_percent))}%`, backgroundColor: '#9CC8AE' }]} /></View>
            ) : current.status === 'expired' ? <Text style={styles.expiredNote}>این اشتراک به پایان رسیده است.</Text> : null}
            <ActionButton title="مشاهدهٔ جزئیات" icon="arrow-left" quiet onPress={() => router.push(`/profiles/${current.id}`)} />
          </Card>
        ) : (
          <Card style={styles.emptyCard}>
            <Feather name="layers" size={25} color={c.primary} />
            <Text style={[styles.emptyTitle, { color: c.foreground }]}>هنوز اشتراکی ندارید</Text>
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>وقتی فروشنده اشتراکی برای شما ثبت کند، جزئیات آن اینجا نمایش داده می‌شود.</Text>
            <ActionButton title="رفتن به اشتراک‌ها" icon="arrow-left" onPress={() => router.push('/(tabs)/profiles')} />
          </Card>
        )}

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>حساب شما</Text>
          <Text style={[styles.sectionMeta, { color: c.mutedForeground }]}>{persianDigits(list.length)} اشتراک</Text>
        </View>
        <Card style={styles.accountCard}>
          <View style={styles.accountIcon}><Feather name="user" size={17} color={c.primary} /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.accountName, { color: c.foreground }]}>{dashboard.data.customer.name}</Text>
            <Ltr style={[styles.accountPhone, { color: c.mutedForeground }]}>{dashboard.data.customer.phone}</Ltr>
          </View>
          <Feather name="lock" size={16} color={c.mutedForeground} />
        </Card>
        {dashboard.data.unread_count > 0 ? (
          <View style={[styles.notice, { backgroundColor: c.accent }]}>
            <Feather name="bell" size={16} color={c.primary} />
            <Text style={[styles.noticeText, { color: c.accentForeground }]}>{persianDigits(dashboard.data.unread_count)} اعلان خوانده‌نشده</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 35, gap: 18 },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 2 },
  welcome: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'right' },
  brandMark: { height: 44, width: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  summary: { padding: 20, gap: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  dot: { height: 6, width: 6, borderRadius: 3 },
  pillText: { color: '#E5F0E8', fontFamily: 'Inter_500Medium', fontSize: 11 },
  plan: { color: '#F0F6F1', fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'right', marginTop: 3 },
  provider: { color: '#B5C9BC', fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.16)', marginVertical: 3 },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 4 },
  metric: { flex: 1, gap: 8, alignItems: 'center' },
  metricLine: { width: 1, height: 35 },
  metricLabel: { color: '#B5C9BC', fontFamily: 'Inter_400Regular', fontSize: 11 },
  metricValue: { color: '#F4F8F4', fontFamily: 'Inter_700Bold', fontSize: 20, textAlign: 'center' },
  metricUnit: { color: '#B5C9BC', fontSize: 11, fontFamily: 'Inter_500Medium' },
  progressTrack: { height: 5, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.17)', overflow: 'hidden', marginTop: 2 },
  progressFill: { height: '100%', borderRadius: 4 },
  expiredNote: { color: '#E6CBA8', fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'right' },
  emptyCard: { alignItems: 'flex-start', paddingVertical: 22 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, textAlign: 'right' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 22, textAlign: 'right' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  sectionMeta: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  accountCard: { flexDirection: 'row', alignItems: 'center' },
  accountIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#E3EEE5', alignItems: 'center', justifyContent: 'center' },
  accountName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'right' },
  accountPhone: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 13, borderRadius: 15 },
  noticeText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  skeleton: { borderRadius: 20, opacity: 0.75 },
});
