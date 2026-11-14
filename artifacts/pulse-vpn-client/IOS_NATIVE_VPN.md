# Native iOS VPN implementation

Pulse now has an iOS Packet Tunnel extension and an Expo native-module bridge for
WireGuard, AmneziaWG, and OpenVPN. The existing API client and sign-in flow are
unchanged. Profile text and OpenVPN credentials are stored in the shared iOS
Keychain; the extension receives only the profile identity in its Network
Extension preferences. Traffic totals come from the VPN engines, and internet
reachability is reported separately from the operating-system tunnel state.

## Apple account setup still required

The app is configured with bundle ID `com.pulse.vpnclient`, extension ID
`com.pulse.vpnclient.PacketTunnel`, app group `group.com.pulse.vpnclient`, and
Keychain group `$(AppIdentifierPrefix)com.pulse.vpnclient.shared`.

Before signing or testing on a device:

1. In the Apple Developer portal, register the app and Packet Tunnel extension
   identifiers and enable Network Extensions / Packet Tunnel Provider.
2. The user confirmed Apple approved the Network Extension entitlement. Ensure
   Packet Tunnel Provider is enabled for both identifiers and included in the
   provisioning configuration; source entitlements alone do not grant access.
3. Enable the matching App Group and Keychain Sharing group for both identifiers
   and include them in the provisioning profiles.
4. Set the Apple Team ID in the Expo iOS configuration and use signing profiles
   that include all of these capabilities.

If `com.pulse.vpnclient` is already registered to a different Apple team, change
the app and extension identifiers before creating or signing the app.

## Build on macOS

Expo Go cannot load this custom native module. Build a development or release
app with Xcode on macOS and install it on a physical iPhone.

The AmneziaWG Apple package builds its Go backend as part of the Xcode build.
The build copies the backend sources to Derived Data and omits the upstream
Xray-only Go entry point, so this app does not add an Xray tunnel. The current
pinned package requires Go 1.26 and Xcode's iOS SDK. Xcode 16 or newer and
CocoaPods 1.16.2 or newer are recommended for the extension target.

From the monorepo root:

```sh
pnpm install
pnpm --filter @workspace/pulse-vpn-client exec expo prebuild --platform ios
cd artifacts/pulse-vpn-client/ios
pod install
open PulseVPNClient.xcworkspace
```

Choose the app scheme, set the Apple development team for both targets, and run
on a physical iPhone. Re-run `expo prebuild` after changing `app.json`, the
Packet Tunnel target configuration, or the Xcode package/build plugin.

For an unsigned IPA from a macOS GitHub worker, see
[`IOS_GITHUB_ACTIONS.md`](./IOS_GITHUB_ACTIONS.md). That workflow requires
no Apple credentials. The resulting IPA cannot be installed or submitted until
it is signed with the correct Apple certificates and provisioning profiles.

## Runtime behavior

- WireGuard and AmneziaWG use the Amnezia Apple WireGuardKit parser and native Go
  tunnel backend. Amnezia-specific parameters are parsed by that upstream
  implementation.
- OpenVPN uses OpenVPNAdapter, which is based on OpenVPN 3 Core.
- The app serializes profile changes through one iOS tunnel configuration and
  confirms disconnection using `NEVPNConnection` state.
- Upload and download counters are engine totals, not estimates. Tunnel-active
  state does not by itself mean internet access works; the connectivity test
  requires a non-empty HTTPS response through the device's current routing.
- The Packet Tunnel is configured for iOS 15.1+, but the Expo app's deployment
  target can be higher depending on the Expo SDK and installed modules.

## Verification status

The Expo config, generated Xcode target, package references, native-module
autolinking, and TypeScript types were checked in this workspace. This Linux
environment has no Xcode or Apple signing credentials, so it cannot compile the
iOS binary, test Apple entitlement approval, or verify live VPN traffic on an
iPhone. Do not treat the current source bundle as a tested or publishable iOS
build until those device checks pass.

## Third-party sources and licenses

- [AmneziaWG Apple](https://github.com/amnezia-vpn/amneziawg-apple), pinned to
  `v3.1.5`: MIT.
- [OpenVPNAdapter](https://github.com/ss-abramchuk/OpenVPNAdapter), pinned to
  `0.8.0`: GNU AGPL v3; it incorporates OpenVPN 3 Core and related dependencies.
  The upstream repository is archived, so refresh or replace it and perform a
  security review before treating the OpenVPN engine as production-ready.

The app package currently declares GPL-3.0-only. Review and satisfy the
third-party license and source-distribution obligations before distributing
builds, especially for the AGPL OpenVPN adapter. This note is not legal advice.
