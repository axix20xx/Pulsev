#!/usr/bin/env bash
set -euo pipefail

app_path="${1:?Pass the built PulseVPNClient.app path}"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_entitlements="$project_root/ios/PulseVPNClient/PulseVPNClient.entitlements"
tunnel_entitlements="$project_root/ios/.targets/PulsePacketTunnel/generated.entitlements"
tunnel_app="$app_path/PlugIns/PulsePacketTunnel.appex"

for entitlements in "$app_entitlements" "$tunnel_entitlements"; do
  if [[ ! -f "$entitlements" ]] || ! /usr/libexec/PlistBuddy \
    -c 'Print :com.apple.developer.networking.networkextension' "$entitlements" \
    | grep -Fq 'packet-tunnel-provider'; then
    echo "::error::Missing packet-tunnel-provider entitlement in $entitlements"
    exit 1
  fi
done

if [[ ! -d "$tunnel_app" ]]; then
  echo "::error::PulsePacketTunnel.appex is missing from the built app."
  exit 1
fi

app_bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Info.plist")
tunnel_bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$tunnel_app/Info.plist")
tunnel_point=$(/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionPointIdentifier' "$tunnel_app/Info.plist")

if [[ "$app_bundle_id" != "com.pulse.vpnclient" ]]; then
  echo "::error::Unexpected app bundle identifier: $app_bundle_id"
  exit 1
fi
if [[ "$tunnel_bundle_id" != "com.pulse.vpnclient.PacketTunnel" ]]; then
  echo "::error::Unexpected tunnel bundle identifier: $tunnel_bundle_id"
  exit 1
fi
if [[ "$tunnel_point" != "com.apple.networkextension.packet-tunnel" ]]; then
  echo "::error::Unexpected Packet Tunnel extension point: $tunnel_point"
  exit 1
fi

echo "Packet Tunnel entitlement metadata and extension packaging are ready for authorized signing."
