import { randomUUID } from "node:crypto";

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function createWireGuardMobileConfig(
  config: string,
  serviceId: number,
  hostId: string,
  locationName: string,
): string {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0 || !/^[A-Za-z0-9._-]{1,80}$/.test(hostId)) {
    throw new Error("Invalid WireGuard profile identity.");
  }
  if (!/^\s*\[Interface\]\s*$/im.test(config) || !/^\s*\[Peer\]\s*$/im.test(config)) {
    throw new Error("WireGuard config cannot be represented as an iOS profile.");
  }
  if (/^\s*(?:FwMark|Table|PreUp|PostUp|PreDown|PostDown|SaveConfig)\s*=/im.test(config)) {
    throw new Error("This WireGuard config contains options unsupported by iOS configuration profiles.");
  }
  const endpoint = config.match(/^\s*Endpoint\s*=\s*(.+?)\s*$/im)?.[1]?.trim();
  if (!endpoint) throw new Error("WireGuard config is missing the endpoint required by iOS.");

  const safeLocation = hostId.replace(/[^A-Za-z0-9.-]/g, "-");
  const identifier = `com.pulse.wireguard.service-${serviceId}.location-${safeLocation}`;
  const displayName = `Pulse WireGuard - ${locationName}`;
  const profileUuid = randomUUID().toUpperCase();
  const tunnelUuid = randomUUID().toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key><string>${xmlEscape(displayName)}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>${xmlEscape(identifier)}</string>
  <key>PayloadUUID</key><string>${profileUuid}</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadDisplayName</key><string>VPN</string>
      <key>PayloadType</key><string>com.apple.vpn.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>${xmlEscape(`${identifier}.vpn`)}</string>
      <key>PayloadUUID</key><string>${tunnelUuid}</string>
      <key>UserDefinedName</key><string>${xmlEscape(displayName)}</string>
      <key>VPNType</key><string>VPN</string>
      <key>VPNSubType</key><string>com.wireguard.ios</string>
      <key>VendorConfig</key>
      <dict>
        <key>WgQuickConfig</key><string>${xmlEscape(config.trim())}</string>
      </dict>
      <key>VPN</key>
      <dict>
        <key>RemoteAddress</key><string>${xmlEscape(endpoint)}</string>
        <key>AuthenticationMethod</key><string>Password</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;
}
