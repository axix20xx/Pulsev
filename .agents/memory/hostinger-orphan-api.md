---
name: Hostinger orphan API process
description: Hostinger may leave the launcher’s internal API child alive during a forced restart.
---

When the Hostinger launcher is restarted forcefully, its previous API child can survive briefly or become orphaned while still listening on the fixed internal port. A new launcher must probe the internal API and reuse a healthy existing process before spawning another child.

**Why:** Multiple launchers can each complete the database migration check, but spawning a migration child before probing the existing API can exhaust Hostinger's process limit (`EAGAIN`), while a second API child can fail with `EADDRINUSE`.

**How to apply:** Probe the internal API before starting migration or another child, keep the internal API port stable for the public proxy, retry transient `EAGAIN`, and only report the installer as ready when either the reused API or the owned child is active.