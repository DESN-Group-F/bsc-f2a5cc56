import Foundation

struct ServiceFailure: Error {
    let message: String
    let code: String
}

enum ServicePolicy {
    static let cookieName = "inventory_session"
    static let sessionSeconds: TimeInterval = 8 * 60 * 60
    static let maxResponseBytes = 32 * 1024 * 1024
    static let routes: Set<String> = [
        "/api/session", "/api/inventory", "/api/accounts", "/api/battery-models",
        "/api/teaching-groups", "/api/task-plans", "/api/messages", "/api/export"
    ]
    struct CookieUpdate {
        let present: Bool
        let token: String?
        let expiresAt: TimeInterval
    }
    static func origin(_ input: String?) throws -> String {
        guard let input = input, let components = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https", let host = components.host, !host.isEmpty,
              host.range(of: "^[A-Za-z0-9.\\-:\\[\\]]+$", options: .regularExpression) != nil,
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/",
              components.port == nil || (1...65535).contains(components.port!) else {
            throw ServiceFailure(message: "Enter a trusted HTTPS origin without a path, query, fragment or credentials.", code: "INVALID_ORIGIN")
        }
        var normalized = URLComponents()
        normalized.scheme = "https"
        normalized.host = host.lowercased()
        normalized.port = components.port == 443 ? nil : components.port
        guard let value = normalized.string, normalized.url != nil else {
            throw ServiceFailure(message: "The HTTPS service origin is invalid.", code: "INVALID_ORIGIN")
        }
        return value
    }
    static func requestURL(origin: String, path: String?) throws -> URL {
        guard let path = path, path.count <= 24000, path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("\\"),
              let relative = URLComponents(string: path), relative.scheme == nil, relative.host == nil, relative.fragment == nil,
              relative.percentEncodedPath == relative.path, routes.contains(relative.path),
              let url = URL(string: origin + path), url.absoluteString.hasPrefix(origin + "/") else {
            throw ServiceFailure(message: "Use an allowed inventory API path and query only.", code: "INVALID_PATH")
        }
        return url
    }
    static func request(path: String, method: String?, body: String?, headers: [String: String]) throws {
        guard method == "GET" || method == "POST" else { throw ServiceFailure(message: "Only GET and POST are supported.", code: "INVALID_METHOD") }
        guard method != "GET" || body == nil else { throw ServiceFailure(message: "GET requests cannot contain a body.", code: "INVALID_BODY") }
        let limit = path == "/api/session" ? 5000 : path == "/api/export" ? 15000 : 250000
        guard (body?.utf8.count ?? 0) <= limit else { throw ServiceFailure(message: "This request exceeds its API size limit. Nothing was sent.", code: "REQUEST_TOO_LARGE") }
        var seen = Set<String>()
        for (name, value) in headers {
            let key = name.lowercased()
            guard seen.insert(key).inserted, key == "content-type" || key == "accept", value.count <= 256,
                  !value.isEmpty, value.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else {
                throw ServiceFailure(message: "Only safe Content-Type and Accept headers are allowed.", code: "INVALID_HEADERS")
            }
            if key == "content-type" && value.lowercased().range(of: "^application/json(?:;\\s*charset=utf-8)?$", options: .regularExpression) == nil {
                throw ServiceFailure(message: "Send request bodies as application/json.", code: "INVALID_HEADERS")
            }
        }
    }
    static func splitCookies(_ header: String) -> [String] {
        // A comma within an RFC expiry is not the beginning of another cookie.
        let regex = try! NSRegularExpression(pattern: ",\\s*(?=[A-Za-z0-9_\\-]+=)")
        let raw = header as NSString
        let matches = regex.matches(in: header, range: NSRange(location: 0, length: raw.length))
        var offset = 0, output: [String] = []
        for match in matches { output.append(raw.substring(with: NSRange(location: offset, length: match.range.location - offset))); offset = NSMaxRange(match.range) }
        output.append(raw.substring(from: offset))
        return output
    }
    static func cookie(_ headers: [String], now: TimeInterval) throws -> CookieUpdate {
        var result = CookieUpdate(present: false, token: nil, expiresAt: 0)
        for raw in headers.flatMap({ splitCookies($0) }) {
            let parts = raw.components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) }
            guard let first = parts.first, first.hasPrefix(cookieName + "=") else { continue }
            guard !result.present else { throw ServiceFailure(message: "The service returned conflicting session cookies. Sign in again.", code: "SESSION_COOKIE_INVALID") }
            let token = String(first.dropFirst(cookieName.count + 1))
            var attributes: [String: String] = [:]
            for part in parts.dropFirst() where !part.isEmpty {
                let pieces = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                let key = pieces[0].lowercased(), value = pieces.count == 2 ? String(pieces[1]) : ""
                guard attributes[key] == nil else { throw ServiceFailure(message: "The service returned an invalid session cookie. Sign in again.", code: "SESSION_COOKIE_INVALID") }
                attributes[key] = value
            }
            guard attributes["httponly"] != nil, attributes["secure"] != nil, attributes["path"] == "/", attributes["domain"] == nil else {
                throw ServiceFailure(message: "The service did not return a secure host-only session cookie.", code: "SESSION_COOKIE_INVALID")
            }
            var expiresAt = now + sessionSeconds
            if let age = attributes["max-age"] {
                guard let seconds = Int64(age) else { throw ServiceFailure(message: "The service returned an invalid session expiry. Sign in again.", code: "SESSION_COOKIE_INVALID") }
                expiresAt = seconds <= 0 ? now : now + min(TimeInterval(seconds), sessionSeconds)
            } else if let expiry = attributes["expires"] {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.calendar = Calendar(identifier: .gregorian)
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
                formatter.isLenient = false
                guard let date = formatter.date(from: expiry) else { throw ServiceFailure(message: "The service returned an invalid session expiry. Sign in again.", code: "SESSION_COOKIE_INVALID") }
                expiresAt = min(expiresAt, date.timeIntervalSince1970)
            } else { throw ServiceFailure(message: "The service returned an invalid session expiry. Sign in again.", code: "SESSION_COOKIE_INVALID") }
            if token.isEmpty || expiresAt <= now { result = CookieUpdate(present: true, token: nil, expiresAt: 0) }
            else {
                guard token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw ServiceFailure(message: "The service returned an invalid session cookie. Sign in again.", code: "SESSION_COOKIE_INVALID") }
                result = CookieUpdate(present: true, token: token, expiresAt: expiresAt)
            }
        }
        return result
    }
    static func textContent(_ contentType: String?) -> Bool {
        let type = (contentType ?? "").lowercased().components(separatedBy: ";")[0].trimmingCharacters(in: .whitespaces)
        return type.hasPrefix("text/") || type == "application/json" || type.hasSuffix("+json")
    }
}
