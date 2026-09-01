---
name: Persian date boundaries
description: The sales UI uses Persian calendar dates while report APIs continue to receive Gregorian ISO dates.
---

User-facing date controls should display and accept Tehran Persian-calendar dates, then convert to Gregorian ISO strings only when calling APIs. Keep CSS `@import` rules before all other rules in the main stylesheet.

**Why:** Browser-native date inputs use the Gregorian calendar, while the product language and date labels are Persian. CSS imports placed after rules also trigger build warnings and can change stylesheet processing.

**How to apply:** Reuse the shared Persian date conversion helpers for every new date input and keep new component styles below the stylesheet imports.