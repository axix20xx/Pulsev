import { Feather } from '@expo/vector-icons';
import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function NotFoundScreen() {
  const c = useColors();
  return (
    <>
      <Stack.Screen options={{ title: 'صفحه پیدا نشد', contentStyle: { backgroundColor: c.background } }} />
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <View style={[styles.art, { backgroundColor: c.accent, borderColor: c.border }]}>
          <View style={[styles.orbit, { borderColor: c.primary }]} />
          <View style={[styles.mark, { backgroundColor: c.primary }]}><Feather name="compass" size={29} color={c.primaryForeground} /></View>
          <View style={[styles.dot, { backgroundColor: c.success }]} />
        </View>
        <Text style={[styles.eyebrow, { color: c.primary }]}>PULSE · 404</Text>
        <Text style={[styles.title, { color: c.foreground }]}>این صفحه پیدا نشد</Text>
        <Text style={[styles.detail, { color: c.mutedForeground }]}>نشانی واردشده در Pulse وجود ندارد یا دیگر در دسترس نیست.</Text>
        <Link href="/" style={[styles.link, { backgroundColor: c.primary }]}>
          <Text style={[styles.linkText, { color: c.primaryForeground }]}>بازگشت به شروع</Text>
          <Feather name="arrow-left" size={16} color={c.primaryForeground} />
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 11 },
  art: { width: 148, height: 148, borderRadius: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 13, overflow: 'hidden' },
  orbit: { position: 'absolute', width: 118, height: 118, borderRadius: 60, borderWidth: 1, opacity: 0.35 },
  mark: { width: 67, height: 67, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, right: 26, top: 26 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  detail: { maxWidth: 280, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'center' },
  link: { marginTop: 14, minHeight: 50, borderRadius: 16, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  linkText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
