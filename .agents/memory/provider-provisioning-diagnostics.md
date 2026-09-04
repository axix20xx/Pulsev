---
name: Provider provisioning diagnostics
description: Safe error reporting for strict multi-provider service creation.
---

When strict provisioning rejects a service because any configured Provider fails, the API should preserve the no-partial-service rollback policy while returning each failed Provider key and a truncated, credential-free reason.

**Why:** A generic 502 makes an external DNS, authentication, or API compatibility problem look like a database failure and prevents operators from fixing the right Provider.

**How to apply:** Keep per-provider status/error data internal to the provisioning result, include safe details in the user-facing error, and never include request bodies, tokens, passwords, or raw provider responses.

Provider settings should offer an explicit live server-side connection test that validates both reachability and authentication.

**Why:** Credential-ready only proves encrypted values exist; it does not prove the Provider accepts them or that the production host can reach its API.

**How to apply:** Test from the API server, show a safe status and timestamp in settings, never return credentials or raw upstream bodies, and preserve authentication errors over less-informative fallback endpoint failures.