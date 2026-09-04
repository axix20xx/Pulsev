---
name: Panel availability policy
description: Defines when external VPN providers appear and who can use them.
---

Only providers with complete server-side credentials are considered active. Credential readiness must use the same database-backed encrypted-credential resolution as provisioning; environment variables are not a provider source. Every active provider is available to every enabled reseller; do not require per-reseller panel assignments.

**Why:** The user explicitly wants only panels with real data/credentials to appear and wants the complete available panel set shared by all users.

**How to apply:** Filter provider lists and provisioning targets by enabled state plus effective credential availability, then use the resulting full set for every authenticated reseller.

Provider kind values are lowercase machine identifiers (`marzban`, `rain_admin`, `falcon`), not editable display labels.

**Why:** Free-text editing allowed a visually correct value such as `Marzban` to be rejected with HTTP 400, making credential changes appear to save while the database remained unchanged.

**How to apply:** Render kind choices as a fixed selector and normalize case at both the client submission and API boundary; keep labels separate from stored identifiers.