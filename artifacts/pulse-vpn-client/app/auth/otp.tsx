import React, { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMobileSessionQueryKey, useRequestMobileOtp, useVerifyMobileOtp } from '@workspace/api-client-react';
import { ActionButton, Card, Heading, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { saveMobileToken } from '@/lib/mobile-auth';

export default function OtpSignIn() {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
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
      onSuccess: (result) => {
        setChallengeId(result.challenge_id);
        setExpiresAt(result.expires_at);
      },
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
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.mark, { backgroundColor: c.primary }]}>
            <Feather name="activity" size={27} color={c.primaryForeground} />
          </View>
          <Heading eyebrow="PULSE  /  دسترسی امن" title="ورود به حساب" detail="اشتراک‌های خود را در فضایی خصوصی و مطمئن مدیریت کنید." />
          <Card style={{ marginTop: 7 }}>
            <Text style={[styles.label, { color: c.foreground }]}>{challengeId ? 'کد یک‌بارمصرف' : 'شماره موبایل'}</Text>
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
              style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.background, textAlign: 'left', writingDirection: 'ltr' }]}
            />
            {challengeId ? <>
              <Text style={[styles.help, { color: c.mutedForeground }]}>کد ۴ رقمی را از فروشندهٔ Pulse خود دریافت کنید. این برنامه پیامک ارسال نمی‌کند.</Text>
              <TextInput
                testID="otp-input"
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 4))}
                placeholder="— — — —"
                placeholderTextColor={c.mutedForeground}
                keyboardType="number-pad"
                maxLength={4}
                textContentType="oneTimeCode"
                style={[styles.input, styles.otp, { color: c.foreground, borderColor: c.input, backgroundColor: c.background }]}
              />
              {expiresAt ? <Text style={[styles.meta, { color: c.mutedForeground }]}>مهلت این درخواست: <Text style={{ writingDirection: 'ltr' }}>{new Date(expiresAt).toLocaleString('fa-IR')}</Text></Text> : null}
              <ActionButton title="تأیید و ورود" icon="arrow-left" onPress={verify} loading={verifyOtp.isPending} disabled={otp.length !== 4} />
              <Pressable onPress={() => { setChallengeId(''); setOtp(''); requestOtp.reset(); verifyOtp.reset(); }}>
                <Text style={[styles.secondaryLink, { color: c.primary }]}>ویرایش شماره</Text>
              </Pressable>
            </> : <>
              <Text style={[styles.help, { color: c.mutedForeground }]}>ابتدا شماره‌تان را وارد کنید؛ سپس از فروشندهٔ خود کد ورود را بخواهید.</Text>
              <ActionButton title="ادامه" icon="arrow-left" onPress={startChallenge} loading={requestOtp.isPending} disabled={phone.trim().length < 8} />
            </>}
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: c.destructive }]}>{error.message || 'ورود انجام نشد. اتصال را بررسی و دوباره تلاش کنید.'}</Text> : null}
          </Card>
          <View style={styles.privacy}>
            <Feather name="shield" size={16} color={c.primary} />
            <Text style={[styles.privacyText, { color: c.mutedForeground }]}>کد فقط برای ورود به حساب Pulse شماست. آن را با دیگران به‌اشتراک نگذارید.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: 28, paddingHorizontal: 3 },
  mark: { height: 62, width: 62, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 25, alignSelf: 'flex-end' },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'right' },
  input: { minHeight: 56, borderWidth: 1, borderRadius: 17, paddingHorizontal: 15, fontSize: 16, fontFamily: 'Inter_500Medium' },
  otp: { textAlign: 'center', writingDirection: 'ltr', letterSpacing: 13, fontSize: 22, fontFamily: 'Inter_700Bold' },
  help: { fontSize: 13, lineHeight: 22, textAlign: 'right' },
  meta: { fontSize: 11, textAlign: 'right' },
  error: { fontSize: 13, lineHeight: 20, textAlign: 'right' },
  secondaryLink: { textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 13, padding: 4 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 22, paddingHorizontal: 5 },
  privacyText: { flex: 1, textAlign: 'right', fontSize: 12, lineHeight: 20 },
});
