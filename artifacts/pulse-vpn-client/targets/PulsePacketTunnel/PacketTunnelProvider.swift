import Foundation
import NetworkExtension
import OpenVPNAdapter
import WireGuardKit

extension NEPacketTunnelFlow: OpenVPNAdapterPacketFlow {}

private struct PulseVpnProfileRecord: Codable {
  let protocolName: String
  let profileId: String
  let profileName: String
  let configuration: String
  let username: String?
  let password: String?
}

final class PacketTunnelProvider: NEPacketTunnelProvider {
  private var wireGuardAdapter: WireGuardAdapter?
  private var openVpnAdapter: OpenVPNAdapter?
  private var startCompletion: ((Error?) -> Void)?
  private var stopCompletion: (() -> Void)?
  private var statisticsTimer: DispatchSourceTimer?
  private var activeProfile: PulseVpnProfileRecord?
  private var connectedAt: Int64?

  override func startTunnel(
    options: [String: NSObject]?,
    completionHandler: @escaping (Error?) -> Void
  ) {
    let profile: PulseVpnProfileRecord
    do {
      guard let data = try PulseVpnKeychain.read(key: "active-profile") else {
        completionHandler(tunnelError(1, "The secure VPN profile is unavailable."))
        return
      }
      profile = try JSONDecoder().decode(PulseVpnProfileRecord.self, from: data)
    } catch {
      completionHandler(tunnelError(1, "The secure VPN profile is unavailable."))
      return
    }
    guard let protocolConfiguration = protocolConfiguration as? NETunnelProviderProtocol,
          protocolConfiguration.providerConfiguration?["profileId"] as? String == profile.profileId,
          protocolConfiguration.providerConfiguration?["protocol"] as? String == profile.protocolName else {
      completionHandler(tunnelError(2, "The saved VPN profile does not match this tunnel."))
      return
    }
    guard !profile.configuration.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      completionHandler(tunnelError(3, "The VPN profile configuration is empty."))
      return
    }

    activeProfile = profile
    startCompletion = completionHandler
    PulseVpnRuntimeStore.clear()
    PulseVpnRuntimeStore.appendDiagnostic("Tunnel start requested for \(profile.protocolName).")

