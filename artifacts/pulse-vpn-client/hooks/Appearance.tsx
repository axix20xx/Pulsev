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
        const migrated = await AsyncStorage.getItem('pulse.theme.light-v2');
        const value = await AsyncStorage.getItem('pulse.theme');
        if (migrated !== '1') {
          const next = value === 'light' || value === 'system' ? value : 'light';
          updateThemeMode(next);
          await AsyncStorage.setItem('pulse.theme', next);
          await AsyncStorage.setItem('pulse.theme.light-v2', '1');
        } else if (value === 'light' || value === 'dark' || value === 'system') {
          updateThemeMode(value);
        }
      } catch {
        // The light palette remains available if local preferences are unavailable.
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
