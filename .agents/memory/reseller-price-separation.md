---
name: Reseller price separation
description: The two per-gig prices used for reseller credit accounting and customer sales
---

The reseller purchase price paid to the manager and the customer-facing sale price must remain separate. Resellers may override the suggested retail total for each sale.

**Why:** A single per-gig value cannot represent both the manager's credit cost and a reseller's negotiated retail price, so reusing it makes customer totals and profit calculations wrong.

**How to apply:** Use the purchase price for credit/cost calculations. Treat the manager's customer price as a default suggestion, but preserve a validated non-negative custom retail total entered in Quick Sale or service creation.