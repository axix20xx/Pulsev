package com.pulse.vpn.engine

import android.content.Context
import android.os.Build
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Small, app-owned diagnostics log. It intentionally records engine events and
 * sanitized error text rather than Android's global log or VPN configuration.
 */
object PulseDiagnostics {
  private const val LOG_FILE = "pulse-diagnostics.log"
  private const val PREVIOUS_LOG_FILE = "pulse-diagnostics.previous.log"
  private const val MAX_LOG_BYTES = 128 * 1024L

  private val lock = Any()
  private val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }
  private val linkPattern = Regex("""(?i)\b(?:vless|vmess|trojan|ss|ssr|tuic|hysteria2|https?|socks)://[^\s"'<>]+""")
  private val secretPattern = Regex("""(?i)\b(password|passwd|token|username|user|uuid|private[_ -]?key|public[_ -]?key|secret|auth)\s*[:=]\s*[^\s,;]+""")
  private val ipv4Pattern = Regex("""\b(?:\d{1,3}\.){3}\d{1,3}\b""")
  private val ipv6Pattern = Regex("""(?i)\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]{1,}\b""")
  private val uuidPattern = Regex("""(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b""")
  private val longOpaqueValuePattern = Regex("""\b[A-Za-z0-9_-]{40,}\b""")
  private val domainPattern = Regex("""\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b""")
  private val privatePathPattern = Regex("""/data/(?:user|app|data)/[^\s,;]+""")

  @JvmStatic
  fun log(context: Context, event: String, detail: String = "", attemptId: String? = null) {
    val safeEvent = event.filter { it.isLetterOrDigit() || it == '_' }.take(48).ifBlank { "event" }
    val attemptDetail = attemptId
      ?.filter { it.isLetterOrDigit() || it == '_' || it == '-' }
      ?.take(16)
      ?.takeIf { it.isNotBlank() }
      ?.let { "attempt_id=$it" }
      .orEmpty()
    val safeDetail = sanitize(listOf(attemptDetail, detail).filter { it.isNotBlank() }.joinToString(";")).take(300)
    val line = synchronized(dateFormat) { dateFormat.format(Date()) } +
      " $safeEvent" + if (safeDetail.isBlank()) "" else " $safeDetail"

    runCatching {
      synchronized(lock) {
        val file = File(context.filesDir, LOG_FILE)
        if (file.length() >= MAX_LOG_BYTES) {
          File(context.filesDir, PREVIOUS_LOG_FILE).delete()
          file.renameTo(File(context.filesDir, PREVIOUS_LOG_FILE))
        }
        FileOutputStream(file, true).bufferedWriter(Charsets.UTF_8).use {
          it.append(line).append('\n')
        }
      }
    }
  }

  fun export(context: Context): String {
    val appVersion = runCatching {
      context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
    }.getOrDefault("unknown")
    val logs = synchronized(lock) {
      listOf(PREVIOUS_LOG_FILE, LOG_FILE)
        .map { File(context.filesDir, it) }
        .filter { it.isFile }
        .joinToString(separator = "") { it.readText(Charsets.UTF_8) }
        .takeLast(240 * 1024)
    }
    val exportedAt = synchronized(dateFormat) { dateFormat.format(Date()) }
    return buildString {
      appendLine("Pulse VPN diagnostic report")
      appendLine("app_version=$appVersion")
      appendLine("android_api=${Build.VERSION.SDK_INT}")
      appendLine("device_abi=${Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"}")
      appendLine("exported_at_utc=$exportedAt")
      appendLine("privacy=No VPN profile, credentials, subscription URL, server address, or traffic destination is included.")
      appendLine("--- recent app diagnostics ---")
      append(logs)
      if (logs.isBlank()) appendLine("No engine events have been recorded yet.")
    }
  }

  private fun sanitize(value: String): String = value
    .replace(linkPattern, "[link]")
    .replace(secretPattern, "\$1=[redacted]")
    .replace(privatePathPattern, "[app-path]")
    .replace(ipv4Pattern, "[ip]")
    .replace(ipv6Pattern, "[ip]")
    .replace(uuidPattern, "[id]")
    .replace(longOpaqueValuePattern, "[redacted]")
    .replace(domainPattern, "[host]")
    .replace(Regex("[\\r\\n\\t]+"), " ")
    .trim()
}
