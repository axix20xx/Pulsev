import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card, Heading, Screen } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

export default function ActivityScreen() {
  const c = useColors();
  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Heading eyebrow="گزارش محلی" title="فعالیت" detail="فقط رویدادهای واقعی اتصال نمایش داده می‌شوند؛ تاریخچهٔ ساختگی یا دادهٔ ترافیک نداریم." />
        <Card style={styles.empty}>
          <View style={[styles.mark, { backgroundColor: c.accent }]}><Feather name="activity" size={20} color={c.primary} /></View>
          <Text style={[styles.title, { color: c.foreground }]}>هنوز رویدادی ثبت نشده</Text>
          <Text style={[styles.body, { color: c.mutedForeground }]}>پس از آن‌که ثبت رویدادها بدون اثر بر وضعیت واقعی اتصال فراهم باشد، تاریخچهٔ امن اینجا نمایش داده می‌شود.</Text>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <View style={styles.privacy}><Feather name="lock" size={14} color={c.mutedForeground} /><Text style={[styles.privacyText, { color: c.mutedForeground }]}>اطلاعات پیکربندی و اعتبارنامه‌ها در تاریخچه ذخیره نمی‌شوند.</Text></View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 32, gap: 14 },
  empty: { alignItems: 'flex-end', padding: 20, gap: 13, marginTop: 10 },
  mark: { height: 45, width: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 17, textAlign: 'right' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 22, textAlign: 'right' },
  divider: { width: '100%', height: StyleSheet.hairlineWidth, marginTop: 2 },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  privacyText: { flex: 1, textAlign: 'right', fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 18 },
});