    switch profile.protocolName {
    case "wireguard", "amneziawg":
      startWireGuardCompatibleTunnel(profile)
    case "openvpn":
      startOpenVpnTunnel(profile)
    default:
      finishStart(tunnelError(4, "This VPN protocol is not supported on iOS."))
    }
  }

  override func stopTunnel(
    with reason: NEProviderStopReason,
    completionHandler: @escaping () -> Void
  ) {
    stopCompletion = completionHandler
    statisticsTimer?.cancel()
    statisticsTimer = nil
    PulseVpnRuntimeStore.appendDiagnostic("Tunnel stop requested (reason \(reason.rawValue)).")

    if let wireGuardAdapter {
      wireGuardAdapter.stop { [weak self] _ in
        self?.finishStop()
      }
    } else if let openVpnAdapter {
      openVpnAdapter.disconnect()
    } else {
      finishStop()
    }
  }

  private func startWireGuardCompatibleTunnel(_ profile: PulseVpnProfileRecord) {
    do {
      let configuration = try TunnelConfiguration(
        fromWgQuickConfig: profile.configuration,
        called: profile.profileName
      )
      let adapter = WireGuardAdapter(with: self) { level, message in
        if level == .error {
          PulseVpnRuntimeStore.appendDiagnostic("WireGuard engine reported an error.")
        }
      }
      wireGuardAdapter = adapter
      adapter.start(tunnelConfiguration: configuration) { [weak self] error in
        guard let self else { return }
        if let error {
          self.finishStart(error)
          return
        }
        self.connectedAt = Int64(Date().timeIntervalSince1970 * 1000)
        self.writeRuntimeStatus(state: "CONNECTED", upload: 0, download: 0)
        self.startStatisticsTimer()
        self.finishStart(nil)
      }
    } catch {
      finishStart(error)
    }
  }

  private func startOpenVpnTunnel(_ profile: PulseVpnProfileRecord) {
    guard let configurationData = profile.configuration.data(using: .utf8) else {
      finishStart(tunnelError(5, "The OpenVPN configuration could not be decoded."))
      return
    }

    let adapter = OpenVPNAdapter()
    adapter.delegate = self
    openVpnAdapter = adapter

    let configuration = OpenVPNConfiguration()
    configuration.fileContent = configurationData

    do {
      let evaluation = try adapter.apply(configuration: configuration)
      if !evaluation.autologin {
        guard let username = profile.username, !username.isEmpty,
              let password = profile.password, !password.isEmpty else {
          finishStart(tunnelError(6, "OpenVPN requires a username and password."))
          return
        }
        let credentials = OpenVPNCredentials()
        credentials.username = username
        credentials.password = password
        try adapter.provide(credentials: credentials)
      }
      startStatisticsTimer()
      adapter.connect(using: packetFlow)
    } catch {
      finishStart(error)
    }
  }

  private func startStatisticsTimer() {
    statisticsTimer?.cancel()
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.pulse.vpn.stats"))
    timer.schedule(deadline: .now(), repeating: .seconds(1))
    timer.setEventHandler { [weak self] in
      self?.updateTrafficCounters()
    }
    statisticsTimer = timer
    timer.resume()
  }

  private func updateTrafficCounters() {
    guard activeProfile != nil else { return }
    if let wireGuardAdapter {
      wireGuardAdapter.getRuntimeConfiguration { [weak self] configuration in
        guard let self, let configuration else { return }
        let totals = Self.parseWireGuardCounters(configuration)
        self.writeRuntimeStatus(state: "CONNECTED", upload: totals.upload, download: totals.download)
      }
    } else if let openVpnAdapter {
      let statistics = openVpnAdapter.interfaceStatistics
      writeRuntimeStatus(
        state: openVpnAdapter.connectionInformation == nil ? "CONNECTING" : "CONNECTED",
        upload: Int64(max(0, statistics.bytesOut)),
        download: Int64(max(0, statistics.bytesIn))
      )
    }
  }

  private static func parseWireGuardCounters(_ runtimeConfiguration: String) -> (upload: Int64, download: Int64) {
    var upload: Int64 = 0
    var download: Int64 = 0
    for line in runtimeConfiguration.split(whereSeparator: \.isNewline) {
      if line.hasPrefix("tx_bytes="), let value = Int64(line.dropFirst("tx_bytes=".count)) {
        upload += max(0, value)
      } else if line.hasPrefix("rx_bytes="), let value = Int64(line.dropFirst("rx_bytes=".count)) {
        download += max(0, value)
      }
    }
    return (upload, download)
  }

  private func writeRuntimeStatus(state: String, upload: Int64, download: Int64, error: String? = nil) {
    guard let profile = activeProfile else { return }
    PulseVpnRuntimeStore.update(
      protocolName: profile.protocolName,
      profileId: profile.profileId,
      profileName: profile.profileName,
      state: state,
      uploadBytes: upload,
      downloadBytes: download,
      connectedAt: connectedAt,
      error: error
    )
  }

  private func finishStart(_ error: Error?) {
    if let error {
      PulseVpnRuntimeStore.appendDiagnostic("Tunnel start failed.")
      writeRuntimeStatus(
        state: "ERROR",
        upload: 0,
        download: 0,
        error: "The VPN engine could not start this profile."
      )
    }
    let completion = startCompletion
    startCompletion = nil
    completion?(error)
  }

  private func finishStop() {
    statisticsTimer?.cancel()
    statisticsTimer = nil
    let runtimeState = UserDefaults(suiteName: "group.com.pulse.vpnclient")?
      .dictionary(forKey: "pulse-vpn.runtime-status")?["state"] as? String
    if runtimeState != "ERROR" {
      PulseVpnRuntimeStore.clear()
    }
    wireGuardAdapter = nil
    openVpnAdapter = nil
    activeProfile = nil
    connectedAt = nil
    let completion = stopCompletion
    stopCompletion = nil
    completion?()
  }

  private func tunnelError(_ code: Int, _ message: String) -> NSError {
    NSError(
      domain: "PulsePacketTunnel",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}

extension PacketTunnelProvider: OpenVPNAdapterDelegate {
  func openVPNAdapter(
    _ openVPNAdapter: OpenVPNAdapter,
    configureTunnelWithNetworkSettings networkSettings: NEPacketTunnelNetworkSettings?,
    completionHandler: @escaping (Error?) -> Void
  ) {
    networkSettings?.dnsSettings?.matchDomains = [""]
    setTunnelNetworkSettings(networkSettings, completionHandler: completionHandler)
  }

  func openVPNAdapter(
    _ openVPNAdapter: OpenVPNAdapter,
    handleEvent event: OpenVPNAdapterEvent,
    message: String?
  ) {
    switch event {
    case .connected:
      connectedAt = Int64(Date().timeIntervalSince1970 * 1000)
      writeRuntimeStatus(state: "CONNECTED", upload: 0, download: 0)
      finishStart(nil)
    case .disconnected:
      finishStop()
    case .reconnecting:
      if let profile = activeProfile {
        PulseVpnRuntimeStore.update(
          protocolName: profile.protocolName,
          profileId: profile.profileId,
          profileName: profile.profileName,
          state: "CONNECTING",
          uploadBytes: Int64(max(0, openVPNAdapter.interfaceStatistics.bytesOut)),
          downloadBytes: Int64(max(0, openVPNAdapter.interfaceStatistics.bytesIn)),
          connectedAt: connectedAt
        )
      }
    default:
      break
    }
  }

  func openVPNAdapter(_ openVPNAdapter: OpenVPNAdapter, handleError error: Error) {
    let isFatal = (error as NSError).userInfo[OpenVPNAdapterErrorFatalKey] as? Bool ?? false
    guard isFatal else { return }
    if startCompletion != nil {
      finishStart(error)
    } else {
      writeRuntimeStatus(
        state: "ERROR",
        upload: Int64(max(0, openVPNAdapter.interfaceStatistics.bytesOut)),
        download: Int64(max(0, openVPNAdapter.interfaceStatistics.bytesIn)),
        error: error.localizedDescription
      )
      cancelTunnelWithError(error)
    }
  }

  func openVPNAdapter(_ openVPNAdapter: OpenVPNAdapter, handleLogMessage logMessage: String) {
    let lowercased = logMessage.lowercased()
    if lowercased.contains("error") || lowercased.contains("fatal") {
      PulseVpnRuntimeStore.appendDiagnostic("OpenVPN reported an engine error.")
    }
  }
}
