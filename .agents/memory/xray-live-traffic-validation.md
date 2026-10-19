---
name: Xray Reality and live traffic validation
description: Reality share-link normalization and distinguishing an active tunnel from usable internet traffic.
---

Treat TCP reachability and Xray's `connected` state as hints, not proof that a server can carry user traffic. For Reality outbounds, preserve valid `serverNames`, recover a missing name from explicit link SNI or a DNS endpoint host, and reject an IP-only link with no SNI. Treat `privateKey` as server-only: populate the client `publicKey`/`password` from the selected VLESS URI (`pbk`/`password`) and reject the node if neither exists. Auto-connect should verify HTTPS through the active VPN route and try a bounded set of alternate servers when traffic fails.

**Why:** A Reality converter can emit empty server names or omit the URI's client public key, producing native config errors; the core can also report connected when DNS or outbound traffic is unusable. Never substitute a server private key for client key material.

**How to apply:** Normalize the generated Xray JSON before starting the VPN service; confirm real HTTPS connectivity through Android's VPN transport before declaring a selected server usable.
