---
name: Service disable history
description: How dashboard activity should identify services disabled today
---

Daily disabled-service metrics and activity must use an explicit disable timestamp, not a generic updated timestamp.

**Why:** A service can be edited, renewed, or synchronized after its status changes; updated_at alone cannot prove when or why it was disabled.

**How to apply:** Set the timestamp on manual and automatic disable transitions, clear it when reactivated, and include the stored note/reason in activity details using Tehran date boundaries.