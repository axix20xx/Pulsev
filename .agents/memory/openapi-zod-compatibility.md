---
name: OpenAPI and Orval compatibility
description: Constraints between this workspace's Orval output, Zod version, and parameter naming.
---

The workspace's generated Zod clients must target the installed Zod 3 API. OpenAPI integer schemas can cause Orval to emit the Zod 4-only top-level `z.int()` helper. For integer-valued response fields, use `type: number` with `multipleOf: 1` to preserve integer validation in Zod 3. Also avoid mixing inline query parameters with path parameters on one operation: Orval can generate a Zod `OperationParams` export and a TypeScript query-params type with the same name. Replacing query values with referenced parameters does not necessarily avoid that collision; path-only route parameters do.

**Why:** Code generation can succeed while the library typecheck fails from either an unsupported Zod helper or duplicate barrel exports.

**How to apply:** After editing the OpenAPI contract, run codegen and the library typecheck together. Keep integer response schemas Zod 3-compatible with numeric `multipleOf: 1`; for an operation needing both route identity and optional selection values, consider a distinct path or another schema shape and verify generated exports before proceeding.