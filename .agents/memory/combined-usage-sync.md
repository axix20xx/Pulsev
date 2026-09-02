---
name: Combined provider usage sync
description: Background quota enforcement combines panel usage and AmneziaWG usage with reset offsets.
---

Quota enforcement must aggregate effective usage from every successful V2Box panel row and the AmneziaWG client, subtracting per-source reset offsets before comparing with the service quota.

**Why:** Provider counters can reset independently on renewal, and treating a reset counter as a decrease would undercount traffic or re-enable an exhausted service.

**How to apply:** Keep the worker idempotent and single-flight, persist combined bytes and cache state, disable remote clients and the local service on quota/date exhaustion, and leave failed provider reads stale rather than replacing them with zero.

The legacy AWG server is configured through the imported `settings` row and exposes client stats at `/api/clients/{clientId}/stats` with top-level `rx_bytes` and `tx_bytes`; usage parsing must reject unknown payloads instead of treating them as zero.

**Why:** The old server remains the source of truth for AWG provisioning and counters, and silently accepting a changed response shape can erase a customer's displayed usage.

**How to apply:** Keep loading the URL/token from the database settings, support direct and wrapped stats payloads, and throw on non-JSON or missing receive/transmit counters so the sync worker preserves the previous value.