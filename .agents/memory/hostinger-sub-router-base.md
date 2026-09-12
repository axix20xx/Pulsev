---
name: Hostinger public subscription router base
description: Public /sub uses a separate asset bundle path and must not inherit that path as its browser route base.
---

The Hostinger public subscription bundle loads assets from `/panel-sub-assets`, but its browser router must use an empty base because the page itself is served at `/sub`.

**Why:** Reusing the asset base as the Wouter route base prevents the public subscription route from resolving in the Hostinger bundle and can produce a blank or fallback screen.

**How to apply:** Keep `/panel` route base-aware, keep `/mobile` and `/panel-sub-assets` bundles route-base-free, and verify `/sub?t=...` after every Hostinger rebuild.