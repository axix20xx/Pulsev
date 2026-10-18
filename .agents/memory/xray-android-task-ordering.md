---
name: Xray Android task ordering
description: Prevent Gradle validation failures when the app consumes expo-xray-vpn's extracted classes JAR.
---

When building the local-AAR version of `expo-xray-vpn`, app `desugar*FileDependencies` and `collectReleaseDependencies` tasks must depend on `:expo-xray-vpn:extractXrayAar`.

**Why:** Gradle validates producer-consumer task ordering. Both desugaring and Android's release dependency report consume the extracted classes JAR, so either can fail validation without an explicit producer dependency.

**How to apply:** Add the producer dependency lazily to both matching app tasks in the Android Gradle configuration, using the full `:expo-xray-vpn:extractXrayAar` task path.
