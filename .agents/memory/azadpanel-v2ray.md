---
name: AzadPanel V2Ray provisioning
description: Dedicated AzadPanel Xray provider credentials and subscription aggregation.
---

Use a separate AzadPanel provider credential row for Xray/V2Ray. Account provisioning uses the existing service username, quota, and expiry; use the documented `vless` proxy declaration and append the provider's dynamic subscription URL to the customer's combined feed.

**Why:** AzadPanel reseller credentials are core-specific, while the existing public subscription already aggregates feeds from multiple providers.

**How to apply:** Keep a dedicated `azadpanel_v2ray` provider kind and automatically provision only when a service is created or renewed. Do not backfill existing active services unless the user explicitly approves a one-time rollout.
