---
name: Paid and unpaid profit allocation
description: Financial rule for splitting sales profit by collection status.
---

When sales income is split into collected and outstanding amounts, allocate the shared credit cost proportionally by each amount’s share of total income. The collected and outstanding profit parts should then reconcile to total profit.

**Why:** Charging the full shared cost to collected profit makes the paid/unpaid view misleading and can produce a negative collected profit even when the overall sale is profitable.

**How to apply:** Use the same proportional allocation in API responses and any optimistic client-side updates that recalculate the collection breakdown.