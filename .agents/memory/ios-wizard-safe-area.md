---
name: iOS wizard safe area
description: Mobile layout rule for full-screen wizard dialogs on iOS.
---

Full-screen wizard dialogs must use the dynamic viewport height, keep the content region independently scrollable, and reserve bottom padding for the iOS safe area so action buttons stay above the Home Indicator/browser toolbar.

**Why:** A 100vh flex layout can place the wizard footer underneath the bottom navigation area on iPhone-sized screens.

**How to apply:** Keep the modal card constrained to 100dvh, make the wizard content the scrolling flex region, keep the footer non-shrinking, and include `env(safe-area-inset-bottom)` plus a practical mobile minimum.