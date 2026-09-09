---
name: Hostinger root bundle
description: Hostinger serves separate admin and customer frontend bundles at /panel and /mobile.
---

Hostinger production exports must build each routed frontend for its actual public base: `/panel` for admin/reseller and `/mobile` for the customer PWA. The launcher must route those paths to separate bundle roots.

**Why:** Reusing one `/panel` build for `/mobile` makes Wouter, assets, manifest, and service-worker scopes point at the admin app. Old service workers can then keep serving the panel login even after the server route is corrected.

**How to apply:** Build/copy the frontend twice with `PORT` plus `BASE_PATH=/panel/` and `BASE_PATH=/mobile/`; route `/panel` and `/mobile` to their matching roots, serve the mobile manifest/SW inside the mobile scope, and migrate stale registrations outside `/mobile/` before reload.