import Capacitor
import Foundation

@objc(BatteryServicePlugin)
public class BatteryServicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BatteryServicePlugin"
    public let jsName = "BatteryService"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConfiguration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadBusinessData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBusinessData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "battery.inventory.service")
    private let sessions = SecureSessionStore()
    private let originKey = "battery.service.origin.v1"

    private func execute(_ call: CAPPluginCall, _ action: @escaping () throws -> Void) {
        queue.async {
            do { try action() }
            catch let failure as ServiceFailure { call.reject(failure.message, failure.code) }
            catch { call.reject("Native service processing failed. Preserve pending work before retrying.", "NATIVE_SERVICE_FAILURE") }
        }
    }
    private func configurationResult() -> [String: Any] {
        if let origin = UserDefaults.standard.string(forKey: originKey) { return ["origin": origin] }
        return ["origin": NSNull()]
    }
    @objc public func getConfiguration(_ call: CAPPluginCall) { execute(call) { call.resolve(self.configurationResult()) } }
    @objc public func configure(_ call: CAPPluginCall) {
        execute(call) {
            let origin = try ServicePolicy.origin(call.getString("origin"))
            if let session = try self.sessions.load(now: Date().timeIntervalSince1970), session.origin != origin {
                throw ServiceFailure(message: "Sign out before changing the service origin. Preserve pending work first.", code: "SESSION_EXISTS")
            }
            UserDefaults.standard.set(origin, forKey: self.originKey)
            guard UserDefaults.standard.string(forKey: self.originKey) == origin else { throw ServiceFailure(message: "Service configuration could not be saved.", code: "CONFIGURATION_STORAGE") }
            call.resolve(self.configurationResult())
        }
    }
    @objc public func clearSession(_ call: CAPPluginCall) { execute(call) { try self.sessions.clear(); call.resolve() } }
    private func businessData() throws -> BusinessDataStore {
        let configured = UserDefaults.standard.string(forKey: originKey)
        let scope: String
        if let configured = configured, !configured.isEmpty { scope = try ServicePolicy.origin(configured) }
        else { scope = "unconfigured" }
        return try BusinessDataStore(scope: scope)
    }
    @objc public func loadBusinessData(_ call: CAPPluginCall) {
        execute(call) {
            if let data = try self.businessData().load() { call.resolve(["data": data]) }
            else { call.resolve(["data": NSNull()]) }
        }
    }
    @objc public func saveBusinessData(_ call: CAPPluginCall) {
        execute(call) {
            guard let data = call.getString("data") else { throw ServiceFailure(message: "Provide the complete business envelope as a string.", code: "INVALID_BUSINESS_DATA") }
            try self.businessData().save(data)
            call.resolve()
        }
    }
    @objc public func request(_ call: CAPPluginCall) {
        execute(call) {
            guard let savedOrigin = UserDefaults.standard.string(forKey: self.originKey) else { throw ServiceFailure(message: "Configure the trusted HTTPS service origin first.", code: "CONFIGURATION") }
            let origin = try ServicePolicy.origin(savedOrigin)
            let url = try ServicePolicy.requestURL(origin: origin, path: call.getString("path"))
            let method = call.getString("method"), body = call.getString("body")
            if call.options["body"] != nil && !(call.options["body"] is String) { throw ServiceFailure(message: "Provide request bodies as JSON strings.", code: "INVALID_BODY") }
            var headers: [String: String] = [:]
            if let raw = call.options["headers"] {
                guard let object = raw as? [String: Any] else { throw ServiceFailure(message: "Provide request headers as an object.", code: "INVALID_HEADERS") }
                for (name, value) in object {
                    guard let value = value as? String else { throw ServiceFailure(message: "Request header values must be strings.", code: "INVALID_HEADERS") }
                    headers[name] = value
                }
            }
            try ServicePolicy.request(path: url.path, method: method, body: body, headers: headers)
            let credential = try self.sessions.load(now: Date().timeIntervalSince1970)
            guard credential == nil || credential!.origin == origin else { throw ServiceFailure(message: "The saved session belongs to another service origin. Preserve work and explicitly reset it.", code: "SESSION_ORIGIN_MISMATCH") }
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            request.httpMethod = method!
            request.httpShouldHandleCookies = false
            request.httpBody = body?.data(using: .utf8)
            if method == "POST" { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
            if let credential = credential { request.setValue(ServicePolicy.cookieName + "=" + credential.token, forHTTPHeaderField: "Cookie") }
            let transfer = try ServiceTransfer().run(request)
            let response = transfer.response
            if (300..<400).contains(response.statusCode) { throw ServiceFailure(message: "The service returned a redirect. No redirect was followed; review the configured origin.", code: "REDIRECT_DENIED") }
            let rawCookies = response.allHeaderFields.compactMap { key, value -> String? in String(describing: key).lowercased() == "set-cookie" ? String(describing: value) : nil }
            let update: ServicePolicy.CookieUpdate
            do { update = try ServicePolicy.cookie(rawCookies, now: Date().timeIntervalSince1970) }
            catch { try self.sessions.clear(); throw error }
            if response.statusCode == 401 || update.present && update.token == nil { try self.sessions.clear() }
            else if let token = update.token, update.present { try self.sessions.save(ServiceSession(origin: origin, token: token, expiresAt: update.expiresAt)) }
            if url.path == "/api/session", method == "POST", (200..<300).contains(response.statusCode),
               let data = body?.data(using: .utf8), let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], object["action"] as? String == "signout" { try self.sessions.clear() }
            var allowed: [String: String] = [:]
            for name in ["content-type", "content-disposition"] {
                if let value = response.value(forHTTPHeaderField: name), value.count <= 2048, !value.contains("\r"), !value.contains("\n") { allowed[name] = value }
            }
            let text = ServicePolicy.textContent(allowed["content-type"]) ? String(data: transfer.bytes, encoding: .utf8) : nil
            call.resolve(["status": response.statusCode, "headers": allowed, "body": text ?? transfer.bytes.base64EncodedString(), "encoding": text == nil ? "base64" : "utf8"])
        }
    }
}
