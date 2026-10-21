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

Show native engine/tunnel state separately from Internet reachability. A running engine and established TUN may be labeled “tunnel active,” but only a successful payload-bearing HTTPS probe may be labeled “Internet verified.” A failed probe must remain visible and must not silently turn a real OpenVPN/WireGuard tunnel into “disconnected.”

**Why:** Platform VPN icons and engine lifecycle events do not prove user traffic can reach the Internet; conversely, a DNS/HTTPS probe failure can be independent from an established tunnel and must not misreport its lifecycle.

**How to apply:** Keep engine state authoritative for tunnel lifecycle, run reachability tests as a separate status, and preserve probe errors. For sing-box automatic server selection, try a small set of fast candidates using real traffic checks; if all fail, report the failed test rather than claiming Internet access.

When a user switches protocols, stop all Pulse-owned tunnels and wait for Android's VPN slot to be released before starting the selected engine. Never stop a VPN owned by another app.

**Why:** The user explicitly expects a protocol change to stop the previous tunnel first, and Android only permits one active VPN service per device.

**How to apply:** Enforce handoff in both protocol-selection UI and the native connection lock; verify engine states and VPN-network release, then fail clearly if another app still owns the slot.
