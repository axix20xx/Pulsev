---
name: Service identity
description: The stable, customer-facing reference used to identify a service across management and public subscription surfaces.
---

Use a stable display reference derived from the existing numeric service ID (`PULSE-` plus a zero-padded ID) instead of replacing or exposing a new routing identifier.

**Why:** The numeric ID already anchors ownership checks, renewal routes, tokens, and sales history. Deriving a readable reference keeps those boundaries intact while giving resellers and customers one value they can safely match across cards, announcements, and `/sub`.

**How to apply:** Return the reference with every service-shaped API response, include it in service-related notifications and public announcements, and keep sorting based on explicit creation/renewal timestamps rather than the display string.