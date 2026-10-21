---
name: Xray server health cache
description: Safe in-memory latency hints and real traffic validation for V2Ray server selection.
---

Keep V2Ray latency and tunnel-validation results in process memory, scoped by subscription ID; clear them on logout. Background TCP latency checks run only while the app is foreground, the server picker is visible, and Pulse native tunnels are idle. They must never initiate or switch a tunnel.

Treat TCP latency as a ranking hint, not proof of a working configuration. Prefer recent HTTPS-through-the-active-tunnel successes when the user starts smart connect, then latency-ranked candidates; validate each attempted tunnel with real traffic and try only a bounded number of alternatives. TCP probes cannot classify UDP-only protocols such as Hysteria2 or TUIC.

**Why:** Share-link identifiers may contain endpoints, and persistent health data can become stale or leak across account changes. A reachable TCP port or native “connected” state can still carry no user traffic.

**How to apply:** Keep measurements in a session-scoped memory cache, avoid probes through an active Pulse tunnel, and require a live HTTPS test through the selected tunnel before treating it as usable.
