---
name: PostgreSQL BIGINT runtime boundaries
description: Worker IDs must be converted from pg strings before safe-integer checks and Provider identity logic.
---

Normalize PostgreSQL BIGINT identifiers to validated safe integers at application boundaries; TypeScript query generics do not convert runtime data. Do not change the global pg BIGINT parser, which can silently lose precision.

**Why:** Provider backfills could complete without saving a V2Ray identity because pg supplied a string service ID and Number.isSafeInteger rejected it. Unit tests using numeric IDs missed the production-shaped input. Missing mappings are not by themselves evidence of old deployed code or an ownership denial.

**How to apply:** Include string IDs in regression tests, reject unsafe IDs before Provider calls, and verify durable account mappings before marking V2Ray backfills successfully completed.
