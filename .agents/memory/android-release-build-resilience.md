---
name: Android release build resilience
description: Avoid presenting stale APKs when native Gradle/CMake builds or managed workflows are interrupted.
---

Repeated Android release builds have reset the workspace during Gradle/CMake execution, discarded background logs, and left the previous APK in the output directory. Lowering CMake parallelism did not prevent the runtime reset. The managed workflow restart service also returned a server-disconnection error while all workflows remained stopped.

**Why:** The output directory can still contain a valid older APK after a failed or lost build, making file presence alone misleading.

**How to apply:** After an interrupted build, confirm the build process ended, inspect the APK timestamp and embedded version, and verify alignment/signature before presenting it. If the workspace or workflow service repeatedly disconnects, stop retrying and report code/test results separately from the unavailable build and preview.
