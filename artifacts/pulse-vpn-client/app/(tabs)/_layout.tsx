import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'web' ? 28 : Math.max(insets.bottom, 8);
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.primary,
      tabBarInactiveTintColor: c.mutedForeground,
      tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 10, marginTop: 2 },
      tabBarStyle: {
        backgroundColor: c.card,
        borderTopColor: c.border,
        borderTopWidth: 1,
        height: Platform.OS === 'web' ? 84 : 62 + bottomInset,
        paddingTop: 9,
        paddingBottom: bottomInset,
        elevation: Platform.OS === 'android' ? 12 : 0,
        shadowColor: c.foreground,
        shadowOpacity: Platform.OS === 'android' ? 0.08 : 0,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -5 },
      },
    }}>
      <Tabs.Screen name="index" options={{ title: 'خانه', tabBarIcon: ({ color }) => <Feather name="grid" size={21} color={color} /> }} />
      <Tabs.Screen name="protocols" options={{ title: 'پروتکل', tabBarIcon: ({ color }) => <Feather name="radio" size={21} color={color} /> }} />
      <Tabs.Screen name="activity" options={{ title: 'فعالیت', tabBarIcon: ({ color }) => <Feather name="activity" size={21} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'حساب', tabBarIcon: ({ color }) => <Feather name="user" size={21} color={color} /> }} />
      <Tabs.Screen name="profiles" options={{ href: null }} />
    </Tabs>
  );
}
