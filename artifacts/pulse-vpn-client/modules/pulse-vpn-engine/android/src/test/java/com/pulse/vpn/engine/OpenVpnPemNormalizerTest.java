package com.pulse.vpn.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class OpenVpnPemNormalizerTest {
    @Test
    public void normalizesCertificateLineEndingsAndLegacyX509Marker() {
        String input = "<ca>\\r\\n-----BEGIN X509 CERTIFICATE-----\\r\\nYWJj\\r\\n-----END X509 CERTIFICATE-----\\r\\n</ca>";

        String normalized = OpenVpnPemNormalizer.normalize(input);

        assertTrue(normalized.contains("<ca>\n-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n</ca>"));
    }

    @Test
    public void preservesTlsCryptV2KeyTagsAndContentsWhileNormalizingNewlines() {
        String input = "<tls-crypt-v2>\r\n-----BEGIN OpenVPN tls-crypt-v2 client key-----\r\nYWJj\r\n-----END OpenVPN tls-crypt-v2 client key-----\r\n</tls-crypt-v2>";

        String normalized = OpenVpnPemNormalizer.normalize(input);

        assertEquals(
            "<tls-crypt-v2>\n-----BEGIN OpenVPN tls-crypt-v2 client key-----\nYWJj\n-----END OpenVPN tls-crypt-v2 client key-----\n</tls-crypt-v2>",
            normalized
        );
    }
}
