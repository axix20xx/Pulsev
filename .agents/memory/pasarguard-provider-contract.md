---
name: PasarGuard Provider contract
description: How the rain_admin provider kind maps to PasarGuard user access and Group 1.
---

The `rain_admin` provider kind represents PasarGuard. Use its canonical singular `/api/user` routes; Group 1 grants the intended complete service access.

**Why:** Plural `/api/users` fallbacks can return misleading 404 responses, and PasarGuard user access is group-based rather than assigned through a `service_ids` field.

**How to apply:** Create and renew with active status plus Group 1, preserve existing groups when reconciling older users, and never treat a plural-route 404 as proof that a PasarGuard user is disabled.

Renewal must explicitly call `POST /api/user/{username}/reset` after updating the plan. Updating `expire` and `data_limit` alone does not clear PasarGuard's consumed traffic.

**Why:** PasarGuard intentionally keeps usage when a user is modified; without the reset endpoint, a renewed account immediately inherits its old quota consumption.

**How to apply:** Carry an explicit renewal-only reset intent through failed-Provider retry jobs. Never reset usage during ordinary provisioning retries.

Older users may be reconciled periodically, but only while their local service is active, unexpired, and below quota, under the same per-service lifecycle lock as disable and renewal.

**Why:** A broad cron that blindly activates remote users can restore access after quota or expiry shutdown.

**How to apply:** Re-check eligibility under the lifecycle lock and update only status/group membership; do not send quota, expiry, or usage fields during reconciliation.