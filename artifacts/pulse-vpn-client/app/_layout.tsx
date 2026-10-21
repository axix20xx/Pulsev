import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Vazirmatn_400Regular as Inter_400Regular,
  Vazirmatn_500Medium as Inter_500Medium,
  Vazirmatn_600SemiBold as Inter_600SemiBold,
  Vazirmatn_700Bold as Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/vazirmatn';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { getMobileToken } from '@/lib/mobile-auth';
import { AppearanceProvider } from '@/hooks/Appearance';
import { VpnPreferencesProvider } from '@/hooks/VpnPreferences';
import { useColors } from '@/hooks/useColors';
import * as SystemUI from 'expo-system-ui';

const DEFAULT_API_DOMAIN = 'vinte.peppernopepper.com';

function getApiBaseUrl(configuredDomain: string | undefined): string {
  const value = configuredDomain?.trim();
  if (!value || /^(undefined|null)$/i.test(value)) {
    return `https://${DEFAULT_API_DOMAIN}`;
  }

  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    if (!parsed.hostname || /^(undefined|null)$/i.test(parsed.hostname)) {
      return `https://${DEFAULT_API_DOMAIN}`;
    }

    // The API is served over HTTPS in production. Keep any configured port,
    // but discard paths so generated /api/... requests always resolve at root.
    return `https://${parsed.host}`;
  } catch {
    return `https://${DEFAULT_API_DOMAIN}`;
  }
}

setBaseUrl(getApiBaseUrl(process.env.EXPO_PUBLIC_DOMAIN));
setAuthTokenGetter(getMobileToken);

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'بازگشت', headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="auth/otp" />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profiles/[id]" />
      <Stack.Screen name="servers/[protocol]" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="connection" options={{ headerShown: false, presentation: 'card' }} />
    </Stack>
  );
}

function AppSurface() {
  const colors = useColors();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardProvider>
        <RootLayoutNav />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  // Keep existing typography token names stable while loading a font with full
  // Persian glyph coverage instead of relying on device-specific fallback.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AppearanceProvider>
        <VpnPreferencesProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <AppSurface />
            </QueryClientProvider>
          </ErrorBoundary>
        </VpnPreferencesProvider>
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}
