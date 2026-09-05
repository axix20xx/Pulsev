---
name: Renewal service artifacts
description: The source of subscription and AmneziaWG links after renewal.
---

After a renewal, the UI must use the complete service returned by the renewal API for QR, subscription, and AmneziaWG download actions. The service object used to open the wizard can contain stale artifacts from before provider/AWG recreation.

**Why:** Renewal recreates the AWG client and can refresh service metadata, so using the original object risks presenting an old or missing download link.

**How to apply:** Return the mapped renewal response through the client context, store it in the success state, and build all success actions from that fresh object.

A renewal starts a fresh package immediately: its expiry is calculated from the renewal time, not appended to unused time, and all displayed usage resets to zero by rebasing Provider counters.

**Why:** Sellers expect renewal to replace the current package; carrying remaining days or historical traffic forward makes the selected duration and allowance inaccurate.

**How to apply:** Set expiry to now plus the selected days, set service usage/remaining fields to the new package baseline, and set each Provider usage offset to its pre-renewal raw counter.