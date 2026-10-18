import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useGetMobileSession } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function EntryRoute() {
  const colors = useColors();
  const session = useGetMobileSession();
  const signedIn = session.data?.authenticated === true;
  if (session.isLoading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  return <Redirect href={signedIn ? '/(tabs)' : '/auth/otp'} />;
}
