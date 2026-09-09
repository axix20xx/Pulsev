---
name: Customer OTP delivery
description: The current customer login verification flow and its temporary delivery boundary.
---

Customer login uses a database-backed, four-digit, non-expiring, single-use OTP challenge. Until a real SMS or messaging provider is connected, a reseller or master admin can explicitly generate the code from the customer profile and share it with the customer.

**Why:** The workspace has no SMS provider configured, but customer login must not fall back to passwordless phone-only access; master admins also need to support customer onboarding from Hostinger.

**How to apply:** Preserve four-digit validation, attempt limits, single-use consumption, phone/customer binding, and ownership checks when changing the OTP flow. A future SMS integration should replace only delivery, not verification semantics.