---
name: Public storefront inquiry boundary
description: Safety and attribution rules for reseller storefront orders and sales.
---

Public storefronts collect buyer inquiries; they do not take payment, create services, or call Providers. A reseller must explicitly start and submit a sale from an owner-scoped lead. That completed sale is the point where storefront attribution is recorded.

**Why:** Public form input must not be able to provision Provider accounts, and an inquiry should not be counted as a completed sale.

**How to apply:** Keep provisioning behind an authenticated seller action. When converting a storefront lead, verify the lead belongs to the seller, prevent duplicate conversion, and write the lead-to-sale association in the sale transaction.
