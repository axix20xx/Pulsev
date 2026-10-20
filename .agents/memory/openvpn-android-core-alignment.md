---
name: OpenVPN Android core alignment
description: Compatibility and source verification rules for the native OpenVPN Android engine.
---

Keep the OpenVPN native core, generated SWIG JNI wrappers, and Android service adapter on compatible API versions. Replacing only the native library can break connection setup when JNI methods or callbacks change.

**Why:** OpenVPN core upgrades can remove Java-facing methods or change tunnel callbacks; a profile parser passing alone does not verify the Android service bridge or a live tunnel.

**How to apply:** Regenerate wrappers and compile the adapter whenever the core changes. Test parsing with a sanitized profile fixture and verify a real tunnel on a device separately. Never log full VPN profile contents.

For GitHub codeload sources, verify a normalized extracted source-tree hash rather than relying only on compressed archive bytes; codeload can regenerate gzip metadata or the top-level directory while retaining identical files.

**Why:** A release archive was repacked with a different byte hash even though its extracted file tree matched the pinned source.

**How to apply:** Keep content verification enabled before native compilation; do not remove checksum checks just to accommodate archive repacking.

When building the OpenVPN shared library with the Android NDK, link ELF load segments for 16 KB pages and verify both ELF and APK ZIP alignment. A library can be present in the APK yet fail at `System.loadLibrary` on newer Android devices if it is only 4 KB aligned.

**Why:** A device-visible OpenVPN load failure persisted despite the JNI library and its dependencies being packaged; the custom core was linked with 4 KB segment alignment.

**How to apply:** Add `-Wl,-z,max-page-size=16384` to the native link and validate the final APK with `zipalign -c -P 16 4` as well as checking the library's `PT_LOAD` alignment.

The user has accepted GPL-family distribution terms for this VPN client and selected an AGPL-3.0 adapter for iOS.

**Why:** License obligations affect what can be included in downloadable builds and how source must be provided.

**How to apply:** Preserve third-party license notices and corresponding-source availability when preparing distributable client builds.
