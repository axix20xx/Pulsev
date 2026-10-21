package com.tim.openvpn;

/** Dependency-free regression test; run with javac and java. */
public final class OpenVpnEventStateMapperTest {
    private static void expect(String event, String expected) {
        String actual = OpenVpnEventStateMapper.stateForEvent(event);
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(
                "Expected " + event + " to map to " + expected + ", got " + actual
            );
        }
    }

    public static void main(String[] args) {
        expect("CONNECTED", "CONNECTED");
        expect("DISCONNECTED", "DISCONNECTED");
        expect("RESOLVE", "CONNECTING");
        expect("RECONNECTING", "CONNECTING");
        expect("INFO", null);
        expect("WARN", null);
        expect("BYTECOUNT", null);
        expect("UNKNOWN_EVENT", null);
        expect(null, null);
        System.out.println("OpenVPN event-state regression tests passed.");
    }
}
