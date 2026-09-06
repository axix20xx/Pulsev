---
name: Session guard and logout
description: Durable access-control rules for the management UI behind Replit and Hostinger proxies.
---

Management routes must derive authentication only from the server session response; never substitute a display or fallback session that reports an authenticated role.

**Why:** A hardcoded presentation session can bypass the client route guard even though protected API endpoints still return unauthorized responses.

**How to apply:** Keep only the public subscription route outside the management guard, disable business queries until the session is authenticated, and clear user-scoped state whenever authentication is lost.

Same-origin CORS checks must compare the request Origin host with the effective request host, including the first forwarded host supplied by trusted deployment proxies.

**Why:** Browser POST requests include Origin even when frontend and API share one public domain; an allowlist-only callback with no configured origins blocks login on fresh Hostinger and preview deployments.

**How to apply:** Permit exact same-host origins dynamically, keep explicitly configured cross-origin hosts as a separate allowlist, and reject all other origins.

Logout should end with a full navigation to the login route after the server cookie is cleared.

**Why:** Client-side navigation can race a still-mounted authenticated query observer and briefly restore a protected route or cached dashboard.

**How to apply:** Mark the session unauthenticated immediately, hide overlapping mobile navigation while the drawer is open, then replace the current document with the base-path-aware login URL.