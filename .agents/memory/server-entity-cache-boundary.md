---
name: Server entity cache boundary
description: Authenticated customer, service, sale, and reseller records must not be persisted in generic browser storage.
---

Server-owned business records must come from the authenticated API/query cache; browser persistence is reserved for intentional local preferences.

**Why:** Generic local storage survives logout and account changes, so stale seller records can briefly appear before the next API response.

**How to apply:** When changing client state, clear server entity state on signed-out/auth changes and never restore customer, service, sale, or reseller fixtures as an authenticated fallback.