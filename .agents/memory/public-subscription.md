---
name: Public token subscription routes
description: Rules for keeping token-based subscription links public and compatible with legacy URLs.
---

Token-based subscription pages must bypass authenticated-shell redirects using a path-prefix check, because the router location includes the query string. Normalize legacy stored subscription URLs to the current public route in the client while preserving the token.

**Why:** A strict equality check for the route missed `/sub?t=...` and sent valid customers to the login screen.

**How to apply:** Keep public subscription data and AWG delivery behind token-specific server routes, never expose provider credentials, and use the app's current `/sub?t=` path for new links.