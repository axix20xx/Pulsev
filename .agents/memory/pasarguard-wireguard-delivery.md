---
name: PasarGuard WireGuard delivery
description: The PasarGuard API returns a user's WireGuard profiles as a ZIP of individual .conf files.
---

For a user-specific WireGuard download, resolve the already-provisioned PasarGuard user by username, then request `GET /api/user/{user_id}/subscription/wireguard`. The response is an archive of WireGuard `.conf` files.

`rain_admin_wireguard` can be the sole Rain Admin provider: its own credentials can create, renew, disable, and read usage for accounts, as well as fetch WireGuard profiles. If a separate `rain_admin` row targets the same exact PasarGuard instance, prefer it for standard account operations to avoid duplicate writes; the WireGuard extension still serves profile downloads. Never reuse numeric user IDs across distinct hosts or base paths.

**Why:** The user clarified that `rain_admin_wireguard` is their only Rain Admin provider. It must not require a second provider entry, while duplicate rows for one panel must not double-count or duplicate writes.

**How to apply:** For an account backfill, lookup first and create only after a confirmed not-found response using remaining quota and existing expiry. For new services and renewals, route normal account operations through this provider when no matching primary row exists. Compare normalized scheme, host, and API path before sharing provider identity or IDs.

The one-time backfill is authorized only for eligible existing services; it must not modify accounts that already exist.

Recheck each service's lifecycle, expiry, remaining quota, and WireGuard entitlement when the backfill job runs. Existing accounts must remain untouched, and create requests must not run after lookup errors, permission failures, or panel mismatch.

Rain Admin WireGuard usage belongs in the combined service quota and per-provider usage details. Public `/sub` and mobile delivery must expose each `.conf`, the all-server `.zip`, and the iOS profile from the saved provider identity.

**Why:** The user explicitly requires the standalone Rain Admin WireGuard API to count toward total usage and provide the same config downloads in subscription and mobile flows.

**How to apply:** Include `rain_admin_wireguard` in saved-usage reads and totals, use its saved provider identity when available, and keep public downloads keyed to the saved provider key rather than mixing it into the V2Ray feed.
