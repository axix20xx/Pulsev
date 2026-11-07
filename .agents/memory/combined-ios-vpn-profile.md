---
name: Combined iOS VPN profile
description: Eligibility and protocol limits for installing several VPN apps from one iOS configuration profile.
---

A combined iOS profile may include OpenVPN Connect, WireGuard, and AmneziaWG payloads, but only when the service is active and the reseller has the corresponding provider/protocol enabled. V2Ray subscription links are app imports, not VPN payloads, and must remain separate.

**Why:** Reseller provider access and per-service protocol flags must remain authoritative; bundling an old saved account after its provider is disabled can expose stale configuration or make profile installation fail.

**How to apply:** Re-check service state and provider ownership on the server when generating every combined profile. Prepare missing accounts only after an explicit customer action, and omit protocols that are disabled or unavailable.

When building an “install all” profile, isolate failures per provider and include every healthy provider; only fail the request when no usable profiles remain.

**Why:** One unavailable panel, including a Cloudflare 521, must not prevent iOS users from installing profiles from other configured providers.

**How to apply:** Catch provider fetch/lookup failures around each optional source, log the skipped provider, and return a valid partial profile when possible. Keep the single-provider download routes strict.
