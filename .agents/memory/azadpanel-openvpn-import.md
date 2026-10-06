---
name: AzadPanel OpenVPN handoff
description: Supported OpenVPN Connect import options for AzadPanel-backed customer profiles
---

AzadPanel returns an OpenVPN server address, username/password, locations, and `.ovpn` profiles, but not an OpenVPN Access Server import token or a customer-facing profile URL. OpenVPN Connect's import-profile deeplink uses the raw HTTPS URL after `openvpn://import-profile/`; do not percent-encode the nested URL. The profile endpoint must return `application/x-openvpn-profile`.

**Why:** OpenVPN's webauth RFC specifies the literal nested URL and exact profile MIME type. Percent-encoding the URL or returning the Provider's `text/plain` response type makes the Connect import invalid.

**How to apply:** Build the deeplink around a same-origin HTTPS profile endpoint; return the profile uncached, inline, with `application/x-openvpn-profile`, and never put Provider credentials in the link. Keep direct `.ovpn` downloads as a fallback. Do not add a one-time login handshake to the importer.
