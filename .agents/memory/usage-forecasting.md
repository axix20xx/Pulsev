---
name: Usage forecasting
description: Statistical policy for quota-exhaustion forecasts and customer package recommendations.
---

Forecast traffic from complete Tehran-calendar daily samples aggregated across every saved provider source. Use a recency-weighted robust estimate and show fast/slow usage scenarios; if evidence is sparse, show uncertainty rather than a precise date. Customer package suggestions are based on recent usage with a modest reserve and must remain opt-in. Weekly day/hour heatmaps should use a fixed seven-calendar-day window including today through its latest sample, independent of the main chart range; daily trend summaries should use complete days only, and missing observations must not be presented as sampled zero traffic.

**Why:** Provider counters reset independently, and sparse or partial samples can otherwise create misleading precision. Operators need to see today's observed activity in the heatmap, while a partial day must not skew a daily trend. A range such as “today” should not silently collapse a weekly-pattern chart to one day. A recommendation should help the reseller decide, not silently choose or submit a package.

**How to apply:** Reuse the same estimator for analytics, customer profiles, and package suggestions. Keep the contractual expiry date separate from quota exhaustion, report whichever is expected first, and never infer a zero-usage rate from missing history. Label the heatmap's partial current day and expose coverage so a complete-looking chart does not imply complete collection.
