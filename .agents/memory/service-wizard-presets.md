---
name: Service wizard presets
description: The service creation wizard’s quick-choice behavior and API boundary.
---

Quick volume and duration buttons in the service wizard are convenience shortcuts, not a new API contract. They must write numeric gigabyte/day values into the existing controlled form, keep custom inputs available, and calculate the displayed expiry using the existing Tehran/Persian date helpers.

**Why:** The provisioning flow already depends on the existing create-service payload; changing the UI must not alter provider creation or date semantics.

**How to apply:** Keep preset values centralized in the wizard, preserve the final numeric conversion before submission, and verify selected values remain visible through the confirmation step.