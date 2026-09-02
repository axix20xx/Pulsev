---
name: Master-admin sales ledger
description: Safety and scope rules for the master administrator’s detailed reseller sales page.
---

The master administrator has a separate detailed sales ledger for reviewing customer sales by reseller. The only destructive action exposed there is deleting an individual sales-log row; customer, service, subscription, credit, and reseller records remain untouched.

**Why:** The operational reseller sales view intentionally has different visibility and editing behavior, while log cleanup must not accidentally change service lifecycle or financial balances.

**How to apply:** Keep the admin list and delete routes master-admin protected, filter by reseller Telegram ID, show customer/service/subscription context read-only, and require explicit confirmation before log deletion.