---
name: Super-admin cost policy
description: Internal per-gig cost basis for the master admin
---

The master admin's internal cost basis is 2,500 toman per gig.

**Why:** The master admin does not buy credit through the reseller pricing flow, but their own sales still need a real cost basis for profit and financial reports.

**How to apply:** Keep the customer-facing sale price independent; use 2,500 only when calculating the master admin's internal cost, profit, and fallback per-gig display.

For the master-admin dashboard, headline financial totals represent the reseller's amount payable to the master admin; reseller dashboards continue to show their full customer-facing sale amount. Detailed master-admin reports may show both values side by side.

**Why:** Resellers sell to customers at a higher price than the wholesale amount they settle with the master admin, so exposing the wrong basis makes dashboard income misleading and can reveal admin-only pricing semantics to sellers.

**How to apply:** Branch dashboard financial aggregates by role. Keep `amount_to_admin` and related fields in master-only report responses; never include them in reseller dashboard or sales responses.