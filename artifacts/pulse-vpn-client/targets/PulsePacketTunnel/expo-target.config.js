module.exports = {
  type: "network-packet-tunnel",
  name: "PulsePacketTunnel",
  displayName: "Pulse VPN Tunnel",
  bundleIdentifier: ".PacketTunnel",
  deploymentTarget: "15.1",
  frameworks: ["NetworkExtension", "Security", "Network", "SystemConfiguration"],
  entitlements: {
    "com.apple.developer.networking.networkextension": ["packet-tunnel-provider"],
    "com.apple.security.application-groups": ["group.com.pulse.vpnclient"],
    "keychain-access-groups": ["$(AppIdentifierPrefix)com.pulse.vpnclient.shared"],
  },
};
