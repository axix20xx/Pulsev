---
name: Replit Android build environment
description: Workspace-specific storage and JDK constraints for local Android builds.
---

For local Android builds in this workspace, keep the Android SDK/NDK under a workspace `.cache` path and exclude `.cache/` from Git and deployments. Use a stable JDK 17, not GraalVM 19; if the Gradle-cached Temurin runtime disappears after a workspace restart, the installed Nix `jdk17` package provides a replacement. Bound Gradle worker count and JVM heaps; React Native CMake compilation across multiple ABIs can exceed the workspace's 8-GiB memory cap. Prefer an arm64 build for a quick current-phone installer, retaining the universal build option.

**Why:** Android SDK/NDK packages can exceed the container's per-user overlay quota even when `df` reports free space, Gradle under the installed GraalVM 19 runtime crashed with SIGBUS during SDK package operations, and parallel C++/Gradle tasks can exhaust the 8-GiB memory limit.

**How to apply:** before building an APK locally, place SDK tools on the workspace volume, select a stable supported JDK, limit Gradle workers/heaps, and keep the generated SDK out of source control and deployment bundles. Use the single arm64 target for routine device testing; build all ABIs only when compatibility testing requires it.
