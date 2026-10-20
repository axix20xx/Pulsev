/*
 * Adapted from the Apache-2.0-licensed VPNProtocols Android library:
 * https://github.com/tim06/VPNProtocols
 *
 * The OpenVPN 3.11 API changes are limited to the DNS callback and removal of
 * the obsolete route-emulation option.
 */
package com.tim.openvpn;

import android.os.Handler;
import android.os.HandlerThread;

import com.tim.basevpn.state.ConnectionState;
import com.tim.openvpn.log.OpenVPNLogger;
import com.tim.openvpn.model.CIDRIP;
import com.tim.openvpn.service.IOpenVPNService;
import com.tim.openvpn.utils.NetworkUtils;

import net.openvpn.ovpn3.ClientAPI_Config;
import net.openvpn.ovpn3.ClientAPI_EvalConfig;
import net.openvpn.ovpn3.ClientAPI_Event;
import net.openvpn.ovpn3.ClientAPI_ExternalPKICertRequest;
import net.openvpn.ovpn3.ClientAPI_ExternalPKISignRequest;
import net.openvpn.ovpn3.ClientAPI_LogInfo;
import net.openvpn.ovpn3.ClientAPI_OpenVPNClient;
import net.openvpn.ovpn3.ClientAPI_OpenVPNClientHelper;
import net.openvpn.ovpn3.ClientAPI_Status;
import net.openvpn.ovpn3.ClientAPI_TransportStats;
import net.openvpn.ovpn3.DnsAddress;
import net.openvpn.ovpn3.DnsDomain;
import net.openvpn.ovpn3.DnsOptions;
import net.openvpn.ovpn3.DnsOptions_AddressList;
import net.openvpn.ovpn3.DnsOptions_DomainsList;
import net.openvpn.ovpn3.DnsOptions_ServersMap;
import net.openvpn.ovpn3.DnsServer;

import java.util.Locale;

public class OpenVPNThreadv3 extends ClientAPI_OpenVPNClient implements Runnable, OpenVPNManagement {
    final static long EmulateExcludeRoutes = (1 << 16);
    public static final String VPNSERVICE_TUN = "vpnservice-tun";
    private static volatile String lastEngineError;

    public static void clearLastEngineError() {
        lastEngineError = null;
    }

    public static String getLastEngineError() {
        return lastEngineError;
    }

    private static void rememberEngineError(String message) {
        if (message == null || message.trim().isEmpty()) return;
        String safe = message
            .replaceAll("(?is)<(key|cert|ca|tls-crypt|tls-crypt-v2)>.*?</\\1>", "[redacted]")
            .replaceAll("(?i)(password|passwd|token)\\s*[:=]\\s*[^\\s,;]+", "$1=[redacted]")
            .replaceAll("\\s+", " ")
            .trim();
        lastEngineError = safe.length() > 500 ? safe.substring(0, 500) : safe;
    }

    static {
        System.loadLibrary("ovpn3");
    }

    private final String configuration;
    private final IOpenVPNService mService;
    private final HandlerThread mHandlerThread;
    private final Handler mHandler;
    private final Runnable mStatusPoll = this::pollStatus;

    public OpenVPNThreadv3(IOpenVPNService openVpnService, String config) {
        OpenVPNLogger.d("OpenVPNThreadv3", "Starting OpenVPN 3 profile validation");
        configuration = config;
        mService = openVpnService;
        mHandlerThread = new HandlerThread("OpenVPN3Thread");
        mHandlerThread.start();
        mHandler = new Handler(mHandlerThread.getLooper());
    }

    @Override
    public void run() {
        clearLastEngineError();
        if (!setConfig(configuration)) {
            mService.openvpnStopped();
            return;
        }

        OpenVPNLogger.d("OpenVPNThreadv3", ClientAPI_OpenVPNClientHelper.platform());
        OpenVPNLogger.d("OpenVPNThreadv3", ClientAPI_OpenVPNClientHelper.copyright());
        mHandler.postDelayed(mStatusPoll, 2 * 1000);

        ClientAPI_Status status = connect();
        if (status.getError()) {
            rememberEngineError(status.getStatus() + ": " + status.getMessage());
            OpenVPNLogger.e(
                "OpenVPNThreadv3",
                String.format(Locale.US, "connect() error: %s: %s", status.getStatus(), status.getMessage())
            );
        }
        OpenVPNLogger.d("OpenVPNThreadv3", "OpenVPN 3 thread finished");
        mHandler.removeCallbacks(mStatusPoll);
    }

