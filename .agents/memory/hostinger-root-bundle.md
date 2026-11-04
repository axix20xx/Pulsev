---
name: Hostinger root bundle
description: The public landing page stays at the Hostinger root; the staff console stays at /panel.
---

Hostinger exports serve the public landing page at `/`, the staff management frontend at `/panel`, and the customer PWA at `/mobile`; build each entrypoint for its own public base. Preserve `/sub` and `/store/:slug` as public routes. The root service worker caches the public shell, so bump its cache version when replacing that shell to make installed browsers fetch the new page.

**Why:** The bare domain is the public front door and must not expose the management login; staff use `/panel`. Old root service-worker caches can keep serving a previous shell after an update, and reusing a `/panel` build for `/mobile` misroutes assets and service-worker scope.

**How to apply:** Build/copy the public landing separately at `/`, the management frontend at `/panel/`, and the customer frontend at `/mobile/`. Keep public subscription/store routes working, avoid redirects from `/` to `/panel`, and version the root shell cache when it changes. Await API readiness before management session auth; keep the mobile manifest/service worker inside `/mobile/`.