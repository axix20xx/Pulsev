---
name: OpenVPN account persistence
description: Safe persistence and reload behavior for customer OpenVPN access across public subscription and mobile pages.
---

Store the OpenVPN delivery payload encrypted at rest and keyed by the service, not by one browser view or token. Public reads may only decrypt the saved record and rebuild token-bound import URLs; they must not contact a Provider. Recovery or creation happens only after the customer explicitly chooses the action, with one setup attempt per service at a time. A legacy Provider account that predates app-side persistence needs one explicit recovery action before it can be shown after reload.

**Why:** Users need the same credentials on `/sub` and `/mobile` after refresh, while repeated automatic Provider checks can cause rate limits or account blocks, as the user warned.

**How to apply:** Reuse the app’s existing credential encryption; return `no-store` responses; keep iOS import URLs pointed at the app-owned HTTPS profile endpoint. Do not add Provider calls to page-load or polling paths.
