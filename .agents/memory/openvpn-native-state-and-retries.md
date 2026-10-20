---
name: OpenVPN Android state and retry limits
description: The tim06 OpenVPN Android service runs in a separate process and raw profiles can retry indefinitely.
---

When passing a raw `.ovpn` profile through `OpenVPNConfig(configuration = ...)`, impose finite DNS and connection retries instead of relying on the library's generated-config defaults. After binding to the `:openvpn` service, register the callback and explicitly read its current `IVPNService` state; callback registration alone does not replay the existing state.

OpenVPN engine diagnostics are produced inside the separate `:openvpn` process. A static field in the app process cannot read them; relay sanitized error/progress details over Binder or an atomic file in app-private storage.

Before constructing any generated `ClientAPI_*` SWIG wrapper for profile preflight, call `System.loadLibrary("ovpn3")` in that same process. The later service/thread load does not initialize the JNI library for preflight.

**Why:** `resolv-retry infinite` can leave a profile connecting forever, and missed binder callbacks can leave local state stale. Process-local diagnostics disappear across Android process boundaries. Separately, constructing SWIG wrappers before loading `libovpn3` can poison class initialization and surface as `NoClassDefFoundError` even when the dex class and ABI library are packaged.

**How to apply:** Keep retry limits in the private per-connection config; refresh binder state after callback registration and while polling; pass sanitized engine diagnostics across the process boundary; load `ovpn3` before every direct JNI preflight; verify in a custom Android build.
