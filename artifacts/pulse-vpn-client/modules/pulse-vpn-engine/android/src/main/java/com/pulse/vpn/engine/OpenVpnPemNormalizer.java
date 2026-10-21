package com.pulse.vpn.engine;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Normalizes line endings in inline PEM blocks without changing key material. */
public final class OpenVpnPemNormalizer {
    private static final String[] INLINE_TAGS = { "ca", "cert", "key", "tls-crypt-v2" };

    private OpenVpnPemNormalizer() {}

    public static String normalize(String config) {
        if (config == null) return "";

        String normalized = config
            .replace("\uFEFF", "")
            .replace("\r\n", "\n")
            .replace('\r', '\n');

        for (String tag : INLINE_TAGS) {
            Pattern expression = Pattern.compile(
                "(?is)<" + Pattern.quote(tag) + "(?:\\s[^>]*)?>(.*?)</" + Pattern.quote(tag) + "\\s*>"
            );
            Matcher matcher = expression.matcher(normalized);
            StringBuffer output = new StringBuffer();
            while (matcher.find()) {
                String block = matcher.group(1)
                    .replace("\\r\\n", "\n")
                    .replace("\\n", "\n")
                    .replace("\\r", "\n")
                    .trim();

                if ("ca".equals(tag) || "cert".equals(tag)) {
                    block = block
                        .replaceAll("(?i)-----BEGIN\\s+X509\\s+CERTIFICATE-----", "-----BEGIN CERTIFICATE-----")
                        .replaceAll("(?i)-----END\\s+X509\\s+CERTIFICATE-----", "-----END CERTIFICATE-----");
                }

                String replacement = "<" + tag + ">\n" + block + "\n</" + tag + ">";
                matcher.appendReplacement(output, Matcher.quoteReplacement(replacement));
            }
            matcher.appendTail(output);
            normalized = output.toString();
        }

        return normalized;
    }
}
