---
name: Seller notification center
description: Durable rules for reseller notifications, ownership, delivery channel, and event timestamps.
---

The seller notification center is an in-app, database-backed inbox scoped to the authenticated reseller. Direct Telegram delivery is a separate capability and must not be implied by the presence of Telegram login.

**Why:** The current product can safely surface and mark notifications as read without introducing a bot/channel policy, customer consent flow, or delivery credentials. Usage synchronization also refreshes service timestamps, so those timestamps do not represent when AWG became ready.

**How to apply:** Enforce reseller ownership in every notification read/update query. Use a dedicated event key for AWG-ready notifications and a creation/event timestamp rather than a general service `updated_at` value when deciding whether a readiness notification is new.

Customer push messages are a separate master-admin capability: an admin may send a validated custom title/body to all customers or one selected customer. The message must be persisted in each customer's mobile inbox and then pushed to active devices; a missing/expired device subscription must not prevent inbox delivery.

**Why:** The operations team needs a reliable broadcast and targeted support channel, while push delivery is inherently best-effort and customer records must not be exposed to reseller-scoped notification logic.

**How to apply:** Keep the endpoint master-admin-only, validate recipient IDs server-side, generate a unique event key per send, and use the mobile notification route as the single delivery path.