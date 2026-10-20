# Android VPN engine notices

- OpenVPN 3 core 3.11.7: GNU AGPL-3.0-only or MPL-2.0, with the OpenSSL linking permission described in `openvpn3/LICENSE.md`. The selected distribution must comply with its license and source-offer requirements.
- Android service classes adapted from `tim06/VPNProtocols` 1.1.3: Apache License 2.0. The original Maven POM identifies the license; project URL: https://github.com/tim06/VPNProtocols/
- Asio 1.24.0: Boost Software License 1.0, included in `asio/LICENSE_1_0.txt`.
- Mbed TLS 2.28.4: Apache License 2.0, included in `mbedtls/LICENSE`.
- LZ4 1.8.3: BSD 2-Clause license, included in `lz4/LICENSE`.

OpenVPN 3 source and its bundled notices are in `openvpn3/`. The Android service classes in `libs/openvpn-service-classes.jar` are derived from the Apache-2.0 VPNProtocols release with its old OpenVPN JNI wrappers and thread class removed; the thread adapter is maintained in this module.
