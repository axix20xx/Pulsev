import Foundation

public enum PulseVpnRuntimeStore {
  private static let appGroup = "group.com.pulse.vpnclient"
  private static let statusKey = "pulse-vpn.runtime-status"
  private static let diagnosticsKey = "pulse-vpn.diagnostics"
  private static let maximumDiagnosticEntries = 120

  public static func update(
    protocolName: String,
    profileId: String,
    profileName: String,
    state: String,
    uploadBytes: Int64,
    downloadBytes: Int64,
    connectedAt: Int64?,
    error: String? = nil
  ) {
    let payload: [String: Any] = [
      "protocol": protocolName,
      "profileId": profileId,
      "profileName": profileName,
      "state": state,
      "uploadBytes": max(0, uploadBytes),
      "downloadBytes": max(0, downloadBytes),
      "connectedAt": connectedAt as Any? ?? NSNull(),
      "updatedAt": Int64(Date().timeIntervalSince1970 * 1000),
      "error": error as Any? ?? NSNull(),
    ]
    UserDefaults(suiteName: appGroup)?.set(payload, forKey: statusKey)
  }

  public static func clear() {
    UserDefaults(suiteName: appGroup)?.removeObject(forKey: statusKey)
  }

  public static func appendDiagnostic(_ message: String) {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }
    var entries = defaults.stringArray(forKey: diagnosticsKey) ?? []
    let safeMessage = message
      .replacingOccurrences(of: "\n", with: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !safeMessage.isEmpty else { return }
    entries.append("[\(Int(Date().timeIntervalSince1970))] \(safeMessage)")
    defaults.set(Array(entries.suffix(maximumDiagnosticEntries)), forKey: diagnosticsKey)
  }
}
