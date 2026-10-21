import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';
type AppearanceContextValue = { themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void };
const AppearanceContext = createContext<AppearanceContextValue>({ themeMode: 'dark', setThemeMode: () => undefined });

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, updateThemeMode] = useState<ThemeMode>('dark');
  useEffect(() => {
    void (async () => {
      try {
        const migrated = await AsyncStorage.getItem('pulse.theme.light-v1');
        if (migrated !== '1') {
          updateThemeMode('dark');
          await AsyncStorage.setItem('pulse.theme', 'dark');
          await AsyncStorage.setItem('pulse.theme.light-v1', '1');
          return;
        }
        const value = await AsyncStorage.getItem('pulse.theme');
        if (value === 'light' || value === 'dark' || value === 'system') updateThemeMode(value);
      } catch {
        // The branded midnight palette remains the default if local preferences are unavailable.
      }
    })();
  }, []);
  const setThemeMode = (mode: ThemeMode) => {
    updateThemeMode(mode);
    AsyncStorage.setItem('pulse.theme', mode).catch(() => undefined);
  };
  const value = useMemo(() => ({ themeMode, setThemeMode }), [themeMode]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
