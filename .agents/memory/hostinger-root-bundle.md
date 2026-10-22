---
name: Hostinger root bundle
description: Hostinger serves separate admin and customer frontend bundles at /panel and /mobile.
---

Hostinger exports serve the management frontend at both `/` and `/panel`, and the customer PWA at `/mobile`; build each entrypoint for its own public base. The root-level management routes must receive the same startup gate as `/panel`.

**Why:** The root login can load before the API finishes schema setup, so its first session request may query an incomplete database schema. Reusing a `/panel` build for `/mobile` also misroutes assets and service-worker scope.

**How to apply:** Build/copy the management frontend separately for `/` and `/panel/`, and the customer frontend for `/mobile/`. Gate root and panel HTML until API readiness, and await management schema readiness before attaching session auth. Serve the mobile manifest/SW within its scope and migrate stale registrations outside `/mobile/` before reload.