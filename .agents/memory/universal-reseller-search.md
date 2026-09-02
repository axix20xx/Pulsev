---
name: Universal reseller search
description: Rules for cross-entity search across customers, services, sales, and subscription links.
---

Universal search is a server-side, ownership-scoped query across customer, service, and sale records. Search service fields must include customer name/mobile, username, plan, notes, service ID, and subscription URL; phone matching normalizes Persian and Arabic digits and strips separators.

**Why:** Resellers need one search entry point for operational records and subscription links, while a cross-entity endpoint must not become a data-leak path.

**How to apply:** Reuse the authenticated reseller ownership predicate for each union branch, return only safe navigation/link fields, debounce the frontend request, and keep the search result limit bounded.