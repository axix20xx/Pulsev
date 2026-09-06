---
name: Async partial provisioning
description: Background retry behavior for service creation and renewal when a Provider or AWG is unavailable.
---

Service creation or renewal may commit when at least one configured Provider succeeds. Each failed Provider is recorded as a targeted retry job, and AmneziaWG has its own retry job; the service stays visible while monitoring reports progress.

**Why:** A single unavailable external panel should not block a usable service on healthy Providers, while silently losing the failed Provider would leave the account incomplete.

**How to apply:** Keep ownership on every job, retry only the failed Provider keys, report partial renewal failures in the seller notification center, use bounded exponential backoff, and roll back when no Provider succeeds at all.

Every retry job must capture the service lifecycle generation and run under the same per-service advisory lock used by quota shutdown and renewal. Shutdown and renewal advance the generation; workers complete stale jobs without calling Provider or AWG APIs.

**Why:** A delayed retry can otherwise recreate access after quota exhaustion or attach a newly created AWG client to an older service state.

**How to apply:** Treat the generation as part of every provisioning job contract, re-check active state and generation before persisting remote results, cancel older jobs when state advances, and reset AWG state when renewal starts a new generation.