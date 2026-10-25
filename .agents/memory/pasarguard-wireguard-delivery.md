---
name: PasarGuard WireGuard delivery
description: The PasarGuard API returns a user's WireGuard profiles as a ZIP of individual .conf files.
---

For a user-specific WireGuard download, resolve the already-provisioned PasarGuard user by username, then request `GET /api/user/{user_id}/subscription/wireguard`. The response is an archive of WireGuard `.conf` files.

`rain_admin_wireguard` can be the sole Rain Admin provider: its own credentials can create, renew, disable, and read usage for accounts, as well as fetch WireGuard profiles. If a separate `rain_admin` row targets the same exact PasarGuard instance, prefer it for standard account operations to avoid duplicate writes; the WireGuard extension still serves profile downloads. Never reuse numeric user IDs across distinct hosts or base paths.

**Why:** The user clarified that `rain_admin_wireguard` is their only Rain Admin provider. It must not require a second provider entry, while duplicate rows for one panel must not double-count or duplicate writes.

**How to apply:** For an account backfill, lookup first and create only after a confirmed not-found response using remaining quota and existing expiry. For new services and renewals, route normal account operations through this provider when no matching primary row exists. Compare normalized scheme, host, and API path before sharing provider identity or IDs.

The one-time backfill is authorized only for eligible existing services; it must not modify accounts that already exist. If public `/sub` or mobile requests a missing delivery record, first look up the extension account and create it only after a confirmed not-found response, for an active eligible service.

Recheck each service's lifecycle, expiry, remaining quota, and WireGuard entitlement when the backfill job runs. Existing accounts must remain untouched, and create requests must not run after lookup errors, permission failures, or panel mismatch.

Rain Admin WireGuard usage belongs in the combined service quota and per-provider usage details. Public `/sub` and mobile delivery must expose each `.conf`, the all-server `.zip`, and the iOS profile from the saved provider identity.

**Why:** The user explicitly requires the standalone Rain Admin WireGuard API to count toward total usage and provide the same config downloads in subscription and mobile flows.

**How to apply:** Include `rain_admin_wireguard` in saved-usage reads and totals, persist delivery metadata when a profile is first prepared, use its saved provider identity for downloads, and keep it separate from the V2Ray feed. On mobile, treat a zero quota limit as unlimited, not as an exhausted service.

**Why:** A provider account can exist without a local encrypted delivery row; in that case both public clients hide the profiles even though the provider can serve them.

**How to apply:** For an active entitled service with no saved delivery, resolve the unique configured Rain Admin WireGuard provider, safely ensure the missing account if lookup confirms it is absent, then save the returned profile locations before responding. Never create after a transient lookup error or when provider identity is ambiguous.

The public subscription page must treat a missing expiry date as no expiry, not as zero days remaining; otherwise it marks a valid subscription finished and hides every protocol choice.

**Why:** Services without a fixed expiry are valid, and the backend already reports them as unfinished.

**How to apply:** Keep client-side expiration checks conditional on a real, parseable expiry date, and preserve quota exhaustion as a separate limit check.

Both public WireGuard retrieval and the create/retry action must use the same Rain Admin ensure-account flow before requesting profiles.

**Why:** The subscription page calls GET automatically and POST when the user retries; a POST path that only reads profiles can fail forever when the extension account is missing.

**How to apply:** Route both actions through the provider-aware backfill/delivery helper, then persist the same delivery record. Return only sanitized provider error detail so missing groups or profiles can be diagnosed without exposing credentials.

Public subscription and mobile WireGuard delivery is a collection: include every enabled WireGuard provider for the service, such as AzadPanel and the standalone Rain Admin extension.

**Why:** The user explicitly asked to see both providers and any other configured WireGuard sources together rather than one provider taking precedence over another.

**How to apply:** Persist each delivery under its provider key, group profiles by provider in `/sub` and mobile, and make combined ZIP and iOS bundles include every enabled provider. Keep provider-specific download links available and never reuse identities across providers.
