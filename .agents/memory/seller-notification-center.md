---
name: Seller notification center
description: Durable rules for reseller notifications, ownership, delivery channel, and event timestamps.
---

The seller notification center is an in-app, database-backed inbox scoped to the authenticated reseller. Direct Telegram delivery is a separate capability and must not be implied by the presence of Telegram login.

**Why:** The current product can safely surface and mark notifications as read without introducing a bot/channel policy, customer consent flow, or delivery credentials. Usage synchronization also refreshes service timestamps, so those timestamps do not represent when AWG became ready.

**How to apply:** Enforce reseller ownership in every notification read/update query. Use a dedicated event key for AWG-ready notifications and a creation/event timestamp rather than a general service `updated_at` value when deciding whether a readiness notification is new.