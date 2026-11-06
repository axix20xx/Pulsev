---
name: VPN profile text bridge
description: Preserve downloaded VPN configuration as plain text before passing it to Android native engines.
---

Provider profile responses may use binary or custom MIME types even though the payload is a text configuration. The generated API client can interpret those responses as Blob-like objects; Android native engine methods require actual strings.

**Why:** Passing an object through the React Native bridge leads to Kotlin receiving an object instead of configuration text, so a connection fails before the native engine can parse the profile.

**How to apply:** For mobile VPN profile downloads, request `responseType: 'text'`, preserve the raw configuration contents, and validate a non-empty string before any tunnel stop or switch. Keep a test that rejects object responses at the bridge boundary.
