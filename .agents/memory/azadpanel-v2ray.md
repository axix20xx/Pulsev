---
name: AzadPanel V2Ray provisioning
description: Dedicated AzadPanel Xray provider credentials and subscription aggregation.
---

Use a separate AzadPanel provider credential row for Xray/V2Ray. Account provisioning uses the documented `vless` proxy declaration and appends the provider's dynamic subscription URL to the customer's combined feed. New and renewed services are provisioned normally. When the super-admin saves/enables a credentialed V2Ray Provider, enqueue eligible active, unexpired services with quota remaining. Repeated explicit saves may enqueue only eligible services not already represented by a backfill job; do not create a scheduled or unattended recurring backfill. Create only missing accounts, using each service's current remaining quota and exact expiry; do not update existing Provider users or reset counters. Respect `Retry-After`.

If a V2Ray account lookup for the service's main username returns 403, use one deterministic V2Ray-only username (`pulsev2_<serviceId>`) and persist the mapping by service and Provider. Use that mapping for future provisioning, usage reads, disables, subscription feeds, and Provider-account audits. If the fallback lookup or account-creation request is also denied, stop and report the failing operation; do not try to bypass Provider access or quota limits.

**Why:** AzadPanel reseller credentials are core-specific, and its API returns 403 when a reseller credential cannot access a username owned by another reseller. The user chose an isolated V2Ray identity for that case; creation-level 403s may still indicate a panel block or reseller quota limit.

**How to apply:** Keep a dedicated `azadpanel_v2ray` provider kind. Use a durable per-provider marker plus per-service job idempotency to avoid duplicate work; re-saving the Provider may pick up services skipped because another Provider job was in flight. Existing failures require a visible operation-specific error and explicit retry after the Provider problem is fixed.
