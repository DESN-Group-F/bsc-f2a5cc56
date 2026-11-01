import Foundation
import Security

/// Classified failure from the inventory service.
struct APIFailure: Error, LocalizedError, Sendable {
    enum Kind: Sendable {
        /// 401: the session is missing or ended. Nothing executed on this attempt.
        case unauthorized
        /// A definite 4xx answer. On a first attempt nothing was committed.
        case rejected
        /// Network loss, timeout, redirect or 5xx. A write may or may not have committed.
        case uncertain
        /// A 2xx body that could not be read or verified.
        case invalidResponse
    }

    let kind: Kind
    let status: Int?
    let message: String
    let code: String?

    var errorDescription: String? { message }
    /// Codes ending in `_rejected_final` permanently settle a request ID as rejected.
    var isFinalRejection: Bool { code?.hasSuffix("_rejected_final") == true }
}

/// The configured service origin. One exact HTTPS origin; no other host is ever contacted.
enum ServerConfig {
    static let defaultOrigin = URL(string: "https://zztv-battery.gear-c1.openbayes.net")!
    private static let key = "serviceOrigin"

    static var origin: URL {
        if let raw = UserDefaults.standard.string(forKey: key), let url = normalized(raw) { return url }
        return defaultOrigin
    }

    static func setOrigin(_ raw: String) -> Bool {
        guard let url = normalized(raw) else { return false }
        UserDefaults.standard.set(url.absoluteString, forKey: key)
        return true
    }

    static func normalized(_ raw: String) -> URL? {
        guard var components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty else { return nil }
        components.scheme = "https"
        components.host = host.lowercased()
        if components.port == 443 { components.port = nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }

    /// `Origin` header value: scheme://host[:port] with no trailing slash.
    static func originHeader(for url: URL) -> String {
        var value = "https://\(url.host ?? "")"
        if let port = url.port { value += ":\(port)" }
        return value
    }
}

/// Session token storage in the Keychain, bound to one origin and never synced.
final class SessionTokenStore: @unchecked Sendable {
    private let service = "com.batteryinventory.session"
    private let lock = NSLock()
    private var cached: (token: String, expires: Date)?
    private var loaded = false

    private struct Stored: Codable { let token: String; let expires: Date; let origin: String }

    func token(for origin: URL) -> String? {
        lock.lock(); defer { lock.unlock() }
        if !loaded { cached = read(origin: origin); loaded = true }
        guard let value = cached, value.expires > Date() else { return nil }
        return value.token
    }

    func save(_ token: String, expires: Date, origin: URL) {
        lock.lock(); defer { lock.unlock() }
        cached = (token, expires)
        loaded = true
        let stored = Stored(token: token, expires: expires, origin: origin.absoluteString)
        guard let data = try? JSONEncoder().encode(stored) else { return }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: origin.absoluteString]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    func clear(origin: URL) {
        lock.lock(); defer { lock.unlock() }
        cached = nil
        loaded = true
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: origin.absoluteString]
        SecItemDelete(query as CFDictionary)
    }

    private func read(origin: URL) -> (String, Date)? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: origin.absoluteString,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let stored = try? JSONDecoder().decode(Stored.self, from: data),
              stored.origin == origin.absoluteString else { return nil }
        return (stored.token, stored.expires)
    }
}

/// HTTPS client for the inventory API. Cookies are handled manually; redirects are refused.
final class APIClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let origin: URL
    let tokens: SessionTokenStore
    private var session: URLSession!

    static let sessionCookie = "inventory_session"
    static let maxSessionSeconds: TimeInterval = 8 * 60 * 60

    init(origin: URL = ServerConfig.origin, tokens: SessionTokenStore = SessionTokenStore()) {
        self.origin = origin
        self.tokens = tokens
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 40
        config.waitsForConnectivity = false
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    var hasSession: Bool { tokens.token(for: origin) != nil }

    // MARK: Requests

    func get(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    func post(_ path: String, body: Data) async throws -> Data {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.path = path
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(ServerConfig.originHeader(for: origin), forHTTPHeaderField: "Origin")
        return try await send(request)
    }

    func post<Body: Encodable>(_ path: String, json: Body) async throws -> Data {
        try await post(path, body: try JSONEncoder().encode(json))
    }

    private func send(_ original: URLRequest) async throws -> Data {
        var request = original
        if let token = tokens.token(for: origin) {
            request.setValue("\(Self.sessionCookie)=\(token)", forHTTPHeaderField: "Cookie")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIFailure(kind: .uncertain, status: nil,
                             message: "Couldn't reach the server. Check your connection and try again.", code: nil)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIFailure(kind: .uncertain, status: nil, message: "The server sent an unreadable response.", code: nil)
        }
        absorbCookies(http)
        let status = http.statusCode
        if (200..<300).contains(status) { return data }
        let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
        let message = envelope?.error ?? HTTPURLResponse.localizedString(forStatusCode: status).capitalized
        switch status {
        case 401:
            tokens.clear(origin: origin)
            throw APIFailure(kind: .unauthorized, status: status, message: "Please sign in again.", code: envelope?.code)
        case 300..<400:
            throw APIFailure(kind: .uncertain, status: status, message: "The server redirected the request. It was not followed.", code: nil)
        case 400..<500:
            throw APIFailure(kind: .rejected, status: status, message: message, code: envelope?.code)
        default:
            throw APIFailure(kind: .uncertain, status: status, message: "The server couldn't finish this. Your work is kept — try again.", code: envelope?.code)
        }
    }

    /// Accept only a well-formed session cookie from the configured HTTPS origin.
    private func absorbCookies(_ response: HTTPURLResponse) {
        guard let url = response.url, url.host?.lowercased() == origin.host?.lowercased() else { return }
        var fields: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            if let k = key as? String, let v = value as? String { fields[k] = v }
        }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url).filter { $0.name == Self.sessionCookie }
        guard let cookie = cookies.last else { return }
        let expired = cookie.expiresDate.map { $0 <= Date() } ?? false
        if cookie.value.isEmpty || expired {
            tokens.clear(origin: origin)
            return
        }
        guard cookies.count == 1, cookie.isSecure, cookie.isHTTPOnly, cookie.path == "/",
              cookie.value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            tokens.clear(origin: origin)
            return
        }
        let limit = Date().addingTimeInterval(Self.maxSessionSeconds)
        tokens.save(cookie.value, expires: min(cookie.expiresDate ?? limit, limit), origin: origin)
    }

    // MARK: URLSessionTaskDelegate

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? {
        nil
    }
}

extension JSONDecoder {
    static let api = JSONDecoder()
}

extension Data {
    func decoded<T: Decodable>(_ type: T.Type) throws -> T {
        do {
            return try JSONDecoder.api.decode(T.self, from: self)
        } catch {
            throw APIFailure(kind: .invalidResponse, status: 200, message: "The server's answer couldn't be read.", code: nil)
        }
    }
}
