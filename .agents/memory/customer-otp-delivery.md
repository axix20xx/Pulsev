---
name: Customer OTP delivery
description: The current customer login verification flow and its delivery boundary.
---

Customer login uses a database-backed, four-digit reusable code that never expires and is replaced only by an explicit reseller/master-admin action. New codes are encrypted at rest so the same code can be shown again. During upgrade, the latest legacy hash-only code is preserved and made reusable; because hashes cannot be reversed, it remains valid but cannot be displayed until the reseller explicitly creates a replacement. The encryption key derives from `SESSION_SECRET`, which must remain stable.

OTP verification must read and preserve the `is_permanent` flag from the database row. Without it, no-expiry permanent codes fall through the temporary-code validation and are rejected as invalid.

**Why:** Until a real SMS or messaging provider is connected, a reseller or master admin must be able to deliver the code directly and customers must not lose access on refresh or after logging in once.

**How to apply:** Preserve four-digit validation, failed-attempt limits, phone/customer binding, ownership checks, and existing mobile-session contracts. Never rotate a code during customer page loads, service creation, or renewal; only the explicit “new code” action invalidates the previous code. A future SMS integration should replace only delivery, not the reusable-code verification semantics.