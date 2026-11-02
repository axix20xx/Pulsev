---
name: V2Pro profile handoff
description: Cross-platform profile sharing behavior and import constraints for V2Pro on public subscription pages.
---

V2Pro is available on both iOS and Android. Its public `/sub` handoff uses one Pulse subscription-feed URL through the operating system's share sheet; do not offer per-profile downloads or route through V2Box. No custom V2Pro URL scheme is verified, so do not guess one. If sharing is unavailable, copy the feed URL for manual subscription import.

**Why:** the user confirmed a standard HTTPS subscription link imports both WireGuard and OpenVPN in V2Pro, while no public iOS deep-link contract was found.

**How to apply:** when changing the `/sub` V2Pro card, share the complete subscription feed as a single URL on iOS and Android. Treat successful handoff as the URL being shared, not proof the app accepted or connected every profile.
