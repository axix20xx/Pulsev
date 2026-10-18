import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';
type AppearanceContextValue = { themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void };
const AppearanceContext = createContext<AppearanceContextValue>({ themeMode: 'system', setThemeMode: () => undefined });

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, updateThemeMode] = useState<ThemeMode>('system');
  useEffect(() => {
    AsyncStorage.getItem('pulse.theme').then((value) => {
      if (value === 'light' || value === 'dark' || value === 'system') updateThemeMode(value);
    }).catch(() => undefined);
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
