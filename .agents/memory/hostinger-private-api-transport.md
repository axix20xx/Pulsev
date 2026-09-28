---
name: Hostinger private API transport
description: Hostinger's managed Node runtime may refuse loopback TCP between a launcher and its API child despite the listener being bound.
---

For the Hostinger deployment, route parent/child health checks and API proxy requests through the shared private Unix socket rather than exposing the API on another TCP interface.

**Why:** Hostinger logs showed the API child bound to `127.0.0.1` and shared a network namespace with its launcher, yet both the child's self-check and the launcher's health probes received `ECONNREFUSED`.

**How to apply:** Preserve the socket-based path in the Hostinger launcher and API bootstrap; use the isolated TCP listener only for non-Hostinger runs. Keep stale-socket removal guarded by a failed health probe and process ownership checks.