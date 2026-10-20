package com.pulse.vpn.engine

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.IBinder
import android.os.SystemClock
import android.view.WindowManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.ConnectException
import java.io.File
import java.io.BufferedReader
import java.io.StringReader
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.net.URL
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException

import com.wireguard.android.backend.GoBackend as WireGuardBackend
import com.wireguard.android.backend.Tunnel as WireGuardTunnel
import com.wireguard.config.Config as WireGuardConfig

import com.tim.basevpn.IConnectionStateListener
import com.tim.basevpn.IVPNService
import com.tim.basevpn.state.ConnectionState
import com.tim.openvpn.configuration.OpenVPNConfig
import com.tim.openvpn.service.OpenVPNService
import net.openvpn.ovpn3.ClientAPI_Config
import net.openvpn.ovpn3.ClientAPI_EvalConfig
import net.openvpn.ovpn3.ClientAPI_OpenVPNClient
import org.amnezia.awg.backend.GoBackend as AmneziaBackend
import org.amnezia.awg.backend.NoopTunnelActionHandler
import org.amnezia.awg.backend.Tunnel as AmneziaTunnel
import org.amnezia.awg.config.Config as AmneziaConfig

class PulseVpnEngineModule : Module() {
  private var pendingPermissionPromise: Promise? = null
  private var singBoxReceiverRegistered = false
  private val singBoxStatusReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != PulseSingBoxVpnService.ACTION_STATUS) return
      sendEvent(
        "onSingBoxStateChange",
        mapOf(
          "state" to (intent.getStringExtra(PulseSingBoxVpnService.EXTRA_STATE) ?: "disconnected"),
          "profileId" to intent.getStringExtra(PulseSingBoxVpnService.EXTRA_PROFILE_ID),
          "profileName" to intent.getStringExtra(PulseSingBoxVpnService.EXTRA_PROFILE_NAME),
          "lastChangedAt" to intent.getLongExtra("lastChangedAt", 0L),
          "connectedAt" to intent.getLongExtra("connectedAt", 0L).takeIf { it > 0L },
          "error" to intent.getStringExtra(PulseSingBoxVpnService.EXTRA_ERROR),
        ),
      )
    }
  }

  private var wireGuardBackend: WireGuardBackend? = null
  private var wireGuardTunnel: WireGuardTunnel? = null
  private var wireGuardConfig: WireGuardConfig? = null
  private var wireGuardProfileId: String? = null
  private var wireGuardProfileName: String? = null
  private var wireGuardLastState: WireGuardTunnel.State? = null
  @Volatile private var wireGuardConnectedAt: Long? = null

  private var amneziaBackend: AmneziaBackend? = null
  private var amneziaTunnel: AmneziaTunnel? = null
  private var amneziaConfig: AmneziaConfig? = null
  private var amneziaProfileId: String? = null
  private var amneziaProfileName: String? = null
  private var amneziaLastState: AmneziaTunnel.State? = null
  @Volatile private var amneziaConnectedAt: Long? = null
  @Volatile private var openVpnState = "UNKNOWN"
  private var openVpnProfileId: String? = null
  private var openVpnProfileName: String? = null
  private var openVpnSessionDir: File? = null
  private var openVpnError: String? = null
  private var openVpnStartRequestedAt: Long? = null
  @Volatile private var openVpnConnectedAt: Long? = null
  @Volatile private var openVpnUploadBytes = 0L
  @Volatile private var openVpnDownloadBytes = 0L
  private var openVpnRemote: IVPNService? = null
  private var openVpnServiceConnection: ServiceConnection? = null
  private var openVpnServiceBound = false

  private val openVpnStateListener = object : IConnectionStateListener.Stub() {
    override fun stateChanged(status: ConnectionState) {
      recordOpenVpnState(status)
    }

    override fun trafficUpdate(txRate: Long, rxRate: Long, txTotal: Long, rxTotal: Long) {
      openVpnUploadBytes = txTotal.coerceAtLeast(0)
      openVpnDownloadBytes = rxTotal.coerceAtLeast(0)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PulseVpnEngine")
    Events("onSingBoxStateChange")

    OnCreate {
      registerSingBoxStatusReceiver()
    }

    AsyncFunction("probeTcpServers") { servers: List<Map<String, Any?>>, timeoutMs: Int ->
      val executor = Executors.newFixedThreadPool(servers.size.coerceIn(1, 8))
      try {
        executor.invokeAll(
          servers.map { server ->
            Callable { probeTcpEndpoint(server, timeoutMs) }
          }
        ).map { it.get() }
      } finally {
        executor.shutdownNow()
      }
    }

    AsyncFunction("probeTunnelConnectivity") {
      probeTunnelConnectivity()
    }

    AsyncFunction("getSingBoxStatus") {
      PulseSingBoxVpnService.status(requireContext())
    }

    AsyncFunction("confirmSingBoxTraffic") {
      PulseSingBoxVpnService.confirmTraffic(requireContext())
    }

    AsyncFunction("connectSingBox") { profileId: String, profileName: String, config: String ->
      if (config.isBlank()) {
        throw CodedException("ERR_SINGBOX_CONFIG_EMPTY", "The sing-box configuration is empty.", null)
      }
      if (VpnService.prepare(requireContext()) != null) {
        throw CodedException("ERR_VPN_PERMISSION_REQUIRED", "Android VPN permission has not been granted.", null)
      }
      PulseSingBoxVpnService.start(requireContext(), profileId, profileName, config)
      PulseSingBoxVpnService.status(requireContext())
    }

    AsyncFunction("disconnectSingBox") {
      PulseSingBoxVpnService.stop(requireContext())
      PulseSingBoxVpnService.status(requireContext())
    }

    AsyncFunction("setTunnelTestKeepScreenOn") { enabled: Boolean ->
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.runOnUiThread {
          if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
          else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
      activity != null
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != VPN_PERMISSION_REQUEST_CODE) return@OnActivityResult
      val promise = pendingPermissionPromise ?: return@OnActivityResult
      pendingPermissionPromise = null
      val granted = payload.resultCode == Activity.RESULT_OK || VpnService.prepare(requireContext()) == null
      if (granted) promise.resolve(mapOf("granted" to true))
      else promise.resolve(mapOf("granted" to false))
    }

    OnDestroy {
      pendingPermissionPromise?.reject(
        "ERR_VPN_PERMISSION_CANCELLED",
        "The Android VPN permission request was interrupted.",
        null
      )
      pendingPermissionPromise = null
      if (singBoxReceiverRegistered) {
        runCatching { requireContext().unregisterReceiver(singBoxStatusReceiver) }
        singBoxReceiverRegistered = false
      }
      runCatching { openVpnRemote?.unregisterCallback(openVpnStateListener) }
      openVpnServiceConnection?.let { connection ->
        if (openVpnServiceBound) {
          runCatching { requireContext().unbindService(connection) }
        }
      }
      openVpnServiceBound = false
      openVpnServiceConnection = null
      openVpnRemote = null
      appContext.currentActivity?.runOnUiThread {
        appContext.currentActivity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      val context = requireContext()
      val intent = VpnService.prepare(context)
      if (intent == null) {
        promise.resolve(mapOf("granted" to true))
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_ACTIVITY_UNAVAILABLE", "The current Android activity is unavailable.", null)
      if (pendingPermissionPromise != null) {
        throw CodedException("ERR_VPN_PERMISSION_IN_PROGRESS", "A VPN permission request is already open.", null)
      }
      pendingPermissionPromise = promise
      activity.startActivityForResult(intent, VPN_PERMISSION_REQUEST_CODE)
    }

    AsyncFunction("isSupported") {
      true
    }

    AsyncFunction("getDiagnosticLog") {
      PulseDiagnostics.export(requireContext())
    }

    AsyncFunction("connectWireGuard") { profileId: String, profileName: String, configText: String ->
      requireVpnPermission()
      if (configText.isBlank()) throw CodedException("ERR_WG_CONFIG_EMPTY", "WireGuard config is empty.", null)
      stopAmneziaIfRunning()
      val context = requireContext()
      val parsed = try {
        WireGuardConfig.parse(BufferedReader(StringReader(configText)))
      } catch (error: Throwable) {
        throw CodedException("ERR_WG_CONFIG_INVALID", "The WireGuard configuration could not be parsed.", error)
      }
      val backend = wireGuardBackend ?: WireGuardBackend(context).also { wireGuardBackend = it }
      val tunnel = wireGuardTunnel ?: object : WireGuardTunnel {
        override fun getName(): String = WIREGUARD_TUNNEL_NAME
        override fun onStateChange(newState: WireGuardTunnel.State) {
          wireGuardLastState = newState
          wireGuardConnectedAt = if (newState == WireGuardTunnel.State.UP) {
            wireGuardConnectedAt ?: System.currentTimeMillis()
          } else {
            null
          }
        }
      }.also { wireGuardTunnel = it }

      try {
        backend.setState(tunnel, WireGuardTunnel.State.UP, parsed)
        wireGuardConfig = parsed
        wireGuardProfileId = profileId
        wireGuardProfileName = profileName
        wireGuardStatus()
      } catch (error: Throwable) {
        throw CodedException(
          "ERR_WG_CONNECT_FAILED",
          error.localizedMessage ?: "WireGuard could not start the tunnel.",
          error
        )
      }
    }

    AsyncFunction("disconnectWireGuard") {
      stopWireGuardIfRunning()
      wireGuardStatus()
    }

    AsyncFunction("getWireGuardStatus") {
      wireGuardStatus()
    }

    AsyncFunction("connectAmneziaWg") { profileId: String, profileName: String, configText: String ->
      requireVpnPermission()
      if (configText.isBlank()) throw CodedException("ERR_AWG_CONFIG_EMPTY", "AmneziaWG config is empty.", null)
      val normalizedConfig = normalizeAmneziaWgConfig(configText)
      val context = requireContext()
      val parsed = try {
        AmneziaConfig.parse(BufferedReader(StringReader(normalizedConfig)))
      } catch (error: Throwable) {
        val detail = sanitizeAmneziaParserError(error)
        throw CodedException(
          "ERR_AWG_CONFIG_INVALID",
          "The AmneziaWG configuration could not be parsed: $detail",
          error
        )
      }
      stopWireGuardIfRunning()
      val backend = amneziaBackend ?: AmneziaBackend(context, NoopTunnelActionHandler()).also { amneziaBackend = it }
      val tunnel = amneziaTunnel ?: object : AmneziaTunnel {
        override fun getName(): String = AMNEZIA_TUNNEL_NAME
        override fun isIpv4ResolutionPreferred(): Boolean = false
        override fun isMetered(): Boolean =
          (context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
            ?.isActiveNetworkMetered ?: true
        override fun onStateChange(newState: AmneziaTunnel.State) {
          amneziaLastState = newState
          amneziaConnectedAt = if (newState == AmneziaTunnel.State.UP) {
            amneziaConnectedAt ?: System.currentTimeMillis()
          } else {
            null
          }
        }
      }.also { amneziaTunnel = it }

      try {
        backend.setState(tunnel, AmneziaTunnel.State.UP, parsed)
        amneziaConfig = parsed
        amneziaProfileId = profileId
        amneziaProfileName = profileName
        amneziaStatus()
      } catch (error: Throwable) {
        throw CodedException(
          "ERR_AWG_CONNECT_FAILED",
          error.localizedMessage ?: "AmneziaWG could not start the tunnel.",
          error
        )
      }
    }

    AsyncFunction("disconnectAmneziaWg") {
      stopAmneziaIfRunning()
      amneziaStatus()
    }

    AsyncFunction("getAmneziaWgStatus") {
      amneziaStatus()
    }

    AsyncFunction("connectOpenVpn") { profileId: String, profileName: String, configText: String, username: String, password: String ->
      requireVpnPermission()
      val context = requireContext()
      PulseDiagnostics.log(context, "openvpn_connect_requested")
      if (configText.isBlank()) throw CodedException("ERR_OPENVPN_CONFIG_EMPTY", "OpenVPN config is empty.", null)
      if (username.isBlank() || password.isBlank()) {
        throw CodedException("ERR_OPENVPN_CREDENTIALS_MISSING", "OpenVPN username and password are required.", null)
      }
      if (openVpnState == "CONNECTED" || openVpnState == "CONNECTING") {
        throw CodedException("ERR_OPENVPN_ALREADY_ACTIVE", "Disconnect the current OpenVPN tunnel before changing servers.", null)
      }
      stopAmneziaIfRunning()
      stopWireGuardIfRunning()
      File(context.filesDir, OPENVPN_ENGINE_ERROR_FILE).delete()
      File(context.filesDir, OPENVPN_ENGINE_EVENT_FILE).delete()
      val prepared = prepareOpenVpnConfig(context, configText, username, password)
      try {
        validateOpenVpnConfig(prepared.configuration)
      } catch (error: Throwable) {
        PulseDiagnostics.log(context, "openvpn_config_rejected", "${error.javaClass.simpleName}: ${error.localizedMessage.orEmpty()}")
        prepared.directory.deleteRecursively()
        throw error
      }
      openVpnProfileId = profileId
      openVpnProfileName = profileName
      openVpnError = null
      openVpnConnectedAt = null
      openVpnUploadBytes = 0L
      openVpnDownloadBytes = 0L
      openVpnStartRequestedAt = System.currentTimeMillis()
      openVpnState = "CONNECTING"
      openVpnSessionDir = prepared.directory
      try {
        OpenVPNService.startService(context, OpenVPNConfig(configuration = prepared.configuration))
        PulseDiagnostics.log(context, "openvpn_service_started")
        bindOpenVpnService(context)
        openVpnStatus()
      } catch (error: Throwable) {
        PulseDiagnostics.log(context, "openvpn_start_failed", "${error.javaClass.simpleName}: ${error.localizedMessage.orEmpty()}")
        openVpnState = "ERROR"
        openVpnError = error.localizedMessage ?: "OpenVPN could not start."
        prepared.directory.deleteRecursively()
        openVpnSessionDir = null
        throw CodedException("ERR_OPENVPN_START_FAILED", openVpnError ?: "OpenVPN could not start.", error)
      }
    }

    AsyncFunction("disconnectOpenVpn") {
      stopOpenVpn()
      openVpnStatus()
    }

    AsyncFunction("getOpenVpnStatus") {
      openVpnStatus()
    }
  }

  private fun registerSingBoxStatusReceiver() {
    if (singBoxReceiverRegistered) return
    val context = requireContext()
    runCatching {
      ContextCompat.registerReceiver(
        context,
        singBoxStatusReceiver,
        IntentFilter(PulseSingBoxVpnService.ACTION_STATUS),
        ContextCompat.RECEIVER_NOT_EXPORTED,
      )
      singBoxReceiverRegistered = true
    }.onFailure {
      android.util.Log.w("PulseVpnEngine", "Could not register sing-box state receiver", it)
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext
      ?: throw CodedException("ERR_CONTEXT_UNAVAILABLE", "Android React context is unavailable.", null)

  private fun requireVpnPermission() {
    if (VpnService.prepare(requireContext()) != null) {
      throw CodedException(
        "VPN_PERMISSION_REQUIRED",
        "Request Android VPN permission before connecting.",
        null
      )
    }
  }

  private fun normalizeAmneziaWgConfig(configText: String): String {
    val normalized = configText
      .removePrefix("\uFEFF")
      .replace("\r\n", "\n")
      .replace('\r', '\n')
      .trim()

    if (normalized.startsWith("{") || normalized.startsWith("<")) {
      throw CodedException(
        "ERR_AWG_RESPONSE_NOT_CONFIG",
        "The server returned an error page or JSON instead of an AmneziaWG profile.",
        null
      )
    }
    if (!Regex("(?im)^\\s*\\[Interface\\]\\s*$").containsMatchIn(normalized)) {
      throw CodedException(
        "ERR_AWG_INTERFACE_MISSING",
        "The downloaded AmneziaWG profile is missing its [Interface] section.",
        null
      )
    }
    if (!Regex("(?im)^\\s*\\[Peer\\]\\s*$").containsMatchIn(normalized)) {
      throw CodedException(
        "ERR_AWG_PEER_MISSING",
        "The downloaded AmneziaWG profile is missing its [Peer] section.",
        null
      )
    }
    return "$normalized\n"
  }

  private fun sanitizeAmneziaParserError(error: Throwable): String {
    val root = generateSequence(error) { it.cause }.take(6).lastOrNull()
    val raw = root?.localizedMessage?.takeIf { it.isNotBlank() }
      ?: root?.javaClass?.simpleName
      ?: "Invalid AmneziaWG profile."
    return raw
      .replace(
        Regex("(?im)\\b(PrivateKey|PublicKey|PresharedKey|PreSharedKey)\\s*=\\s*[^\\r\\n]*"),
        "${'$'}1=[redacted]"
      )
      .replace(Regex("(?<![A-Za-z0-9])[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9])"), "[redacted]")
      .replace(Regex("\\s+"), " ")
      .trim()
      .take(180)
      .ifBlank { "The profile contains an invalid key or option." }
  }

  private fun stopWireGuardIfRunning() {
    val backend = wireGuardBackend ?: return
    val tunnel = wireGuardTunnel ?: return
    val config = wireGuardConfig ?: return
    if (backend.getState(tunnel) == WireGuardTunnel.State.UP) {
      backend.setState(tunnel, WireGuardTunnel.State.DOWN, config)
    }
  }

  private fun stopAmneziaIfRunning() {
    val backend = amneziaBackend ?: return
    val tunnel = amneziaTunnel ?: return
    val config = amneziaConfig ?: return
    if (backend.getState(tunnel) == AmneziaTunnel.State.UP) {
      backend.setState(tunnel, AmneziaTunnel.State.DOWN, config)
    }
  }

  private fun bindOpenVpnService(context: Context) {
    if (openVpnServiceConnection != null) return
    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
        val remote = service?.let { IVPNService.Stub.asInterface(it) }
        openVpnRemote = remote
        if (remote == null) {
          openVpnState = "ERROR"
          openVpnError = "OpenVPN service connected without a status interface."
          return
        }
        try {
          remote.registerCallback(openVpnStateListener)
          // Callback registration does not replay the current state.
          // Read it explicitly so fast success/failure cannot leave the UI stale.
          syncOpenVpnStateFromService(remote)
        } catch (error: Throwable) {
          openVpnState = "ERROR"
          openVpnConnectedAt = null
          openVpnError = error.localizedMessage
            ?: "Could not read the OpenVPN service state."
        }
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        openVpnRemote = null
        if (openVpnState == "CONNECTED" || openVpnState == "CONNECTING") {
          openVpnState = "ERROR"
          openVpnConnectedAt = null
          openVpnError = "OpenVPN service stopped unexpectedly; its connection state is unavailable."
        }
      }
    }
    openVpnServiceConnection = connection
    val bound = try {
      context.bindService(
        Intent(context, OpenVPNService::class.java),
        connection,
        Context.BIND_AUTO_CREATE
      )
    } catch (error: Throwable) {
      openVpnServiceConnection = null
      throw error
    }
    if (!bound) {
      openVpnServiceConnection = null
      throw CodedException("ERR_OPENVPN_BIND_FAILED", "Could not bind to the OpenVPN service.", null)
    }
    openVpnServiceBound = true
  }

  private data class PreparedOpenVpnConfig(val configuration: String, val directory: File)

  private fun prepareOpenVpnConfig(
    context: Context,
    configText: String,
    username: String,
    password: String
  ): PreparedOpenVpnConfig {
    if (username.any { it == '\n' || it == '\r' } || password.any { it == '\n' || it == '\r' }) {
      throw CodedException("ERR_OPENVPN_CREDENTIALS_INVALID", "OpenVPN credentials contain an invalid line break.", null)
    }
    val directory = File(context.cacheDir, "openvpn-${UUID.randomUUID()}")
    if (!directory.mkdirs()) {
      throw CodedException("ERR_OPENVPN_CONFIG_STORAGE", "Could not create private OpenVPN profile storage.", null)
    }
    fun savePrivateFile(name: String, content: String): File {
      val file = File(directory, name)
      file.writeText(content.trim() + "\n", Charsets.UTF_8)
      file.setReadable(false, false)
      file.setReadable(true, true)
      file.setWritable(false, false)
      file.setWritable(true, true)
      return file
    }

    val authFile = savePrivateFile("auth.txt", "$username\n$password")
    var prepared = configText
      .removePrefix("\uFEFF")
      .replace("\r\n", "\n")
      .replace('\r', '\n')
    prepared = normalizeOpenVpnPemBlocks(prepared)
    var proxyAuthFile: File? = null
    val sensitiveBlockNames = listOf(
      "tls-auth", "tls-crypt",
      "extra-certs", "pkcs12", "secret", "dh", "crl-verify"
    )
    // OpenVPN 3 accepts inline CA, client-certificate, and private-key blocks.
    // Keep PEM material inline so the service process receives the same bytes
    // that preflight parsed, without a temporary-file handoff.
    // Private keys stay in the transient in-memory config and are never logged.
    // Keep tls-crypt-v2 client keys inline. The OpenVPN 3 parser supports the
    // inline form, and rewriting this wrapped client key to a temporary file
    // has caused key-parse failures on otherwise valid downloaded profiles.
    try {
      prepared = prepared.replace(Regex("(?is)<auth-user-pass>.*?</auth-user-pass>")) {
        ""
      }
      prepared = prepared.replace(Regex("(?is)<http-proxy-user-pass(?:\\s[^>]*)?>(.*?)</http-proxy-user-pass\\s*>")) {
        proxyAuthFile = savePrivateFile("proxy-auth.txt", it.groupValues[1])
        ""
      }
      sensitiveBlockNames.forEachIndexed { index, tag ->
        val expression = Regex("(?is)<${Regex.escape(tag)}(?:\\s[^>]*)?>(.*?)</${Regex.escape(tag)}\\s*>")
        prepared = expression.replace(prepared) { match ->
          val file = savePrivateFile("$index-${tag.replace('-', '_')}.pem", match.groupValues[1])
          val path = file.absolutePath.replace("\\", "\\\\").replace("\"", "\\\"")
          "$tag \"$path\""
        }
      }
      val linesWithoutInlineCredentials = prepared.lineSequence()
        .filterNot { line ->
          val isCredentialDirective =
            Regex("^\\s*(auth-user-pass|username|password)\\b.*$", RegexOption.IGNORE_CASE)
            .containsMatchIn(line)
          val isInlineProxyDirective = proxyAuthFile != null &&
            Regex("^\\s*http-proxy-user-pass\\b.*$", RegexOption.IGNORE_CASE).containsMatchIn(line)
          val isRetryDirective =
            Regex("^\\s*(connect-timeout|connect-retry(?:-max)?|resolv-retry)\\b.*$", RegexOption.IGNORE_CASE)
              .containsMatchIn(line)
          isCredentialDirective || isInlineProxyDirective || isRetryDirective
        }
        .joinToString("\n")
        .trim()
      val authPath = authFile.absolutePath.replace("\\", "\\\\").replace("\"", "\\\"")
      val directives = buildList {
        add("auth-user-pass \"$authPath\"")
        proxyAuthFile?.let {
          val proxyPath = it.absolutePath.replace("\\", "\\\\").replace("\"", "\\\"")
          add("http-proxy-user-pass \"$proxyPath\"")
        }
        // Bound DNS/connection retries so a dead endpoint cannot spin forever.
        add("connect-timeout 10")
        add("connect-retry 3 5")
        add("connect-retry-max 4")
        add("resolv-retry 10")
      }
      return PreparedOpenVpnConfig(
        configuration = linesWithoutInlineCredentials + "\n" + directives.joinToString("\n") + "\n",
        directory = directory
      )
    } catch (error: Throwable) {
      directory.deleteRecursively()
      if (error is CodedException) throw error
      throw CodedException("ERR_OPENVPN_CONFIG_STORAGE", "Could not prepare private OpenVPN profile files.", error)
    }
  }

  private fun normalizeOpenVpnPemBlocks(config: String): String {
    var normalizedConfig = config
    for (tag in listOf("ca", "cert", "key")) {
      val expression = Regex("(?is)<${Regex.escape(tag)}(?:\\s[^>]*)?>(.*?)</${Regex.escape(tag)}\\s*>")
      normalizedConfig = expression.replace(normalizedConfig) { match ->
        val normalized = match.groupValues[1]
          .replace("\\r\\n", "\n")
          .replace("\\n", "\n")
          .replace("\\r", "\n")
          .replace(
            Regex("-----BEGIN\\s+X509\\s+CERTIFICATE-----", RegexOption.IGNORE_CASE),
            "-----BEGIN CERTIFICATE-----",
          )
          .replace(
            Regex("-----END\\s+X509\\s+CERTIFICATE-----", RegexOption.IGNORE_CASE),
            "-----END CERTIFICATE-----",
          )
          .trim()
        "<$tag>\n$normalized\n</$tag>"
      }
    }
    return normalizedConfig
  }

  private fun stopOpenVpn() {
    openVpnState = "DISCONNECTING"
    openVpnStartRequestedAt = null
    runCatching { openVpnRemote?.stopVPN() }
    runCatching { OpenVPNService.stopService(requireContext()) }
  }

  private fun validateOpenVpnConfig(configuration: String) {
    try {
      // The profile preflight touches generated SWIG classes before the
      // OpenVPN service/thread is created. Load the JNI library first or the
      // class initializer can fail with NoClassDefFoundError.
      System.loadLibrary("ovpn3")
    } catch (error: UnsatisfiedLinkError) {
      throw CodedException(
        "ERR_OPENVPN_NATIVE_LIBRARY",
        "The OpenVPN native engine could not be loaded: ${error.message ?: error.javaClass.simpleName}. Reinstall the current Android build.",
        error
      )
    }

    val client = ClientAPI_OpenVPNClient()
    val config = ClientAPI_Config()
    var result: ClientAPI_EvalConfig? = null
    try {
      config.setContent(configuration)
      config.setTunPersist(true)
      config.setExternalPkiAlias("extpki")
      config.setCompressionMode("asym")
      config.setInfo(true)
      config.setAllowLocalLanAccess(false)
      config.setRetryOnAuthFailed(false)
      config.setEnableLegacyAlgorithms(false)

      result = client.eval_config(config)
      if (result.getError()) {
        val detail = sanitizeOpenVpnDiagnostic(result.getMessage())
        throw CodedException(
          "ERR_OPENVPN_PROFILE_INVALID",
          "OpenVPN rejected this profile before connecting: $detail",
          null
        )
      }
    } finally {
      result?.delete()
      config.delete()
      client.delete()
    }
  }

  private fun probeTcpEndpoint(server: Map<String, Any?>, timeoutMs: Int): Map<String, Any?> {
    val id = server["id"]?.toString() ?: ""
    val host = (server["host"] as? String)?.trim().orEmpty()
    val port = (server["port"] as? Number)?.toInt() ?: 0
    if (
      host.isBlank() ||
      host.length > 253 ||
      host.any { it.isWhitespace() || it == '/' || it == '\\' || it == '@' } ||
      port !in 1..65535
    ) {
      return mapOf("id" to id, "reachable" to false, "latencyMs" to null)
    }

    val socket = Socket()
    val startedAt = SystemClock.elapsedRealtime()
    return try {
      socket.connect(InetSocketAddress(host, port), timeoutMs.coerceIn(250, 3_000))
      mapOf(
        "id" to id,
        "reachable" to true,
        "latencyMs" to (SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(1L)
      )
    } catch (_: Exception) {
      mapOf("id" to id, "reachable" to false, "latencyMs" to null)
    } finally {
      runCatching { socket.close() }
    }
  }

  private fun probeTunnelConnectivity(): Map<String, Any?> {
    val context = requireContext()
    val connectivityManager =
      context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val vpnNetwork = connectivityManager.activeNetwork?.takeIf { network ->
      connectivityManager.getNetworkCapabilities(network)
        ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
    }

    if (vpnNetwork == null) {
      PulseDiagnostics.log(context, "tunnel_probe_no_vpn")
      val endpoints = TUNNEL_TEST_URLS.map { endpoint ->
        mapOf(
          "endpoint" to endpoint,
          "success" to false,
          "error" to "No active Android VPN route."
        )
      }
      return mapOf(
        "vpnActive" to false,
        "passed" to false,
        "testedAt" to System.currentTimeMillis(),
        "endpoints" to endpoints
      )
    }

    val executor = Executors.newFixedThreadPool(TUNNEL_TEST_URLS.size)
    val results = try {
      executor.invokeAll(
        TUNNEL_TEST_URLS.map { endpoint ->
          Callable { probeHttpsEndpoint(vpnNetwork, endpoint) }
        }
      ).map { it.get() }
    } finally {
      executor.shutdownNow()
    }

    PulseDiagnostics.log(
      context,
      "tunnel_probe_completed",
      "vpn_active=true;passed=${results.any { it["success"] == true }};" +
        results.mapIndexed { index, result ->
          "probe${index + 1}{ok=${result["success"]};code=${result["statusCode"] ?: "none"};" +
            "bytes=${result["bytesReceived"] ?: 0};latency_ms=${result["latencyMs"] ?: "none"};" +
            "error=${result["error"] ?: "none"}}"
        }.joinToString(";")
    )

    return mapOf(
      "vpnActive" to true,
      "passed" to results.any { it["success"] == true },
      "testedAt" to System.currentTimeMillis(),
      "endpoints" to results
    )
  }

  private fun probeHttpsEndpoint(vpnNetwork: Network, endpoint: String): Map<String, Any?> {
    val startedAt = SystemClock.elapsedRealtime()
    var connection: HttpsURLConnection? = null
    return try {
      // Bind the health check to the Android VPN network itself. An unbound
      // URLConnection can follow the phone's default network instead and
      // report a false failure while the VPN interface is active.
      connection = vpnNetwork.openConnection(URL(endpoint)) as HttpsURLConnection
      connection.connectTimeout = TUNNEL_TEST_TIMEOUT_MS
      connection.readTimeout = TUNNEL_TEST_TIMEOUT_MS
      connection.requestMethod = "GET"
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.setRequestProperty("Cache-Control", "no-cache")
      connection.setRequestProperty("User-Agent", "PulseVPN-ConnectivityCheck")
      val statusCode = connection.responseCode
      val bytesReceived = if (statusCode in 200..299) {
        var total = 0
        val buffer = ByteArray(1024)
        connection.inputStream.use { stream ->
          while (total < MAX_TUNNEL_TEST_BYTES) {
            val count = stream.read(buffer, 0, minOf(buffer.size, MAX_TUNNEL_TEST_BYTES - total))
            if (count <= 0) break
            total += count
          }
        }
        total
      } else {
        0
      }
      mapOf(
        "endpoint" to endpoint,
        "success" to (statusCode in 200..299 && bytesReceived > 0),
        "statusCode" to statusCode,
        "bytesReceived" to bytesReceived,
        "latencyMs" to (SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(1L)
      )
    } catch (error: Throwable) {
      val safeError = when (error) {
        is UnknownHostException -> "DNS resolution failed."
        is SocketTimeoutException -> "The secure request timed out."
        is SSLException -> "TLS verification failed."
        is ConnectException -> "The endpoint refused the connection."
        else -> "Network request failed (${error.javaClass.simpleName})."
      }
      mapOf(
        "endpoint" to endpoint,
        "success" to false,
        "bytesReceived" to 0,
        "latencyMs" to (SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(1L),
        "error" to safeError
      )
    } finally {
      connection?.disconnect()
    }
  }

  private fun sanitizeOpenVpnDiagnostic(message: String?): String {
    val cleaned = (message ?: "")
      .replace(Regex("(?is)<(key|cert|ca|tls-crypt|tls-crypt-v2)>.*?</\\1>"), "[redacted]")
      .replace(Regex("(?i)(password|passwd|token)\\s*[:=]\\s*[^\\s,;]+"), "$1=[redacted]")
      .replace(Regex("\\s+"), " ")
      .trim()
      .take(320)
    if (cleaned.contains("tls_crypt_v2_client_key_parse_error", ignoreCase = true)) {
      return "OpenVPN rejected the tls-crypt-v2 client key. The app now passes this key inline without rewriting it; the server may need to reissue a client key compatible with the bundled OpenVPN engine."
    }
    return cleaned.ifBlank { "The OpenVPN core did not provide a more specific profile error." }
  }

  private fun openVpnStatus(): Map<String, Any?> {
    val context = requireContext()
    if (openVpnRemote == null && openVpnServiceConnection == null) {
      try {
        // The React Native module can be recreated while the foreground VPN
        // service survives. Rebind on status reads so the UI can recover the
        // authoritative native state after app/process recreation.
        bindOpenVpnService(context)
      } catch (error: Throwable) {
        openVpnState = "ERROR"
        openVpnConnectedAt = null
        openVpnError = error.localizedMessage
          ?: "Could not reconnect to the OpenVPN status service."
        android.util.Log.w("PulseVpnEngine", "Could not bind to the OpenVPN status service", error)
      }
    }
    val remote = openVpnRemote
    if (remote != null) {
      try {
        syncOpenVpnStateFromService(remote)
      } catch (error: Throwable) {
        if (openVpnState == "CONNECTED" || openVpnState == "CONNECTING") {
          openVpnState = "ERROR"
          openVpnConnectedAt = null
          openVpnError = error.localizedMessage
            ?: "Could not refresh the OpenVPN service state."
        }
      }
    }
    val latestEngineEvent = readOpenVpnEngineDiagnostic(context)
    val vpnNetworkActive = runCatching {
      val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      connectivity.activeNetwork?.let(connectivity::getNetworkCapabilities)
        ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
    }.getOrDefault(false)
    if (
      openVpnRemote != null &&
      openVpnState in setOf("CONNECTING", "READYFORCONNECT") &&
      latestEngineEvent?.trim()?.let {
        it.equals("CONNECTED", ignoreCase = true) || it.startsWith("CONNECTED:", ignoreCase = true)
      } == true &&
      vpnNetworkActive
    ) {
      // OpenVPN emits the CONNECTED engine event before every service callback
      // consumer has observed the new state. Only reconcile when the app's
      // OpenVPN service is bound and Android confirms an active VPN network.
      recordOpenVpnState(ConnectionState.CONNECTED)
    }
    val mappedState = when (openVpnState) {
      "CONNECTED" -> "CONNECTED"
      "CONNECTING", "READYFORCONNECT" -> "CONNECTING"
      "DISCONNECTED", "IDLE" -> "DISCONNECTED"
      else -> when {
        openVpnState.contains("DISCONNECT") -> "DISCONNECTING"
        openVpnState.contains("CONNECT") -> "CONNECTING"
        openVpnState.contains("ERROR") ||
          openVpnState.contains("FAIL") ||
          openVpnState.contains("AUTH") ||
          openVpnState == "PERMISSION_NOT_GRANTED" -> "ERROR"
        else -> "UNKNOWN"
      }
    }
    if (mappedState == "CONNECTED" && openVpnConnectedAt == null) {
      openVpnConnectedAt = System.currentTimeMillis()
    }
    return mapOf(
      "status" to mappedState,
      "tunnelState" to when (mappedState) {
        "CONNECTED" -> "ACTIVE"
        "DISCONNECTED" -> "INACTIVE"
        "CONNECTING" -> "CONNECTING"
        "DISCONNECTING" -> "DISCONNECTING"
        "ERROR" -> "ERROR"
        else -> "UNKNOWN"
      },
      "isConnected" to (mappedState == "CONNECTED"),
      "profileId" to openVpnProfileId,
      "profileName" to openVpnProfileName,
      "connectedAt" to openVpnConnectedAt,
      "uploadBytes" to openVpnUploadBytes,
      "downloadBytes" to openVpnDownloadBytes,
      "error" to openVpnError,
      "diagnostic" to (
        readOpenVpnEngineError(context) ?: readOpenVpnEngineDiagnostic(context)
      )
    )
  }

  private fun readOpenVpnEngineDiagnostic(context: Context): String? =
    runCatching {
      File(context.filesDir, OPENVPN_ENGINE_EVENT_FILE)
        .takeIf { it.isFile }
        ?.readText(Charsets.UTF_8)
        ?.replace(Regex("\\s+"), " ")
        ?.trim()
        ?.take(240)
        ?.takeIf { it.isNotBlank() }
    }.getOrNull()

  private fun readOpenVpnEngineError(context: Context): String? =
    runCatching {
      File(context.filesDir, OPENVPN_ENGINE_ERROR_FILE)
        .takeIf { it.isFile }
        ?.readText(Charsets.UTF_8)
        ?.replace(Regex("\\s+"), " ")
        ?.trim()
        ?.take(320)
        ?.takeIf { it.isNotBlank() }
    }.getOrNull()

  private fun recordOpenVpnState(status: ConnectionState) {
    synchronized(this) {
      val previous = openVpnState
      openVpnState = status.name
      if (previous != status.name) {
        runCatching {
          PulseDiagnostics.log(requireContext(), "openvpn_state", "$previous->${status.name}")
        }
      }
      when (status) {
        ConnectionState.CONNECTED -> {
          openVpnStartRequestedAt = null
          if (openVpnConnectedAt == null) openVpnConnectedAt = System.currentTimeMillis()
          openVpnError = null
        }
        ConnectionState.PERMISSION_NOT_GRANTED -> {
          openVpnStartRequestedAt = null
          openVpnConnectedAt = null
          openVpnError = "Android VPN permission was not granted."
        }
        ConnectionState.DISCONNECTED, ConnectionState.IDLE -> {
          openVpnStartRequestedAt = null
          if (previous == "CONNECTING" || previous == "READYFORCONNECT") {
            val context = runCatching { requireContext() }.getOrNull()
            val engineDetail = context?.let(::readOpenVpnEngineError)
            val lastEvent = context?.let(::readOpenVpnEngineDiagnostic)
            openVpnError = if (!engineDetail.isNullOrBlank()) {
              sanitizeOpenVpnDiagnostic(engineDetail)
            } else if (!lastEvent.isNullOrBlank()) {
              sanitizeOpenVpnDiagnostic("OpenVPN stopped before connecting. Last engine event: $lastEvent")
            } else {
              "OpenVPN disconnected before the connection was established."
            }
          }
          openVpnConnectedAt = null
          openVpnUploadBytes = 0L
          openVpnDownloadBytes = 0L
        }
        ConnectionState.DISCONNECTING -> {
          openVpnStartRequestedAt = null
          openVpnConnectedAt = null
        }
        else -> Unit
      }
      if (status == ConnectionState.DISCONNECTED || status == ConnectionState.IDLE) {
        openVpnSessionDir?.deleteRecursively()
        openVpnSessionDir = null
      }
    }
  }

  private fun syncOpenVpnStateFromService(remote: IVPNService) {
    val status = remote.state
    val ignoreStaleState = synchronized(this) {
      val startupAge = openVpnStartRequestedAt?.let { System.currentTimeMillis() - it }
      (openVpnState == "CONNECTING" && startupAge != null && startupAge < 5_000L &&
        (status == ConnectionState.DISCONNECTED || status == ConnectionState.IDLE)) ||
        (openVpnState == "DISCONNECTING" &&
          (status == ConnectionState.CONNECTING || status == ConnectionState.READYFORCONNECT))
    }
    if (!ignoreStaleState) recordOpenVpnState(status)
  }

  private fun wireGuardStatus(): Map<String, Any?> {
    val backend = wireGuardBackend
    val tunnel = wireGuardTunnel
    if (backend == null || tunnel == null) return statusMap("UNKNOWN", false, null, null, null)
    val state = try {
      backend.getState(tunnel) ?: wireGuardLastState
    } catch (_: Throwable) {
      wireGuardLastState
    }
    return statusMap(
      state?.name ?: "UNKNOWN",
      state == WireGuardTunnel.State.UP,
      wireGuardProfileId,
      wireGuardProfileName,
      null,
      if (state == WireGuardTunnel.State.UP) {
        wireGuardConnectedAt ?: System.currentTimeMillis().also { wireGuardConnectedAt = it }
      } else {
        null
      }
    )
  }

  private fun amneziaStatus(): Map<String, Any?> {
    val backend = amneziaBackend
    val tunnel = amneziaTunnel
    if (backend == null || tunnel == null) return statusMap("UNKNOWN", false, null, null, null)
    val state = try {
      backend.getState(tunnel) ?: amneziaLastState
    } catch (_: Throwable) {
      amneziaLastState
    }
    return statusMap(
      state?.name ?: "UNKNOWN",
      state == AmneziaTunnel.State.UP,
      amneziaProfileId,
      amneziaProfileName,
      null,
      if (state == AmneziaTunnel.State.UP) {
        amneziaConnectedAt ?: System.currentTimeMillis().also { amneziaConnectedAt = it }
      } else {
        null
      }
    )
  }

  private fun statusMap(
    rawState: String,
    connected: Boolean,
    profileId: String?,
    profileName: String?,
    error: String?,
    connectedAt: Long? = null
  ): Map<String, Any?> {
    val normalized = when (rawState) {
      "UP" -> "CONNECTED"
      "DOWN" -> "DISCONNECTED"
      "UNKNOWN" -> "UNKNOWN"
      else -> "ERROR"
    }
    val tunnelState = when (rawState) {
      "UP" -> "ACTIVE"
      "DOWN" -> "INACTIVE"
      "UNKNOWN" -> "UNKNOWN"
      else -> "ERROR"
    }
    return mapOf(
      "status" to normalized,
      "tunnelState" to tunnelState,
      "isConnected" to connected,
      "profileId" to profileId,
      "profileName" to profileName,
      "connectedAt" to connectedAt,
      "error" to error
    )
  }

  companion object {
    private const val VPN_PERMISSION_REQUEST_CODE = 42082
    private const val WIREGUARD_TUNNEL_NAME = "Pulse-WireGuard"
    private const val AMNEZIA_TUNNEL_NAME = "Pulse-AmneziaWG"
    private const val TUNNEL_TEST_TIMEOUT_MS = 4_500
    private const val OPENVPN_ENGINE_ERROR_FILE = "openvpn-engine-error.txt"
    private const val OPENVPN_ENGINE_EVENT_FILE = "openvpn-engine-event.txt"
    private const val MAX_TUNNEL_TEST_BYTES = 4096
    private val TUNNEL_TEST_URLS = listOf(
      "https://www.google.com/robots.txt",
      "https://www.cloudflare.com/cdn-cgi/trace"
    )
  }
}
