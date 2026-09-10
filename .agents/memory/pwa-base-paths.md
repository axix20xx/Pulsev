---
name: PWA base paths
description: Installable panel assets must use paths relative to the Vite artifact base so Replit previews and flat Hostinger deployments share one bundle.
---

Keep the manifest link, service-worker registration, service-worker scope, and shell cache entries relative to the artifact base path rather than hardcoding `/`.

**Why:** The same management frontend is built under a Replit artifact prefix and under `/panel/` on Hostinger; absolute root URLs silently escape the mounted app in one of those environments.

**How to apply:** Use `import.meta.env.BASE_URL` for runtime registration and relative manifest/shell URLs, then rebuild the Hostinger panel with its own `BASE_PATH`.

Push links to the public subscription screen need a PWA-local route (`/mobile/sub`) when opened from the customer service worker; the standalone Hostinger `/sub` page still needs its own root-built bundle with assets rewritten to `/panel-sub-assets/`.

**Why:** Navigating a `/sub` notification directly from a scoped `/mobile/` app can load outside the mounted artifact and appear blank, while Hostinger serves `/sub` from a separate static root.

**How to apply:** Normalize `/sub` to `./sub` inside the service worker and render the public subscription component before the mobile router; rebuild both the root subscription bundle and the `/mobile/` bundle.