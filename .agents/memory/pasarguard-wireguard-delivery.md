---
name: PasarGuard WireGuard delivery
description: The PasarGuard API returns a user's WireGuard profiles as a ZIP of individual .conf files.
---

For a user-specific WireGuard download, resolve the already-provisioned PasarGuard user by username, then request `GET /api/user/{user_id}/subscription/wireguard`. The response is an archive of WireGuard `.conf` files.

Expose Rain Admin WireGuard as a read-only provider extension. It may resolve an existing account and fetch its configs, but must not create, renew, disable, or account for users. Reuse the existing WireGuard delivery contract so `/sub` and `/mobile` continue to own profile selection and `.conf`/ZIP/iOS bundle downloads.

**Why:** PasarGuard serves WireGuard independently from the normal user subscription and provisioning flows; treating it as a normal provider can cause duplicate writes and duplicate usage accounting.

**How to apply:** When adding or changing this integration, keep account writes on the primary provider, retrieve only user-specific WireGuard archives, and make archive handling size-bounded and safe before returning files to clients.

On an explicit Rain Admin WireGuard credential save, a one-time paced backfill may prepare and encrypt delivery metadata for active, unexpired services with quota remaining that do not already have saved WireGuard delivery. This is a read-only profile fetch: it must never create or modify provider users.

**Why:** The user requested automatic setup for eligible existing subscriptions, while retaining the read-only provider boundary that avoids duplicate account writes.

**How to apply:** Queue only missing service deliveries for resellers with WireGuard access, space requests, recheck service eligibility when each job runs, and surface non-retryable missing-user or missing-config errors in the job monitor.
