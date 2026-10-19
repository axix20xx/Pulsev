---
name: OpenVPN Android state and retry limits
description: The tim06 OpenVPN Android service runs in a separate process and raw profiles can retry indefinitely.
---

When passing a raw `.ovpn` profile through `OpenVPNConfig(configuration = ...)`, impose finite DNS and connection retries instead of relying on the library's generated-config defaults. After binding to the `:openvpn` service, register the callback and explicitly read its current `IVPNService` state; callback registration alone does not replay the existing state.

**Why:** A profile containing `resolv-retry infinite` can leave the tunnel connecting forever when DNS or the endpoint cannot be reached. Since the native service is in a separate process, the app's local state can remain stale if it misses the service's transition callback.

**How to apply:** Keep retry limits in the private, per-connection config; refresh the native state through the binder after registration and during polling; verify failure and recovery behavior in a custom Android build.
