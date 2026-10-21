# Android client build

This app includes native in-app engines for OpenVPN, WireGuard, AmneziaWG, and
V2Ray/Xray. Those engines are not available in Expo Go; install a custom
Android build instead.

From the repository root:

```sh
pnpm --filter @workspace/pulse-vpn-client run android:prebuild
pnpm --filter @workspace/pulse-vpn-client run android:apk:arm64
```

The test APK is written to
`artifacts/pulse-vpn-client/android/app/build/outputs/apk/release/app-release.apk`.
Unless overridden, its API endpoint is the verified Hostinger domain
`https://vinte.peppernopepper.com`; set `EXPO_PUBLIC_DOMAIN` to use another
backend.
The machine needs a JDK and Android SDK platform/build-tools matching the
generated Gradle project. The generated Expo project signs this test build with
its debug key; it is installable for testing but is not a production/Play Store
signing identity. Production distribution requires the owner's own signing
configuration.
The build scripts default Java's temporary files to `.cache/pulse-tmp` in the
workspace to avoid restricted system-temp storage; set `PULSE_BUILD_TMPDIR` only
if a different writable location is needed.
The Gradle worker count is intentionally limited; keep the Gradle heap at 3 GiB
for DEX merging, which can exceed the default 1 GiB heap in this app.

OpenVPN integration licensing and corresponding source references are in
`THIRD_PARTY_NOTICES.md` and `third_party/`.
