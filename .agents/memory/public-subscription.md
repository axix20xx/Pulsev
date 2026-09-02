---
name: Public token subscription routes
description: Rules for keeping token-based subscription links public and compatible with legacy URLs.
---

Token-based subscription pages must bypass authenticated-shell redirects using a path-prefix check, because the router location includes the query string. The UI should derive a new domain-prefixed `/sub?t=` page URL from any stored token while preserving the original feed URL separately for direct client imports.

**Why:** A strict equality check for the route missed `/sub?t=...` and sent valid customers to the login screen.

**How to apply:** Keep public subscription data and AWG delivery behind token-specific server routes, never expose provider credentials, use the app's current `/sub?t=` path for new display/QR links, and retain the feed URL for V2Box and client deep links.

Client deep links should use documented schemes where available (V2Box, Clash/Karing, Hiddify, Stash, V2RayNG, Quantumult X, Loon, and Surge); keep clipboard import as the fallback for clients without a stable official import scheme such as Streisand.

**Why:** App URL schemes differ by platform and some commonly copied Streisand/Shadowrocket formats are not stable or officially documented.

**How to apply:** Treat the subscription URL itself as the universal source of truth, expose one-tap schemes only when verified, and always retain a visible copy/import path.

The browser-facing `/sub?t=` route is an HTML details page, not an app-import feed. App links must target the domain-prefixed public feed proxy, which preserves the upstream subscription body and forwards the requesting client headers.

**Why:** Subscription apps cannot parse the React page, while the legacy provider feed already emits the configuration format and supports client-specific negotiation.

**How to apply:** Keep the stored/display page URL separate from the feed URL, proxy the legacy upstream feed without rewriting its body, and override `subscription-userinfo` from the database so quota and expiry remain accurate even when the upstream cache is stale.

When an upstream feed contains multiple provider URIs, the proxy must preserve the entire payload and the public page should enumerate each supported URI for individual copying; an expired service may legitimately return only a fallback/disabled link.

**Why:** Provider subscriptions commonly contain many server endpoints, and silently showing only the first one makes a healthy multi-provider subscription look incomplete.

**How to apply:** Never split-and-rebuild the feed server-side; forward it intact, and use client-side extraction only as an additional visibility/copy aid.