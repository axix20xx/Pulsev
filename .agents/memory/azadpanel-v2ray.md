---
name: AzadPanel V2Ray provisioning
description: Dedicated AzadPanel Xray provider credentials and subscription aggregation.
---

Use a separate AzadPanel provider credential row for Xray/V2Ray. Account provisioning uses the documented `vless` proxy declaration and appends the provider's dynamic subscription URL to the customer's combined feed. New and renewed services are provisioned normally. When the super-admin saves/enables a credentialed V2Ray Provider, enqueue eligible active, unexpired services with quota remaining. Repeated explicit saves may enqueue only eligible services not already represented by a backfill job; do not create a scheduled or unattended recurring backfill. Create only missing accounts, using each service's current remaining quota and exact expiry; do not update existing Provider users or reset counters. Respect `Retry-After`.

**Why:** AzadPanel reseller credentials are core-specific, while the existing public subscription already aggregates feeds from multiple providers. The user explicitly changed the earlier new/renewal-only scope and wants eligible existing services reconciled when a super-admin saves the Provider, while preserving the Provider rate-limit safety rule.

**How to apply:** Keep a dedicated `azadpanel_v2ray` provider kind. Use a durable per-provider marker plus per-service job idempotency to avoid duplicate work; re-saving the Provider may pick up services skipped because another Provider job was in flight. Existing failures require a visible error and explicit retry after the Provider problem is fixed.
