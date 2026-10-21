import type { XrayShareServer } from './xray-share-links';
import { pingXrayServers } from './vpn-engine';
import {
  getXrayServerHealth,
  hasFreshXrayTcpResults,
  mergeXrayTcpResults,
  type XrayServerHealthMap,
} from './xray-server-health';

export const MAX_XRAY_LATENCY_PROBES = 48;
const inFlightBySubscription = new Map<string, Promise<XrayServerHealthMap>>();

export async function refreshXrayServerLatencies(
  subscriptionId: string,
  servers: readonly XrayShareServer[],
  force = false,
): Promise<XrayServerHealthMap> {
  const boundedServers = servers.slice(0, MAX_XRAY_LATENCY_PROBES);
  if (!boundedServers.length) return getXrayServerHealth(subscriptionId);

  if (!force && hasFreshXrayTcpResults(subscriptionId, boundedServers.map((server) => server.id))) {
    return getXrayServerHealth(subscriptionId);
  }

  const activeScan = inFlightBySubscription.get(subscriptionId);
  if (activeScan) {
    await activeScan.catch(() => undefined);
    if (hasFreshXrayTcpResults(subscriptionId, boundedServers.map((server) => server.id))) {
      return getXrayServerHealth(subscriptionId);
    }
  }

  const scan = pingXrayServers(boundedServers)
    .then((pingResults) => mergeXrayTcpResults(
      subscriptionId,
      boundedServers.map((server) => ({
        id: server.id,
        reachable: pingResults[server.id] !== null && pingResults[server.id] !== undefined,
        latencyMs: pingResults[server.id] ?? null,
      })),
    ));
  inFlightBySubscription.set(subscriptionId, scan);
  try {
    return await scan;
  } finally {
    if (inFlightBySubscription.get(subscriptionId) === scan) {
      inFlightBySubscription.delete(subscriptionId);
    }
  }
}
