import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMobileDashboard, useLogoutMobile } from '@workspace/api-client-react';
import * as FileSystem from 'expo-file-system/legacy';
import { ActionButton, Card, Heading, InlineState, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { ThemeMode, useAppearance } from '@/hooks/Appearance';
import { clearMobileToken } from '@/lib/mobile-auth';
import { getDiagnosticLog } from '@/lib/vpn-engine';

const themeOptions: { id: ThemeMode; title: string; icon: 'smartphone' | 'sun' | 'moon'; hint: string }[] = [
  { id: 'light', title: 'روشن', icon: 'sun', hint: 'پیشنهادشده' },
  { id: 'system', title: 'همگام با دستگاه', icon: 'smartphone', hint: '' },
  { id: 'dark', title: 'تیره', icon: 'moon', hint: '' },
];

export default function Settings() {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { themeMode, setThemeMode } = useAppearance();
  const logout = useLogoutMobile();
  const dashboard = useGetMobileDashboard();
  const currentSubscription = dashboard.data?.subscriptions.find((entry) => entry.status === 'active') ?? dashboard.data?.subscriptions[0];
  const [logoutError, setLogoutError] = useState('');
  const [savingDiagnostics, setSavingDiagnostics] = useState(false);

  function signOut() {
    Alert.alert('خروج از حساب', 'از حساب Pulse خارج می‌شوید؟', [
      { text: 'انصراف', style: 'cancel' },
      { text: 'خروج', style: 'destructive', onPress: () => {
        setLogoutError('');
        logout.mutate(undefined, {
          onSuccess: async () => {
            await clearMobileToken();
            queryClient.clear();
            router.replace('/auth/otp');
          },
          onError: (error) => setLogoutError(error.message || 'خروج انجام نشد. دوباره تلاش کنید.'),
        });
      } },
    ]);
  }

  function contactSupport() {
    Share.share({ message: 'سلام، برای اشتراک Pulse خود به راهنمایی نیاز دارم. لطفاً راهنمایی‌ام کنید.' });
  }

  async function downloadDiagnostics() {
    if (Platform.OS !== 'android') return;
    setSavingDiagnostics(true);
    try {
      const report = await getDiagnosticLog();
      const folder = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!folder.granted || !folder.directoryUri) return;
      const suffix = new Date().toISOString().replace(/[:.]/g, '-');
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        folder.directoryUri,
        `PulseVPN-diagnostics-${suffix}.txt`,
        'text/plain',
      );
      await FileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, report, { encoding: 'utf8' });
      Alert.alert('گزارش ذخیره شد', 'فایل گزارش در پوشه‌ای که انتخاب کردید ذخیره شد. می‌توانید آن را برای بررسی ارسال کنید.');
    } catch (error) {
      Alert.alert(
        'ذخیره گزارش انجام نشد',
        error instanceof Error ? error.message : 'ذخیره فایل گزارش ناموفق بود. دوباره تلاش کنید.',
      );
    } finally {
      setSavingDiagnostics(false);
    }
  }

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Heading eyebrow="حریم خصوصی حساب" title="حساب" detail="اطلاعات واقعی حساب و تنظیمات برنامهٔ PulseVPN." />
        {dashboard.data ? (
          <Card style={styles.accountSummary}>
            <View style={[styles.optionIcon, { backgroundColor: c.accent }]}><Feather name="user" size={18} color={c.primary} /></View>
            <View style={styles.accountCopy}>
              <Text style={[styles.accountName, { color: c.foreground }]}>{dashboard.data.customer.name}</Text>
              <Text style={[styles.accountPhone, { color: c.mutedForeground }]}>{dashboard.data.customer.phone}</Text>
            </View>
            <Feather name="lock" size={15} color={c.mutedForeground} />
          </Card>
        ) : dashboard.isLoading ? <View style={[styles.accountSkeleton, { backgroundColor: c.muted }]} /> : null}
        {currentSubscription ? (
          <Pressable accessibilityRole="button" testID="account-subscription-detail" onPress={() => router.push(`/profiles/${currentSubscription.id}`)}>
            <Card style={styles.actionCard}>
              <View style={[styles.optionIcon, { backgroundColor: c.accent }]}><Feather name="layers" size={17} color={c.primary} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.optionTitle, { color: c.foreground }]}>{currentSubscription.plan}</Text>
                <Text style={[styles.optionHint, { color: c.mutedForeground }]}>{currentSubscription.provider_name} · {currentSubscription.status === 'active' ? 'فعال' : 'وضعیت سرویس'}</Text>
              </View>
              <Feather name="chevron-left" size={17} color={c.mutedForeground} />
            </Card>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" testID="account-all-subscriptions" onPress={() => router.push('/(tabs)/profiles')}>
          <Card style={styles.actionCard}>
            <View style={[styles.optionIcon, { backgroundColor: c.secondary }]}><Feather name="list" size={17} color={c.secondaryForeground} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.optionTitle, { color: c.foreground }]}>مدیریت اشتراک‌ها</Text>
              <Text style={[styles.optionHint, { color: c.mutedForeground }]}>مشاهدهٔ طرح‌ها، میزان مصرف و وضعیت سرویس</Text>
            </View>
            <Feather name="chevron-left" size={17} color={c.mutedForeground} />
          </Card>
        </Pressable>

        <Text style={[styles.sectionTitle, { color: c.foreground }]}>نمایش</Text>
        <Card style={styles.optionCard}>
          {themeOptions.map((option, index) => {
            const selected = themeMode === option.id;
            return (
              <React.Fragment key={option.id}>
                {index > 0 ? <View style={[styles.rule, { backgroundColor: c.border }]} /> : null}
                <Pressable accessibilityRole="radio" accessibilityState={{ selected }} testID={`theme-${option.id}`} onPress={() => setThemeMode(option.id)} style={styles.option}>
                  <View style={[styles.optionIcon, { backgroundColor: selected ? c.accent : c.secondary }]}><Feather name={option.icon} size={17} color={selected ? c.primary : c.mutedForeground} /></View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.optionTitle, { color: c.foreground }]}>{option.title}</Text>
                    {option.hint ? <Text style={[styles.optionHint, { color: c.mutedForeground }]}>{option.hint}</Text> : null}
                  </View>
                  {selected ? <Feather name="check-circle" size={19} color={c.primary} /> : <View style={[styles.radio, { borderColor: c.input }]} />}
                </Pressable>
              </React.Fragment>
            );
          })}
        </Card>

        <Text style={[styles.sectionTitle, { color: c.foreground }]}>زبان</Text>
        <Pressable accessibilityRole="button" onPress={() => Alert.alert('زبان برنامه', 'فارسی تنها زبان آماده در نسخهٔ فعلی است. رابط برنامه به‌صورت راست‌چین نمایش داده می‌شود.', [{ text: 'متوجه شدم' }])}>
          <Card style={styles.languageCard}>
            <View style={[styles.optionIcon, { backgroundColor: c.accent }]}><Feather name="globe" size={17} color={c.primary} /></View>
            <Text style={[styles.optionTitle, { color: c.foreground, flex: 1 }]}>فارسی</Text>
            <Text style={[styles.languageHint, { color: c.mutedForeground }]}>زبان فعلی</Text>
            <Feather name="chevron-left" size={17} color={c.mutedForeground} />
          </Card>
        </Pressable>

        <Text style={[styles.sectionTitle, { color: c.foreground }]}>راهنما و حساب</Text>
        {Platform.OS === 'android' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: savingDiagnostics, busy: savingDiagnostics }}
            disabled={savingDiagnostics}
            testID="download-diagnostics"
            onPress={downloadDiagnostics}
          >
            <Card style={styles.actionCard}>
              <View style={[styles.optionIcon, { backgroundColor: c.accent }]}><Feather name="download" size={17} color={c.primary} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.optionTitle, { color: c.foreground }]}>دانلود گزارش فنی</Text>
                <Text style={[styles.optionHint, { color: c.mutedForeground }]}>برای بررسی اتصال؛ اطلاعات ورود و نشانی سرورها حذف می‌شوند.</Text>
              </View>
              {savingDiagnostics ? <ActivityIndicator size="small" color={c.primary} /> : <Feather name="chevron-left" size={17} color={c.mutedForeground} />}
            </Card>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={contactSupport}>
          <Card style={styles.actionCard}>
            <View style={[styles.optionIcon, { backgroundColor: c.accent }]}><Feather name="message-circle" size={17} color={c.primary} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.optionTitle, { color: c.foreground }]}>پشتیبانی</Text>
              <Text style={[styles.optionHint, { color: c.mutedForeground }]}>درخواست راهنمایی را با فروشنده‌تان در میان بگذارید.</Text>
            </View>
            <Feather name="arrow-up-left" size={17} color={c.mutedForeground} />
          </Card>
        </Pressable>
        <Pressable accessibilityRole="button" testID="privacy-details" onPress={() => Alert.alert('حریم خصوصی', 'PulseVPN نشانی پیکربندی و اعتبارنامه‌ها را در صفحه‌های معمولی نمایش نمی‌دهد. گزارش فنی فقط از خروجی موتور بومی دریافت می‌شود.', [{ text: 'متوجه شدم' }])}>
        <Card style={styles.actionCard}>
          <View style={[styles.optionIcon, { backgroundColor: c.secondary }]}><Feather name="lock" size={17} color={c.mutedForeground} /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.optionTitle, { color: c.foreground }]}>حریم خصوصی</Text>
            <Text style={[styles.optionHint, { color: c.mutedForeground }]}>اطلاعات اشتراک فقط برای حساب واردشده نمایش داده می‌شود.</Text>
          </View>
          <Feather name="chevron-left" size={17} color={c.mutedForeground} />
        </Card>
        </Pressable>
        <Pressable accessibilityRole="button" testID="about-pulse" onPress={() => Alert.alert('دربارهٔ PulseVPN', 'نسخهٔ ۱.۰.۲۶\nاتصال تنها با موتور بومی و وضعیت واقعی سرور گزارش می‌شود.', [{ text: 'بستن' }])}>
          <Card style={styles.actionCard}>
            <View style={[styles.optionIcon, { backgroundColor: c.accent }]}><Feather name="info" size={17} color={c.primary} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.optionTitle, { color: c.foreground }]}>دربارهٔ PulseVPN</Text>
              <Text style={[styles.optionHint, { color: c.mutedForeground }]}>نسخه و اطلاعات برنامه</Text>
            </View>
            <Feather name="chevron-left" size={17} color={c.mutedForeground} />
          </Card>
        </Pressable>
        {logoutError ? <InlineState title="خروج انجام نشد" detail={logoutError} retry={signOut} /> : null}
        <ActionButton title="خروج از حساب" icon="log-out" quiet onPress={signOut} loading={logout.isPending} />
        <Text style={[styles.version, { color: c.mutedForeground }]}>Pulse VPN Client · مشتریان Pulse</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 40, gap: 13 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, textAlign: 'right', marginTop: 5 },
  optionCard: { paddingVertical: 4, gap: 0 },
  accountSummary: { flexDirection: 'row', alignItems: 'center', minHeight: 76 },
  accountCopy: { flex: 1, gap: 5, alignItems: 'flex-end' },
  accountName: { fontFamily: 'Inter_700Bold', fontSize: 15, textAlign: 'right' },
  accountPhone: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right' },
  accountSkeleton: { height: 76, borderRadius: 20, opacity: 0.7 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  optionIcon: { width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'right' },
  optionHint: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  rule: { height: 1, marginHorizontal: 2 },
  radio: { width: 17, height: 17, borderWidth: 1.5, borderRadius: 9 },
  languageCard: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  languageHint: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  version: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center', paddingVertical: 7 },
});
