---
name: OpenVPN Android core alignment
description: Compatibility and source verification rules for the native OpenVPN Android engine.
---

Keep the OpenVPN native core, generated SWIG JNI wrappers, and Android service adapter on compatible API versions. Replacing only the native library can break connection setup when JNI methods or callbacks change.

**Why:** OpenVPN core upgrades can remove Java-facing methods or change tunnel callbacks; a profile parser passing alone does not verify the Android service bridge or a live tunnel.

**How to apply:** Regenerate wrappers and compile the adapter whenever the core changes. Test parsing with a sanitized profile fixture and verify a real tunnel on a device separately. Never log full VPN profile contents.

When switching OpenVPN profiles, stop the existing tunnel and wait for native `DISCONNECTED`/`INACTIVE` status before starting the next profile. Clear a stale screen error when the native tunnel is still connected.

**Why:** The native service allows only one active OpenVPN profile; a reconnect attempt during shutdown can be rejected while the old tunnel remains connected, leaving a misleading error visible.

**How to apply:** Serialize reconnects in the Android wrapper with a bounded status poll, and let the UI prioritize the confirmed tunnel state over an earlier failed switch attempt.

Do not trust module-local OpenVPN state after React Native module recreation. Rebind to the running Android service when status is queried, then synchronize from its authoritative state callback/API.

**Why:** The Android foreground service can outlive the JavaScript/native module instance, so an unbound module reports `UNKNOWN` even while the tunnel is still active.

**How to apply:** Status reads should establish a service binding when needed; preserve separate status/error fields and do not start or stop a tunnel as a side effect of rebinding.

Keep inline OpenVPN `<ca>`, `<cert>`, and `<key>` blocks inline across Android preflight and service startup. Normalize line endings and PEM labels, but do not convert these PEM blocks into temporary file paths.

**Why:** The supplied CA, client certificate, and matching private key were valid and worked in OpenVPN Connect, while Pulse reported Mbed TLS parse errors after rewriting PEM blocks as files. Keeping them inline removes that handoff as a source of divergence without weakening TLS verification.

**How to apply:** When changing Android profile preparation, keep CA, client certificate, and private key blocks in the configuration string; externalize auth and other supported files only when needed. Test both preflight and the service path, and never log private material.

For GitHub codeload sources, verify a normalized extracted source-tree hash rather than relying only on compressed archive bytes; codeload can regenerate gzip metadata or the top-level directory while retaining identical files.

**Why:** A release archive was repacked with a different byte hash even though its extracted file tree matched the pinned source.

**How to apply:** Keep content verification enabled before native compilation; do not remove checksum checks just to accommodate archive repacking.

When building the OpenVPN shared library with the Android NDK, include `openvpn/crypto/data_epoch.cpp` and reject unresolved symbols; also link ELF load segments for 16 KB pages and verify APK ZIP alignment.

**Why:** The native loader reported a missing `DataChannelEpoch::check_send_iterate()` method because the custom link omitted its implementation file. Separately, 16 KB alignment is required for compatibility with newer Android page sizes.

**How to apply:** Compile the pinned core's required translation units, link with `-Wl,--no-undefined` and `-Wl,-z,max-page-size=16384`, then validate the final APK with `zipalign -c -P 16 4` and inspect `PT_LOAD` alignment.

The user has accepted GPL-family distribution terms for this VPN client and selected an AGPL-3.0 adapter for iOS.

**Why:** License obligations affect what can be included in downloadable builds and how source must be provided.

**How to apply:** Preserve third-party license notices and corresponding-source availability when preparing distributable client builds.
