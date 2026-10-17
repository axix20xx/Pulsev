import { createHash } from "node:crypto";
import { build as buildPlist, parse as parsePlist, type PlistValue } from "plist";

export type MobileConfigProtocol = "openvpn" | "wireguard" | "amneziawg";

export type MobileConfigEntry = {
  protocol: MobileConfigProtocol;
  config: string;
  serverId: string;
  serverName: string;
};

const MAX_ENTRIES = 80;
const IPSEC_CERTIFICATE_PAYLOAD_TYPES = new Set([
  "com.apple.security.pem",
  "com.apple.security.pkcs1",
  "com.apple.security.pkcs12",
  "com.apple.security.root",
]);
function isPlistDictionary(value: PlistValue | undefined): value is { [key: string]: PlistValue } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date));
}

function isIkev2VpnPayload(payload: { [key: string]: PlistValue }): boolean {
  const nestedVpnType = isPlistDictionary(payload.VPN) ? payload.VPN.VPNType : undefined;
  const hasIkev2Settings = isPlistDictionary(payload.IKEv2) && Object.keys(payload.IKEv2).length > 0;
  return [payload.VPNType, nestedVpnType].some(
    (value) => typeof value === "string" && value.trim().toLowerCase() === "ikev2",
  ) || hasIkev2Settings;
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function stableUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha1").update("pulse-mobileconfig-v1\0").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeServerId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error("Invalid server identity in mobileconfig.");
  }
  return value.replace(/[^A-Za-z0-9.-]/g, "-");
}

function parseOpenVpnVendorConfig(profile: string): Map<string, string> {
  const directives = new Map<string, string>();
  const counts = new Map<string, number>();
  const lines = profile.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  let inlineTag: string | null = null;
  let inlineValue: string[] = [];
  let remoteCount = 0;

  const addDirective = (name: string, value: string) => {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    directives.set(count === 1 ? name : `${name}.${count}`, value || "NOARGS");
    if (name === "remote") remoteCount += 1;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (inlineTag) {
      if (line.toLowerCase() === `</${inlineTag}>`) {
        addDirective(inlineTag, inlineValue.join("\n"));
        inlineTag = null;
        inlineValue = [];
      } else {
        inlineValue.push(rawLine);
      }
      continue;
    }
    if (line.startsWith("#") || line.startsWith(";")) continue;
    const openTag = line.match(/^<(ca|cert|key|tls-auth|tls-crypt|tls-crypt-v2|dh)>$/i);
    if (openTag) {
      inlineTag = openTag[1].toLowerCase();
      inlineValue = [];
      continue;
    }
    if (/^<\/?(?:connection|auth-user-pass)>$/i.test(line)) {
      if (/^<connection>$/i.test(line)) {
        throw new Error("OpenVPN mobileconfig does not support nested connection blocks.");
      }
      throw new Error("OpenVPN auth blocks cannot be converted to a mobileconfig.");
    }
    if (/^<(?:ca|cert|key|tls-auth|tls-crypt|tls-crypt-v2|dh|connection|auth-user-pass)>/i.test(line)) {
      throw new Error("OpenVPN profile contains an unsupported or malformed inline block.");
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.*))?$/);
    if (!match) throw new Error("OpenVPN profile contains an invalid directive.");
    const name = match[1].toLowerCase();
    let value = match[2]?.trim() ?? "";

    if (["config", "cd", "chroot", "daemon", "group", "log", "log-append", "management", "plugin", "script-security", "status", "user", "writepid", "up", "down", "route-up", "route-pre-down"].includes(name)) {
      throw new Error(`OpenVPN directive "${name}" cannot be represented safely in an iOS profile.`);
    }
    if (["ca", "cert", "key", "tls-auth", "tls-crypt", "tls-crypt-v2", "dh", "pkcs12"].includes(name)) {
      if (value) {
        throw new Error(`OpenVPN directive "${name}" must contain inline data for iOS import.`);
      }
    }
    if (name === "auth-user-pass") {
      // A server-side file path cannot exist on the customer's phone. Leave it
      // as a promptable directive in the OpenVPN Connect profile instead.
      value = "";
    }
    if (name === "remote") remoteCount += 1;
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    directives.set(count === 1 ? name : `${name}.${count}`, value || "NOARGS");
  }

  if (inlineTag) throw new Error(`OpenVPN profile is missing </${inlineTag}>.`);
  if (!remoteCount) throw new Error("OpenVPN profile is missing its remote server directive.");
  const hasCert = [...directives.keys()].some((key) => key === "cert" || /^cert\.\d+$/.test(key));
  const hasKey = [...directives.keys()].some((key) => key === "key" || /^key\.\d+$/.test(key));
  if (hasCert !== hasKey) throw new Error("OpenVPN profile must provide both the client certificate and private key.");
  if (!hasCert) {
    const count = (counts.get("setenv") ?? 0) + 1;
    counts.set("setenv", count);
    directives.set(count === 1 ? "setenv" : `setenv.${count}`, "CLIENT_CERT 0");
  }
  directives.set("vpn-on-demand", "0");
  return directives;
}

