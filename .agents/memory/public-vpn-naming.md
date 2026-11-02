---
name: Provider-blind public VPN names
description: Naming rules for VPN profiles exposed on public subscription pages and in client apps.
---

Keep provider brands out of visible `/sub` and `/mobile` VPN server labels. Use one stable protocol-and-ordinal scheme across screen labels, `.conf`/`.ovpn` downloads, ZIP entries, and iOS `UserDefinedName` values. Provider identifiers may remain in private routing URLs and internal data, but not in customer-facing names.

**Why:** Customers choose a protocol/server, not an internal panel; inconsistent provider names make the same profile look unrelated across downloads and VPN apps.

**How to apply:** Generate public names and filenames from the service identity, protocol, and stable server order. Use `OpenVPN · Server 01` / `WireGuard · Server 01` for labels, include the service code in downloaded filenames, and keep iOS profile names aligned without provider names.
