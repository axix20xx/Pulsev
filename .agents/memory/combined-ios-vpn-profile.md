---
name: Combined iOS VPN profile
description: Eligibility and protocol limits for installing several VPN apps from one iOS configuration profile.
---

A combined iOS profile may include OpenVPN Connect, WireGuard, and AmneziaWG payloads, but only when the service is active and the reseller has the corresponding provider/protocol enabled. V2Ray subscription links are app imports, not VPN payloads, and must remain separate.

**Why:** Reseller provider access and per-service protocol flags must remain authoritative; bundling an old saved account after its provider is disabled can expose stale configuration or make profile installation fail.

**How to apply:** Re-check service state and provider ownership on the server when generating every combined profile. Prepare missing accounts only after an explicit customer action, and omit protocols that are disabled or unavailable.
