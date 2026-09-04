---
name: Provider subscription feed
description: Public subscription links must resolve through configured Provider credentials.
---

Public subscription feeds should first resolve the customer username through active, credential-backed Providers and proxy their returned subscription URL; legacy upstream URLs are only a compatibility fallback.

**Why:** Locally generated subscription tokens do not exist in the old external `sub.php` service, so proxying every token there returns a misleading 404/502 and clients import nothing.

**How to apply:** Keep the public token endpoint independent from Provider credentials, but let the server authenticate to Providers internally and return a client-compatible feed, combining base64 feeds when multiple Providers succeed.

V2Box deep links should pass the absolute feed URL as the `url` query value without percent-encoding the URL itself; the feed URL has no nested query parameters, while encoding it can leave some clients with an empty subscription.

**Why:** V2Box can create a subscription entry from the deep link while still failing to fetch or parse an encoded URL, which looks like a successful import with zero configs.

**How to apply:** Encode the subscription name, but keep the feed URL raw in `v2box://install-sub?url=...&name=...`; always offer a copy-feed fallback.

The canonical customer URL can serve both the browser status page and client feed: the Hostinger launcher uses HTML Accept headers for the page and non-browser client requests for the proxied feed.

**Why:** Customers need one shareable URL instead of separate status and import links, while browsers and VPN clients require different response bodies.

**How to apply:** Keep `/sub?t=<token>` as the public URL, proxy non-browser requests to the internal feed endpoint, and preserve the request User-Agent when forwarding to Provider resolution.

When detecting the one-link response mode, treat recognizable browser User-Agents as browser requests even if their `Accept` header is `*/*`; only known VPN client signatures should override that.

**Why:** Some embedded browsers and screenshot/proxy browsers omit `text/html` from `Accept`, so relying only on content negotiation can return a feed or provider error instead of the status page.

**How to apply:** Check known VPN client signatures first, then recognize common browser UA markers and `Sec-Fetch-Dest: document`; use the feed branch only for non-browser clients.

Portable database exports require the Hostinger runtime to use the same `SESSION_SECRET` that encrypted Provider credentials, or every Provider must be re-saved after migration.

**Why:** The imported subscription rows remain readable with any secret, but encrypted Provider credentials silently fail decryption and the public feed falls back to an unavailable-provider error.

**How to apply:** Treat a public subscription `502` with a healthy token/status response as a Provider credential/runtime problem first; repair the secret or re-enter Provider credentials before changing subscription tokens or frontend links.