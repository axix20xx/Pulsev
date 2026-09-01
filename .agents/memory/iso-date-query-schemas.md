---
name: ISO date query schemas
description: Compatibility rule for date query parameters shared by OpenAPI, Orval, and the Express request layer.
---

Use patterned OpenAPI strings for ISO dates sent in query parameters instead of `format: date`. In this workspace, Orval turns `format: date` into a Zod date parser, while Express receives query values as strings.

**Why:** A generated Zod query schema can reject an otherwise valid URL query before the route reaches its own date validation.

**How to apply:** Define date query values as strings with a `^\d{4}-\d{2}-\d{2}$` pattern, then convert only at the application/database boundary.