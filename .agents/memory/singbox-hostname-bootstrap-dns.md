---
name: sing-box hostname bootstrap DNS
description: DNS resolver requirements for sing-box proxy server hostnames on Android.
---

For sing-box 1.14+, proxy outbounds whose server is a hostname need a usable `domain_resolver`. Keep a dedicated bootstrap DNS server on the direct/physical network, and use the proxy-routed resolver for app traffic.

**Why:** sending the proxy endpoint's own DNS lookup through that proxy creates a bootstrap loop; Android can show a VPN interface and default routes while no proxied traffic succeeds.

**How to apply:** when generating Android sing-box configs, set `route.default_domain_resolver` to the direct bootstrap resolver and use the active physical network's DNS address for it. Continue to use the proxy-detoured DNS server as the user-traffic default.
