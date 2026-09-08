---
name: Renewal AWG lifecycle
description: AWG renewal deletes the old client and provisions a new client like a new service.
---

For service renewal, the AWG-compatible sequence is: clear usage caches, capture current stats as the offset when available, reset local AWG counters, create a new client through the normal initial-provisioning flow, and then delete the old client. AWG failures remain non-blocking and are retried separately.

**Why:** The product behavior requires renewal to be equivalent to a new AWG account rather than preserving the old client identity; creating first also avoids provider failures caused by deleting before a new client is accepted.

**How to apply:** Renewal and its AWG retry job must call the normal `POST /api/clients` flow first, persist the returned new UUID, and then remove the previous client. Completed or superseded jobs must not retain a `last_error`; old cancelled AWG jobs may be requeued only when the active service still has no AWG client and no newer AWG job is already active.