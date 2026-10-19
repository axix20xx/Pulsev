---
name: Xray Reality and live traffic validation
description: Reality share-link normalization and distinguishing an active tunnel from usable internet traffic.
---

Treat TCP reachability and Xray's `connected` state as hints, not proof that a server can carry user traffic. For Reality outbounds, preserve valid `serverNames`, recover a missing name from explicit link SNI or a DNS endpoint host, and reject an IP-only link with no SNI. Auto-connect should verify HTTPS through the active VPN route and try a bounded set of alternate servers when traffic fails.

**Why:** A Reality converter can emit an empty `serverNames` list, and the native core can report connected even when DNS or outbound traffic is unusable.

**How to apply:** Normalize the generated Xray JSON before starting the VPN service; confirm real HTTPS connectivity through Android's VPN transport before declaring a selected server usable.
