---
name: Legacy renewal sequence
description: AWG renewal must preserve the legacy worker's reset and same-ID recreation order.
---

For service renewal, the AWG-compatible sequence is: clear usage caches, capture current stats as the offset when available, reset local AWG counters, delete the existing client, wait two seconds, and POST the same client ID again. AWG failures remain non-blocking and are retried separately.

**Why:** The deployed Provider accepts ordinary client creation, while renewal depends on the delete/wait/recreate lifecycle used by the legacy cron.

**How to apply:** Do not replace the old client with a random ID or skip the delete delay in the renewal path; keep the endpoint and `{ id }` payload unchanged.