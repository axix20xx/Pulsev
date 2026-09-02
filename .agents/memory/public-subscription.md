---
name: Public token subscription routes
description: Rules for keeping token-based subscription links public and compatible with legacy URLs.
---

Token-based subscription pages must bypass authenticated-shell redirects using a path-prefix check, because the router location includes the query string. Normalize legacy stored subscription URLs to the current public route in the client while preserving the token.

**Why:** A strict equality check for the route missed `/sub?t=...` and sent valid customers to the login screen.

**How to apply:** Keep public subscription data and AWG delivery behind token-specific server routes, never expose provider credentials, use the app's current `/sub?t=` path for new links, and generate QR codes locally from that same public URL rather than sending tokens to a third-party QR service.

Client deep links should use documented schemes where available (V2Box, Clash/Karing, Hiddify, Stash, V2RayNG, Quantumult X, Loon, and Surge); keep clipboard import as the fallback for clients without a stable official import scheme such as Streisand.

**Why:** App URL schemes differ by platform and some commonly copied Streisand/Shadowrocket formats are not stable or officially documented.

**How to apply:** Treat the subscription URL itself as the universal source of truth, expose one-tap schemes only when verified, and always retain a visible copy/import path.