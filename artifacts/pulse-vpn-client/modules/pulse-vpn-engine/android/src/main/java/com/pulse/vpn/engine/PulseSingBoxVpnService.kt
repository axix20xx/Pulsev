package com.pulse.vpn.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject
import io.nekohasekai.libbox.BridgeOptions
import io.nekohasekai.libbox.BridgeSession
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.ConnectionOwner
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NetworkInterface as BoxNetworkInterface
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.Notification as BoxNotification
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.PlatformUser
import io.nekohasekai.libbox.RoutePrefix
import io.nekohasekai.libbox.RoutePrefixIterator
import io.nekohasekai.libbox.ShellSession
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.SystemProxyStatus
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import java.io.File
import java.net.InetAddress
import java.net.NetworkInterface as JavaNetworkInterface
import java.util.concurrent.ConcurrentHashMap

/**
 * Owns the sing-box core and Android TUN interface. It deliberately runs in
 * the app process so Expo can receive real state broadcasts from this service.
 */
class PulseSingBoxVpnService : VpnService(), PlatformInterface, CommandServerHandler {
  companion object {
    const val ACTION_START = "com.pulse.vpnclient.SINGBOX_START"
    const val ACTION_STOP = "com.pulse.vpnclient.SINGBOX_STOP"
    const val ACTION_STATUS = "com.pulse.vpnclient.SINGBOX_STATUS"
    const val EXTRA_STATE = "state"
    const val EXTRA_PROFILE_ID = "profileId"
    const val EXTRA_PROFILE_NAME = "profileName"
    const val EXTRA_ERROR = "error"

    private const val TAG = "PulseSingBox"
    private const val PREFS = "pulse_singbox_state"
    private const val OWNER_PID = "ownerPid"
    private const val CHANNEL_ID = "pulse_vpn_tunnel"
    private const val NOTIFICATION_ID = 4701
    private val setupLock = Any()
    @Volatile private var libboxReady = false

    fun start(context: Context, profileId: String, profileName: String, config: String) {
      val now = System.currentTimeMillis()
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(EXTRA_STATE, "connecting")
        .putString(EXTRA_PROFILE_ID, profileId)
        .putString(EXTRA_PROFILE_NAME, profileName)
        .putLong("lastChangedAt", now)
        .putLong("connectedAt", 0L)
        .putInt(OWNER_PID, android.os.Process.myPid())
        .remove(EXTRA_ERROR)
        .apply()
      context.sendBroadcast(
        Intent(ACTION_STATUS).setPackage(context.packageName).apply {
          putExtra(EXTRA_STATE, "connecting")
          putExtra(EXTRA_PROFILE_ID, profileId)
          putExtra(EXTRA_PROFILE_NAME, profileName)
          putExtra("lastChangedAt", now)
          putExtra("connectedAt", 0L)
        },
      )
      val intent = Intent(context, PulseSingBoxVpnService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_PROFILE_ID, profileId)
        putExtra(EXTRA_PROFILE_NAME, profileName)
        putExtra("config", config)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      val now = System.currentTimeMillis()
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(EXTRA_STATE, "disconnecting")
        .putLong("lastChangedAt", now)
        .apply()
      context.sendBroadcast(
        Intent(ACTION_STATUS).setPackage(context.packageName).apply {
          putExtra(EXTRA_STATE, "disconnecting")
          putExtra(EXTRA_PROFILE_ID, context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(EXTRA_PROFILE_ID, null))
          putExtra(EXTRA_PROFILE_NAME, context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(EXTRA_PROFILE_NAME, null))
          putExtra("lastChangedAt", now)
        },
      )
      context.startService(Intent(context, PulseSingBoxVpnService::class.java).apply {
        action = ACTION_STOP
      })
    }

    fun status(context: Context): Map<String, Any?> {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val savedState = prefs.getString(EXTRA_STATE, "disconnected") ?: "disconnected"
      val runningState = savedState in setOf("connecting", "connected", "disconnecting")
      val ownerPid = prefs.getInt(OWNER_PID, -1)
      val staleState = runningState && ownerPid != android.os.Process.myPid()
      if (staleState) {
        prefs.edit()
          .putString(EXTRA_STATE, "disconnected")
          .putLong("connectedAt", 0L)
          .putLong("lastChangedAt", System.currentTimeMillis())
          .remove(EXTRA_ERROR)
          .apply()
      }
      return mapOf(
        "state" to if (staleState) "disconnected" else savedState,
        "profileId" to prefs.getString(EXTRA_PROFILE_ID, null),
        "profileName" to prefs.getString(EXTRA_PROFILE_NAME, null),
        "lastChangedAt" to prefs.getLong("lastChangedAt", 0L),
        "connectedAt" to if (staleState) null else prefs.getLong("connectedAt", 0L).takeIf { it > 0L },
        "error" to prefs.getString(EXTRA_ERROR, null),
      )
    }

    fun confirmTraffic(context: Context): Map<String, Any?> {
      val current = status(context)
      if (current["state"] != "connecting") return current
      val now = System.currentTimeMillis()
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(EXTRA_STATE, "connected")
        .putLong("lastChangedAt", now)
        .putLong("connectedAt", now)
        .remove(EXTRA_ERROR)
        .apply()
      context.sendBroadcast(
        Intent(ACTION_STATUS).setPackage(context.packageName).apply {
          putExtra(EXTRA_STATE, "connected")
          putExtra(EXTRA_PROFILE_ID, current[EXTRA_PROFILE_ID] as? String)
          putExtra(EXTRA_PROFILE_NAME, current[EXTRA_PROFILE_NAME] as? String)
          putExtra("lastChangedAt", now)
          putExtra("connectedAt", now)
        },
      )
      return status(context)
    }

    private fun initializeLibbox(context: Context) {
      if (libboxReady) return
      synchronized(setupLock) {
        if (libboxReady) return
        val baseDir = File(context.filesDir, "singbox").apply { mkdirs() }
        val workDir = File(baseDir, "work").apply { mkdirs() }
        val tempDir = File(context.cacheDir, "singbox").apply { mkdirs() }
        Libbox.touch()
        Libbox.setup(
          io.nekohasekai.libbox.SetupOptions().apply {
            basePath = baseDir.absolutePath
            workingPath = workDir.absolutePath
            tempPath = tempDir.absolutePath
            fixAndroidStack = true
            appVersion = "1.0.9"
            appMarketingVersion = "1.0.9"
            logMaxLines = 1200
            debug = false
          },
        )
        libboxReady = true
      }
    }
  }

