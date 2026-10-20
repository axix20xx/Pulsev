---
name: sing-box IPv6 interface prefixes
description: Avoid native sing-box crashes when enumerating Android IPv6 network-interface addresses.
---

Strip the Android IPv6 zone suffix (such as `%wlan0`) from an interface address before appending its prefix length. Keep the interface name as its own field.

**Why:** Go's `netip.ParsePrefix` rejects a scoped IPv6 address inside a prefix. sing-box's `MustParsePrefix` can turn an Android link-local address such as `fe80::…%wlan0/64` into a process-level `SIGABRT` instead of a recoverable connection error.

**How to apply:** When producing sing-box `NetworkInterface` address/prefix entries from Android `NetworkInterface.hostAddress`, remove everything from `%` onward before adding `/prefixLength`. Recheck this at any adapter boundary that serializes interface addresses.
