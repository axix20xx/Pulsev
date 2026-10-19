---
name: Android OkHttp alignment
description: Prevent release crashes from mismatched OkHttp core and URLConnection artifacts in the native VPN client.
---

Keep `okhttp-urlconnection` on the same OkHttp version as the resolved `okhttp` core when adding Android VPN-engine dependencies.

**Why:** A native VPN library raised core OkHttp to 5.3.0 while React Native and Expo continued selecting `okhttp-urlconnection` 4.9.2. React Native's `JavaNetCookieJar` then crashed the app during ordinary network requests with `NoClassDefFoundError` for `okhttp3.internal.Util`.

**How to apply:** After changing native Android dependencies, inspect both artifacts in `releaseRuntimeClasspath` with Gradle dependency insight, align their versions, and verify the release APK contains the required classes.
