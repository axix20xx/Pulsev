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