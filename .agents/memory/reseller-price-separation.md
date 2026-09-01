---
name: Reseller price separation
description: The two per-gig prices used for reseller credit accounting and customer sales
---

The reseller purchase price paid to the manager and the customer-facing sale price must remain separate settings for every reseller.

**Why:** A single per-gig value cannot represent both the manager's credit cost and the reseller's retail pricing, so reusing it makes customer totals and profit calculations wrong.

**How to apply:** Use the purchase price for credit/cost/profit calculations and the customer sale price when a reseller creates a service; enforce the latter on the server rather than trusting client input.