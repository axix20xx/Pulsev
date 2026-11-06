---
name: Provider operation safety
description: Rules for avoiding Provider rate limiting when making account changes.
---

Provider account mutations must be initiated by explicit user action and target one service on one selected Provider. Avoid unattended batch or scheduled changes to Provider accounts; the user reported repeated nighttime account changes can lead Providers to block them. For repair, update only active, in-quota, unexpired users and preserve the exact existing quota, expiry, and traffic counters; never call Provider usage-reset endpoints as part of repair. Narrow exception: the user explicitly approved a paced AzadPanel V2Ray backfill; super-admin saves may enqueue only eligible services not already represented by a backfill job, and it creates only missing accounts without updating or resetting existing ones.

**Why:** The user reported automated or widespread Provider changes risk account blocks and requested narrow repairs without changing quota, time, or usage. The V2Ray backfill is a specific user-authorized exception, not permission for unattended recurring or broader batch mutations.

**How to apply:** Expose one confirmed per-service action, validate eligibility on the server, send only to that Provider, and verify locally with static checks or mocked requests rather than live Provider writes. Keep V2Ray reconciliation explicit, paced, quota-preserving, and limited to active unexpired services with remaining quota.

For explicit service cancellation, disable every Provider account mapped to that service, including credentialed providers currently disabled in settings. Use the saved provider-specific identity and do not mutate an unmapped disabled provider; a provider with no account for this service is a no-op.

**Why:** The user asked that cancellation disable all Providers, including newly added Provider APIs, without letting unrelated or unprovisioned Provider accounts block cancellation.

**How to apply:** On confirmed cancellation, include disabled Provider configurations only when a saved service-to-provider account mapping identifies the target; use provider-specific identities and skip integrations such as Raven when no account mapping exists.
