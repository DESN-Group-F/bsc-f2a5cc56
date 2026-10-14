import Foundation
import Security

struct ServiceSession: Codable {
    let origin: String
    let token: String
    let expiresAt: TimeInterval
}

final class SecureSessionStore {
    private let identity: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "battery.inventory.service.session.v1",
        kSecAttrAccount as String: "staff-session"
    ]
    private func failure() -> ServiceFailure { ServiceFailure(message: "Secure credential storage is unavailable. Preserve pending work, then explicitly reset the local session and sign in again.", code: "SECURE_STORAGE") }
    func load(now: TimeInterval) throws -> ServiceSession? {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let value = try? JSONDecoder().decode(ServiceSession.self, from: data),
              (try? ServicePolicy.origin(value.origin)) == value.origin,
              value.token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              value.expiresAt.isFinite, value.expiresAt <= now + ServicePolicy.sessionSeconds else { throw failure() }
        if value.expiresAt <= now { try clear(); return nil }
        return value
    }
    func save(_ value: ServiceSession) throws {
        guard let data = try? JSONEncoder().encode(value) else { throw failure() }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let update = SecItemUpdate(identity as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw failure() }
        var insert = identity
        for (key, value) in attributes { insert[key] = value }
        guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw failure() }
    }
    func clear() throws {
        let status = SecItemDelete(identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure() }
    }
}
