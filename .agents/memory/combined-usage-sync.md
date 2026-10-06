---
name: Combined provider usage sync
description: Background quota enforcement combines panel usage and AmneziaWG usage with reset offsets.
---

Quota enforcement must aggregate effective usage from every successful configured panel row—including AzadPanel OpenVPN—and the AmneziaWG client, subtracting per-source reset offsets before comparing with the service quota.

**Why:** Provider counters can reset independently on renewal, and treating a reset counter as a decrease would undercount traffic or re-enable an exhausted service.

**How to apply:** Keep the worker idempotent and single-flight, persist combined bytes and cache state, disable remote clients and the local service on quota/date exhaustion, and leave failed provider reads stale rather than replacing them with zero.

The legacy AWG server's client list contains identity/address metadata but no traffic counters; counters come from each client's stats resource, and a 404 there means the stored client no longer exists remotely.

**Why:** Falling back to an unscoped client list can attribute another client's traffic, while silently accepting a missing client as zero erases real usage.

**How to apply:** Support wrapped stats and common counter aliases, preserve the previous value on invalid/missing stats, and only recreate a missing client during an explicit AWG repair/save action because its configuration changes.

Usage pages must keep showing persisted AWG counters after disabling a service deletes its remote client and clears the client ID. When no live client remains, present these as saved history rather than live stats.

**Why:** The remote client ID is cleared during disable, but the last counters remain in the database; hiding them makes a user's AWG history disappear.

**How to apply:** Include historical AWG usage when counters or reset offsets exist, even without a client ID. Never treat a missing ID or failed stats request as zero or recreate the client just to display history.

Provider clients and the AWG client are lifecycle parts of the same service: creation must not persist a partial service, and quota/date/manual disable is complete only after every configured remote is disabled.

**Why:** Treating one remote's success as the service's success can leave active access after a customer reaches quota or expiration.

**How to apply:** Roll back the local create on provider/AWG failure, perform best-effort remote cleanup, and retry automatic disable while any provider or AWG remains enabled.

AzadPanel OpenVPN reports current `used_traffic` in bytes; use it as a provider counter, not `lifetime_used_traffic`.

**Why:** Lifetime traffic can include earlier service periods, while the current counter works with the per-provider reset offsets used during renewal.

**How to apply:** Include AzadPanel in the combined usage ledger, retain its last effective reading when a transient read fails, and disable its account with the documented user update only when combined service quota is reached.

The AWG-only reporting poll runs every five minutes for unexpired active/expiring services with a stored AWG client ID. It updates AWG counters only; it does not change service state or call panel APIs. Keep the existing combined worker separate and unchanged.

**Why:** The user wants AWG readings refreshed without increasing panel traffic or risking accidental lifecycle changes; the existing combined worker still owns quota/expiry behavior.

**How to apply:** Share a five-minute per-client AWG result cache between workers, serialize stats requests, preserve saved counters on errors, and back off for an hour after all stats routes return route-level 404s. Do not run the poller locally without explicit approval.