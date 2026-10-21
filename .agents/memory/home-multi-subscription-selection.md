---
name: Home multi-subscription selection
description: Home must require an explicit eligible subscription choice before showing protocol routes, even when only one exists.
---

On Home and the Protocols tab, require an explicit eligible subscription choice before showing protocol routes. Do not silently select a subscription, even when there is only one. Derive protocol availability from the selected subscription only.

**Why:** The user wants a deliberate subscription-first flow so customers see only routes tied to the plan they chose.

**How to apply:** Show eligible subscriptions first, hide protocols until a valid one is selected, then show only its supported routes. Persist the choice before navigating to server selection; clear dependent protocol/server selections when changing subscriptions.
