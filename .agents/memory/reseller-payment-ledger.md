---
name: Reseller payment ledger
description: Source and meaning of reseller balances in the master-admin sales ledger
---

Reseller credit invoices are the source of the amounts owed to the master admin; each invoice carries its own paid state, and balances are aggregated per reseller over the selected Tehran date range.

The master-admin sales history must stay reseller-focused: aggregate customer sales by reseller and show sale count, sold GB, amount payable to the admin, and admin profit without exposing individual customer rows.

**Why:** Customer sale payment status describes collection from the customer, while reseller credit payment status describes settlement with the master admin; mixing them produces incorrect balances.

**How to apply:** Show reseller name, total due, paid amount, remaining amount, and profit; allow only the master admin to change an invoice's paid state. Keep customer-level history available only to the owning reseller.