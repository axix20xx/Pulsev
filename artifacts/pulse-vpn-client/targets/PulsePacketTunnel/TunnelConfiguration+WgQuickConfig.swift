import Foundation
import Network
import WireGuardKit

extension TunnelConfiguration {
  convenience init(fromWgQuickConfig text: String, called name: String? = nil) throws {
    enum Section: Equatable {
      case none
      case interface
      case peer
    }

    let interfaceKeys: Set<String> = [
      "privatekey", "listenport", "address", "dns", "mtu",
      "jc", "jmin", "jmax", "s1", "s2", "s3", "s4",
      "h1", "h2", "h3", "h4", "i1", "i2", "i3", "i4", "i5",
      "headerprotectionkey", "contentpaddingaddition", "rekeyaftertime",
      "rekeytimeout", "rejectaftertime", "keepalivetimeout",
      "maxhandshakeattempts", "randomtrailers", "disablecookies",
    ]
    let peerKeys: Set<String> = [
      "publickey", "presharedkey", "allowedips", "endpoint", "persistentkeepalive",
    ]

    var section = Section.none
    var interfaceAttributes = [String: [String]]()
    var peers = [[String: [String]]]()
    var sawInterface = false

    for rawLine in text.split(whereSeparator: \.isNewline) {
      let withoutComment = rawLine.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
      let line = String(withoutComment).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !line.isEmpty else { continue }
      let normalized = line.lowercased()

      if normalized == "[interface]" {
        guard !sawInterface else {
          throw parseError("The VPN profile contains multiple interfaces.")
        }
        sawInterface = true
        section = .interface
        continue
      }
      if normalized == "[peer]" {
        guard sawInterface else {
          throw parseError("A peer appears before the interface section.")
        }
        section = .peer
        peers.append([:])
        continue
      }

      guard let separator = line.firstIndex(of: "="), section != .none else {
        throw parseError("The VPN profile contains an invalid configuration line.")
      }
      let key = String(line[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      let value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
      let allowedKeys = section == .interface ? interfaceKeys : peerKeys
      guard allowedKeys.contains(key), !value.isEmpty else {
        throw parseError("The VPN profile contains an unsupported or empty setting.")
      }

      if section == .interface {
        if ["address", "dns"].contains(key) {
          interfaceAttributes[key, default: []].append(value)
        } else {
          guard interfaceAttributes[key] == nil else {
            throw parseError("The VPN profile repeats a setting that must be unique.")
          }
          interfaceAttributes[key] = [value]
        }
      } else {
        guard !peers.isEmpty else {
          throw parseError("The VPN peer section is incomplete.")
        }
        if key == "allowedips" {
          peers[peers.count - 1][key, default: []].append(value)
        } else {
          guard peers[peers.count - 1][key] == nil else {
            throw parseError("The VPN profile repeats a peer setting.")
          }
          peers[peers.count - 1][key] = [value]
        }
      }
    }

    guard sawInterface,
          let privateKeyText = interfaceAttributes["privatekey"]?.first,
          let privateKey = PrivateKey(base64Key: privateKeyText),
          !peers.isEmpty else {
      throw parseError("The VPN profile is missing a valid private key or peer.")
    }

    var interface = InterfaceConfiguration(privateKey: privateKey)
    if let listenPort = interfaceAttributes["listenport"]?.first {
      guard let value = UInt16(listenPort) else { throw parseError("The VPN listen port is invalid.") }
      interface.listenPort = value
    }
    if let mtu = interfaceAttributes["mtu"]?.first {
      guard let value = UInt16(mtu) else { throw parseError("The VPN MTU is invalid.") }
      interface.mtu = value
    }
    interface.addresses = try splitValues(interfaceAttributes["address"])
      .map { value in
        guard let address = IPAddressRange(from: value) else {
          throw parseError("The VPN interface address is invalid.")
        }
        return address
      }

    for value in splitValues(interfaceAttributes["dns"]) {
      if let server = DNSServer(from: value) {
        interface.dns.append(server)
      } else {
        interface.dnsSearch.append(value)
      }
    }

    interface.junkPacketCount = try uint16(interfaceAttributes, key: "jc")
    interface.junkPacketMinSize = try uint16(interfaceAttributes, key: "jmin")
    interface.junkPacketMaxSize = try uint16(interfaceAttributes, key: "jmax")
    interface.initPacketJunkSize = try uint16(interfaceAttributes, key: "s1")
    interface.responsePacketJunkSize = try uint16(interfaceAttributes, key: "s2")
    interface.cookieReplyPacketJunkSize = try uint16(interfaceAttributes, key: "s3")
    interface.transportPacketJunkSize = try uint16(interfaceAttributes, key: "s4")
    interface.initPacketMagicHeader = interfaceAttributes["h1"]?.first
    interface.responsePacketMagicHeader = interfaceAttributes["h2"]?.first
    interface.underloadPacketMagicHeader = interfaceAttributes["h3"]?.first
    interface.transportPacketMagicHeader = interfaceAttributes["h4"]?.first
    interface.specialJunk1 = interfaceAttributes["i1"]?.first
    interface.specialJunk2 = interfaceAttributes["i2"]?.first
    interface.specialJunk3 = interfaceAttributes["i3"]?.first
    interface.specialJunk4 = interfaceAttributes["i4"]?.first
    interface.specialJunk5 = interfaceAttributes["i5"]?.first
    if let key = interfaceAttributes["headerprotectionkey"]?.first {
      guard let parsed = PrivateKey(base64Key: key) else {
        throw parseError("The AmneziaWG header protection key is invalid.")
      }
      interface.headerProtectionKey = parsed
    }
    interface.contentPaddingAddition = interfaceAttributes["contentpaddingaddition"]?.first
    interface.rekeyAfterTime = interfaceAttributes["rekeyaftertime"]?.first
    interface.rekeyTimeout = interfaceAttributes["rekeytimeout"]?.first
    interface.rejectAfterTime = interfaceAttributes["rejectaftertime"]?.first
    interface.keepaliveTimeout = interfaceAttributes["keepalivetimeout"]?.first
    interface.maxHandshakeAttempts = interfaceAttributes["maxhandshakeattempts"]?.first
    interface.randomTrailers = interfaceAttributes["randomtrailers"]?.first
    interface.disableCookies = interfaceAttributes["disablecookies"]?.first

    let parsedPeers = try peers.map { attributes -> PeerConfiguration in
      guard let publicKeyText = attributes["publickey"]?.first,
            let publicKey = PublicKey(base64Key: publicKeyText) else {
        throw parseError("A VPN peer has an invalid public key.")
      }
      var peer = PeerConfiguration(publicKey: publicKey)
      if let preSharedKeyText = attributes["presharedkey"]?.first {
        guard let key = PreSharedKey(base64Key: preSharedKeyText) else {
          throw parseError("A VPN peer has an invalid pre-shared key.")
        }
        peer.preSharedKey = key
      }
      peer.allowedIPs = try splitValues(attributes["allowedips"])
        .map { value in
          guard let address = IPAddressRange(from: value) else {
            throw parseError("A VPN peer has an invalid allowed IP range.")
          }
          return address
        }
      if let endpoint = attributes["endpoint"]?.first {
        guard let parsed = Endpoint(from: endpoint) else {
          throw parseError("A VPN peer has an invalid endpoint.")
        }
        peer.endpoint = parsed
      }
      peer.persistentKeepAlive = attributes["persistentkeepalive"]?.first
      return peer
    }

    self.init(name: name, interface: interface, peers: parsedPeers)
  }
}

private func splitValues(_ values: [String]?) -> [String] {
  (values ?? [])
    .flatMap { $0.split(separator: ",", omittingEmptySubsequences: false) }
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
}

private func uint16(_ attributes: [String: [String]], key: String) throws -> UInt16? {
  guard let text = attributes[key]?.first else { return nil }
  guard let value = UInt16(text) else {
    throw parseError("An AmneziaWG numeric parameter is invalid.")
  }
  return value
}

private func parseError(_ message: String) -> NSError {
  NSError(
    domain: "PulseWireGuardConfiguration",
    code: 1,
    userInfo: [NSLocalizedDescriptionKey: message]
  )
}
