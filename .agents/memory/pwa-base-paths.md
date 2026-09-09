---
name: PWA base paths
description: Installable panel assets must use paths relative to the Vite artifact base so Replit previews and flat Hostinger deployments share one bundle.
---

Keep the manifest link, service-worker registration, service-worker scope, and shell cache entries relative to the artifact base path rather than hardcoding `/`.

**Why:** The same management frontend is built under a Replit artifact prefix and under `/panel/` on Hostinger; absolute root URLs silently escape the mounted app in one of those environments.

**How to apply:** Use `import.meta.env.BASE_URL` for runtime registration and relative manifest/shell URLs, then rebuild the Hostinger panel with its own `BASE_PATH`.