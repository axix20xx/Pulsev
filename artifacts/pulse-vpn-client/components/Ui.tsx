import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const custom = StyleSheet.flatten(style) ?? {};
  const contentTop = typeof custom.paddingTop === 'number' ? custom.paddingTop : 22;
  const contentBottom = typeof custom.paddingBottom === 'number' ? custom.paddingBottom : 28;
  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;
  return <View style={[styles.screen, custom, {
    backgroundColor: c.background,
    paddingTop: Math.max(insets.top + contentTop, webTop, contentTop),
    paddingBottom: custom.paddingBottom === 0
      ? 0
      : Math.max(insets.bottom + contentBottom, webBottom, contentBottom),
  }]}>{children}</View>;
}

export function Heading({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  const c = useColors();
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={[styles.eyebrow, { color: c.primary }]}>{eyebrow}</Text> : null}
      <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
      {detail ? <Text style={[styles.detail, { color: c.mutedForeground }]}>{detail}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, shadowColor: c.foreground }, style]}>{children}</View>;
}

export function ActionButton({ title, onPress, icon, quiet, loading, disabled }: {
  title: string; onPress: () => void; icon?: keyof typeof Feather.glyphMap;
  quiet?: boolean; loading?: boolean; disabled?: boolean;
}) {
  const c = useColors();
  const bg = quiet ? c.secondary : c.primary;
  const fg = quiet ? c.secondaryForeground : c.primaryForeground;
  return (
    <Pressable testID={`button-${title}`} accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.82 : 1 }]}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Feather name={icon} size={17} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function InlineState({ title, detail, retry, icon = 'alert-circle' }: {
  title: string; detail: string; retry?: () => void; icon?: keyof typeof Feather.glyphMap;
}) {
  const c = useColors();
  return (
    <Card style={styles.stateCard}>
      <Feather name={icon} size={22} color={c.primary} />
      <Text style={[styles.stateTitle, { color: c.foreground }]}>{title}</Text>
      <Text style={[styles.detail, { color: c.mutedForeground, textAlign: 'center' }]}>{detail}</Text>
      {retry ? <ActionButton title="تلاش دوباره" icon="rotate-ccw" quiet onPress={retry} /> : null}
    </Card>
  );
}

export function Ltr({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[{ writingDirection: 'ltr', textAlign: 'left', fontVariant: ['tabular-nums'] }, style]}>{children}</Text>;
}

export const sharedStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  small: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
  heading: { gap: 8, marginBottom: 18 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1, textAlign: 'right' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 27, lineHeight: 37, textAlign: 'right' },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 23, textAlign: 'right' },
  card: { borderWidth: 1, borderRadius: 20, padding: 17, gap: 12, shadowOpacity: 0.035, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 1 },
  button: { minHeight: 54, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  stateCard: { alignItems: 'center', paddingVertical: 25 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'center' },
});
