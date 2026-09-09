---
name: Customer OTP delivery
description: The current customer login verification flow and its temporary delivery boundary.
---

Customer login uses a database-backed, five-minute, single-use OTP challenge. Until a real SMS or messaging provider is connected, the management customer profile generates the code and displays it in the profile notice for the seller to share with the customer.

**Why:** The workspace has no SMS provider configured, but customer login must not fall back to passwordless phone-only access.

**How to apply:** Preserve expiry, attempt limits, single-use consumption, phone/customer binding, and ownership checks when changing the OTP flow. A future SMS integration should replace only delivery, not verification semantics.