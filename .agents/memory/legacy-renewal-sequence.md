---
name: AmneziaWG renewal and iOS profiles
description: Preserve existing AmneziaWG iOS profiles across renewals when the provider can safely keep the tunnel identity.
---

The desired customer experience is that renewing service does not require downloading another AmneziaWG mobileconfig. Preserve the existing client/key when the Provider supports safely extending its expiry/quota in place. A mobileconfig is a static snapshot and cannot silently refresh itself if the tunnel configuration changes.

**Why:** The user does not want customers to reinstall mobileconfig after each renewal. Rotating or deleting the Provider client invalidates the installed keys; iOS has no automatic refresh mechanism for an already-installed static profile.

**How to apply:** Before changing renewal or quota-disable behavior, verify the Provider can update/extend the same client and can still block exhausted service safely without deleting its key. If it cannot, do not claim mobileconfig can auto-refresh; explain that the only supported fallback is the customer installing a replacement profile.