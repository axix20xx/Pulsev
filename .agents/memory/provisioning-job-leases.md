---
name: Provisioning job leases
description: Reliability rules for provider and AWG background jobs.
---

Provisioning jobs use a short worker-owned lease with periodic heartbeats. A stale running job is recoverable only after its lease expires; manual retry must be ownership-scoped and must not interrupt an active lease.

**Why:** A process restart can leave a job permanently marked running, while an aggressive reset can run two provisioning operations for the same service.

**How to apply:** Keep lease ownership separate from service lifecycle ownership, clear the lease on completion/retry, and retain a stable AWG candidate UUID across retries so an ambiguous provider response cannot create duplicates.