---
name: Audit entity identifiers
description: Type boundary between management route IDs and audit-log entity identifiers.
---

Audit-log `entity_id` values are stored as text, while management routes commonly parse customer and service identifiers as numbers. Queries joining or filtering audit records must cast the route parameter to text at the SQL boundary.

**Why:** A CRM timeline query can fail at runtime with PostgreSQL's `text = integer` operator error even though the route parameter validation and TypeScript checks pass.

**How to apply:** Whenever a management query filters `reseller_audit_log.entity_id` using a numeric route ID, use an explicit text cast and keep ownership predicates in the same query.