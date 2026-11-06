---
name: Usage forecasting
description: Statistical policy for quota-exhaustion forecasts and customer package recommendations.
---

Forecast traffic from complete Tehran-calendar daily samples aggregated across every saved provider source. Use a recency-weighted robust estimate and show fast/slow usage scenarios; if evidence is sparse, show uncertainty rather than a precise date. Customer package suggestions are based on recent usage with a modest reserve and must remain opt-in.

**Why:** Provider counters reset independently, and sparse or partial samples can otherwise create misleading precision. A recommendation should help the reseller decide, not silently choose or submit a package.

**How to apply:** Reuse the same estimator for analytics, customer profiles, and package suggestions. Keep the contractual expiry date separate from quota exhaustion, report whichever is expected first, and never infer a zero-usage rate from missing history.
