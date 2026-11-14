import Foundation
import NetworkExtension
import Security

private struct PulseVpnProfileRecord: Codable {
  let protocolName: String
  let profileId: String
  let profileName: String
  let configuration: String
  let username: String?
  let password: String?
}

final class PulseVpnEngineController {
  static let shared = PulseVpnEngineController()

  private let providerBundleIdentifier = "com.pulse.vpnclient.PacketTunnel"
  private let appGroup = "group.com.pulse.vpnclient"
  private let profileKey = "active-profile"
  private let statusKey = "pulse-vpn.runtime-status"
  private let diagnosticsKey = "pulse-vpn.diagnostics"
  private let supportedProtocols: Set<String> = ["wireguard", "amneziawg", "openvpn"]

  var isSupported: Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    return true
    #endif
  }

  func connect(
    protocolName: String,
    profileId: String,
    profileName: String,
    configuration: String,
    username: String?,
    password: String?
  ) async throws -> [String: Any] {
    guard supportedProtocols.contains(protocolName) else {
      throw nativeError(1, "This VPN protocol is not supported on iOS.")
    }
    guard !profileId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !configuration.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw nativeError(2, "The VPN profile is incomplete.")
    }
    if protocolName == "openvpn",
       (username?.isEmpty != false || password?.isEmpty != false) {
      throw nativeError(3, "OpenVPN requires a username and password.")
    }

    let manager = try await loadManager()
    try await stopIfNeeded(manager)

    let profile = PulseVpnProfileRecord(
      protocolName: protocolName,
      profileId: profileId,
      profileName: profileName,
      configuration: configuration,
      username: username,
      password: password
    )
    let profileData = try JSONEncoder().encode(profile)
    try PulseVpnKeychainStore.write(profileData, key: profileKey)
    UserDefaults(suiteName: appGroup)?.removeObject(forKey: statusKey)

    do {
      try configure(manager, protocolName: protocolName, profileId: profileId)
      try await save(manager)
      try await reload(manager)
      try await MainActor.run {
        try manager.connection.startVPNTunnel()
      }
    } catch {
      let nativeError = error as NSError
      appendDiagnostic(
        "VPN setup/start failed with \(nativeError.domain) code \(nativeError.code)."
      )
      try? PulseVpnKeychainStore.remove(key: profileKey)
      throw error
    }

    appendDiagnostic("VPN start requested for \(protocolName).")
    return statusPayload(
      protocolName: protocolName,
      profileId: profileId,
      profileName: profileName,
      connectionStatus: manager.connection.status
    )
  }

  func disconnect() async throws -> [String: Any] {
    let manager = try await loadManager()
    try await stopIfNeeded(manager)
    try? PulseVpnKeychainStore.remove(key: profileKey)
    UserDefaults(suiteName: appGroup)?.removeObject(forKey: statusKey)
    appendDiagnostic("VPN disconnect confirmed.")
    return disconnectedStatus()
  }

  func status(for requestedProtocol: String) async throws -> [String: Any] {
    let manager = try await loadManager()
    guard manager.protocolConfiguration != nil else {
      return disconnectedStatus(protocolName: requestedProtocol)
    }
    try await reload(manager)
    let tunnelProtocol = manager.protocolConfiguration as? NETunnelProviderProtocol
    let actualProtocol = tunnelProtocol?.providerConfiguration?["protocol"] as? String
    guard actualProtocol == requestedProtocol else {
      return disconnectedStatus(protocolName: requestedProtocol)
    }
    let profileId = tunnelProtocol?.providerConfiguration?["profileId"] as? String
    let runtime = UserDefaults(suiteName: appGroup)?.dictionary(forKey: statusKey)
    let profileName = runtime?["profileName"] as? String ?? manager.localizedDescription
    return statusPayload(
      protocolName: requestedProtocol,
      profileId: profileId,
      profileName: profileName,
      connectionStatus: manager.connection.status,
      runtime: runtime
    )
  }

  func probeConnectivity() async -> [String: Any] {
    let protocolName = await activeProtocol()
    let connected = await activeConnectionStatus()
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard connected, let protocolName else {
      return [
        "vpnActive": false,
        "passed": false,
        "testedAt": now,
        "endpoints": [],
      ]
    }

    let endpoints = await withTaskGroup(of: [String: Any].self) { group in
      for endpoint in [
        "https://example.com/",
        "https://www.apple.com/library/test/success.html",
      ] {
        group.addTask {
          await Self.probeEndpoint(endpoint)
        }
      }
      var results = [[String: Any]]()
      for await result in group {
        results.append(result)
      }
      return results
    }
    return [
      "vpnActive": true,
      "passed": endpoints.contains { $0["success"] as? Bool == true },
      "testedAt": now,
      "endpoints": endpoints,
      "protocol": protocolName,
    ]
  }

  func diagnosticLog() -> String {
    UserDefaults(suiteName: appGroup)?.stringArray(forKey: diagnosticsKey)?.joined(separator: "\n") ?? ""
  }

  private func configure(
    _ manager: NETunnelProviderManager,
    protocolName: String,
    profileId: String
  ) throws {
    let tunnelProtocol = NETunnelProviderProtocol()
    tunnelProtocol.providerBundleIdentifier = providerBundleIdentifier
    tunnelProtocol.serverAddress = "Pulse VPN"
    tunnelProtocol.providerConfiguration = [
      "protocol": protocolName,
      "profileId": profileId,
    ]
    manager.protocolConfiguration = tunnelProtocol
    manager.localizedDescription = "Pulse VPN"
    manager.isEnabled = true
  }

  private func loadManager() async throws -> NETunnelProviderManager {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NETunnelProviderManager, Error>) in
      NETunnelProviderManager.loadAllFromPreferences { managers, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let manager = managers?.first(where: { candidate in
          guard let tunnelProtocol = candidate.protocolConfiguration as? NETunnelProviderProtocol else {
            return false
          }
          return tunnelProtocol.providerBundleIdentifier == self.providerBundleIdentifier
        }) ?? NETunnelProviderManager()
        continuation.resume(returning: manager)
      }
    }
  }

  private func save(_ manager: NETunnelProviderManager) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      manager.saveToPreferences { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      }
    }
  }

  private func reload(_ manager: NETunnelProviderManager) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      manager.loadFromPreferences { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      }
    }
  }

  private func stopIfNeeded(_ manager: NETunnelProviderManager) async throws {
    guard manager.protocolConfiguration != nil else {
      return
    }
    try await reload(manager)
    guard manager.connection.status != .disconnected && manager.connection.status != .invalid else {
      return
    }
    manager.connection.stopVPNTunnel()
    let deadline = Date().addingTimeInterval(12)
    while Date() < deadline {
      try await Task.sleep(nanoseconds: 150_000_000)
      try await reload(manager)
      if manager.connection.status == .disconnected || manager.connection.status == .invalid {
        return
      }
    }
    throw nativeError(4, "iOS did not confirm that the previous VPN tunnel stopped.")
  }

  private func statusPayload(
    protocolName: String,
    profileId: String?,
    profileName: String?,
    connectionStatus: NEVPNStatus,
    runtime: [String: Any]? = nil
  ) -> [String: Any] {
    let state: (String, String, Bool)
    switch connectionStatus {
    case .connected:
      state = ("CONNECTED", "ACTIVE", true)
    case .connecting, .reasserting:
      state = ("CONNECTING", "CONNECTING", false)
    case .disconnecting:
      state = ("DISCONNECTING", "DISCONNECTING", false)
    case .disconnected:
      state = ("DISCONNECTED", "INACTIVE", false)
    case .invalid:
      state = ("UNKNOWN", "UNKNOWN", false)
    @unknown default:
      state = ("UNKNOWN", "UNKNOWN", false)
    }

    let runtimeMatches = runtime?["protocol"] as? String == protocolName
    return [
      "status": state.0,
      "tunnelState": state.1,
      "isConnected": state.2,
      "profileId": profileId as Any? ?? NSNull(),
      "profileName": profileName as Any? ?? NSNull(),
      "connectedAt": runtimeMatches ? (runtime?["connectedAt"] as Any? ?? NSNull()) : NSNull(),
      "uploadBytes": runtimeMatches ? (runtime?["uploadBytes"] as? Int64 ?? 0) : 0,
      "downloadBytes": runtimeMatches ? (runtime?["downloadBytes"] as? Int64 ?? 0) : 0,
      "error": runtimeMatches ? (runtime?["error"] as Any? ?? NSNull()) : NSNull(),
    ]
  }

  private func disconnectedStatus(protocolName: String? = nil) -> [String: Any] {
    [
      "status": "DISCONNECTED",
      "tunnelState": "INACTIVE",
      "isConnected": false,
      "profileId": NSNull(),
      "profileName": NSNull(),
      "connectedAt": NSNull(),
      "uploadBytes": 0,
      "downloadBytes": 0,
      "error": NSNull(),
      "protocol": protocolName as Any? ?? NSNull(),
    ]
  }

  private func activeProtocol() async -> String? {
    guard let manager = try? await loadManager(),
          manager.protocolConfiguration != nil,
          let tunnelProtocol = manager.protocolConfiguration as? NETunnelProviderProtocol else {
      return nil
    }
    return tunnelProtocol.providerConfiguration?["protocol"] as? String
  }

  private func activeConnectionStatus() async -> Bool {
    guard let manager = try? await loadManager(),
          manager.protocolConfiguration != nil else { return false }
    return manager.connection.status == .connected
  }

  private func appendDiagnostic(_ message: String) {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }
    var entries = defaults.stringArray(forKey: diagnosticsKey) ?? []
    entries.append("[\(Int(Date().timeIntervalSince1970))] \(message)")
    defaults.set(Array(entries.suffix(120)), forKey: diagnosticsKey)
  }

  private static func probeEndpoint(_ endpoint: String) async -> [String: Any] {
    let started = Date()
    guard let url = URL(string: endpoint) else {
      return ["endpoint": endpoint, "success": false, "error": "Invalid test URL."]
    }
    do {
      var request = URLRequest(url: url)
      request.timeoutInterval = 8
      request.cachePolicy = .reloadIgnoringLocalCacheData
      let (data, response) = try await URLSession.shared.data(for: request)
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      let elapsed = Int(Date().timeIntervalSince(started) * 1000)
      return [
        "endpoint": endpoint,
        "success": (200..<300).contains(statusCode) && !data.isEmpty,
        "statusCode": statusCode,
        "bytesReceived": data.count,
        "latencyMs": elapsed,
      ]
    } catch {
      return [
        "endpoint": endpoint,
        "success": false,
        "latencyMs": Int(Date().timeIntervalSince(started) * 1000),
        "error": "The endpoint could not be reached.",
      ]
    }
  }

  private func nativeError(_ code: Int, _ message: String) -> NSError {
    NSError(
      domain: "PulseVpnEngine",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
