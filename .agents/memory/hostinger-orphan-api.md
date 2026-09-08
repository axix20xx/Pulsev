---
name: Hostinger orphan API process
description: Hostinger may leave the launcher’s internal API child alive during a forced restart.
---

When the Hostinger launcher is restarted forcefully, its previous API child can survive briefly or become orphaned while still listening on the fixed internal port. A new launcher must probe the internal API and reuse a healthy existing process before spawning another child.

**Why:** Multiple launchers can each complete the database migration check, but a second API child then fails with `EADDRINUSE` even though the database and migration marker are healthy.

**How to apply:** Keep the internal API port stable for the public proxy, probe a health/session endpoint before spawning, treat a healthy response as reusable, and only report the installer as ready when either the reused API or the owned child is active.