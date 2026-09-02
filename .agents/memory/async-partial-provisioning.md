---
name: Async partial provisioning
description: Background retry behavior for service creation when a Provider or AWG is unavailable.
---

Service creation may commit when at least one configured Provider succeeds. Each failed Provider is recorded as a targeted retry job, and AmneziaWG has its own retry job; the service stays visible while monitoring reports progress.

**Why:** A single unavailable external panel should not block a usable service on healthy Providers, while silently losing the failed Provider would leave the account incomplete.

**How to apply:** Keep ownership on every job, retry only the failed Provider keys, use bounded exponential backoff, and retain the existing rollback when no Provider succeeds at all.