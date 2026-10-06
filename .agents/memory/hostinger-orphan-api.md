---
name: Hostinger orphan API process
description: Hostinger may leave the launcher’s internal API child alive during a forced restart.
---

When the Hostinger launcher is restarted forcefully, its previous API child can survive briefly or become orphaned while still listening on the fixed internal port. A new launcher must probe the internal API and reuse a healthy existing process before spawning another child.

**Why:** Multiple launchers can each complete the database migration check, but spawning a migration child before probing the existing API can exhaust Hostinger's process limit (`EAGAIN`), while a second API child can fail with `EADDRINUSE`.

**How to apply:** Probe the internal API before starting migration or another child, coordinate first boot with a filesystem lock, keep the internal API port stable for the public proxy, retry transient `EAGAIN`, and report ready only after the API readiness check succeeds.

The launcher must distinguish a child that has exited from one that was explicitly killed; Node's `child.killed` flag is not an alive check. After a healthy API exits, automatically probe/restart it with backoff and keep serving the panel instead of reverting to the installer.

**Why:** Hostinger can terminate the API after startup, and treating an exited child as alive prevents recovery while the management route sees a non-ready phase and sends users to installation.

**How to apply:** Use `exitCode`/`signalCode` for liveness, wait for the internal health endpoint before declaring ready, schedule bounded restarts, and gate the installer only until the launcher has never reached a healthy API state.

Hostinger has a finite application-log quota; production launchers must not forward routine API request-completion logs, and the API log level should default to warnings/errors.

**Why:** Pino HTTP emits one info log per request, and forwarding every line through the launcher can fill Hostinger's log allowance and make the hosting process appear to fail.

**How to apply:** Default the child API to `LOG_LEVEL=warn`, filter API stdout in the launcher to warnings/errors/startup failures, and keep migration output available only while migration is running.

Keep API liveness and readiness separate. Liveness must respond immediately; readiness should remain pending until management and mobile schema initialization finishes. Use readiness for startup/reuse decisions and liveness for the watchdog. If an API is live but still initializing, keep it and avoid spawning a duplicate.

**Why:** The login/session route waits for `managementReady`, so treating it as a liveness probe can cause false startup timeouts and restart the API while DDL is still running. A liveness-only startup check has the opposite risk: the panel appears ready before its schema is usable.

**How to apply:** Keep `/api/healthz` independent of database setup and expose a fast `/api/readyz` status with `starting`, `ready`, or `error`; never kill a responsive `starting` API just because its readiness window elapsed. If both probes return `ECONNREFUSED`, diagnose process bootstrap or port binding rather than schema readiness.

Bind the Hostinger-only API child explicitly to IPv4 loopback (`127.0.0.1`), matching the launcher's internal probes; leave the shared Replit API's bind behavior unchanged.

**Why:** A wildcard/default address can select an address family that does not match the supervisor's IPv4 probe on some hosts.

**How to apply:** Set a Hostinger-specific child environment flag and branch the API listener address on that flag, rather than changing the shared API's default host.

For PostgreSQL socket failures, `Pool.on("error")` handles idle clients only. Attach a persistent error listener to each connected client so a failure during an active query is consumed instead of terminating Node. Keep API liveness independent from database availability, report database-backed request failures as temporary 503s, and prevent slow worker ticks from overlapping.

**Why:** A transient database timeout emitted an unhandled `pg.Client` error, killing the API child and triggering Hostinger's restart loop even though the HTTP server itself was recoverable.

**How to apply:** Add the client listener on the pool's `connect` event, keep the pool's own idle-error listener, single-flight periodic DB workers, and do not restart the API solely because a database-backed request failed.