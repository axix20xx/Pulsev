---
name: Hostinger orphan API process
description: Hostinger may leave the launcher’s internal API child alive during a forced restart.
---

When the Hostinger launcher is restarted forcefully, its previous API child can survive briefly or become orphaned while still listening on the fixed internal port. A new launcher must probe the internal API and reuse a healthy existing process before spawning another child.

**Why:** Multiple launchers can each complete the database migration check, but spawning a migration child before probing the existing API can exhaust Hostinger's process limit (`EAGAIN`), while a second API child can fail with `EADDRINUSE`.

**How to apply:** Probe the internal API before starting migration or another child, coordinate first boot with a short-lived filesystem lock, keep the internal API port stable for the public proxy, retry transient `EAGAIN`, and only report the installer as ready when either the reused API or the owned child is active.

The launcher must distinguish a child that has exited from one that was explicitly killed; Node's `child.killed` flag is not an alive check. After a healthy API exits, automatically probe/restart it with backoff and keep serving the panel instead of reverting to the installer.

**Why:** Hostinger can terminate the API after startup, and treating an exited child as alive prevents recovery while the management route sees a non-ready phase and sends users to installation.

**How to apply:** Use `exitCode`/`signalCode` for liveness, wait for the internal health endpoint before declaring ready, schedule bounded restarts, and gate the installer only until the launcher has never reached a healthy API state.