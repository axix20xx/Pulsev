---
name: Panel availability policy
description: Defines when external VPN providers appear and who can use them.
---

Only providers with complete server-side credentials are considered active. Credential readiness must use the same effective resolution as provisioning, including encrypted settings and legacy environment fallback; checking nullable database fields alone can report a configured provider as unavailable. Every active provider is available to every enabled reseller; do not require per-reseller panel assignments.

**Why:** The user explicitly wants only panels with real data/credentials to appear and wants the complete available panel set shared by all users.

**How to apply:** Filter provider lists and provisioning targets by enabled state plus effective credential availability, then use the resulting full set for every authenticated reseller.