function wireGuardPayload(entry: MobileConfigEntry, serviceId: number, hostId: string): string {
  const config = entry.config.trim();
  if (!/^\s*\[Interface\]\s*$/im.test(config) || !/^\s*\[Peer\]\s*$/im.test(config)) {
    throw new Error("WireGuard profile cannot be represented as an iOS configuration.");
  }
  if (/^\s*(?:FwMark|Table|PreUp|PostUp|PreDown|PostDown|SaveConfig)\s*=/im.test(config)) {
    throw new Error("WireGuard profile contains options unsupported by iOS.");
  }
  const endpoint = config.match(/^\s*Endpoint\s*=\s*(.+?)\s*$/im)?.[1]?.trim();
  if (!endpoint) throw new Error("WireGuard profile is missing its endpoint.");
  const subtype = entry.protocol === "amneziawg" ? "org.amnezia.awg" : "com.wireguard.ios";
  const identifier = `com.pulse.all.${entry.protocol}.service-${serviceId}.location-${hostId}.vpn`;
  const displayName = `Pulse ${entry.protocol === "amneziawg" ? "AmneziaWG" : "WireGuard"} · ${entry.serverName}`;

  return `    <dict>
      <key>PayloadDisplayName</key><string>VPN</string>
      <key>PayloadType</key><string>com.apple.vpn.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>${escapeXml(identifier)}</string>
      <key>PayloadUUID</key><string>${stableUuid(identifier)}</string>
      <key>UserDefinedName</key><string>${escapeXml(displayName)}</string>
      <key>VPNType</key><string>VPN</string>
      <key>VPNSubType</key><string>${subtype}</string>
      <key>VendorConfig</key><dict><key>WgQuickConfig</key><string>${escapeXml(config)}</string></dict>
      <key>VPN</key><dict>
        <key>RemoteAddress</key><string>${escapeXml(endpoint)}</string>
        <key>AuthenticationMethod</key><string>Password</string>
      </dict>
    </dict>`;
}

function openVpnPayload(entry: MobileConfigEntry, serviceId: number, hostId: string): string {
  const directives = parseOpenVpnVendorConfig(entry.config);
  const identifier = `com.pulse.all.openvpn.service-${serviceId}.location-${hostId}.vpn`;
  const displayName = `Pulse OpenVPN · ${entry.serverName}`;
  const vendorConfig = [...directives.entries()]
    .map(([key, value]) => `<key>${escapeXml(key)}</key><string>${escapeXml(value.replace(/\r\n?/g, "\n").replace(/\n/g, "\\n"))}</string>`)
    .join("");
  return `    <dict>
      <key>PayloadDisplayName</key><string>VPN</string>
      <key>PayloadType</key><string>com.apple.vpn.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>${escapeXml(identifier)}</string>
      <key>PayloadUUID</key><string>${stableUuid(identifier)}</string>
      <key>UserDefinedName</key><string>${escapeXml(displayName)}</string>
      <key>VPNType</key><string>VPN</string>
      <key>VPNSubType</key><string>net.openvpn.connect.app</string>
      <key>VPN</key><dict>
        <key>AuthName</key><string>DEFAULT</string>
        <key>AuthenticationMethod</key><string>Password</string>
        <key>RemoteAddress</key><string>DEFAULT</string>
      </dict>
      <key>VendorConfig</key><dict>${vendorConfig}</dict>
    </dict>`;
}

