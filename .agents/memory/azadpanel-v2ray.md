---
name: AzadPanel V2Ray provisioning
description: Dedicated AzadPanel Xray provider credentials and subscription aggregation.
---

Use a separate AzadPanel provider credential row for Xray/V2Ray. Account provisioning uses the documented `vless` proxy declaration and appends the provider's dynamic subscription URL to the customer's combined feed. New and renewed services are provisioned normally. When the super-admin saves/enables a credentialed V2Ray Provider, enqueue eligible active, unexpired services with quota remaining. Repeated explicit saves may requeue services that still lack a saved mapping even if an earlier job completed or failed; skip existing mappings and in-progress jobs. Do not create a scheduled or unattended recurring backfill. Create only missing accounts, using each service's current remaining quota and exact expiry; do not update existing Provider users or reset counters. Respect `Retry-After`.

For a V2Ray backfill, verify the actual subscription-link read routes before treating an existing account as usable. If both the Xray link and documented user endpoints deny access for the service username, use one deterministic V2Ray-only username (`pulsev2_<serviceId>`) and persist the mapping by service and Provider. Use that mapping for future provisioning, usage reads, disables, subscription feeds, and Provider-account audits; invalidate any cached denial when the mapping changes. A backfill must never be marked complete without a result from its target Provider. If the fallback lookup or account-creation request is also denied, stop and report the failing operation; do not try to bypass Provider access or quota limits.

**Why:** AzadPanel reseller credentials are core-specific, and its API returns 403 when a reseller credential cannot access a username owned by another reseller. A completed job with no mapping can otherwise conceal an unreadable subscription account or a missing Provider result. The user chose an isolated V2Ray identity for access collisions; creation-level 403s may still indicate a panel block or reseller quota limit.

**How to apply:** Keep a dedicated `azadpanel_v2ray` provider kind. On an explicit save, requeue eligible services that still lack a saved mapping regardless of completed or failed historical jobs; skip mapped services and active jobs. Keep work staggered and one-time, not scheduled. Missing target-provider results and denied subscription reads must become visible failures, not completed jobs; re-save after correcting the Provider to retry.

For subscription reads, if the Xray `/link` endpoint returns 403, try the documented `GET /api/user/{username}` using the same token; its response also carries `subscription_url` and `links`. Cache a successful route briefly and throttle repeated denial. If both routes deny access, stop without changing Provider accounts and log whether the request used the saved Provider mapping or the service username, never the username itself.

**Why:** Some AzadPanel deployments may deny the specialized link route while still allowing the documented user read; bounded fallback avoids turning repeated client refreshes into extra Provider traffic.

**How to apply:** This is a read-only subscription fallback, not a way around reseller ownership. Keep username values and config links out of logs.
