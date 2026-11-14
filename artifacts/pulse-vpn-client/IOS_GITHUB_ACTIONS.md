# Build an unsigned iOS IPA with GitHub Actions

The repository workflow is **Build unsigned iOS IPA** under the GitHub Actions
tab. It runs on a macOS 26 worker with Xcode 26 and Swift 6.2+, creates the Expo iOS project, builds the app and
Packet Tunnel extension without code signing, and packages the result as a
downloadable `.ipa` workflow artifact. It requires no Apple credentials and
runs after relevant pushes to `main` or from **Actions → Build unsigned iOS IPA
→ Run workflow**.

## Download

After a successful run, download the
`PulseVPN-iOS-unsigned-<run number>` artifact from the run summary. The artifact
is retained for 14 days.

## Important limitation

This unsigned IPA is a build package, not an installable or distributable app.
It cannot be installed on an iPhone, use the Packet Tunnel entitlement, or be
submitted to TestFlight/App Store until it is signed with valid Apple
certificates and provisioning profiles. The user confirmed the Network
Extension entitlement is approved; Apple team signing is still a separate
requirement.

For a signed build, register the app ID `com.pulse.vpnclient` and extension ID
`com.pulse.vpnclient.PacketTunnel` with the Apple team and enable the approved
Packet Tunnel entitlement, App Group `group.com.pulse.vpnclient`, and Keychain
Sharing capability on the relevant identifiers and provisioning profiles.
