export type XrayServerHealth = {
  tcpReachable?: boolean;
  latencyMs?: number | null;
  checkedAt?: number;
  lastTrafficResult?: 'passed' | 'failed';
  lastTrafficAt?: number;
};

export type XrayServerHealthMap = Record<string, XrayServerHealth>;
export type TcpProbeResult = {
  id: string;
  reachable: boolean;
  latencyMs: number | null;
};

const healthBySubscription = new Map<string, XrayServerHealthMap>();
export const XRAY_LATENCY_MAX_AGE_MS = 90_000;
const TRAFFIC_RESULT_MAX_AGE_MS = 30 * 60_000;
const RECENT_FAILURE_MS = 2 * 60_000;
const UDP_PROTOCOLS = new Set(['hysteria2', 'hy2', 'tuic']);

function getMap(subscriptionId: string): XrayServerHealthMap {
  return healthBySubscription.get(subscriptionId) ?? {};
}

export function getXrayServerHealth(subscriptionId: string): XrayServerHealthMap {
  return { ...getMap(subscriptionId) };
}

export function mergeXrayTcpResults(
  subscriptionId: string,
  results: TcpProbeResult[],
  checkedAt = Date.now(),
): XrayServerHealthMap {
  const next = { ...getMap(subscriptionId) };
  for (const result of results) {
    if (!result.id) continue;
    const previous = next[result.id] ?? {};
    const latencyMs = result.latencyMs;
    next[result.id] = {
      ...previous,
      tcpReachable: result.reachable === true,
      latencyMs: result.reachable && Number.isFinite(latencyMs) && Number(latencyMs) >= 0
        ? Number(latencyMs)
        : null,
      checkedAt,
    };
  }
  healthBySubscription.set(subscriptionId, next);
  return { ...next };
}

export function recordXrayTrafficValidation(
  subscriptionId: string,
  serverId: string,
  passed: boolean,
  checkedAt = Date.now(),
): XrayServerHealthMap {
  if (!serverId) return getXrayServerHealth(subscriptionId);
  const next = { ...getMap(subscriptionId) };
  next[serverId] = {
    ...(next[serverId] ?? {}),
    lastTrafficResult: passed ? 'passed' : 'failed',
    lastTrafficAt: checkedAt,
  };
  healthBySubscription.set(subscriptionId, next);
  return { ...next };
}

export function hasFreshXrayTcpResults(
  subscriptionId: string,
  serverIds: string[],
  now = Date.now(),
  maxAgeMs = XRAY_LATENCY_MAX_AGE_MS,
): boolean {
  if (!serverIds.length) return false;
  const health = getMap(subscriptionId);
  return serverIds.every((id) => {
    const checkedAt = health[id]?.checkedAt;
    return typeof checkedAt === 'number' &&
      checkedAt <= now &&
      now - checkedAt <= maxAgeMs;
  });
}

export function rankXrayServers<T extends { id: string }>(
  subscriptionId: string,
  servers: T[],
  now = Date.now(),
): T[] {
  const health = getMap(subscriptionId);
  return servers
    .map((server, index) => ({ server, index, state: health[server.id] }))
    .sort((left, right) => {
      const priority = (entry: typeof left) => {
        const state = entry.state;
        const recent = typeof state?.lastTrafficAt === 'number' &&
          now >= state.lastTrafficAt;
        if (
          state?.lastTrafficResult === 'passed' &&
          recent &&
          now - state.lastTrafficAt! <= TRAFFIC_RESULT_MAX_AGE_MS
        ) return 0;
        if (
          state?.lastTrafficResult === 'failed' &&
          recent &&
          now - state.lastTrafficAt! <= RECENT_FAILURE_MS
        ) return 4;

        const protocol = 'protocol' in entry.server && typeof entry.server.protocol === 'string'
          ? entry.server.protocol.toLowerCase()
          : '';
        const supportsTcpLatency = !UDP_PROTOCOLS.has(protocol);
        const freshTcpResult = typeof state?.checkedAt === 'number' &&
          state.checkedAt <= now &&
          now - state.checkedAt <= XRAY_LATENCY_MAX_AGE_MS;
        if (!supportsTcpLatency || !freshTcpResult) return 2;
        return state?.tcpReachable === true ? 1 : 3;
      };
      const leftPriority = priority(left);
      const rightPriority = priority(right);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftLatency = leftPriority === 1 && Number.isFinite(left.state?.latencyMs)
        ? left.state!.latencyMs!
        : Number.POSITIVE_INFINITY;
      const rightLatency = rightPriority === 1 && Number.isFinite(right.state?.latencyMs)
        ? right.state!.latencyMs!
        : Number.POSITIVE_INFINITY;
      if (leftLatency !== rightLatency) return leftLatency - rightLatency;
      return left.index - right.index;
    })
    .map(({ server }) => server);
}

export function clearXrayServerHealth(subscriptionId?: string): void {
  if (subscriptionId) {
    healthBySubscription.delete(subscriptionId);
    return;
  }
  healthBySubscription.clear();
}
