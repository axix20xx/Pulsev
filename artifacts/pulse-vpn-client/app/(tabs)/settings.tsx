import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLogoutMobile } from '@workspace/api-client-react';
import { ActionButton, Card, Heading, InlineState, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { ThemeMode, useAppearance } from '@/hooks/Appearance';
import { clearMobileToken } from '@/lib/mobile-auth';

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
  const [logoutError, setLogoutError] = useState('');

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

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Heading eyebrow="حساب کاربری" title="تنظیمات" detail="ترجیحات و دسترسی حساب خود را مدیریت کنید." />

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
        <Card style={styles.actionCard}>
          <View style={[styles.optionIcon, { backgroundColor: c.secondary }]}><Feather name="lock" size={17} color={c.mutedForeground} /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.optionTitle, { color: c.foreground }]}>حریم خصوصی</Text>
            <Text style={[styles.optionHint, { color: c.mutedForeground }]}>اطلاعات اشتراک فقط برای حساب واردشده نمایش داده می‌شود.</Text>
          </View>
        </Card>
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
