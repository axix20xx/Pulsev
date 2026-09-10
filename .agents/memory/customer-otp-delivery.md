---
name: Customer OTP delivery
description: The current customer login verification flow and its delivery boundary.
---

Customer login uses a database-backed, four-digit, non-expiring OTP challenge that remains valid for repeated logins until a newer code is generated. Until a real SMS or messaging provider is connected, a reseller or master admin can generate the code from the customer profile or receive it in the post-sale/renewal delivery message.

**Why:** The workspace has no SMS provider configured, but customer login must not fall back to passwordless phone-only access; master admins also need to support customer onboarding from Hostinger.

**How to apply:** Preserve four-digit validation, failed-attempt limits, phone/customer binding, ownership checks, and invalidation when a newer code is generated. A future SMS integration should replace only delivery, not the reusable-code verification semantics.