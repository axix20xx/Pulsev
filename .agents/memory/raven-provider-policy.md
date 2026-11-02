---
name: Raven provider policy
description: Channel selection, legacy-service boundaries, and safe renewal semantics for the Raven API provider.
---

Treat Raven as a standalone bearer-key API provider, not as a panel-compatible Rain Admin or Marzban instance; it uses an API key, not a username/password. Super-admin settings choose the channels used when creating Raven configs: Xray, WireGuard, OpenVPN, and DNS. When an enabled Raven provider is saved, queue missing accounts for active services that have finite remaining quota and more than one day of expiry. Recheck service status/quota/expiry in the worker; skip existing mappings, unlimited services, no-expiry services, and near-expiry services.

For renewal, check Raven's reset quote and require `allowed: true` before resetting usage. Then add only the positive difference needed to reach the renewed package's target GB, and set expiry from the renewal date. Do not automatically replay a reset or revive after its result may have applied; surface the partial state for manual checking.

Keep Raven DNS out of iOS VPN mobileconfig bundles for now. Raven documents it as a separately configured gaming-DNS profile, not as a VPN tunnel.

**Why:** The user requested automatic Raven account creation for old services when provider credentials are saved, chose “reset usage and add quota” for renewals, and explicitly chose to keep DNS out of iOS profiles for now. Raven config creation and traffic resets can consume seller credit.

**How to apply:** Keep Raven credentials API-key-only, channel choices super-admin controlled, and backfill idempotent; preserve the reset-quote guard and no-duplicate-charge behavior, and don't add a DNS payload without an iOS-compatible resolver value.
