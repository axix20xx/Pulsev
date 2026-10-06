---
name: Provider operation safety
description: Rules for avoiding Provider rate limiting when making account changes.
---

Provider account mutations must be initiated by explicit user action and target one service on one selected Provider. Avoid batch or scheduled changes to Provider accounts; the user reported repeated nighttime account changes can lead Providers to block them. For repair, update only active, in-quota, unexpired users and preserve the exact existing quota, expiry, and traffic counters; never call Provider usage-reset endpoints as part of repair.

**Why:** The user reported automated or widespread Provider changes risk account blocks and requested narrow repairs without changing quota, time, or usage.

**How to apply:** Expose one confirmed per-service action, validate eligibility on the server, send only to that Provider, and verify locally with static checks or mocked requests rather than live Provider writes.
