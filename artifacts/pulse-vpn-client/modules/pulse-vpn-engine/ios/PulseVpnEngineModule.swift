import ExpoModulesCore
import UIKit

public final class PulseVpnEngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PulseVpnEngine")

    AsyncFunction("isSupported") { () -> Bool in
      PulseVpnEngineController.shared.isSupported
    }

    AsyncFunction("connectWireGuard") {
      (profileId: String, profileName: String, configText: String) async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.connect(
        protocolName: "wireguard",
        profileId: profileId,
        profileName: profileName,
        configuration: configText,
        username: nil,
        password: nil
      )
    }

    AsyncFunction("disconnectWireGuard") { () async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.disconnect()
    }

    AsyncFunction("getWireGuardStatus") { () async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.status(for: "wireguard")
    }

    AsyncFunction("connectAmneziaWg") {
      (profileId: String, profileName: String, configText: String) async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.connect(
        protocolName: "amneziawg",
        profileId: profileId,
        profileName: profileName,
        configuration: configText,
        username: nil,
        password: nil
      )
    }

    AsyncFunction("disconnectAmneziaWg") { () async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.disconnect()
    }

    AsyncFunction("getAmneziaWgStatus") { () async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.status(for: "amneziawg")
    }

    AsyncFunction("connectOpenVpn") {
      (
        profileId: String,
        profileName: String,
        configText: String,
        username: String,
        password: String
      ) async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.connect(
        protocolName: "openvpn",
        profileId: profileId,
        profileName: profileName,
        configuration: configText,
        username: username,
        password: password
      )
    }

    AsyncFunction("disconnectOpenVpn") { () async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.disconnect()
    }

    AsyncFunction("getOpenVpnStatus") { () async throws -> [String: Any] in
      try await PulseVpnEngineController.shared.status(for: "openvpn")
    }

    AsyncFunction("probeTunnelConnectivity") { () async -> [String: Any] in
      await PulseVpnEngineController.shared.probeConnectivity()
    }

    AsyncFunction("getDiagnosticLog") { () -> String in
      PulseVpnEngineController.shared.diagnosticLog()
    }

    AsyncFunction("setTunnelTestKeepScreenOn") { (enabled: Bool) async -> Bool in
      await MainActor.run {
        UIApplication.shared.isIdleTimerDisabled = enabled
        return true
      }
    }
  }
}
