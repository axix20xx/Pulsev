---
name: sing-box hostname bootstrap DNS
description: DNS resolver requirements for sing-box proxy server hostnames on Android.
---

For sing-box 1.14+, resolve a proxy hostname over Android's physical network before starting the VPN, then pin that resolved IP in the outbound while preserving its TLS SNI and transport Host. Keep a physical-network bootstrap resolver for other hostnames, and route app DNS over HTTPS through the proxy when UDP relay is not guaranteed. Do not emit the removed TUN `dns_mode` field; use the modern route-rule DNS hijack action.

**Why:** sending the proxy endpoint's own DNS lookup through that proxy creates a bootstrap loop; explicitly detouring bootstrap UDP to an empty `direct` outbound is rejected by sing-box. A preflight DNS lookup alone is insufficient if sing-box later resolves the original hostname through the active VPN. Stale TUN DNS fields also fail config parsing in newer sing-box versions. UDP/53 through some proxy profiles may fail while TCP traffic works, leaving apps unable to resolve sites even with an active TUN.

**How to apply:** resolve the proxy endpoint using a non-VPN Android `Network`, replace only the outbound's `server` with the numeric result, and retain TLS `server_name`/Reality SNI and WebSocket Host. Enable modern route-rule DNS hijacking, use the physical bootstrap resolver for remaining hostnames, and detour app DoH through `proxy`.
