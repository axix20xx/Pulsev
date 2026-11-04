---
name: Hostinger root bundle
description: Keep the florist-facing public shell at the Hostinger root and staff management at /panel.
---

Hostinger exports serve the fictional Persian flower-shop storefront at `/`, the staff management frontend at `/panel`, and the customer PWA at `/mobile`; build each entrypoint for its own public base. Preserve `/sub` and `/store/:slug` as public routes. Root metadata, manifest, favicon, and touch icon must match the florist shell.

**Why:** The user wants a flower-shop landing page at the bare domain while the real staff login remains separate. Old root service-worker caches can keep serving a previous shell after an update, and reusing a `/panel` build for `/mobile` misroutes assets and service-worker scope.

**How to apply:** Build/copy the florist shell separately at `/`, the management frontend at `/panel/`, and the customer frontend at `/mobile/`. Keep public subscription/store routes working, avoid redirects from `/` to `/panel`, and brand root-only metadata/icons independently from panel/mobile. Keep the mobile manifest/service worker inside `/mobile/`.