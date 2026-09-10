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

Customer Push and reseller panel notifications intentionally remain separate delivery channels. The admin UI should show active-device status for customers, use server-side Ajax recipient search, and report inbox delivery separately from Push delivery.

**Why:** A message can be safely stored in the inbox even when a device subscription is missing or expired; treating those as one success flag previously made failed Push delivery invisible.

**How to apply:** For customers, expose active device count and push sent/failed counts. For resellers, write to the existing owner-scoped panel notification inbox and do not claim Web Push delivery unless reseller device subscriptions are added.

The customer mobile shell should check Push subscription status after authentication and offer an explicit, dismissible activation prompt; settings and the prompt must share the same activation flow.

**Why:** Customers often enter the PWA without ever visiting notification settings, so waiting for an opt-in buried in settings makes admin messages appear broken even when the backend is working.

**How to apply:** Do not prompt on public/login routes, keep dismissal scoped to the current customer session, and preserve a settings fallback for retries or browser permission recovery.

The Push test endpoint must use a unique event key and return delivery metrics; an HTTP 200 from the endpoint only means the request was handled, not that a device received the notification.

**Why:** Minute-based idempotency prevented repeated tests from actually sending, while swallowed Web Push provider errors made failed delivery look successful.

**How to apply:** Return active-device, attempted, sent, failed, deactivated, and safe error fields to the mobile client, and log the provider status/body server-side without exposing credentials or subscription secrets.