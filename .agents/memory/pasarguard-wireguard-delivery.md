---
name: PasarGuard WireGuard delivery
description: The PasarGuard API returns a user's WireGuard profiles as a ZIP of individual .conf files.
---

For a user-specific WireGuard download, resolve the already-provisioned PasarGuard user by username, then request `GET /api/user/{user_id}/subscription/wireguard`. The response is an archive of WireGuard `.conf` files.

When a read-only `rain_admin_wireguard` login cannot resolve the username, try the primary Rain Admin credentials only if both provider API bases identify the same PasarGuard instance. Keep the archive request on the WireGuard extension; never reuse numeric user IDs across distinct hosts or base paths.

**Why:** A restricted WireGuard login may be allowed to fetch subscription configs but not inspect user records; PasarGuard IDs are only meaningful within the same panel instance.

**How to apply:** Compare normalized scheme, host, and API path before sharing a lookup. Keep account resolution read-only, then fetch `/api/user/{user_id}/subscription/wireguard` through the configured extension.

Keep `rain_admin_wireguard` itself read-only: it fetches user-specific configs but never creates, renews, or disables accounts. A separately approved, one-time legacy backfill may create a missing account through a matching primary `rain_admin` provider, only when both point to the exact same PasarGuard instance. Never modify an account that already exists.

**Why:** The user approved creating matching accounts for eligible services originally provisioned elsewhere, while avoiding changes to existing provider accounts and preventing IDs from being reused across panels.

**How to apply:** Queue a paced backfill only for active, unexpired services with quota remaining and reseller WireGuard access. Verify the exact panel instance, look up first, create only on a confirmed not-found response using remaining quota and existing expiry, then fetch the archive through the WireGuard extension. Keep `/sub` and `/mobile` delivery behavior unchanged.

Recheck each service's lifecycle, expiry, remaining quota, and WireGuard entitlement when the backfill job runs. Existing accounts must remain untouched, and create requests must not run after lookup errors, permission failures, or panel mismatch.
