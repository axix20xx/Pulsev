---
name: PasarGuard Provider contract
description: How the rain_admin provider kind maps to PasarGuard user access and Group 1.
---

The `rain_admin` provider kind represents PasarGuard. Use its canonical singular `/api/user` routes. New accounts should receive all group IDs returned by the panel's group-list endpoint; do not assume Group 1 exists.

**Why:** PasarGuard user access is group-based, and deployments can have different group IDs or no Group 1.

**How to apply:** Prefer `GET /api/groups/simple` (operator-friendly) and fall back to `GET /api/groups`; assign every returned ID when creating a new user. Preserve existing users' group memberships during renewal. Do not globally toggle disabled group states as part of account provisioning.

Renewal must explicitly call `POST /api/user/{username}/reset` after updating the plan. Updating `expire` and `data_limit` alone does not clear PasarGuard's consumed traffic.

**Why:** PasarGuard intentionally keeps usage when a user is modified; without the reset endpoint, a renewed account immediately inherits its old quota consumption.

**How to apply:** Carry an explicit renewal-only reset intent through failed-Provider retry jobs. Never reset usage during ordinary provisioning retries.

Do not run periodic status/group reconciliation across existing Provider users. Provider audit systems can treat even unchanged PUT requests as bulk account edits and block the integration.

**Why:** The Provider reported recurring account edits and warned that this traffic could result in blocks.

**How to apply:** Set status and Group 1 during explicit provisioning or renewal only. Do not start a periodic all-user worker or issue PUTs when no user-initiated lifecycle action requires them.