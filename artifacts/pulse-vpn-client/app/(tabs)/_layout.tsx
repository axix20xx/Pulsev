import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.primary,
      tabBarInactiveTintColor: c.mutedForeground,
      tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 2 },
      tabBarStyle: {
        backgroundColor: c.card,
        borderTopColor: c.border,
        borderTopWidth: 1,
        height: Platform.OS === 'web' ? 84 : 64,
        paddingTop: 7,
        paddingBottom: Platform.OS === 'web' ? 28 : 8,
        elevation: 0,
      },
    }}>
      <Tabs.Screen name="index" options={{ title: 'خانه', tabBarIcon: ({ color }) => <Feather name="grid" size={21} color={color} /> }} />
      <Tabs.Screen name="profiles" options={{ title: 'اشتراک‌ها', tabBarIcon: ({ color }) => <Feather name="layers" size={21} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'تنظیمات', tabBarIcon: ({ color }) => <Feather name="sliders" size={21} color={color} /> }} />
    </Tabs>
  );
}
