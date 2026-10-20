---
name: sing-box hostname bootstrap DNS
description: DNS resolver requirements for sing-box proxy server hostnames on Android.
---

For sing-box 1.14+, proxy outbounds whose server is a hostname need a usable `domain_resolver`. Keep a dedicated bootstrap DNS server on the physical network, and route app DNS over HTTPS through the proxy when its UDP relay is not guaranteed. The HTTPS resolver's own hostname should use the bootstrap resolver.

**Why:** sending the proxy endpoint's own DNS lookup through that proxy creates a bootstrap loop; explicitly detouring bootstrap UDP to an empty `direct` outbound is rejected by sing-box. UDP/53 through some proxy profiles may also fail while TCP traffic works, leaving apps unable to resolve sites even with an active TUN.

**How to apply:** in Android configs, enable TUN DNS hijacking, set `route.default_domain_resolver` to a bootstrap resolver using the active physical network's DNS, and set app DNS to an HTTPS server detoured through `proxy` with `domain_resolver` pointing to bootstrap.
