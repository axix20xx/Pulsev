import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { XrayShareServer } from '@/lib/xray-share-links';
import {
  getXrayServerHealth,
  hasFreshXrayTcpResults,
  type XrayServerHealthMap,
} from '@/lib/xray-server-health';
import {
  getAmneziaWgStatus,
  getOpenVpnStatus,
  getWireGuardStatus,
  getXrayState,
} from '@/lib/vpn-engine';
import { refreshXrayServerLatencies } from '@/lib/xray-latency';
import { isNativeTunnelConnected, isNativeTunnelConnecting } from '@/lib/tunnel-state';

const MAX_BACKGROUND_PROBES = 48;
const RESCAN_INTERVAL_MS = 60_000;

async function hasNoPulseTunnel(): Promise<boolean> {
  try {
    const [xray, openvpn, wireguard, amneziawg] = await Promise.all([
      getXrayState(),
      getOpenVpnStatus(),
      getWireGuardStatus(),
      getAmneziaWgStatus(),
    ]);
    const nativeStates = [openvpn, wireguard, amneziawg];
    const active = xray.state === 'connected' ||
      ['preparing', 'connecting', 'disconnecting'].includes(xray.state) ||
      nativeStates.some((state) =>
        state.isConnected ||
        state.status === 'CONNECTED' ||
        state.tunnelState === 'ACTIVE' ||
        isNativeTunnelConnected(state) ||
        isNativeTunnelConnecting(state),
      );
    return !active;
  } catch {
    // Do not probe through a tunnel when native state cannot be confirmed.
    return false;
  }
}

export function useXrayLatencyScan(
  subscriptionId: string | null | undefined,
  servers: readonly XrayShareServer[],
  enabled: boolean,
) {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [scanning, setScanning] = useState(false);
  const [health, setHealth] = useState<XrayServerHealthMap>({});
  const inFlight = useRef(false);
  const canUpdate = useRef(false);
  const serverIds = useMemo(() => servers.map((server) => server.id), [servers]);
  const serverSignature = useMemo(() => serverIds.join('\u001f'), [serverIds]);
  const scanServers = useMemo(() => servers.slice(0, MAX_BACKGROUND_PROBES), [servers]);

  useEffect(() => {
    const syncForeground = (state: string) => setForeground(state === 'active');
    const listener = AppState.addEventListener('change', syncForeground);
    return () => listener.remove();
  }, []);

  useEffect(() => {
    setHealth(subscriptionId ? getXrayServerHealth(subscriptionId) : {});
  }, [subscriptionId, serverSignature]);

  const scan = useCallback(async (force = false) => {
    if (!subscriptionId || !scanServers.length || inFlight.current) return;
    if (!force && hasFreshXrayTcpResults(subscriptionId, scanServers.map((server) => server.id))) {
      setHealth(getXrayServerHealth(subscriptionId));
      return;
    }
    if (!(await hasNoPulseTunnel()) || !canUpdate.current) return;

    inFlight.current = true;
    setScanning(true);
    try {
      const updated = await refreshXrayServerLatencies(subscriptionId, scanServers, force);
      if (!canUpdate.current) return;
      setHealth(updated);
    } catch {
      // Latency is informational only; a failed probe must not block selection.
    } finally {
      inFlight.current = false;
      if (canUpdate.current) setScanning(false);
    }
  }, [scanServers, subscriptionId]);

  useEffect(() => {
    canUpdate.current = enabled && focused && foreground;
    if (!canUpdate.current || !subscriptionId || !scanServers.length) {
      setScanning(false);
      return;
    }
    void scan();
    const interval = setInterval(() => void scan(), RESCAN_INTERVAL_MS);
    return () => {
      canUpdate.current = false;
      clearInterval(interval);
    };
  }, [enabled, focused, foreground, scan, scanServers.length, subscriptionId]);

  const refresh = useCallback(() => scan(true), [scan]);
  return { health, scanning, refresh };
}
