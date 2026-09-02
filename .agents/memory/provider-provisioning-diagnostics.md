---
name: Provider provisioning diagnostics
description: Safe error reporting for strict multi-provider service creation.
---

When strict provisioning rejects a service because any configured Provider fails, the API should preserve the no-partial-service rollback policy while returning each failed Provider key and a truncated, credential-free reason.

**Why:** A generic 502 makes an external DNS, authentication, or API compatibility problem look like a database failure and prevents operators from fixing the right Provider.

**How to apply:** Keep per-provider status/error data internal to the provisioning result, include safe details in the user-facing error, and never include request bodies, tokens, passwords, or raw provider responses.