    @Override
    public boolean tun_builder_set_remote_address(String address, boolean ipv6) {
        mService.setMtu(1500);
        return true;
    }

    @Override
    public boolean tun_builder_set_mtu(int mtu) {
        mService.setMtu(mtu);
        return true;
    }

    @Override
    public boolean tun_builder_set_dns_options(DnsOptions options) {
        if (options == null) return true;

        DnsOptions_ServersMap servers = options.getServers();
        if (servers != null) {
            for (DnsServer server : servers.values()) {
                if (server == null) continue;

                DnsOptions_AddressList addresses = server.getAddresses();
                if (addresses != null) {
                    for (DnsAddress address : addresses) {
                        if (address != null && address.getAddress() != null && !address.getAddress().isEmpty()) {
                            mService.addDNS(address.getAddress());
                        }
                    }
                }

                DnsOptions_DomainsList serverDomains = server.getDomains();
                if (serverDomains != null) {
                    for (DnsDomain domain : serverDomains) {
                        if (domain != null) mService.setDomain(domain.getDomain());
                    }
                }
            }
        }

        DnsOptions_DomainsList searchDomains = options.getSearch_domains();
        if (searchDomains != null) {
            for (DnsDomain domain : searchDomains) {
                if (domain != null) mService.setDomain(domain.getDomain());
            }
        }
        return true;
    }

    @Override
    public boolean tun_builder_add_route(String address, int prefixLength, int metric, boolean ipv6) {
        if ("remote_host".equals(address)) return false;

        if (ipv6) {
            mService.addRoutev6(address + "/" + prefixLength, "tun");
        } else {
            mService.addRoute(new CIDRIP(address, prefixLength), true);
        }
        return true;
    }

    @Override
    public boolean tun_builder_exclude_route(String address, int prefixLength, int metric, boolean ipv6) {
        if (ipv6) {
            mService.addRoutev6(address + "/" + prefixLength, "wifi0");
        } else {
            mService.addRoute(new CIDRIP(address, prefixLength), false);
        }
        return true;
    }

    @Override
    public boolean tun_builder_set_proxy_http(String host, int port) {
        return false;
    }

    @Override
    public boolean tun_builder_set_proxy_https(String host, int port) {
        return false;
    }

    @Override
    public int tun_builder_establish() {
        return mService.openTun().detachFd();
    }

    @Override
    public boolean tun_builder_set_session_name(String name) {
        return true;
    }

    @Override
    public boolean tun_builder_add_address(
        String address,
        int prefixLength,
        String gateway,
        boolean ipv6,
        boolean net30
    ) {
        if (!ipv6) {
            mService.setLocalIP(new CIDRIP(address, prefixLength));
        } else {
            mService.setLocalIPv6(address + "/" + prefixLength);
        }
        return true;
    }

    @Override
    public boolean tun_builder_new() {
        return true;
    }

    @Override
    public boolean tun_builder_set_layer(int layer) {
        return layer == 3;
    }

    @Override
    public boolean tun_builder_reroute_gw(boolean ipv4, boolean ipv6, long flags) {
        if ((flags & EmulateExcludeRoutes) != 0) return true;

        if (ipv4) {
            mService.addRoute("0.0.0.0", "0.0.0.0", "127.0.0.1", VPNSERVICE_TUN);
        }
        if (ipv6) {
            mService.addRoutev6("::/0", VPNSERVICE_TUN);
        }
        return true;
    }

    private boolean setConfig(String vpnConfig) {
        ClientAPI_Config config = new ClientAPI_Config();
        config.setContent(vpnConfig);
        config.setTunPersist(true);
        config.setExternalPkiAlias("extpki");
        config.setCompressionMode("asym");
        config.setHwAddrOverride(NetworkUtils.getFakeMacAddrFromSAAID(mService.getCtResolver()));
        config.setInfo(true);
        config.setAllowLocalLanAccess(false);
        config.setRetryOnAuthFailed(false);
        config.setEnableLegacyAlgorithms(false);

        ClientAPI_EvalConfig result = eval_config(config);
        if (result.getExternalPki()) {
            OpenVPNLogger.d("OpenVPNThreadv3", "OpenVPN 3 core requested external PKI");
        }
        if (result.getError()) {
            OpenVPNLogger.e("OpenVPNThreadv3", "OpenVPN profile validation failed: " + result.getMessage());
            return false;
        }

        config.setContent(vpnConfig);
        return true;
    }

