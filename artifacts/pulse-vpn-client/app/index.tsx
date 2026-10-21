import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useGetMobileSession } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function EntryRoute() {
  const colors = useColors();
  const session = useGetMobileSession();
  const signedIn = session.data?.authenticated === true;
  if (session.isLoading) return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <View style={[styles.mark, { backgroundColor: colors.primary }]}>
        <Feather name="activity" size={25} color={colors.primaryForeground} />
      </View>
      <Text style={[styles.brand, { color: colors.foreground }]}>PULSE VPN</Text>
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>در حال بررسی نشست شما</Text>
      <ActivityIndicator color={colors.primary} style={styles.indicator} />
    </View>
  );
  return <Redirect href={signedIn ? '/(tabs)' : '/auth/otp'} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  mark: { width: 66, height: 66, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 17, fontWeight: '700', letterSpacing: 1.2, marginTop: 18 },
  caption: { fontSize: 13, marginTop: 8, textAlign: 'center' },
  indicator: { marginTop: 26 },
});