/**
 * Create one iOS profile containing all supported, active VPN apps for a
 * service. Each protocol/server remains a separate selectable tunnel.
 */
export function createMultiProtocolMobileConfigBundle(
  entries: MobileConfigEntry[],
  serviceId: number,
  ipsecProfile?: string | null,
): string {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    throw new Error("Invalid service identity in mobileconfig.");
  }
  if ((!entries.length && !ipsecProfile) || entries.length > MAX_ENTRIES) {
    throw new Error(`An iOS profile must contain between 1 and ${MAX_ENTRIES} connections.`);
  }
  const identities = entries.map((entry) => `${entry.protocol}:${entry.serverId}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("A combined iOS profile cannot contain duplicate server identities.");
  }

  const normalized = entries.map((entry) => ({
    ...entry,
    hostId: safeServerId(entry.serverId),
    serverName: entry.serverName.trim().slice(0, 120) || entry.serverId,
  }));
  const profileIdentifier = `com.pulse.service-${serviceId}.all-vpn.profile`;
  const payloads = normalized.map((entry) =>
    entry.protocol === "openvpn"
      ? openVpnPayload(entry, serviceId, entry.hostId)
      : wireGuardPayload(entry, serviceId, entry.hostId),
  );
  if (ipsecProfile) {
    const parsed = parsePlist(ipsecProfile);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("AzadPanel returned an invalid IPsec iOS profile.");
    }
    const sourcePayloads = (parsed as { PayloadContent?: PlistValue }).PayloadContent;
    if (!Array.isArray(sourcePayloads)) {
      throw new Error("AzadPanel IPsec profile contains no iOS payloads.");
    }
    const allowed = sourcePayloads.filter((value): value is { [key: string]: PlistValue } => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const payload = value as { [key: string]: PlistValue };
      const type = payload.PayloadType;
      if (type === "com.apple.vpn.managed") {
        return isIkev2VpnPayload(payload);
      }
      return typeof type === "string" && IPSEC_CERTIFICATE_PAYLOAD_TYPES.has(type);
    });
    const ikev2Count = allowed.filter((value) => value.PayloadType === "com.apple.vpn.managed").length;
    if (!ikev2Count) {
      throw new Error("AzadPanel IPsec profile contains no IKEv2 connection.");
    }
    const plistFragment = (value: PlistValue): string => {
      const serialized = buildPlist(value);
      const fragment = serialized
        .replace(/^\s*<\?xml[^>]*\?>\s*/i, "")
        .replace(/^\s*<!DOCTYPE plist[^>]*>\s*/i, "")
        .replace(/^\s*<plist[^>]*>\s*/i, "")
        .replace(/\s*<\/plist>\s*$/i, "");
      if (!fragment.trim()) throw new Error("Could not encode the AzadPanel IPsec profile.");
      return `    ${fragment.replace(/\n/g, "\n    ")}`;
    };
    payloads.push(...allowed.map(plistFragment));
  }
  if (payloads.length > MAX_ENTRIES) {
    throw new Error(`An iOS profile must contain no more than ${MAX_ENTRIES} connections and certificates.`);
  }
  const displayProtocols: string[] = [...new Set(normalized.map((entry) => entry.protocol))]
    .map((protocol) => protocol === "openvpn" ? "OpenVPN" : protocol === "amneziawg" ? "AmneziaWG" : "WireGuard");
  if (ipsecProfile) displayProtocols.push("IPsec");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key><string>Pulse · ${escapeXml(displayProtocols.join(" · "))}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>${escapeXml(profileIdentifier)}</string>
  <key>PayloadUUID</key><string>${stableUuid(profileIdentifier)}</string>
  <key>PayloadContent</key><array>
${payloads.join("\n")}
  </array>
</dict>
</plist>`;
}
