---
name: AzadPanel IPsec accounts
description: Protocol-specific identity and quota rules for AzadPanel IPsec/IKEv2.
---

AzadPanel IPsec is a separate core and account namespace, even when it shares a panel with OpenVPN. Use the IPsec provider row's own API credentials and persist a dedicated provider username for each customer service. Keep reseller access explicitly controlled by the master administrator; do not infer IPsec permission from OpenVPN or WireGuard access.

**Why:** Provider credentials and user records are protocol-specific. Reusing an OpenVPN identity can target the wrong core, misattribute traffic, or fail authorization; ignoring the dedicated identity can also make combined quotas and disable actions incorrect.

**How to apply:** Create IPsec accounts only after an explicit user action, read their usage through the saved provider identity, include that usage in the same service quota and disable decision as other protocols, and renew/reset that identity only during an explicit service renewal. Customer-detail usage breakdowns must join the saved IPsec username and provider key, then sum IPsec alongside every enabled provider and AWG for the displayed combined total. For Apple bundles, recognize `VPNType = IKEv2` at the `com.apple.vpn.managed` payload root (and the nested representation for compatibility); retain only those VPN payloads and required certificate payloads, and include them only when the reseller has IPsec enabled and the account exists.
