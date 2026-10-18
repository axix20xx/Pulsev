# Third-party notices

## OpenVPN for Android

The Android app links `io.github.tim06:openvpn:1.1.3`. Its Maven POM declares
Apache-2.0, while bundled source files such as `ConfigParser.java` and
`VpnProfile.java` carry OpenVPN for Android's GPL-2.0 notice with additional
terms. The corresponding source archive and the upstream additional-terms
notice are included in `third_party/`. The app is marked GPL-2.0-only for
distribution, as accepted for this integration.

- Artifact: <https://repo.maven.apache.org/maven2/io/github/tim06/openvpn/1.1.3/>
- Upstream license notice: <https://github.com/schwabe/ics-openvpn/blob/master/doc/LICENSE.txt>
- OpenVPN 3 core sources and license choices: <https://github.com/OpenVPN/openvpn3>

Keep the `third_party/openvpn-1.1.3-sources.jar`,
`third_party/OPENVPN-ANDROID-LICENSE.txt`, and
`third_party/GPL-2.0.txt` with any source or binary distribution. The app
source must also be made available under the stated GPL terms when distributing
the client.

## Other native VPN engines

- WireGuard Android tunnel library: Apache-2.0,
  <https://github.com/WireGuard/wireguard-android>
- AmneziaWG Android library: Apache-2.0,
  <https://github.com/amnezia-vpn/amneziawg-android>
- Xray Expo bridge: MIT, <https://github.com/chenjiahan/expo-xray-vpn>

Keep each dependency's upstream notices when preparing a release bundle.
