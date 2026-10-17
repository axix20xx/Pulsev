---
name: AzadPanel V2Ray provisioning
description: Dedicated AzadPanel Xray provider credentials and subscription aggregation.
---

Use a separate AzadPanel provider credential row for Xray/V2Ray. Account provisioning uses the documented `vless` proxy declaration and appends the provider's dynamic subscription URL to the customer's combined feed. New and renewed services are provisioned normally. When the super-admin first adds or enables a credentialed V2Ray Provider, the user has authorized a one-time paced backfill for existing active, unexpired services with quota remaining. Create only missing accounts, using each service's current remaining quota and exact expiry; do not update existing Provider users or reset counters. Respect `Retry-After`, and do not run recurring backfills.

**Why:** AzadPanel reseller credentials are core-specific, while the existing public subscription already aggregates feeds from multiple providers. The user explicitly changed the earlier new/renewal-only scope and authorized a one-time rollout, while preserving the Provider rate-limit safety rule.

**How to apply:** Keep a dedicated `azadpanel_v2ray` provider kind. Run the one-time backfill only as part of adding/enabling that Provider; use a durable per-provider marker to prevent repeats. Subsequent accounts are created on service creation or renewal.
