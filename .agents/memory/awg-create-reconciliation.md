---
name: AWG create reconciliation
description: How to handle ambiguous AmneziaWG client-create failures safely.
---

An AmneziaWG client creation request can return a generic HTTP 500 even after the requested client has already been committed.

**Why:** The provider may persist the client before a later firewall rebuild fails. Treating every 500 as a definite create failure leaves the service unlinked and can create orphan clients on retries.

**How to apply:** After a create timeout or server error, query the authenticated client list for the exact requested UUID. If it exists, treat creation as successful, persist that UUID, and complete the job.