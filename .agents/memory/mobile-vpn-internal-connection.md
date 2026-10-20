---
name: In-app VPN connection requirement
description: The customer mobile VPN client must establish tunnels inside its own native app.
---

The Pulse customer mobile client must establish VPN connections internally through native Android tunnel engines; do not replace connection behavior with launching another VPN app.

**Why:** The user explicitly rejected external-app handoff and requested direct in-app connections for OpenVPN, WireGuard, AmneziaWG, and V2Ray-compatible profiles.

**How to apply:** Integrate and test each protocol's native engine separately. Only display connected state from the engine's real lifecycle/status events; never present profile availability as an active connection.

For sing-box on mobile, verify connectivity with a non-empty response body; change the TUN MTU only when packet-size diagnostics support it.

**Why:** A zero-body HTTP 204 can succeed without confirming payload delivery, while a fixed MTU without path evidence can mask the actual routing or DNS defect.

**How to apply:** Keep the core/network MTU unless logs or size-specific tests show fragmentation or path-MTU failure; require received bytes before marking traffic as verified.

For sing-box, treat persisted status as a cache, not proof that its Android service is still alive; reconcile active states against the current process after process recreation.

**Why:** SharedPreferences survive app-process death, but the foreground service and its TUN descriptor do not necessarily survive with them.

**How to apply:** Record the service-owning process when publishing tunnel state and clear stale active states before displaying them; keep requiring a non-empty tunnel response for verified connectivity.
