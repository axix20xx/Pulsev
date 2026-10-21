---
name: Android release build resilience
description: Avoid presenting stale APKs when native Gradle/CMake builds or managed workflows are interrupted.
---

Repeated Android release builds have reset the workspace during Gradle/CMake execution, discarded background logs, and left the previous APK in the output directory. Lowering CMake parallelism and moving Gradle's cache under the workspace `.cache` did not prevent resets when the single-use Gradle daemon started. The managed workflow restart service also returned a server-disconnection error while all workflows remained stopped.

 The arm64 release APK also exceeds Gradle's default 1 GiB heap during DEX merging; use a 3 GiB Gradle heap while keeping workers bounded.

**Why:** The output directory can still contain a valid older APK after a failed or lost build, making file presence alone misleading.

 **How to apply:** After an interrupted build, confirm the build process ended and inspect the APK timestamp and embedded version; never assume an existing output is current. Keep Gradle workers bounded but provide a 3 GiB heap for this app's DEX merge. After repeated daemon-start resets or workflow disconnections, stop retrying and report code/test results separately from the unavailable build and preview.
