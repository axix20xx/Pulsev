---
name: AzadPanel OpenVPN handoff
description: Supported OpenVPN Connect import options for AzadPanel-backed customer profiles
---

AzadPanel returns an OpenVPN server address, username/password, locations, and `.ovpn` profiles, but not an OpenVPN Access Server import token or a customer-facing profile URL. OpenVPN Connect can import a profile from an HTTPS URL wrapped as `openvpn://import-profile/<percent-encoded-HTTPS-URL>`.

**Why:** The customer-facing reference uses its own HTTPS profile endpoint inside the OpenVPN Connect deeplink. An app-owned endpoint can provide the same handoff without exposing AzadPanel credentials or pretending its subscription token is an Access Server token.

**How to apply:** Build the deeplink around an app-owned HTTPS endpoint that validates the subscription bearer token and returns the actual profile as uncached `text/plain`, with no forced attachment download. Keep per-location downloads and official app links as fallbacks; never place provider credentials in the deeplink.
