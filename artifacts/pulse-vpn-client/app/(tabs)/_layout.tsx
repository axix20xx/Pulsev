import React from 'react';
import { Platform, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.primary,
      tabBarInactiveTintColor: c.mutedForeground,
        tabBarLabelStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 3 },
       sceneStyle: { backgroundColor: c.background },
       tabBarStyle: {
         backgroundColor: c.background,
         borderTopColor: c.border,
         borderTopWidth: 1,
          height: Platform.OS === 'web' ? 84 : 68 + bottomInset,
          paddingTop: 9,
         paddingBottom: bottomInset,
         marginHorizontal: 0,
         marginBottom: 0,
         borderRadius: 0,
         elevation: 0,
         shadowColor: c.foreground,
         shadowOpacity: 0.06,
         shadowRadius: 14,
         shadowOffset: { width: 0, height: -5 },
       },
       tabBarBackground: () => <View style={{ flex: 1, backgroundColor: c.background }} />,
    }}>
      <Tabs.Screen name="index" options={{ title: 'خانه', tabBarIcon: ({ color }) => <Feather name="home" size={20} color={color} /> }} />
      <Tabs.Screen name="protocols" options={{ title: 'مسیرها', tabBarIcon: ({ color }) => <Feather name="radio" size={20} color={color} /> }} />
      <Tabs.Screen name="activity" options={{ title: 'وضعیت', tabBarIcon: ({ color }) => <Feather name="activity" size={20} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'تنظیمات', tabBarIcon: ({ color }) => <Feather name="sliders" size={20} color={color} /> }} />
      <Tabs.Screen name="profiles" options={{ href: null }} />
    </Tabs>
  );
}
