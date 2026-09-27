---
name: Master-admin sales ledger
description: Safety and scope rules for the master administrator’s detailed reseller sales page.
---

The master administrator has a separate detailed sales ledger for reviewing customer sales by reseller. Deleting a sales-log row never alters customer, service, subscription, credit, reseller, or balance records. An approved reseller service-cancellation request also removes only its specifically linked sale row (or the latest matching row for legacy requests without a sale ID); request and audit history remain.

**Why:** Cancellation must not leave the requested sale row behind, but broad deletion would erase unrelated revenue history or change financial balances.

**How to apply:** Keep master-admin ledger deletion protected and explicit. For reseller action approvals, delete by the request's sale ID when present; only use the latest service-and-owner match for legacy requests without one. Preserve request/audit rows and all other sale rows.