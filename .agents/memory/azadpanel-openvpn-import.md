---
name: AzadPanel OpenVPN handoff
description: Supported OpenVPN Connect import options for AzadPanel-backed customer profiles
---

AzadPanel returns an OpenVPN server address, username/password, locations, and `.ovpn` profiles, but not an OpenVPN Access Server import token. OpenVPN Connect's `openvpn://import-profile/<token>` flow must not be built from the AzadPanel subscription token or server URL.

**Why:** The app deep link expects an Access Server import token; AzadPanel's profile and subscription values are different credentials and are not interchangeable.

**How to apply:** Offer OpenVPN Connect's in-app Import Profile → URL flow with the returned server and credentials, plus per-location `.ovpn` downloads and official app links. On iPhone, use the iOS share sheet to open a downloaded profile in OpenVPN Connect.
