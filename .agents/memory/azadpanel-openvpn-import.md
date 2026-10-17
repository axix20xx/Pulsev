---
name: AzadPanel protocol handoffs
description: Protocol-specific credentials and safe customer import flows for AzadPanel
---

AzadPanel returns an OpenVPN server address, username/password, locations, and `.ovpn` profiles, but not an OpenVPN Access Server import token or a customer-facing profile URL. OpenVPN Connect's import-profile deeplink uses the raw HTTPS URL after `openvpn://import-profile/`; do not percent-encode the nested URL. The profile endpoint must return `application/x-openvpn-profile`.

**Why:** OpenVPN's webauth RFC specifies the literal nested URL and exact profile MIME type. Percent-encoding the URL or returning the Provider's `text/plain` response type makes the Connect import invalid.

**How to apply:** Build the deeplink around a same-origin HTTPS profile endpoint; return the profile uncached, inline, with `application/x-openvpn-profile`, and never put Provider credentials in the link. Keep direct `.ovpn` downloads as a fallback. Do not add a one-time login handshake to the importer.

## WireGuard

An AzadPanel account is bound to its configured protocol core. Configure WireGuard as a distinct provider type/row with its own provider username/password; never reuse the OpenVPN provider credentials. Verify the selected core against AzadPanel's `/api/admin` response before protocol-specific provisioning. The official iOS app does not publish a `wireguard://` import scheme. AzadPanel supplies per-endpoint `.conf` files, not a customer import URL or cloud ID; WireGuard's official iOS repository documents `.mobileconfig` profiles as the supported iOS installation path.

**Why:** Mixing credentials across core-specific AzadPanel accounts can make provisioning fail or target the wrong protocol. WireGuard's returned config contains the private key, so exposing it in a URL or storing it as ordinary delivery metadata is unsafe. iOS profile installation still requires customer confirmation in Settings; it is not a silent app deeplink.

**How to apply:** Keep each protocol-specific provider connection super-admin managed and separate per-reseller access from provider credentials. Persist only non-secret account/location metadata; fetch and stream each config only after an explicit user action, with no-store headers. Offer `.conf` for manual import and a `.mobileconfig` profile on iOS, explain the Settings confirmation step, and never promise an unsupported URL scheme or send provider credentials to the browser.
