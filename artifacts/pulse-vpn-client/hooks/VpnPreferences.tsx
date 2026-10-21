import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type VpnProtocol = 'v2ray' | 'openvpn' | 'wireguard' | 'amneziawg';
type VpnPreferencesValue = {
  protocol: VpnProtocol | null;
  subscriptionId: string | null;
  serverId: string | null;
  serverName: string | null;
  ready: boolean;
  chooseProtocol: (protocol: VpnProtocol) => void;
  chooseSubscription: (id: string) => void;
  chooseServer: (id: string, name: string) => void;
  clear: () => void;
};
const PreferencesContext = createContext<VpnPreferencesValue | null>(null);
const STORE_KEY = 'pulse.vpn.preferences.v1';

export function VpnPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [protocol, setProtocol] = useState<VpnProtocol | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [serverName, setServerName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const current = useRef({ protocol: null as VpnProtocol | null, subscriptionId: null as string | null, serverId: null as string | null, serverName: null as string | null });

  useEffect(() => {
    void AsyncStorage.getItem(STORE_KEY).then((saved) => {
      if (!saved) return;
      try {
        const value = JSON.parse(saved) as { protocol?: VpnProtocol; subscriptionId?: string; serverId?: string; serverName?: string };
        if (['v2ray', 'openvpn', 'wireguard', 'amneziawg'].includes(value.protocol ?? '')) setProtocol(value.protocol ?? null);
        setSubscriptionId(value.subscriptionId ?? null);
        setServerId(value.serverId ?? null);
        setServerName(value.serverName ?? null);
        current.current = {
          protocol: value.protocol ?? null,
          subscriptionId: value.subscriptionId ?? null,
          serverId: value.serverId ?? null,
          serverName: value.serverName ?? null,
        };
      } catch {
        void AsyncStorage.removeItem(STORE_KEY);
      }
    }).catch(() => undefined).finally(() => setReady(true));
  }, []);

  const persist = (next: { protocol: VpnProtocol | null; subscriptionId: string | null; serverId: string | null; serverName: string | null }) => {
    current.current = next;
    void AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => undefined);
  };
  const chooseProtocol = (value: VpnProtocol) => {
    setProtocol(value);
    setServerId(null);
    setServerName(null);
    persist({ ...current.current, protocol: value, serverId: null, serverName: null });
  };
  const chooseSubscription = (value: string) => {
    setSubscriptionId(value);
    setServerId(null);
    setServerName(null);
    persist({ ...current.current, subscriptionId: value, serverId: null, serverName: null });
  };
  const chooseServer = (id: string, name: string) => {
    setServerId(id);
    setServerName(name);
    persist({ ...current.current, serverId: id, serverName: name });
  };
  const clear = () => {
    const empty = { protocol: null, subscriptionId: null, serverId: null, serverName: null };
    setProtocol(null);
    setSubscriptionId(null);
    setServerId(null);
    setServerName(null);
    current.current = empty;
    void AsyncStorage.removeItem(STORE_KEY).catch(() => undefined);
  };
  const value = useMemo(() => ({ protocol, subscriptionId, serverId, serverName, ready, chooseProtocol, chooseSubscription, chooseServer, clear }), [protocol, subscriptionId, serverId, serverName, ready]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useVpnPreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('VpnPreferencesProvider is missing');
  return value;
}
