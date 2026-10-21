import React, { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMobileSessionQueryKey, useRequestMobileOtp, useVerifyMobileOtp } from '@workspace/api-client-react';
import { ActionButton, Card, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useAppearance } from '@/hooks/Appearance';
import { saveMobileToken } from '@/lib/mobile-auth';

export default function OtpSignIn() {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { themeMode } = useAppearance();
  const systemScheme = useColorScheme();
  const statusBarStyle = themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark') ? 'light' : 'dark';
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const requestOtp = useRequestMobileOtp();
  const verifyOtp = useVerifyMobileOtp({ request: { headers: { 'X-Pulse-Mobile-Client': 'native' } } });
  const error = requestOtp.error || verifyOtp.error;

  async function startChallenge() {
    Keyboard.dismiss();
    const normalized = phone.trim().replace(/\s/g, '');
    if (normalized.length < 8) return;
    requestOtp.mutate({ data: { phone: normalized } }, {
      onSuccess: (result) => { setChallengeId(result.challenge_id); setExpiresAt(result.expires_at); },
    });
  }

  function verify() {
    Keyboard.dismiss();
    if (otp.length !== 4 || !challengeId) return;
    verifyOtp.mutate({ data: { phone: phone.trim().replace(/\s/g, ''), challenge_id: challengeId, otp } }, {
      onSuccess: async (result) => {
        if (!result.authenticated) return;
        if (result.access_token) await saveMobileToken(result.access_token);
        await queryClient.invalidateQueries({ queryKey: getGetMobileSessionQueryKey() });
        router.replace('/(tabs)');
      },
    });
  }

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <StatusBar style={statusBarStyle} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.topline}>
            <View style={[styles.wordmark, { backgroundColor: c.primary }]}><Feather name="activity" size={20} color={c.primaryForeground} /></View>
            <View style={styles.brandCopy}><Text style={[styles.brand, { color: c.foreground }]}>Pulse VPN</Text><Text style={[styles.brandSub, { color: c.mutedForeground }]}>دسترسی خصوصی شما</Text></View>
          </View>
          <View style={styles.intro}>
            <View style={[styles.illustration, { backgroundColor: c.accent, borderColor: c.border }]}>
              <View style={[styles.illustrationDisc, { backgroundColor: c.primary }]}><Feather name={challengeId ? 'key' : 'shield'} size={27} color={c.primaryForeground} /></View>
              <View style={[styles.orbit, { borderColor: c.primary }]} />
              <View style={[styles.orbitDot, { backgroundColor: c.success }]} />
            </View>
            <Text style={[styles.eyebrow, { color: c.primary }]}>{challengeId ? 'مرحلهٔ دوم · تأیید شماره' : 'ورود امن به حساب'}</Text>
            <Text style={[styles.title, { color: c.foreground }]}>{challengeId ? 'کد ورود را وارد کنید' : 'خوش آمدید'}</Text>
            <Text style={[styles.detail, { color: c.mutedForeground }]}>
              {challengeId ? 'کد یک‌بارمصرف را از فروشندهٔ Pulse خود دریافت کنید.' : 'شمارهٔ موبایل‌تان را وارد کنید تا حساب و اشتراک‌هایتان را باز کنید.'}
            </Text>
          </View>

          <Card style={styles.form}>
            <View style={styles.formHeading}>
              <View style={[styles.formGlyph, { backgroundColor: c.secondary }]}><Feather name={challengeId ? 'message-square' : 'smartphone'} size={16} color={c.primary} /></View>
              <View style={styles.formHeadingCopy}>
                <Text style={[styles.formTitle, { color: c.foreground }]}>{challengeId ? 'تأیید هویت' : 'شمارهٔ موبایل'}</Text>
                <Text style={[styles.formHint, { color: c.mutedForeground }]}>{challengeId ? 'کد ۴ رقمی را وارد کنید' : 'بدون رمز عبور، فقط با کد یک‌بارمصرف'}</Text>
              </View>
              <Text style={[styles.stepCount, { color: c.primary }]}>{challengeId ? '۲ / ۲' : '۱ / ۲'}</Text>
            </View>
            <TextInput
              testID="phone-input"
              value={phone}
              onChangeText={setPhone}
              placeholder="مثال: 09123456789"
              placeholderTextColor={c.mutedForeground}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!challengeId}
              accessibilityLabel="شمارهٔ موبایل"
              style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.background, textAlign: 'left', writingDirection: 'ltr' }]}
            />
            {challengeId ? <>
              <Text style={[styles.hint, { color: c.mutedForeground }]}>این برنامه پیامک ارسال نمی‌کند؛ کد را از فروشندهٔ خود بگیرید.</Text>
              <TextInput
                testID="otp-input"
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 4))}
                placeholder="— — — —"
                placeholderTextColor={c.mutedForeground}
                keyboardType="number-pad"
                maxLength={4}
                textContentType="oneTimeCode"
                accessibilityLabel="کد یک‌بارمصرف چهار رقمی"
                style={[styles.input, styles.otp, { color: c.foreground, borderColor: c.input, backgroundColor: c.background }]}
              />
              {expiresAt ? <Text style={[styles.expires, { color: c.mutedForeground }]}>مهلت درخواست: <Text style={{ writingDirection: 'ltr' }}>{new Date(expiresAt).toLocaleString('fa-IR')}</Text></Text> : null}
              <ActionButton title="تأیید و ورود" icon="arrow-left" onPress={verify} loading={verifyOtp.isPending} disabled={otp.length !== 4} />
              <Pressable accessibilityRole="button" testID="edit-phone" onPress={() => { setChallengeId(''); setOtp(''); requestOtp.reset(); verifyOtp.reset(); }}>
                <Text style={[styles.secondaryLink, { color: c.primary }]}>ویرایش شماره</Text>
              </Pressable>
            </> : <>
              <Text style={[styles.hint, { color: c.mutedForeground }]}>پس از ادامه، کد را از فروشندهٔ خود دریافت کنید.</Text>
              <ActionButton title="ادامه" icon="arrow-left" onPress={startChallenge} loading={requestOtp.isPending} disabled={phone.trim().length < 8} />
            </>}
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: c.destructive }]}>{error.message || 'ورود انجام نشد. اتصال را بررسی و دوباره تلاش کنید.'}</Text> : null}
          </Card>

          <View style={[styles.privacy, { backgroundColor: c.secondary }]}>
            <Feather name="lock" size={15} color={c.primary} />
            <Text style={[styles.privacyText, { color: c.mutedForeground }]}>کد ورود فقط برای حساب Pulse شماست؛ آن را با دیگران به‌اشتراک نگذارید.</Text>
          </View>
          <Text style={[styles.footer, { color: c.mutedForeground }]}>PULSE · اتصال، فقط با انتخاب شما</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 28, paddingBottom: 26, gap: 20 },
  topline: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-end' },
  wordmark: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  brandCopy: { alignItems: 'flex-end', gap: 2 },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  brandSub: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  intro: { alignItems: 'flex-end', gap: 8 },
  illustration: { width: 112, height: 112, borderWidth: 1, borderRadius: 39, alignItems: 'center', justifyContent: 'center', marginBottom: 4, alignSelf: 'center', overflow: 'hidden' },
  illustrationDisc: { width: 59, height: 59, borderRadius: 22, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  orbit: { position: 'absolute', width: 91, height: 91, borderRadius: 46, borderWidth: 1, opacity: 0.38 },
  orbitDot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, top: 13, right: 20 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'right' },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 19, textAlign: 'right' },
  form: { padding: 16, borderRadius: 23, gap: 12 },
  formHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 1 },
  formGlyph: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  formHeadingCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  formTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  formHint: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  stepCount: { fontFamily: 'Inter_700Bold', fontSize: 9, writingDirection: 'ltr' },
  input: { minHeight: 54, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, fontSize: 15, fontFamily: 'Inter_500Medium' },
  otp: { minHeight: 62, textAlign: 'center', writingDirection: 'ltr', letterSpacing: 13, fontSize: 21, fontFamily: 'Inter_700Bold' },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 17, textAlign: 'right' },
  expires: { fontFamily: 'Inter_400Regular', fontSize: 9, textAlign: 'right' },
  error: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 18, textAlign: 'right' },
  secondaryLink: { textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 11, paddingVertical: 3 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 15 },
  privacyText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 9, lineHeight: 16, textAlign: 'right' },
  footer: { fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1, textAlign: 'center' },
});
