---
name: Renewal service artifacts
description: The source of subscription and AmneziaWG links after renewal.
---

After a renewal, the UI must use the complete service returned by the renewal API for QR, subscription, and AmneziaWG download actions. The service object used to open the wizard can contain stale artifacts from before provider/AWG recreation.

**Why:** Renewal recreates the AWG client and can refresh service metadata, so using the original object risks presenting an old or missing download link.

**How to apply:** Return the mapped renewal response through the client context, store it in the success state, and build all success actions from that fresh object.

A renewal starts a fresh package immediately: its expiry is calculated from the renewal time, not appended to unused time, and all displayed usage resets to zero by rebasing Provider counters.

**Why:** Sellers expect renewal to replace the current package; carrying remaining days or historical traffic forward makes the selected duration and allowance inaccurate.

**How to apply:** Set expiry to now plus the selected days, set service usage/remaining fields to the new package baseline, and set each Provider usage offset to its pre-renewal raw counter.

Renewal must treat AmneziaWG recreation as an optional sidecar operation; a temporary AWG failure must not roll a successful service renewal into a 500 response.

**Why:** The main Provider renewal and database lifecycle can succeed while the separate AWG API is unavailable, and the seller still needs the renewed service immediately.

**How to apply:** Catch AWG recreation errors, commit the renewal, and enqueue an AWG job using the new lifecycle version for retry.

For legacy services that already have an AWG client, renewal should provision a fresh AWG client ID rather than POSTing the old ID again.

**Why:** New-service creation succeeds through the fresh-client endpoint, while an existing client can be stale or rejected by the AWG API when recreated with the same identifier.

**How to apply:** Best-effort disable the old client, create a fresh client, update the service atomically, and queue an AWG retry if fresh creation fails.

Renewal notification SQL must not reuse one PostgreSQL parameter as both a bigint column value and a text event-key fragment.

**Why:** PostgreSQL raises `42P08` (`inconsistent types deduced for parameter`) when a service ID parameter is used for `service_id` and directly constrained as text in the same prepared query.

**How to apply:** Pass a separate string parameter for event-key formatting while keeping the numeric service ID parameter for bigint columns.

During renewal, validate an existing AWG configuration before replacing the client.

**Why:** Provider-side client creation can return HTTP 500 even though the existing client remains usable; deleting it first unnecessarily removes a working subscription path.

**How to apply:** Preserve a usable client, create a replacement only when configuration is stale/unavailable, and never delete the old client until replacement creation succeeds.