import Foundation
import Security

public enum PulseVpnKeychain {
  private static let service = "com.pulse.vpnclient.shared.vpn"
  private static let sharedAccessGroupSuffix = ".com.pulse.vpnclient.shared"

  public static func read(key: String) throws -> Data? {
    var query = try baseQuery(key: key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
      return nil
    }
    guard status == errSecSuccess else {
      throw keychainError(status)
    }
    return result as? Data
  }

  public static func write(_ data: Data, key: String) throws {
    let query = try baseQuery(key: key)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]

    let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecSuccess {
      return
    }
    guard updateStatus == errSecItemNotFound else {
      throw keychainError(updateStatus)
    }

    var newItem = query
    attributes.forEach { newItem[$0.key] = $0.value }
    let addStatus = SecItemAdd(newItem as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw keychainError(addStatus)
    }
  }

  public static func remove(key: String) throws {
    let status = SecItemDelete(try baseQuery(key: key) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw keychainError(status)
    }
  }

  private static func baseQuery(key: String) throws -> [String: Any] {
    guard let accessGroup = Bundle.main.object(forInfoDictionaryKey: "PulseKeychainAccessGroup") as? String,
          !accessGroup.isEmpty,
          !accessGroup.contains("$("),
          accessGroup.hasSuffix(sharedAccessGroupSuffix) else {
      throw NSError(
        domain: "PulseVpnKeychain",
        code: Int(errSecMissingEntitlement),
        userInfo: [NSLocalizedDescriptionKey: "The shared VPN Keychain access group is not configured."]
      )
    }

    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrAccessGroup as String: accessGroup,
    ]
  }

  private static func keychainError(_ status: OSStatus) -> NSError {
    NSError(
      domain: "PulseVpnKeychain",
      code: Int(status),
      userInfo: [NSLocalizedDescriptionKey: "Secure VPN profile storage failed (\(status))."]
    )
  }
}
