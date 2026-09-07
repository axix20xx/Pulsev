---
name: Public subscription visual boundary
description: The public subscription page has an isolated presentation surface.
---

Keep `/sub` visual refactors inside a dedicated public-subscription class namespace and avoid changing shared management selectors.

**Why:** The subscription page has a different mobile-native visual language from the authenticated management panel; shared selector changes can silently regress operational screens.

**How to apply:** Preserve the existing public subscription behavior and API contract, and scope new layout, color, depth, and responsive rules to the public subscription root.