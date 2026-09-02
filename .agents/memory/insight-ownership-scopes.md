---
name: Insight ownership scopes
description: Ownership rules for aggregate operational dashboards and lifecycle metrics.
---

Aggregate insight queries must apply reseller ownership to every joined entity, not only the primary table. A customer-scoped query must constrain its service and sale joins; provider/job metrics must filter jobs through their owned service; sales-derived cost expressions must resolve the sale's reseller explicitly.

**Why:** A first runtime test exposed both alias mistakes and a cross-reseller leakage risk that typechecking could not detect. Aggregate joins can silently overcount or reveal data even when the top-level customer list is scoped.

**How to apply:** Keep master-admin queries unfiltered, but for reseller queries use the authenticated reseller ID in each relevant join/filter and smoke-test the endpoint with an authenticated session.