---
name: Panel availability policy
description: Defines when external VPN providers appear and who can use them.
---

Only providers with complete server-side credentials are considered active. Credential readiness must use the same database-backed encrypted-credential resolution as provisioning; environment variables are not a provider source. Standard service-provisioning providers remain shared across enabled resellers, but protocol-specific capabilities such as WireGuard and IPsec require their explicit reseller access flags and must never enter generic OpenVPN/Xray provisioning.

**Why:** The user wants only panels with real data/credentials to appear, while keeping WireGuard and IPsec access separately controlled per reseller.

**How to apply:** Filter provider lists and provisioning targets by enabled state plus effective credential availability. Share standard providers with enabled resellers, but enforce protocol-specific reseller permissions on every WireGuard/IPsec service, subscription, and provisioning path.

Provider kind values are lowercase machine identifiers (`marzban`, `rain_admin`, `falcon`), not editable display labels.

**Why:** Free-text editing allowed a visually correct value such as `Marzban` to be rejected with HTTP 400, making credential changes appear to save while the database remained unchanged.

**How to apply:** Render kind choices as a fixed selector and normalize case at both the client submission and API boundary; keep labels separate from stored identifiers.