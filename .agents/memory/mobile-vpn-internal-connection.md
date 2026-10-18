---
name: In-app VPN connection requirement
description: The customer mobile VPN client must establish tunnels inside its own native app.
---

The Pulse customer mobile client must establish VPN connections internally through native Android tunnel engines; do not replace connection behavior with launching another VPN app.

**Why:** The user explicitly rejected external-app handoff and requested direct in-app connections for OpenVPN, WireGuard, AmneziaWG, and V2Ray-compatible profiles.

**How to apply:** Integrate and test each protocol's native engine separately. Only display connected state from the engine's real lifecycle/status events; never present profile availability as an active connection.
