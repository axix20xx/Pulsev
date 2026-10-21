import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'web' ? 28 : Math.max(insets.bottom, 10);
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.primary,
      tabBarInactiveTintColor: c.mutedForeground,
      tabBarLabelStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 9, marginTop: 1 },
      tabBarStyle: {
        backgroundColor: c.card,
        borderTopColor: `${c.border}B8`,
        borderTopWidth: 1,
        height: Platform.OS === 'web' ? 84 : 62 + bottomInset,
        paddingTop: 5,
        paddingBottom: bottomInset,
        marginHorizontal: Platform.OS === 'web' ? 0 : 10,
        marginBottom: Platform.OS === 'web' ? 0 : 4,
        borderRadius: 21,
        elevation: Platform.OS === 'android' ? 16 : 0,
        shadowColor: c.foreground,
        shadowOpacity: Platform.OS === 'android' ? 0.1 : 0.08,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: -7 },
      },
    }}>
      <Tabs.Screen name="index" options={{ title: 'خانه', tabBarIcon: ({ color }) => <Feather name="home" size={20} color={color} /> }} />
      <Tabs.Screen name="protocols" options={{ title: 'مسیرها', tabBarIcon: ({ color }) => <Feather name="radio" size={20} color={color} /> }} />
      <Tabs.Screen name="activity" options={{ title: 'وضعیت', tabBarIcon: ({ color }) => <Feather name="activity" size={20} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'تنظیمات', tabBarIcon: ({ color }) => <Feather name="sliders" size={20} color={color} /> }} />
      <Tabs.Screen name="profiles" options={{ href: null }} />
    </Tabs>
  );
}
