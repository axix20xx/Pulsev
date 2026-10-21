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
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface as JavaNetworkInterface
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicLong

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
    const val EXTRA_ATTEMPT_ID = "attemptId"

    private const val TAG = "PulseSingBox"
    private const val PREFS = "pulse_singbox_state"
    private const val OWNER_PID = "ownerPid"
    private const val CHANNEL_ID = "pulse_vpn_tunnel"
    private const val NOTIFICATION_ID = 4701
    private val setupLock = Any()
    private val lifecycleStateLock = Any()
    @Volatile private var libboxReady = false

    fun start(context: Context, profileId: String, profileName: String, config: String, attemptId: String) {
      synchronized(lifecycleStateLock) {
        val now = System.currentTimeMillis()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
          .putString(EXTRA_STATE, "connecting")
          .putString(EXTRA_PROFILE_ID, profileId)
          .putString(EXTRA_PROFILE_NAME, profileName)
          .putString(EXTRA_ATTEMPT_ID, attemptId)
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
            putExtra(EXTRA_ATTEMPT_ID, attemptId)
            putExtra("lastChangedAt", now)
            putExtra("connectedAt", 0L)
          },
        )
      }
      val intent = Intent(context, PulseSingBoxVpnService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_PROFILE_ID, profileId)
        putExtra(EXTRA_PROFILE_NAME, profileName)
        putExtra(EXTRA_ATTEMPT_ID, attemptId)
        putExtra("config", config)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context, expectedAttemptId: String?) {
      synchronized(lifecycleStateLock) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (expectedAttemptId != null && prefs.getString(EXTRA_ATTEMPT_ID, null) != expectedAttemptId) return
        val now = System.currentTimeMillis()
        prefs.edit()
          .putString(EXTRA_STATE, "disconnecting")
          .putLong("lastChangedAt", now)
          .apply()
        context.sendBroadcast(
          Intent(ACTION_STATUS).setPackage(context.packageName).apply {
            putExtra(EXTRA_STATE, "disconnecting")
            putExtra(EXTRA_PROFILE_ID, prefs.getString(EXTRA_PROFILE_ID, null))
            putExtra(EXTRA_PROFILE_NAME, prefs.getString(EXTRA_PROFILE_NAME, null))
            putExtra(EXTRA_ATTEMPT_ID, expectedAttemptId)
            putExtra("lastChangedAt", now)
          },
        )
      }
      context.startService(Intent(context, PulseSingBoxVpnService::class.java).apply {
        action = ACTION_STOP
        putExtra(EXTRA_ATTEMPT_ID, expectedAttemptId)
      })
    }

    fun status(context: Context): Map<String, Any?> {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val savedState = prefs.getString(EXTRA_STATE, "disconnected") ?: "disconnected"
      val runningState = savedState in setOf("connecting", "connected", "disconnecting")
      val ownerPid = prefs.getInt(OWNER_PID, -1)
      val staleState = runningState && ownerPid != android.os.Process.myPid()
      if (staleState) {
        synchronized(lifecycleStateLock) {
          if (prefs.getInt(OWNER_PID, -1) == ownerPid && prefs.getString(EXTRA_STATE, null) == savedState) {
            prefs.edit()
              .putString(EXTRA_STATE, "disconnected")
              .putLong("connectedAt", 0L)
              .putLong("lastChangedAt", System.currentTimeMillis())
              .remove(EXTRA_ERROR)
              .apply()
          }
        }
      }
      return mapOf(
        "state" to if (staleState) "disconnected" else savedState,
        "profileId" to prefs.getString(EXTRA_PROFILE_ID, null),
        "profileName" to prefs.getString(EXTRA_PROFILE_NAME, null),
        "attemptId" to prefs.getString(EXTRA_ATTEMPT_ID, null),
        "lastChangedAt" to prefs.getLong("lastChangedAt", 0L),
        "connectedAt" to if (staleState) null else prefs.getLong("connectedAt", 0L).takeIf { it > 0L },
        "error" to prefs.getString(EXTRA_ERROR, null),
      )
    }

    fun confirmTraffic(context: Context, expectedAttemptId: String): Map<String, Any?> {
      return synchronized(lifecycleStateLock) {
        val current = status(context)
        if (current["state"] == "connected" && current["attemptId"] == expectedAttemptId) return current
        if (current["state"] != "connecting" || current["attemptId"] != expectedAttemptId) return current
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
            putExtra(EXTRA_ATTEMPT_ID, expectedAttemptId)
            putExtra("lastChangedAt", now)
            putExtra("connectedAt", now)
          },
        )
        status(context)
      }
    }

    private fun initializeLibbox(context: Context) {
      if (libboxReady) return
      synchronized(setupLock) {
        if (libboxReady) return
        val baseDir = File(context.filesDir, "singbox").apply { mkdirs() }
        val workDir = File(baseDir, "work").apply { mkdirs() }
        val tempDir = File(context.cacheDir, "singbox").apply { mkdirs() }
        Libbox.touch()
        val versionName = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
        Libbox.setup(
          io.nekohasekai.libbox.SetupOptions().apply {
            basePath = baseDir.absolutePath
            workingPath = workDir.absolutePath
            tempPath = tempDir.absolutePath
            fixAndroidStack = true
            appVersion = versionName
            appMarketingVersion = versionName
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
  @Volatile private var lastUnderlyingNetworkSignature: String? = null
  @Volatile private var pendingConfig: String? = null
  @Volatile private var profileId: String? = null
  @Volatile private var profileName: String? = null
  @Volatile private var attemptId: String? = null
  @Volatile private var tunnelReady = false
  @Volatile private var stopping = false
  @Volatile private var closingCore = false
  @Volatile private var latestStartId = 0
  private val attemptGeneration = AtomicLong(0L)
  private val lifecycleExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "PulseSingBoxLifecycle").apply { isDaemon = true }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        latestStartId = startId
        val generation = attemptGeneration.incrementAndGet()
        stopping = true
        val stopAttemptId = intent.getStringExtra(EXTRA_ATTEMPT_ID)
        logDiagnostic("singbox_stop_requested", eventAttemptId = stopAttemptId)
        lifecycleExecutor.execute { stopTunnel(startId, generation, stopAttemptId) }
        return START_NOT_STICKY
      }
      ACTION_START -> {
        latestStartId = startId
        stopping = false
        val generation = attemptGeneration.incrementAndGet()
        val startAttemptId = intent.getStringExtra(EXTRA_ATTEMPT_ID)
          ?: UUID.randomUUID().toString().replace("-", "").take(10)
        val config = intent.getStringExtra("config")
        val startProfileId = intent.getStringExtra(EXTRA_PROFILE_ID)
        val startProfileName = intent.getStringExtra(EXTRA_PROFILE_NAME)
        attemptId = startAttemptId
        logDiagnostic("singbox_start_requested", eventAttemptId = startAttemptId)
        pendingConfig = config
        profileId = startProfileId
        profileName = startProfileName
        if (config.isNullOrBlank()) {
          publishState("error", "The sing-box configuration is empty.")
          stopSelf(startId)
          return START_NOT_STICKY
        }
        startForegroundCompat()
        publishState("connecting", null, startAttemptId)
        lifecycleExecutor.execute {
          startTunnel(startId, generation, startAttemptId, config, startProfileId, startProfileName)
        }
      }
    }
    return START_NOT_STICKY
  }

  private fun startTunnel(
    startId: Int,
    generation: Long,
    startAttemptId: String,
    configText: String,
    startProfileId: String?,
    startProfileName: String?,
  ) {
    if (!isCurrentAttempt(generation, startAttemptId)) return
    try {
      initializeLibbox(this)
      var config = configureBootstrapDns(configText)
      Libbox.checkConfig(config)
      logDiagnostic("singbox_config_valid", eventAttemptId = startAttemptId)
      config = resolveProxyEndpoint(config)
      Libbox.checkConfig(config)
      if (!isCurrentAttempt(generation, startAttemptId)) return
      closeCore()
      val server = Libbox.newCommandServer(this, this)
      commandServer = server
      server.start()
      if (!isCurrentAttempt(generation, startAttemptId)) {
        closeCore()
        return
      }
      server.startOrReloadService(config, OverrideOptions())
      logDiagnostic("singbox_core_started", eventAttemptId = startAttemptId)
      if (!isCurrentAttempt(generation, startAttemptId)) {
        closeCore()
        return
      }
      if (!tunnelReady || tunDescriptor == null) {
        error("sing-box started without establishing the Android VPN interface.")
      }
      // The engine and Android TUN are now running. Report this as a live
      // tunnel; Internet reachability is tested independently by the client.
      publishState("connected", null, startAttemptId)
      Log.i(TAG, "sing-box tunnel established for profile ${startProfileId ?: "unknown"}")
    } catch (error: Throwable) {
      if (!isCurrentAttempt(generation, startAttemptId)) {
        closeCore()
        return
      }
      val message = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
      Log.e(TAG, "Could not start sing-box tunnel", error)
      logDiagnostic(
        "singbox_start_failed",
        "category=${error.javaClass.simpleName};message=$message",
        startAttemptId,
      )
      closeCore()
      publishState("error", message, startAttemptId)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf(startId)
    }
  }

  private fun isCurrentAttempt(generation: Long, expectedAttemptId: String): Boolean =
    attemptGeneration.get() == generation && attemptId == expectedAttemptId && !stopping

  private fun logDiagnostic(event: String, detail: String = "", eventAttemptId: String? = attemptId) {
    PulseDiagnostics.log(this, event, detail, eventAttemptId)
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

  private fun publishState(state: String, error: String?, stateAttemptId: String? = attemptId) {
    synchronized(lifecycleStateLock) {
      val current = getSharedPreferences(PREFS, MODE_PRIVATE)
      if (stateAttemptId != null && current.getString(EXTRA_ATTEMPT_ID, null) != stateAttemptId) return
      logDiagnostic("singbox_state", "state=$state;error=${error.orEmpty()}", stateAttemptId)
      val now = System.currentTimeMillis()
      current.edit()
        .putString(EXTRA_STATE, state)
        .putString(EXTRA_PROFILE_ID, profileId)
        .putString(EXTRA_PROFILE_NAME, profileName)
        .putString(EXTRA_ATTEMPT_ID, stateAttemptId)
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
          putExtra(EXTRA_ATTEMPT_ID, stateAttemptId)
          putExtra(EXTRA_ERROR, error)
          putExtra("lastChangedAt", now)
          putExtra("connectedAt", if (state == "connected") now else 0L)
        },
      )
    }
  }

  private fun stopTunnel(startId: Int, generation: Long, stopAttemptId: String?) {
    if (attemptGeneration.get() != generation) return
    val currentAttemptId = getSharedPreferences(PREFS, MODE_PRIVATE).getString(EXTRA_ATTEMPT_ID, null)
    if (stopAttemptId != null && currentAttemptId != stopAttemptId) return
    stopping = true
    publishState("disconnecting", null, stopAttemptId)
    closeCore()
    if (attemptGeneration.get() != generation) return
    publishState("disconnected", null, stopAttemptId)
    stopForeground(STOP_FOREGROUND_REMOVE)
    if (attemptGeneration.get() == generation) stopSelfResult(startId)
  }

  private fun closeCore() {
    if (closingCore) return
    closingCore = true
    try {
      runCatching { commandServer?.closeService() }
      runCatching { commandServer?.close() }
      commandServer = null
      runCatching { tunDescriptor?.close() }
      tunDescriptor = null
      tunnelReady = false
    } finally {
      closingCore = false
    }
  }

  override fun onDestroy() {
    attemptGeneration.incrementAndGet()
    stopping = true
    closeCore()
    interfaceListeners.values.forEach { callback ->
      runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(callback) }
    }
    interfaceListeners.clear()
    if (getSharedPreferences(PREFS, MODE_PRIVATE).getString(EXTRA_STATE, null) !in setOf("error", "disconnected")) {
      publishState("disconnected", null)
    }
    super.onDestroy()
    lifecycleExecutor.shutdownNow()
  }

  // sing-box Android platform contract
  override fun openTun(options: TunOptions): Int {
    if (VpnService.prepare(this) != null) error("Android VPN permission has not been granted.")
    logDiagnostic("singbox_tun_create_requested", "auto_route=${options.autoRoute};mtu=${options.mtu}")
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

    var dnsCount = 0
    var route4Count = 0
    var route6Count = 0
    if (options.autoRoute) {
      if (options.dnsMode.value != Libbox.DNSModeDisabled) {
        val dnsServers = options.dnsServerAddress
        while (dnsServers.hasNext()) {
          builder.addDnsServer(dnsServers.next())
          dnsCount++
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val routes4 = options.inet4RouteAddress
        while (routes4.hasNext()) {
          val route = routes4.next()
          builder.addRoute(route.address(), route.prefix())
          route4Count++
        }

        val routes6 = options.inet6RouteAddress
        while (routes6.hasNext()) {
          val route = routes6.next()
          builder.addRoute(route.address(), route.prefix())
          route6Count++
        }

        addExcludedRoutes(builder, options.inet4RouteExcludeAddress)
        addExcludedRoutes(builder, options.inet6RouteExcludeAddress)
      } else {
        route4Count = addRoutes(builder, options.inet4RouteRange)
        route6Count = addRoutes(builder, options.inet6RouteRange)
      }
      val included = options.includePackage
      while (included.hasNext()) builder.addAllowedApplication(included.next())
      val excluded = options.excludePackage
      while (excluded.hasNext()) builder.addDisallowedApplication(excluded.next())
    }
    logDiagnostic(
      "singbox_tun_routes_configured",
      "dns=$dnsCount;routes_ipv4=$route4Count;routes_ipv6=$route6Count;ipv4_address=$hasIpv4Address;ipv6_address=$hasIpv6Address"
    )
    if (options.autoRoute && route4Count + route6Count == 0) {
      logDiagnostic("singbox_tun_route_failure", "auto_route=true;included_routes=0")
      error("sing-box enabled auto-route but provided no included IP routes; refusing to report a connected tunnel without packet routing.")
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
    logDiagnostic("singbox_tun_established", "fd_valid=${established.fd >= 0}")
    return established.fd
  }

  private fun addRoutes(builder: Builder, routes: RoutePrefixIterator): Int {
    var count = 0
    while (routes.hasNext()) {
      val route = routes.next()
      builder.addRoute(route.address(), route.prefix())
      count++
    }
    return count
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
    if (!protect(fd)) {
      logDiagnostic("singbox_socket_protection_failed", "stage=auto_detect_interface_control")
      error("sing-box could not protect its upstream socket from the VPN route.")
    }
  }

  override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
    val connectivity = getSystemService(ConnectivityManager::class.java)
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = scheduleUnderlyingInterfaceUpdate(listener, connectivity)
      override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
        scheduleUnderlyingInterfaceUpdate(listener, connectivity)
      override fun onLost(network: Network) = scheduleUnderlyingInterfaceUpdate(listener, connectivity)
    }
    interfaceListeners[listener] = callback
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      connectivity.registerDefaultNetworkCallback(callback)
      notifyUnderlyingInterface(listener, connectivity)
    } else {
      connectivity.registerNetworkCallback(NetworkRequest.Builder().build(), callback)
      notifyUnderlyingInterface(listener, connectivity)
    }
  }

  private fun scheduleUnderlyingInterfaceUpdate(
    listener: InterfaceUpdateListener,
    connectivity: ConnectivityManager,
  ) {
    val generation = attemptGeneration.get()
    runCatching {
      lifecycleExecutor.execute {
        if (
          generation != attemptGeneration.get() ||
          stopping ||
          closingCore ||
          commandServer == null ||
          !interfaceListeners.containsKey(listener)
        ) {
          return@execute
        }
        runCatching { notifyUnderlyingInterface(listener, connectivity) }
          .onFailure {
            logDiagnostic(
              "singbox_underlying_network_update_failed",
              "category=${it.javaClass.simpleName}",
            )
          }
      }
    }
  }

  private fun notifyUnderlyingInterface(
    listener: InterfaceUpdateListener,
    connectivity: ConnectivityManager,
  ) {
    val network = findUnderlyingNetwork(connectivity)
    setUnderlyingNetworks(network?.let { arrayOf(it) })
    val signature = network?.let { selected ->
      val link = connectivity.getLinkProperties(selected)
      val capabilities = connectivity.getNetworkCapabilities(selected)
      listOf(
        link?.interfaceName.orEmpty(),
        capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true,
        capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true,
        capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true,
      ).joinToString(":")
    } ?: "none"
    if (signature != lastUnderlyingNetworkSignature) {
      lastUnderlyingNetworkSignature = signature
      logDiagnostic(
        "singbox_underlying_network_changed",
        "available=${network != null};interface=${network?.let { connectivity.getLinkProperties(it)?.interfaceName }.orEmpty()}"
      )
    }
    if (network == null) {
      listener.updateDefaultInterface("", 0, true, false)
    } else {
      updateInterface(listener, connectivity, network)
    }
  }

  private fun findUnderlyingNetwork(connectivity: ConnectivityManager): Network? {
    return findUnderlyingNetworks(connectivity).firstOrNull()?.first
  }

  private fun findUnderlyingNetworks(
    connectivity: ConnectivityManager,
  ): List<Pair<Network, NetworkCapabilities>> {
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
  }

  private fun usableDnsAddresses(addresses: List<InetAddress>): List<InetAddress> =
    addresses
      .filter {
        !it.isAnyLocalAddress &&
          !it.isLoopbackAddress &&
          !it.isLinkLocalAddress &&
          !it.isMulticastAddress
      }
      .distinctBy { it.hostAddress?.substringBefore('%') }
      .sortedBy { if (it is Inet4Address) 0 else 1 }

  private fun configureBootstrapDns(config: String): String {
    val connectivity = getSystemService(ConnectivityManager::class.java)
    val root = JSONObject(config)
    val servers = root.optJSONObject("dns")?.optJSONArray("servers")
      ?: error("Sing-box config is missing its DNS server list.")
    val bootstrap = (0 until servers.length())
      .mapNotNull { servers.optJSONObject(it) }
      .firstOrNull { it.optString("tag") == "bootstrap-dns" }
      ?: error("Sing-box config is missing its Android bootstrap resolver.")
    if (bootstrap.optString("type") != "local") {
      error("The bootstrap resolver must use the Android platform DNS resolver.")
    }
    val networks = findUnderlyingNetworks(connectivity)
    val advertisedDnsCount = networks.firstOrNull()?.first
      ?.let { connectivity.getLinkProperties(it)?.dnsServers?.size } ?: 0
    logDiagnostic(
      "singbox_bootstrap_dns_selected",
      "source=android_platform;physical_networks=${networks.size};advertised_dns_count=$advertisedDnsCount;health_not_assumed=true"
    )
    return config
  }

  private fun resolveProxyEndpoint(config: String): String {
    val root = JSONObject(config)
    val outbounds = root.optJSONArray("outbounds") ?: error("Sing-box config has no outbound list.")
    val proxy = (0 until outbounds.length())
      .mapNotNull { outbounds.optJSONObject(it) }
      .firstOrNull { it.optString("tag") == "proxy" }
      ?: error("Sing-box config has no selected proxy outbound.")
    val host = proxy.optString("server").trim().removePrefix("[").removeSuffix("]")
    if (host.isBlank()) error("The selected proxy server has no hostname or IP address.")
    if (isNumericAddress(host)) {
      val family = if (host.contains(':')) "ipv6" else "ipv4"
      logDiagnostic("singbox_proxy_endpoint_resolution", "source=numeric_ip;family=$family;server_pinned=true")
      return config
    }

    val connectivity = getSystemService(ConnectivityManager::class.java)
    val networks = findUnderlyingNetworks(connectivity)
    if (networks.isEmpty()) {
      logDiagnostic("singbox_proxy_endpoint_resolution_failed", "category=no_underlying_internet_network")
      error("No physical internet network is available for proxy DNS bootstrap.")
    }

    val startedAt = android.os.SystemClock.elapsedRealtime()
    var lastFailure = "UnknownHostException"
    for ((network, capabilities) in networks.take(3)) {
      val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "PulseProxyBootstrapDns").apply { isDaemon = true }
      }
      val future = executor.submit<Array<InetAddress>> { network.getAllByName(host) }
      try {
        val addresses = future.get(2_500L, TimeUnit.MILLISECONDS)
          .filterNot { it.isAnyLocalAddress || it.isLoopbackAddress || it.isMulticastAddress }
          .sortedBy { if (it is Inet4Address) 0 else 1 }
        if (addresses.isNotEmpty()) {
          val selectedAddress = addresses.first()
          val pinnedAddress = selectedAddress.hostAddress?.substringBefore('%')
            ?: error("Android resolved the proxy hostname without a usable address.")
          val family = if (selectedAddress is Inet4Address) "ipv4" else "ipv6"
          proxy.put("server", pinnedAddress)
          val networkType = when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
          }
          logDiagnostic(
            "singbox_proxy_endpoint_resolution",
            "source=android_network_resolver;network=$networkType;family=$family;server_pinned=true;elapsed_ms=${android.os.SystemClock.elapsedRealtime() - startedAt}"
          )
          return root.toString()
        }
        lastFailure = "EmptyAddressResult"
      } catch (error: Throwable) {
        val cause = (error as? java.util.concurrent.ExecutionException)?.cause ?: error
        lastFailure = when (cause) {
          is TimeoutException -> "Timeout"
          else -> cause.javaClass.simpleName.take(48)
        }
        future.cancel(true)
      } finally {
        executor.shutdownNow()
      }
    }
    logDiagnostic(
      "singbox_proxy_endpoint_resolution_failed",
      "category=all_android_resolvers_failed;networks=${networks.size.coerceAtMost(3)};last_error=$lastFailure;elapsed_ms=${android.os.SystemClock.elapsedRealtime() - startedAt}"
    )
    error("Android could not resolve the selected proxy hostname using any available physical internet network (bootstrap DNS failed).")
  }

  private fun isNumericAddress(host: String): Boolean {
    if (host.contains(':')) return runCatching { InetAddress.getByName(host) is Inet6Address }.getOrDefault(false)
    val octets = host.split('.')
    return octets.size == 4 && octets.all { octet ->
      octet.toIntOrNull()?.let { it in 0..255 } == true
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
        dnsServer = BoxStringIterator(
          usableDnsAddresses(link.dnsServers).mapNotNull { it.hostAddress?.substringBefore('%') },
        )
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
    if (!message.isNullOrBlank()) {
      Log.d(TAG, message)
      logDiagnostic("singbox_core_message", message)
    }
  }
  override fun serviceReload() {
    val config = pendingConfig ?: return
    val generation = attemptGeneration.get()
    runCatching {
      lifecycleExecutor.execute {
        if (generation != attemptGeneration.get() || stopping || closingCore) return@execute
        val server = commandServer ?: return@execute
        runCatching { server.startOrReloadService(config, OverrideOptions()) }
          .onFailure {
            logDiagnostic("singbox_core_reload_failed", "category=${it.javaClass.simpleName};message=${it.message.orEmpty()}")
            publishState("error", it.message ?: "sing-box reload failed.")
          }
      }
    }
  }
  override fun serviceStop() {
    if (stopping || closingCore) return
    val generation = attemptGeneration.incrementAndGet()
    stopping = true
    logDiagnostic("singbox_core_stop_requested")
    lifecycleExecutor.execute { stopTunnel(latestStartId, generation, attemptId) }
  }
}

private class BoxStringIterator(private val values: List<String>) : StringIterator {
  private var index = 0
  override fun hasNext() = index < values.size
  override fun len() = values.size
  override fun next() = values[index++]
}