    @Override
    public void external_pki_cert_request(ClientAPI_ExternalPKICertRequest certRequest) {
        OpenVPNLogger.d("OpenVPNThreadv3", "OpenVPN 3 requested an external PKI certificate");
    }

    @Override
    public void external_pki_sign_request(ClientAPI_ExternalPKISignRequest signRequest) {
        OpenVPNLogger.d(
            "OpenVPNThreadv3",
            "OpenVPN 3 requested an external PKI signature for " + signRequest.getAlgorithm()
        );
    }

    @Override
    public boolean socket_protect(int socket, String remote, boolean ipv6) {
        return mService.protectFd(socket);
    }

    @Override
    public void stopVPN() {
        mHandler.post(this::stop);
    }

    @Override
    public void networkChange() {
        mHandler.post(() -> reconnect(1));
    }

    @Override
    public void sendCRResponse(String response) {
        mHandler.post(() -> post_cc_msg("CR_RESPONSE," + response + "\n"));
    }

    @Override
    public void log(ClientAPI_LogInfo info) {
        String message = info.getText();
        while (message.endsWith("\n")) {
            message = message.substring(0, message.length() - 1);
        }
        OpenVPNLogger.d("OpenVPNThreadv3", message);
    }

    @Override
    public void event(ClientAPI_Event event) {
        String name = event.getName();
        String info = event.getInfo();
        if (event.getError() || ("DISCONNECTED".equals(name) && info != null && !info.trim().isEmpty())) {
            rememberEngineError(name + ": " + info);
        }
        if ("INFO".equals(name)) {
            if (info.startsWith("OPEN_URL:") || info.startsWith("CR_TEXT:") || info.startsWith("WEB_AUTH:")) {
                mService.trigger_sso(info);
            } else {
                OpenVPNLogger.d("OpenVPNThreadv3", info);
            }
        } else if ("COMPRESSION_ENABLED".equals(name) || "WARN".equals(name)) {
            OpenVPNLogger.d("OpenVPNThreadv3", String.format(Locale.US, "%s: %s", name, info));
        } else {
            ConnectionState state = ConnectionState.IDLE;
            switch (name) {
                case "RESOLVE":
                case "WAIT":
                case "RECONNECTING":
                case "CONNECTING":
                case "GET_CONFIG":
                case "ASSIGN_IP":
                    state = ConnectionState.CONNECTING;
                    break;
                case "DISCONNECTED":
                    state = ConnectionState.DISCONNECTED;
                    break;
                case "CONNECTED":
                    state = ConnectionState.CONNECTED;
                    break;
                default:
                    break;
            }
            mService.updateStateThread(state);
            OpenVPNLogger.d("OpenVPNThreadv3", name + info);
        }

        if (event.getError()) {
            OpenVPNLogger.e("OpenVPNThreadv3", String.format(Locale.US, "EVENT(Error): %s: %s", name, info));
        }
    }

    @Override
    public net.openvpn.ovpn3.ClientAPI_StringVec tun_builder_get_local_networks(boolean ipv6) {
        net.openvpn.ovpn3.ClientAPI_StringVec networks = new net.openvpn.ovpn3.ClientAPI_StringVec();
        for (String network : NetworkUtils.getLocalNetworks(mService.getConnectivityManager(), ipv6)) {
            networks.add(network);
        }
        return networks;
    }

    @Override
    public boolean pause_on_connection_timeout() {
        return true;
    }

    @Override
    public void stop() {
        super.stop();
        mHandlerThread.quit();
        mService.openvpnStopped();
    }

    @Override
    public void reconnect() {
        mHandler.post(() -> reconnect(1));
    }

    private void pollStatus() {
        ClientAPI_TransportStats stats = transport_stats();
        OpenVPNLogger.d(
            "OpenVPNThreadv3",
            "in: " + stats.getBytesIn() + " / out: " + stats.getBytesOut()
        );
    }
}
