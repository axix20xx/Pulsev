---
name: Hostinger framework detection
description: Hostinger's archive auto-detection depends on framework metadata in the root package manifest.
---

Keep the actual supported framework declared in the root `package.json` of flat Hostinger Web App archives. This app's API uses Express, so retain an `express` dependency there even though production code bundles Express.

**Why:** The original archive had a valid `package.json` and start script but no framework dependency, so Hostinger could not auto-detect its app type and rejected the project structure.

**How to apply:** When rebuilding this Hostinger archive, verify `express` remains under root `dependencies`, then use Hostinger's Node.js Web App flow with Application type `Express` and entry file `app.js`.