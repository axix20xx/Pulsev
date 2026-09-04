---
name: Provider subscription feed
description: Public subscription links must resolve through configured Provider credentials.
---

Public subscription feeds should first resolve the customer username through active, credential-backed Providers and proxy their returned subscription URL; legacy upstream URLs are only a compatibility fallback.

**Why:** Locally generated subscription tokens do not exist in the old external `sub.php` service, so proxying every token there returns a misleading 404/502 and clients import nothing.

**How to apply:** Keep the public token endpoint independent from Provider credentials, but let the server authenticate to Providers internally and return a client-compatible feed, combining base64 feeds when multiple Providers succeed.