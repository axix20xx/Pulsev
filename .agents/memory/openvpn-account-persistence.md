---
name: OpenVPN account persistence
description: Safe persistence and reload behavior for customer OpenVPN access across public subscription and mobile pages.
---

Store the OpenVPN delivery payload encrypted at rest and keyed by the service, not by one browser view or token. Public reads may only decrypt the saved record and rebuild token-bound import URLs; they must not contact a Provider. Recovery or creation happens only after the customer explicitly chooses the action, with one setup attempt per service at a time. A legacy Provider account that predates app-side persistence needs one explicit recovery action before it can be shown after reload.

When AzadPanel returns `403` for the original OpenVPN username, treat it as a possible cross-reseller ownership collision: create/use a stable service-specific OpenVPN-only identity, store its provider username per service and provider, and use that mapping for later provisioning, profile downloads, usage polling, and every per-provider or combined usage query. Never switch accounts when the original lookup succeeds; never retry other 4xx/5xx responses as a collision.

**Why:** The collision identity is the real Provider account for that service. Any code that polls or aggregates by the original service username will miss its traffic, while users also need the same credentials on `/sub` and `/mobile` after refresh.

**How to apply:** Resolve the mapping by `(service_id, provider_key)` in provisioning, usage sync, admin detail cards, and combined service totals. Reuse the app’s existing credential encryption; return `no-store` responses; keep iOS import URLs pointed at the app-owned HTTPS profile endpoint. Do not add Provider calls to page-load paths.
