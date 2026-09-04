---
name: Panel availability policy
description: Defines when external VPN providers appear and who can use them.
---

Only providers with complete server-side credentials are considered active. Credential readiness must use the same database-backed encrypted-credential resolution as provisioning; environment variables are not a provider source. Every active provider is available to every enabled reseller; do not require per-reseller panel assignments.

**Why:** The user explicitly wants only panels with real data/credentials to appear and wants the complete available panel set shared by all users.

**How to apply:** Filter provider lists and provisioning targets by enabled state plus effective credential availability, then use the resulting full set for every authenticated reseller.