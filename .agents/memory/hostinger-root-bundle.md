---
name: Hostinger root bundle
description: Hostinger's flat launcher serves the frontend at the domain root.
---

Hostinger production bundles must be built with `BASE_PATH=/`; the flat launcher serves `web/index.html` at `/`, not under the Replit artifact prefix.

**Why:** Reusing the Replit `/sales-manager` build makes asset URLs point to `/sales-manager/assets/...`, which the Hostinger launcher does not serve and can produce a blank page after navigation.

**How to apply:** Build the Hostinger frontend separately with `PORT` plus `BASE_PATH=/`, and run the export validator before attaching the ZIP.