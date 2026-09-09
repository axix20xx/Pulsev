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

For the AWG server contract used by this workspace, a healthy authenticated list endpoint does not prove that client creation works: the Provider can return a deliberately generic HTTP 500 for both valid legacy ID formats and protocol versions.

**Why:** A live probe reached `/health`, authenticated `/api/clients` successfully, and listed existing clients, while controlled creates still returned the Provider's generic internal error. The failure therefore belongs to the AWG host's peer/interface/storage path, not the panel payload.

**How to apply:** Keep the panel's request contract unchanged until Provider logs identify the failing operation; inspect the AWG service logs for peer insertion, interface rebuild, storage, or interface-limit errors before changing IDs, endpoints, or protocol defaults.

The AWG host can return only a generic HTTP 500 to Pulse while its own logs reveal allocator exhaustion, such as `no available IPs in subnet 10.0.0.0/24`.

**Why:** Renewal creates the replacement peer before removing the old one, so a full client subnet blocks every retry even though the Pulse listener and database are healthy.

**How to apply:** Free verified orphan/disabled peers or expand the AWG client subnet on the Provider host before retrying renewal; do not switch renewal to delete-first just to mask capacity exhaustion.