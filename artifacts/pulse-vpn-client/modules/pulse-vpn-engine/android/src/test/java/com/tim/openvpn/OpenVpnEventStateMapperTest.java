package com.tim.openvpn;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public final class OpenVpnEventStateMapperTest {
    @Test
    public void mapsOnlyExplicitConnectionTransitions() {
        assertEquals("CONNECTED", OpenVpnEventStateMapper.stateForEvent("CONNECTED"));
        assertEquals("DISCONNECTED", OpenVpnEventStateMapper.stateForEvent("DISCONNECTED"));
        assertEquals("CONNECTING", OpenVpnEventStateMapper.stateForEvent("RESOLVE"));
        assertEquals("CONNECTING", OpenVpnEventStateMapper.stateForEvent("RECONNECTING"));
        assertEquals("CONNECTING", OpenVpnEventStateMapper.stateForEvent("WAIT"));
        assertNull(OpenVpnEventStateMapper.stateForEvent("INFO"));
        assertNull(OpenVpnEventStateMapper.stateForEvent("WARN"));
        assertNull(OpenVpnEventStateMapper.stateForEvent("BYTECOUNT"));
        assertNull(OpenVpnEventStateMapper.stateForEvent("UNKNOWN_EVENT"));
        assertNull(OpenVpnEventStateMapper.stateForEvent(null));
    }

    @Test
    public void connectedSurvivesInformationalEventsUntilARealTransition() {
        String state = OpenVpnEventStateMapper.stateAfterEvent(null, "CONNECTED");
        assertEquals("CONNECTED", state);

        for (String informationalEvent : new String[] { "INFO", "WARN", "BYTECOUNT", "UNKNOWN_EVENT", null }) {
            state = OpenVpnEventStateMapper.stateAfterEvent(state, informationalEvent);
            assertEquals("CONNECTED", state);
        }

        assertEquals("CONNECTING", OpenVpnEventStateMapper.stateAfterEvent(state, "RECONNECTING"));
        assertEquals("CONNECTED", OpenVpnEventStateMapper.stateAfterEvent("CONNECTING", "CONNECTED"));
        assertEquals("DISCONNECTED", OpenVpnEventStateMapper.stateAfterEvent("CONNECTED", "DISCONNECTED"));
    }
}
