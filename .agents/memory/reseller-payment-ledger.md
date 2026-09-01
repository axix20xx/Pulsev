---
name: Reseller payment ledger
description: Source and meaning of reseller balances in the master-admin sales ledger
---

Reseller credit invoices are the source of the amounts owed to the master admin; each invoice carries its own paid state, and balances are aggregated per reseller over the selected Tehran date range.

**Why:** Customer sale payment status describes collection from the customer, while reseller credit payment status describes settlement with the master admin; mixing them produces incorrect balances.

**How to apply:** Show reseller name, total due, paid amount, and remaining amount from reseller credit invoices, and allow only the master admin to change an invoice's paid state.