---
name: Renewal AWG lifecycle
description: AWG renewal deletes the old client and provisions a new client like a new service.
---

For service renewal, the AWG-compatible sequence is: clear usage caches, capture current stats as the offset when available, reset local AWG counters, delete the existing client, wait two seconds for asynchronous provider cleanup, and create a new client with a new UUID just like initial provisioning. AWG failures remain non-blocking and are retried separately.

**Why:** The product behavior requires renewal to be equivalent to a new AWG account rather than preserving the old client identity, and the provider can reject immediate replacement while deletion is still propagating.

**How to apply:** Renewal and its AWG retry job must delete the current client, wait two seconds, call the normal `POST /api/clients` flow, and persist the returned new UUID.