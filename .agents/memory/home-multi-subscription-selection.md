---
name: Home multi-subscription selection
description: Customers must choose which active subscription to use before connecting when they have more than one.
---

When an account has multiple eligible subscriptions, do not silently select the first one on Home. Ask the customer which subscription should be used before continuing to server selection.

**Why:** The user explicitly requires a subscription choice on Home so connections are not attributed to an unintended plan.

**How to apply:** Prompt from the Home connect action and protocol tiles; show only subscriptions with configuration for the requested protocol as selectable, and persist the chosen subscription before navigation.
