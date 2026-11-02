export type PublicVpnProtocol = "openvpn" | "wireguard" | "amneziawg";
export type PublicProfileExtension = ".conf" | ".ovpn" | ".mobileconfig" | ".zip";

const protocolTitle: Record<PublicVpnProtocol, string> = {
  openvpn: "OpenVPN",
  wireguard: "WireGuard",
  amneziawg: "AmneziaWG",
};

export function publicProfileName(protocol: PublicVpnProtocol, ordinal: number): string {
  const safeOrdinal = Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 1;
  return `${protocolTitle[protocol]} · Server ${String(safeOrdinal).padStart(2, "0")}`;
}

export function publicProfileFilename(
  serviceId: number | string,
  protocol: PublicVpnProtocol,
  ordinal: number,
  extension: PublicProfileExtension,
): string {
  const numericId = Number(serviceId);
  const serviceCode = Number.isSafeInteger(numericId) && numericId > 0
    ? `PULSE-${String(numericId).padStart(6, "0")}`
    : "PULSE";
  const safeOrdinal = Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 1;
  return `${serviceCode}-${protocolTitle[protocol]}-${String(safeOrdinal).padStart(2, "0")}${extension}`;
}

export function publicProfileBundleFilename(
  serviceId: number | string,
  protocol: PublicVpnProtocol,
  extension: ".zip" | ".mobileconfig",
): string {
  const numericId = Number(serviceId);
  const serviceCode = Number.isSafeInteger(numericId) && numericId > 0
    ? `PULSE-${String(numericId).padStart(6, "0")}`
    : "PULSE";
  return `${serviceCode}-${protocolTitle[protocol]}-all${extension}`;
}
