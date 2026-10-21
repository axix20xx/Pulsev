package com.tim.openvpn;

/**
 * Maps only OpenVPN core events that represent a connection-state transition.
 * Informational and unknown events must not change the service state.
 */
public final class OpenVpnEventStateMapper {
    private OpenVpnEventStateMapper() {}

    public static String stateForEvent(String name) {
        if (name == null) return null;
        switch (name) {
            case "RESOLVE":
            case "WAIT":
            case "RECONNECTING":
            case "CONNECTING":
            case "GET_CONFIG":
            case "ASSIGN_IP":
                return "CONNECTING";
            case "CONNECTED":
                return "CONNECTED";
            case "DISCONNECTED":
                return "DISCONNECTED";
            default:
                return null;
        }
    }

    /**
     * Applies a state-bearing event without allowing informational or unknown
     * events to erase the last authoritative connection state.
     */
    public static String stateAfterEvent(String currentState, String name) {
        String mappedState = stateForEvent(name);
        return mappedState == null ? currentState : mappedState;
    }
}
