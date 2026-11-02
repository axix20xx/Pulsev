import { createHash } from "node:crypto";

export type WireGuardMobileConfigTunnel = {
  config: string;
  hostId: string;
  locationName: string;
};

export type WireGuardMobileConfigProtocol = "wireguard" | "amneziawg";

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const uuidNamespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

function stablePayloadUuid(identifier: string): string {
  const bytes = Buffer.from(
    createHash("sha1").update(uuidNamespace).update(identifier).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeTunnel(tunnel: WireGuardMobileConfigTunnel): {
  config: string;
  hostId: string;
  locationName: string;
  endpoint: string;
} {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(tunnel.hostId)) {
    throw new Error("Invalid WireGuard profile identity.");
  }
  const config = tunnel.config.trim();
  if (!/^\s*\[Interface\]\s*$/im.test(config) || !/^\s*\[Peer\]\s*$/im.test(config)) {
    throw new Error("WireGuard config cannot be represented as an iOS profile.");
  }
  if (/^\s*(?:FwMark|Table|PreUp|PostUp|PreDown|PostDown|SaveConfig)\s*=/im.test(config)) {
    throw new Error("This WireGuard config contains options unsupported by iOS configuration profiles.");
  }
  const endpoint = config.match(/^\s*Endpoint\s*=\s*(.+?)\s*$/im)?.[1]?.trim();
  if (!endpoint) throw new Error("WireGuard config is missing the endpoint required by iOS.");
  return {
    config,
    hostId: tunnel.hostId.replace(/[^A-Za-z0-9.-]/g, "-"),
    locationName: tunnel.locationName.trim().slice(0, 120) || `Location ${tunnel.hostId}`,
    endpoint,
  };
}

function tunnelPayload(
  tunnel: ReturnType<typeof safeTunnel>,
  serviceId: number,
  protocol: WireGuardMobileConfigProtocol,
): string {
  const displayName = `Pulse ${protocol === "amneziawg" ? "AmneziaWG" : "WireGuard"} · ${tunnel.locationName}`;
  const identifier = `com.pulse.${protocol}.service-${serviceId}.location-${tunnel.hostId}`;
  const appBundleId = protocol === "amneziawg" ? "org.amnezia.awg" : "com.wireguard.ios";
  return `    <dict>
      <key>PayloadDisplayName</key><string>VPN</string>
      <key>PayloadType</key><string>com.apple.vpn.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>${xmlEscape(`${identifier}.vpn`)}</string>
      <key>PayloadUUID</key><string>${stablePayloadUuid(`${identifier}.vpn`)}</string>
      <key>UserDefinedName</key><string>${xmlEscape(displayName)}</string>
      <key>VPNType</key><string>VPN</string>
      <key>VPNSubType</key><string>${appBundleId}</string>
      <key>VendorConfig</key>
      <dict><key>WgQuickConfig</key><string>${xmlEscape(tunnel.config)}</string></dict>
      <key>VPN</key>
      <dict>
        <key>RemoteAddress</key><string>${xmlEscape(tunnel.endpoint)}</string>
        <key>AuthenticationMethod</key><string>Password</string>
      </dict>
    </dict>`;
}

/**
 * Builds an Apple configuration profile containing one or more independent
 * WireGuard-family tunnels. iOS imports the tunnels together; the user picks
 * which one to activate in the client rather than routing through all servers
 * as a single ambiguous tunnel.
 */
export function createWireGuardMobileConfigBundle(
  tunnels: WireGuardMobileConfigTunnel[],
  serviceId: number,
  protocol: WireGuardMobileConfigProtocol = "wireguard",
): string {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    throw new Error("Invalid WireGuard profile identity.");
  }
  if (tunnels.length < 1 || tunnels.length > 40) {
    throw new Error("An iOS profile must contain between 1 and 40 tunnels.");
  }
  const normalized = tunnels.map(safeTunnel);
  const uniqueHosts = new Set(normalized.map((tunnel) => tunnel.hostId));
  if (uniqueHosts.size !== normalized.length) {
    throw new Error("An iOS profile cannot contain duplicate server identities.");
  }
  const profileName = `Pulse ${protocol === "amneziawg" ? "AmneziaWG" : "WireGuard"} · ${normalized.length} server${normalized.length === 1 ? "" : "s"}`;
  const serverSetId = createHash("sha256")
    .update(normalized.map((tunnel) => tunnel.hostId).sort().join("\0"))
    .digest("hex")
    .slice(0, 16);
  const profileIdentifier = `com.pulse.${protocol}.service-${serviceId}.servers-${serverSetId}.profile`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key><string>${xmlEscape(profileName)}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>${xmlEscape(profileIdentifier)}</string>
  <key>PayloadUUID</key><string>${stablePayloadUuid(profileIdentifier)}</string>
  <key>PayloadContent</key>
  <array>
${normalized.map((tunnel) => tunnelPayload(tunnel, serviceId, protocol)).join("\n")}
  </array>
</dict>
</plist>`;
}

export function createWireGuardMobileConfig(
  config: string,
  serviceId: number,
  hostId: string,
  locationName: string,
): string {
  return createWireGuardMobileConfigBundle(
    [{ config, hostId, locationName }],
    serviceId,
    "wireguard",
  );
}
