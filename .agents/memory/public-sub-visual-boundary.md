---
name: Public subscription visual boundary
description: The public subscription page has an isolated presentation surface.
---

Keep `/sub` visual refactors inside a dedicated public-subscription class namespace and avoid changing shared management selectors.

**Why:** The subscription page has a different mobile-native visual language from the authenticated management panel; shared selector changes can silently regress operational screens.

**How to apply:** Preserve the existing public subscription behavior and API contract, and scope new layout, color, depth, and responsive rules to the public subscription root.

For dark-mode or responsive changes, place the final route-scoped cascade after legacy `/sub` layers or give it higher specificity; older duplicated public-subscription rules can otherwise restore light cards or flex layouts.

**Why:** The stylesheet contains historical `/sub` layers that are later in source order than the first scoped override, so a normal-specificity dark rule can appear correct in source while losing in the browser.

**How to apply:** Keep the override scoped to `#root .public-sub-v3` and verify both an active token page and the invalid-token state at a narrow viewport.