---
name: V2Pro profile handoff
description: Cross-platform profile sharing behavior and import constraints for V2Pro on public subscription pages.
---

V2Pro is available on both iOS and Android. Keep its public subscription handoff limited to WireGuard `.conf` and OpenVPN `.ovpn` files, and pass those files through the operating system's share sheet. Do not route the flow through V2Box or guess an undocumented app URL scheme. Use provider-neutral server labels and correct file extensions; download the profile when file sharing is unavailable.

**Why:** the V2Pro Android listing documents importing configurations by sharing to the app, but no reliable custom deep-link contract was found. OpenVPN handling is not listed in that documentation and needs device verification.

**How to apply:** when changing the `/sub` V2Pro card, preserve the same two-protocol allowlist for both mobile platforms. Treat successful handoff as the user selecting V2Pro in the share sheet, not proof the app accepted or connected the profile.
