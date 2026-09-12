---
name: Hostinger bundle synchronization
description: How to keep the flat Hostinger package aligned with source API and route-specific frontend builds.
---

The Hostinger ZIP contains compiled API and separate panel, mobile, and public-subscription frontend outputs. A route can exist in source while the deployed package still serves an older bundle.

**Why:** The management UI can request a real endpoint that is present in the current API source but absent from the packaged API, producing a deployment-only failure that local development hides.

**How to apply:** After source changes, rebuild the API, rebuild each affected frontend with its own `BASE_PATH`, copy the outputs into `hostinger-export`, run the package validator, and smoke-test the launcher paths before zipping.