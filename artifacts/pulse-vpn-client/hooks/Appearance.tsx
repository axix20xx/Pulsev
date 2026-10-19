import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';
type AppearanceContextValue = { themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void };
const AppearanceContext = createContext<AppearanceContextValue>({ themeMode: 'light', setThemeMode: () => undefined });

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, updateThemeMode] = useState<ThemeMode>('light');
  useEffect(() => {
    void (async () => {
      try {
        const migrated = await AsyncStorage.getItem('pulse.theme.light-v1');
        if (migrated !== '1') {
          updateThemeMode('light');
          await AsyncStorage.setItem('pulse.theme', 'light');
          await AsyncStorage.setItem('pulse.theme.light-v1', '1');
          return;
        }
        const value = await AsyncStorage.getItem('pulse.theme');
        if (value === 'light' || value === 'dark' || value === 'system') updateThemeMode(value);
      } catch {
        // Light remains the default if local theme preferences are unavailable.
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
