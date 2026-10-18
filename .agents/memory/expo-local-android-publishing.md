---
name: Expo Android module publishing
description: Gradle configuration expectations for Expo local Android modules.
---

For Expo SDK 57 local native modules using `expo-module-gradle-plugin`, define `android.defaultConfig.versionName`. The Expo plugin already configures the Android `release` publication component through `singleVariant("release")`; do not add a second `publishing.singleVariant("release")`.

**Why:** the plugin's publication setup reads `defaultConfig.versionName` and registers the release component itself. Missing the version name fails configuration, while duplicating the publishing DSL prevents the component from being created.

**How to apply:** when adding a local Expo Android module, set its namespace, min SDK, and version name, then let `expo-module-gradle-plugin` provide its release publication.
