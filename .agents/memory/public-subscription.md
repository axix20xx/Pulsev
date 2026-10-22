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

When an upstream feed contains multiple provider URIs, the proxy must preserve the entire payload, but the new public subscription page must not expose raw configuration strings; an expired service may legitimately return only a fallback/disabled link.

**Why:** The feed is for VPN clients to import, while the customer-facing page should keep provider endpoints private and present only safe import actions.

**How to apply:** Never split-and-rebuild or filter the feed server-side; forward it intact, but do not parse or render its individual URI/config contents in `/sub`.

Imported Provider tokens may be longer than the locally generated 32-character tokens, and one service may need both its existing local token and a legacy URL token to remain valid during migration.

**Why:** Replacing or truncating a legacy token breaks already-distributed subscription links, while rejecting a second token alias makes the canonical imported URL resolve to an invalid page.

**How to apply:** Store tokens in a variable-length column large enough for Provider values, backfill legacy `/sub/<token>` values as aliases without deleting local tokens, and resolve all aliases to the same service.

Previously distributed `/sub/<token>` page links must keep resolving alongside `/sub?t=...`; customers may already have saved the direct route in a VPN app. New page and QR links remain query-style, while app imports use the separate feed URL.

**Why:** Changing a saved direct link can make an existing client subscription open an invalid page even when its token is still valid.

**How to apply:** Parse both path-token and query-token forms on the public page, preserve `/sub?t=...` for generated share/QR URLs, and never substitute the page URL for a VPN feed link.

Public VPN downloads must keep app-specific file types: individual WireGuard and AmneziaWG configs are `.conf`, multi-server WireGuard downloads are ZIPs containing one `.conf` per server, OpenVPN profiles are `.ovpn`, and Apple install profiles are `.mobileconfig`.

**Why:** Mobile browsers can infer `.txt` from generic text responses or extensionless URLs, and a concatenation of multiple WireGuard interfaces is not one valid importable `.conf` file.

**How to apply:** Enforce filenames in both response headers and same-origin download links; use `.conf` and `.ovpn` MIME types for individual downloads, ZIP per-server WireGuard configs, and serve Apple profiles as `application/x-apple-aspen-config` from routes shared by `/sub` and `/mobile`.