---
name: Provider subscription feed
description: Public subscription links must resolve through configured Provider credentials.
---

Public subscription feeds should first resolve the customer username through active, credential-backed Providers and proxy their returned subscription URL; legacy upstream URLs are only a compatibility fallback.

**Why:** Locally generated subscription tokens do not exist in the old external `sub.php` service, so proxying every token there returns a misleading 404/502 and clients import nothing.

**How to apply:** Keep the public token endpoint independent from Provider credentials, but let the server authenticate to Providers internally and return a client-compatible feed, combining base64 feeds when multiple Providers succeed.

Persist the last successfully resolved service feed as an encrypted fallback, and serve it when all live Provider attempts temporarily fail.

**Why:** Independent Provider retries keep one failed Provider from blocking healthy Providers, but a total transient outage would otherwise make previously working customer subscriptions return 502.

**How to apply:** Refresh the encrypted cache after any successful live or legacy resolution; use it only after live resolution fails, identify cached responses with a safe response header, and never claim a brand-new service is resilient until it has produced at least one valid feed.

V2Box deep links should pass the absolute feed URL as the `url` query value without percent-encoding the URL itself; the feed URL has no nested query parameters, while encoding it can leave some clients with an empty subscription.

**Why:** V2Box can create a subscription entry from the deep link while still failing to fetch or parse an encoded URL, which looks like a successful import with zero configs.

**How to apply:** Encode the subscription name, but keep the feed URL raw in `v2box://install-sub?url=...&name=...`; always offer a copy-feed fallback.

The canonical customer URL can serve both the browser status page and client feed: the Hostinger launcher uses HTML Accept headers for the page and non-browser client requests for the proxied feed.

**Why:** Customers need one shareable URL instead of separate status and import links, while browsers and VPN clients require different response bodies.

**How to apply:** Keep `/sub?t=<token>` as the public URL, proxy non-browser requests to the internal feed endpoint, and preserve the request User-Agent when forwarding to Provider resolution.

Clash-family clients must receive generated Mihomo YAML, while URI clients must keep the original plain/base64 subscription.

**Why:** Clash and Clash Plus reject V2Box-style URI/base64 feeds even when the underlying Provider configurations are valid.

**How to apply:** Detect Clash/Mihomo/Stash User-Agents or an explicit `format=clash`, convert supported VLESS/VMess/Trojan/Shadowsocks links to YAML, and return a `.yaml` content disposition without changing the cached source feed.

For AzadPanel Xray, merge the dynamic `subscription_url` feed with the individual config links returned by the API, even when the dynamic feed is valid. Deduplicate overlapping configs by their URI without the display-name fragment. Resolve root-relative subscription paths from the panel origin, not by appending them below an API path. Keep diagnostics safe: log provider key and status/error type, never subscription URLs, tokens, or config payloads.

**Why:** The link endpoint can return a valid dynamic feed that contains fewer nodes than its individual `links` array. Treating that feed as a complete replacement hides those extra VLESS/SS nodes from the combined customer feed.

**How to apply:** Fetch the absolute or root-relative `/sub/<token>` URL, require at least one supported config URI, then append every non-duplicate URI from the API `links` array. If the dynamic feed fails, use the direct links by themselves.

Prefix each combined-feed config name with a unique, stable three-letter code derived from its configured Provider identity so operators can visually confirm which Providers contributed nodes. Preserve the URI's connection parameters unchanged.

**Why:** The combined subscription hides source attribution, making it hard to tell whether a Provider's nodes were omitted.

**How to apply:** Apply the prefix to VLESS/VMess and other supported URI display names before merging and caching; do not expose credentials or full provider URLs in the label.

When detecting the one-link response mode, treat recognizable browser User-Agents as browser requests even if their `Accept` header is `*/*`; only known VPN client signatures should override that.

**Why:** Some embedded browsers and screenshot/proxy browsers omit `text/html` from `Accept`, so relying only on content negotiation can return a feed or provider error instead of the status page.

**How to apply:** Check known VPN client signatures first, then recognize common browser UA markers and `Sec-Fetch-Dest: document`; use the feed branch only for non-browser clients.

Portable database exports require the Hostinger runtime to use the same `SESSION_SECRET` that encrypted Provider credentials, or every Provider must be re-saved after migration.

**Why:** The imported subscription rows remain readable with any secret, but encrypted Provider credentials silently fail decryption and the public feed falls back to an unavailable-provider error.

**How to apply:** Treat a public subscription `502` with a healthy token/status response as a Provider credential/runtime problem first; repair the secret or re-enter Provider credentials before changing subscription tokens or frontend links.