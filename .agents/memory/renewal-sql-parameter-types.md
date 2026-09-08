---
name: Renewal SQL parameter types
description: Renewal persistence queries combine service values with dynamic ownership predicates.
---

Renewal persistence must keep service identifiers and ownership parameters in distinct, explicitly typed PostgreSQL placeholders; otherwise a reused placeholder can produce `42P08` text-versus-bigint failures after remote provisioning has already succeeded.

**Why:** A renewal can complete its Provider work and still return HTTP 500 while saving the new lifecycle state if the dynamic ownership predicate shares a placeholder number with a numeric service value.

**How to apply:** When changing the renewal transaction or ownership SQL, reserve later placeholders for ownership parameters and cast service, reseller, day, and numeric-volume parameters at the query boundary.