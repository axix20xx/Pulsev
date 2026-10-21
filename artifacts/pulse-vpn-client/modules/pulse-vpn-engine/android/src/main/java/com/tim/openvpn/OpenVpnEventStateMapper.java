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
}
