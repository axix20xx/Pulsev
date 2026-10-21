import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useGetMobileSession } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAppearance } from '@/hooks/Appearance';
import { useColorScheme } from 'react-native';

export default function EntryRoute() {
  const colors = useColors();
  const { themeMode } = useAppearance();
  const scheme = useColorScheme();
  const statusBarStyle = themeMode === 'dark' || (themeMode === 'system' && scheme === 'dark') ? 'light' : 'dark';
  const session = useGetMobileSession();
  const signedIn = session.data?.authenticated === true;
  if (session.isLoading) return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <StatusBar style={statusBarStyle} />
      <View style={[styles.art, { backgroundColor: colors.accent, borderColor: colors.border }]}>
        <View style={[styles.orbit, { borderColor: colors.primary }]} />
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Feather name="activity" size={25} color={colors.primaryForeground} />
        </View>
        <View style={[styles.signal, { backgroundColor: colors.success }]} />
      </View>
      <Text style={[styles.brand, { color: colors.foreground }]}>Pulse VPN</Text>
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>در حال بررسی نشست خصوصی شما</Text>
      <View style={[styles.loadingTrack, { backgroundColor: colors.secondary }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingLabel, { color: colors.mutedForeground }]}>در حال آماده‌سازی</Text>
      </View>
    </View>
  );
  return <Redirect href={signedIn ? '/(tabs)' : '/auth/otp'} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  art: { width: 126, height: 126, borderRadius: 41, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 13, overflow: 'hidden' },
  orbit: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 1, opacity: 0.4 },
  mark: { width: 63, height: 63, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  signal: { position: 'absolute', width: 9, height: 9, borderRadius: 5, right: 19, top: 19 },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: 0.2 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
  loadingTrack: { minHeight: 43, minWidth: 178, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 14, marginTop: 16 },
  loadingLabel: { fontFamily: 'Inter_500Medium', fontSize: 10 },
});