  private var commandServer: CommandServer? = null
  private var tunDescriptor: ParcelFileDescriptor? = null
  private var defaultNetworkCallback: ConnectivityManager.NetworkCallback? = null
  private val interfaceListeners = ConcurrentHashMap<InterfaceUpdateListener, ConnectivityManager.NetworkCallback>()
  @Volatile private var pendingConfig: String? = null
  @Volatile private var profileId: String? = null
  @Volatile private var profileName: String? = null
  @Volatile private var tunnelReady = false
  @Volatile private var stopping = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopTunnel()
        return START_NOT_STICKY
      }
      ACTION_START -> {
        stopping = false
        pendingConfig = intent.getStringExtra("config")
        profileId = intent.getStringExtra(EXTRA_PROFILE_ID)
        profileName = intent.getStringExtra(EXTRA_PROFILE_NAME)
        if (pendingConfig.isNullOrBlank()) {
          publishState("error", "The sing-box configuration is empty.")
          stopSelf(startId)
          return START_NOT_STICKY
        }
        startForegroundCompat()
        publishState("connecting", null)
        Thread({ startTunnel(startId) }, "PulseSingBoxStart").start()
      }
    }
    return START_NOT_STICKY
  }

  private fun startTunnel(startId: Int) {
    try {
      initializeLibbox(this)
      val originalConfig = pendingConfig ?: error("The sing-box configuration was lost.")
      val config = configureBootstrapDns(originalConfig)
      pendingConfig = config
      Libbox.checkConfig(config)
      commandServer?.let {
        runCatching { it.closeService() }
        runCatching { it.close() }
      }
      val server = Libbox.newCommandServer(this, this)
      commandServer = server
      server.start()
      server.startOrReloadService(config, OverrideOptions())
      if (!tunnelReady || tunDescriptor == null) {
        error("sing-box started without establishing the Android VPN interface.")
      }
      publishState("connecting", null)
      Log.i(TAG, "sing-box tunnel established for profile ${profileId ?: "unknown"}")
    } catch (error: Throwable) {
      val message = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
      Log.e(TAG, "Could not start sing-box tunnel", error)
      closeCore()
      publishState("error", message)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf(startId)
    }
  }

  private fun startForegroundCompat() {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "VPN connection", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(profileName?.takeIf { it.isNotBlank() } ?: "Pulse VPN")
      .setContentText("Secure connection is active")
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun publishState(state: String, error: String?) {
    val now = System.currentTimeMillis()
    val current = getSharedPreferences(PREFS, MODE_PRIVATE)
    current.edit()
      .putString(EXTRA_STATE, state)
      .putString(EXTRA_PROFILE_ID, profileId)
      .putString(EXTRA_PROFILE_NAME, profileName)
      .putLong("lastChangedAt", now)
      .putLong("connectedAt", if (state == "connected") now else 0L)
      .putInt(OWNER_PID, android.os.Process.myPid())
      .putString(EXTRA_ERROR, error)
      .apply()
    sendBroadcast(
      Intent(ACTION_STATUS).setPackage(packageName).apply {
        putExtra(EXTRA_STATE, state)
        putExtra(EXTRA_PROFILE_ID, profileId)
        putExtra(EXTRA_PROFILE_NAME, profileName)
        putExtra(EXTRA_ERROR, error)
        putExtra("lastChangedAt", now)
        putExtra("connectedAt", if (state == "connected") now else 0L)
      },
    )
  }

  private fun stopTunnel() {
    if (stopping) return
    stopping = true
    publishState("disconnecting", null)
    closeCore()
    publishState("disconnected", null)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun closeCore() {
    runCatching { commandServer?.closeService() }
    runCatching { commandServer?.close() }
    commandServer = null
    runCatching { tunDescriptor?.close() }
    tunDescriptor = null
    tunnelReady = false
  }

  override fun onDestroy() {
    closeCore()
    interfaceListeners.values.forEach { callback ->
      runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(callback) }
    }
    interfaceListeners.clear()
    if (getSharedPreferences(PREFS, MODE_PRIVATE).getString(EXTRA_STATE, null) !in setOf("error", "disconnected")) {
      publishState("disconnected", null)
    }
    super.onDestroy()
  }

  // sing-box Android platform contract
  override fun openTun(options: TunOptions): Int {
    if (VpnService.prepare(this) != null) error("Android VPN permission has not been granted.")
    val builder = Builder().setSession(profileName?.takeIf { it.isNotBlank() } ?: "Pulse VPN")
      .setMtu(options.mtu.coerceIn(1280, 9000))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)

    val ipv4Addresses = options.inet4Address
    var hasIpv4Address = false
    while (ipv4Addresses.hasNext()) {
      val address = ipv4Addresses.next()
      builder.addAddress(address.address(), address.prefix())
      hasIpv4Address = true
    }
    val ipv6Addresses = options.inet6Address
    var hasIpv6Address = false
    while (ipv6Addresses.hasNext()) {
      val address = ipv6Addresses.next()
      builder.addAddress(address.address(), address.prefix())
      hasIpv6Address = true
    }

    if (options.autoRoute) {
      if (options.dnsMode.value != Libbox.DNSModeDisabled) {
        val dnsServers = options.dnsServerAddress
        while (dnsServers.hasNext()) builder.addDnsServer(dnsServers.next())
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val routes4 = options.inet4RouteAddress
        var hasRoutes4 = false
        while (routes4.hasNext()) {
          val route = routes4.next()
          builder.addRoute(route.address(), route.prefix())
          hasRoutes4 = true
        }
        if (!hasRoutes4 && hasIpv4Address) builder.addRoute("0.0.0.0", 0)

        val routes6 = options.inet6RouteAddress
        var hasRoutes6 = false
        while (routes6.hasNext()) {
          val route = routes6.next()
          builder.addRoute(route.address(), route.prefix())
          hasRoutes6 = true
        }
        if (!hasRoutes6 && hasIpv6Address) builder.addRoute("::", 0)

        addExcludedRoutes(builder, options.inet4RouteExcludeAddress)
        addExcludedRoutes(builder, options.inet6RouteExcludeAddress)
      } else {
        addRoutes(builder, options.inet4RouteRange)
        addRoutes(builder, options.inet6RouteRange)
      }
      val included = options.includePackage
      while (included.hasNext()) builder.addAllowedApplication(included.next())
      val excluded = options.excludePackage
      while (excluded.hasNext()) builder.addDisallowedApplication(excluded.next())
    }

    if (options.isHTTPProxyEnabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      builder.setHttpProxy(
        android.net.ProxyInfo.buildDirectProxy(
          options.httpProxyServer,
          options.httpProxyServerPort,
        ),
      )
    }
    val established = builder.establish() ?: error("Android did not create the VPN interface.")
    tunDescriptor?.close()
    tunDescriptor = established
    tunnelReady = true
    return established.fd
  }

  private fun addRoutes(builder: Builder, routes: RoutePrefixIterator) {
    while (routes.hasNext()) {
      val route = routes.next()
      builder.addRoute(route.address(), route.prefix())
    }
  }

  private fun addExcludedRoutes(builder: Builder, routes: RoutePrefixIterator) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    while (routes.hasNext()) {
      val route = routes.next()
      builder.excludeRoute(android.net.IpPrefix(InetAddress.getByName(route.address()), route.prefix()))
    }
  }

  override fun usePlatformAutoDetectInterfaceControl() = true
  override fun autoDetectInterfaceControl(fd: Int) {
    if (!protect(fd)) error("sing-box could not protect its upstream socket from the VPN route.")
  }

  override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
    val connectivity = getSystemService(ConnectivityManager::class.java)
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = notifyUnderlyingInterface(listener, connectivity)
      override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
        notifyUnderlyingInterface(listener, connectivity)
      override fun onLost(network: Network) = notifyUnderlyingInterface(listener, connectivity)
    }
    interfaceListeners[listener] = callback
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      connectivity.registerDefaultNetworkCallback(callback)
      notifyUnderlyingInterface(listener, connectivity)
    } else {
      connectivity.registerNetworkCallback(NetworkRequest.Builder().build(), callback)
    }
  }

  private fun notifyUnderlyingInterface(
    listener: InterfaceUpdateListener,
    connectivity: ConnectivityManager,
  ) {
    val network = findUnderlyingNetwork(connectivity)
    setUnderlyingNetworks(network?.let { arrayOf(it) })
    if (network == null) {
      listener.updateDefaultInterface("", 0, true, false)
    } else {
      updateInterface(listener, connectivity, network)
    }
  }

  private fun findUnderlyingNetwork(connectivity: ConnectivityManager): Network? {
    return connectivity.allNetworks
      .mapNotNull { network ->
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return@mapNotNull null
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ||
          capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        ) {
          return@mapNotNull null
        }
        network to capabilities
      }
      .sortedWith(
        compareByDescending<Pair<Network, NetworkCapabilities>> {
          it.second.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        }.thenByDescending {
          it.second.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        },
      )
      .firstOrNull()
      ?.first
  }

  private fun configureBootstrapDns(config: String): String {
    val connectivity = getSystemService(ConnectivityManager::class.java)
    val network = findUnderlyingNetwork(connectivity)
    val address = network
      ?.let { connectivity.getLinkProperties(it)?.dnsServers }
      ?.firstOrNull { !it.isAnyLocalAddress && !it.isLoopbackAddress && !it.isMulticastAddress }
      ?.hostAddress
      ?.substringBefore('%')
      ?: "1.1.1.1"

    return try {
      val root = JSONObject(config)
      val servers = root.optJSONObject("dns")?.optJSONArray("servers")
        ?: return config
      var updated = false
      for (index in 0 until servers.length()) {
        val server = servers.optJSONObject(index) ?: continue
        if (server.optString("tag") == "bootstrap-dns") {
          server.put("server", address)
          updated = true
          break
        }
      }
      if (updated) {
        Log.i(TAG, "Using the active network's DNS for proxy-server bootstrap.")
        root.toString()
      } else {
        Log.w(TAG, "Sing-box config has no bootstrap-dns resolver; keeping the original config.")
        config
      }
    } catch (error: Throwable) {
      Log.e(TAG, "Could not select a bootstrap DNS resolver.", error)
      config
    }
  }

  private fun updateInterface(
    listener: InterfaceUpdateListener,
    connectivity: ConnectivityManager,
    network: Network,
  ) {
    val name = connectivity.getLinkProperties(network)?.interfaceName.orEmpty()
    val index = runCatching { JavaNetworkInterface.getByName(name)?.index ?: 0 }.getOrDefault(0)
    val capabilities = connectivity.getNetworkCapabilities(network)
    val metered = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) != true
    val expensive = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
    listener.updateDefaultInterface(name, index, metered, expensive)
  }

  override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
    interfaceListeners.remove(listener)?.let { callback ->
      runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(callback) }
    }
  }

  override fun getInterfaces(): NetworkInterfaceIterator {
    val connectivity = getSystemService(ConnectivityManager::class.java)
    val interfaces = mutableListOf<BoxNetworkInterface>()
    val networks = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) connectivity.allNetworks.toList() else emptyList()
    for (network in networks) {
      val link = connectivity.getLinkProperties(network) ?: continue
      val caps = connectivity.getNetworkCapabilities(network) ?: continue
      if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
      val name = link.interfaceName ?: continue
      val javaInterface = runCatching { JavaNetworkInterface.getByName(name) }.getOrNull() ?: continue
      val addresses = javaInterface.interfaceAddresses.mapNotNull { address ->
        // Go's netip.ParsePrefix rejects IPv6 zone IDs (for example, %wlan0)
        // inside a prefix. Keep the interface name separately and pass a
        // zone-free address/prefix to sing-box.
        address.address.hostAddress
          ?.substringBefore('%')
          ?.let { "$it/${address.networkPrefixLength}" }
      }
      val boxType = when {
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
        else -> Libbox.InterfaceTypeOther
      }
      interfaces += BoxNetworkInterface().apply {
        this.name = name
        index = javaInterface.index
        mtu = runCatching { javaInterface.mtu }.getOrDefault(1500)
        type = boxType
        flags = 1
        metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        this.addresses = BoxStringIterator(addresses)
        dnsServer = BoxStringIterator(link.dnsServers.mapNotNull { it.hostAddress })
        gateway = BoxStringIterator(link.routes.mapNotNull { route ->
          route.gateway?.takeUnless { it.isAnyLocalAddress }?.hostAddress
        })
      }
    }
    return object : NetworkInterfaceIterator {
      private val iterator = interfaces.iterator()
      override fun hasNext() = iterator.hasNext()
      override fun next() = iterator.next()
    }
  }

  override fun lookupUser(username: String?): PlatformUser =
    PlatformUser().apply {
      this.username = username ?: packageName
      uid = android.os.Process.myUid()
      gid = android.os.Process.myUid()
      homeDir = filesDir.absolutePath
    }

  override fun useProcFS() = false
  override fun underNetworkExtension() = false
  override fun includeAllNetworks() = false
  override fun usePlatformBridge() = false
  override fun usePlatformShell() = false
  override fun readWIFIState(): WIFIState? = null
  override fun localDNSTransport(): LocalDNSTransport? = null
  override fun clearDNSCache() = Unit
  override fun registerMyInterface(name: String?) = Unit
  override fun startNeighborMonitor(listener: io.nekohasekai.libbox.NeighborUpdateListener?) = Unit
  override fun closeNeighborMonitor(listener: io.nekohasekai.libbox.NeighborUpdateListener?) = Unit
  override fun cancelNotification(identifier: String?, typeID: Int) = Unit
  override fun sendNotification(notification: BoxNotification?) = Unit
  override fun tailscaleHostname() = "Pulse VPN"

  override fun findConnectionOwner(
    ipProtocol: Int,
    sourceAddress: String?,
    sourcePort: Int,
    destinationAddress: String?,
    destinationPort: Int,
  ): ConnectionOwner = throw UnsupportedOperationException("Per-process routing is not enabled.")

  override fun checkPlatformShell() = throw UnsupportedOperationException("Platform shell is unavailable.")
  override fun lookupSFTPServer() = throw UnsupportedOperationException("SFTP is unavailable.")
  override fun readSystemSSHHostKey() = throw UnsupportedOperationException("System SSH host keys are unavailable.")
  override fun openShellSession(
    user: PlatformUser?,
    command: String?,
    environ: StringIterator?,
    term: String?,
    rows: Int,
    cols: Int,
  ): ShellSession = throw UnsupportedOperationException("Platform shell is unavailable.")

  override fun createBridge(options: BridgeOptions?): BridgeSession =
    throw UnsupportedOperationException("Platform bridge is unavailable.")

  override fun connectSSHAgent() = -1
  override fun getSystemProxyStatus() = SystemProxyStatus().apply { available = false; enabled = false }
  override fun setSystemProxyEnabled(isEnabled: Boolean) = Unit
  override fun triggerNativeCrash() = Unit
  override fun writeDebugMessage(message: String?) {
    if (!message.isNullOrBlank()) Log.d(TAG, message)
  }
  override fun serviceReload() {
    val config = pendingConfig ?: return
    runCatching { commandServer?.startOrReloadService(config, OverrideOptions()) }
      .onFailure { publishState("error", it.message ?: "sing-box reload failed.") }
  }
  override fun serviceStop() {
    stopTunnel()
  }
}

private class BoxStringIterator(private val values: List<String>) : StringIterator {
  private var index = 0
  override fun hasNext() = index < values.size
  override fun len() = values.size
  override fun next() = values[index++]
}
