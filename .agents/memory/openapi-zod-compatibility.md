---
name: OpenAPI and Zod compatibility
description: Constraint between this workspace's Orval output and installed Zod version.
---

The workspace's generated Zod clients must target the installed Zod 3 API. OpenAPI integer schemas can cause Orval to emit the Zod 4-only top-level `z.int()` helper, while numeric fields generate Zod 3-compatible number schemas.

**Why:** Code generation can succeed while the library typecheck fails if the generated helper API is newer than the installed Zod package.

**How to apply:** After editing the OpenAPI contract, run codegen and the library typecheck together; keep the schema representation compatible with the workspace's installed Zod version unless the whole dependency graph is intentionally upgraded.