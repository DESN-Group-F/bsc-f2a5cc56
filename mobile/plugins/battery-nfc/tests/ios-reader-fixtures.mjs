// Controlled API doubles for executing the production Swift reader state machine.
// They do not model Apple's RF transport, UI, system timeout or SDK availability.
export const iosReaderFixtures = String.raw`
import Foundation
import CoreFoundation

public protocol CAPBridgedPlugin {}
public class CAPPlugin: NSObject { public func load() {} }
public let CAPPluginReturnPromise = "promise"
public struct CAPPluginMethod {
    public init(name: String, returnType: String) {}
}
public class CAPPluginCall {
    public var options: [String: Any]
    var results: [[String: Any]] = []
    var errors: [(String, String)] = []
    var errorData: [[String: Any]?] = []
    public init(_ options: [String: Any] = [:]) { self.options = options }
    public func resolve(_ result: [String: Any] = [:]) { results.append(result) }
    public func reject(_ message: String, _ code: String, _ error: Error? = nil, _ data: [String: Any]? = nil) {
        errors.append((message, code)); errorData.append(data)
    }
}
public class FixtureBundle {
    public static let main = FixtureBundle()
    public func object(forInfoDictionaryKey key: String) -> Any? { "Read battery NFC tags." }
}
public class UIApplication {
    public enum State { case active, background }
    public static let shared = UIApplication()
    public static let didEnterBackgroundNotification = Notification.Name("FixtureBackground")
    public var applicationState: State = .active
}
public enum NFCMiFareFamily { case ultralight, plus, desfire, unknown }
public enum NFCNDEFStatus { case notSupported, readOnly, readWrite }
public struct NFCTypeNameFormat { public let rawValue: UInt8 }
public struct NFCNDEFPayload {
    public var typeNameFormat = NFCTypeNameFormat(rawValue: 1)
    public var type = Data([0x54])
    public var identifier = Data()
    public var payload = Data([0x00, 0x41])
}
public struct NFCNDEFMessage { public var records: [NFCNDEFPayload] }
public struct NFCReaderError: Error {
    public enum Code {
        case ndefReaderSessionErrorZeroLengthMessage
        case readerSessionInvalidationErrorUserCanceled
        case readerSessionInvalidationErrorSessionTimeout
        case readerSessionInvalidationErrorSystemIsBusy
        case other
    }
    public let code: Code
}
public class FixtureMiFareTag {
    public var identifier: Data
    public var mifareFamily: NFCMiFareFamily = .ultralight
    public var isAvailable = true
    public var statusCallbacks: [(NFCNDEFStatus, Int, Error?) -> Void] = []
    public var ndefCallbacks: [(NFCNDEFMessage?, Error?) -> Void] = []
    public init(_ bytes: [UInt8]) { identifier = Data(bytes) }
    public func queryNDEFStatus(completionHandler: @escaping (NFCNDEFStatus, Int, Error?) -> Void) {
        statusCallbacks.append(completionHandler)
    }
    public func readNDEF(completionHandler: @escaping (NFCNDEFMessage?, Error?) -> Void) {
        ndefCallbacks.append(completionHandler)
    }
}
public enum NFCTag {
    case miFare(FixtureMiFareTag)
    case unsupported
    public var isAvailable: Bool {
        if case let .miFare(tag) = self { return tag.isAvailable }
        return true
    }
}
public protocol NFCTagReaderSessionDelegate: AnyObject {
    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession)
    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag])
    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error)
}
public class NFCTagReaderSession {
    public enum PollingOption { case iso14443 }
    public static var readingAvailable = true
    public static var instances: [NFCTagReaderSession] = []
    public weak var delegate: NFCTagReaderSessionDelegate?
    public var alertMessage = ""
    public var beginCount = 0
    public var restartCount = 0
    public var invalidateCount = 0
    public var connectCallbacks: [(Error?) -> Void] = []
    public init?(pollingOption: PollingOption, delegate: NFCTagReaderSessionDelegate, queue: DispatchQueue?) {
        self.delegate = delegate
        Self.instances.append(self)
    }
    public func begin() { beginCount += 1 }
    public func invalidate() { invalidateCount += 1 }
    public func restartPolling() { restartCount += 1 }
    public func connect(to tag: NFCTag, completionHandler: @escaping (Error?) -> Void) {
        connectCallbacks.append(completionHandler)
    }
    public func emit(_ tag: FixtureMiFareTag) { delegate?.tagReaderSession(self, didDetect: [.miFare(tag)]) }
    public func end(_ code: NFCReaderError.Code) {
        delegate?.tagReaderSession(self, didInvalidateWithError: NFCReaderError(code: code))
    }
}
`;

export const iosReaderHarness = String.raw`
struct HarnessFailure: Error { let message: String }
@main struct ReaderHarness {
    static var assertions = 0
    static func check(_ condition: Bool, _ label: String) throws {
        if !condition { throw HarnessFailure(message: label) }
        assertions += 1
    }
    static func pump(_ seconds: Double = 0.012) {
        RunLoop.main.run(until: Date().addingTimeInterval(seconds))
    }
    static func read(_ plugin: BatteryNfcPlugin, _ options: [String: Any] = [:]) -> CAPPluginCall {
        let call = CAPPluginCall(options)
        plugin.read(call)
        pump()
        return call
    }
    static func cancel(_ plugin: BatteryNfcPlugin) { plugin.cancel(CAPPluginCall()); pump() }
    static func finishTag(_ session: NFCTagReaderSession, _ tag: FixtureMiFareTag, blank: Bool = false) {
        session.emit(tag)
        session.connectCallbacks.last!(nil); pump()
        tag.statusCallbacks.last!(.readWrite, 137, nil); pump()
        tag.ndefCallbacks.last!(blank ? nil : NFCNDEFMessage(records: [NFCNDEFPayload()]),
            blank ? NFCReaderError(code: .ndefReaderSessionErrorZeroLengthMessage) : nil)
        pump()
    }
    static func token(_ call: CAPPluginCall) throws -> String {
        guard let id = call.results.first?["readerSessionId"] as? String else {
            throw HarnessFailure(message: "Expected a continuous session token")
        }
        return id
    }
    static func run() throws {
        let plugin = BatteryNfcPlugin()
        plugin.load()
        let first = read(plugin, ["keepSessionAlive": true])
        let session = NFCTagReaderSession.instances.last!
        let tag1 = FixtureMiFareTag([0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06])
        finishTag(session, tag1, blank: true)
        let id = try token(first)
        try check(first.results.count == 1 && first.errors.isEmpty, "First read resolves exactly once")
        try check(first.results[0]["uidHex"] as? String == "04010203040506", "Leading zero and byte order retained")
        try check((first.results[0]["records"] as? [[String: Any]])?.isEmpty == true, "Blank NDEF remains a successful empty message")
        try check(session.beginCount == 1 && session.invalidateCount == 0, "Successful kept read keeps its physical session")
        let count = NFCTagReaderSession.instances.count
        let unsolicited = FixtureMiFareTag([0x04, 0x99])
        session.emit(unsolicited)
        try check(unsolicited.statusCallbacks.isEmpty && session.connectCallbacks.count == 1, "Idle session ignores unsolicited detections")
        try check(read(plugin).errors.first?.1 == "BUSY", "Fresh start cannot replace an idle retained session")
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": "stale"]).errors.first?.1 == "SESSION_ENDED", "Stale token fails closed")
        try check(read(plugin, ["sessionId": id]).errors.first?.1 == "INVALID_ARGUMENT", "Continuation requires opt-in")
        try check(read(plugin, ["keepSessionAlive": 1]).errors.first?.1 == "INVALID_ARGUMENT", "Numeric keep-alive option rejected")

        let second = read(plugin, ["keepSessionAlive": true, "sessionId": id])
        pump(0.23)
        session.emit(tag1)
        try check(session.restartCount == 0 && second.results.isEmpty && second.errors.isEmpty, "Held tag does not complete the next read")
        try check(session.alertMessage.contains("1 read"), "System text reports read count")
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": id]).errors.first?.1 == "BUSY", "Only one pending read owns a session")
        tag1.isAvailable = false
        pump(0.23)
        try check(session.restartCount == 1 && NFCTagReaderSession.instances.count == count, "Actual unavailability restarts polling in the same session")
        session.emit(tag1)
        try check(session.connectCallbacks.count == 1, "Invalidated tag detection is ignored")
        session.connectCallbacks[0](NFCReaderError(code: .other)); pump()
        tag1.statusCallbacks[0](.readOnly, 12, NFCReaderError(code: .other)); pump()
        tag1.ndefCallbacks[0](nil, NFCReaderError(code: .other)); pump()
        try check(second.results.isEmpty && second.errors.isEmpty && session.invalidateCount == 0, "Prior-read callbacks cannot settle a later read in the same session")
        let tag2 = FixtureMiFareTag([0x04, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16])
        finishTag(session, tag2)
        try check(try token(second) == id, "Continuation returns the same token")
        try check(second.results[0]["uidHex"] as? String == "04111213141516", "Next tag evidence remains distinct")
        try check((second.results[0]["records"] as? [[String: Any]])?.first?["payloadHex"] as? String == "0041", "Raw NDEF payload retained")

        session.end(.readerSessionInvalidationErrorUserCanceled)
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": id]).errors.first?.1 == "CANCELLED", "System cancellation between reads is retained")
        try check(NFCTagReaderSession.instances.count == count, "Cancelled continuation never creates a sheet")

        let defaultCall = read(plugin)
        let defaultSession = NFCTagReaderSession.instances.last!
        session.end(.readerSessionInvalidationErrorSessionTimeout)
        finishTag(defaultSession, FixtureMiFareTag([0x01, 0x02, 0x03, 0x04]))
        try check(defaultCall.results.count == 1 && defaultSession.invalidateCount == 1, "Default diagnostics remain a single read")
        try check(defaultCall.results[0]["readerSessionId"] == nil, "Default result has no continuous token")

        let unavailableDetection = read(plugin)
        let unavailableSession = NFCTagReaderSession.instances.last!
        let unavailableTag = FixtureMiFareTag([0x01, 0x02, 0x03, 0x04])
        unavailableTag.isAvailable = false
        finishTag(unavailableSession, unavailableTag)
        try check(unavailableSession.connectCallbacks.count == 1 && unavailableDetection.errors.isEmpty, "A newly detected tag is connected instead of rejected by an availability snapshot")
        try check(unavailableDetection.results.first?["uidHex"] as? String == "01020304", "Successful connection retains the already detected UID")
        try check(unavailableDetection.results.first?["ndefError"] == nil && unavailableSession.invalidateCount == 1, "Actual NDEF completion, not availability, determines the result")

        let immediateLoss = read(plugin)
        let lostSession = NFCTagReaderSession.instances.last!
        let lostTag = FixtureMiFareTag([0x01, 0x02, 0x03, 0x05])
        lostTag.isAvailable = false
        lostSession.emit(lostTag)
        try check(immediateLoss.results.isEmpty && immediateLoss.errors.isEmpty && lostSession.connectCallbacks.count == 1, "Connection result is awaited before classifying a detected tag")
        lostSession.connectCallbacks[0](NSError(domain: "NFCFixture", code: 100, userInfo: [NSLocalizedDescriptionKey: "The tag connection was lost."])); pump()
        try check(immediateLoss.results.first?["uidHex"] as? String == "01020305", "Real connection failure does not erase the UID already observed")
        try check((immediateLoss.results.first?["ndefError"] as? String)?.contains("TAG_CONNECTION: NFCFixture 100") == true, "Real connection failure remains explicit, not a complete NDEF success")
        try check(lostTag.statusCallbacks.isEmpty && lostSession.invalidateCount == 1, "Connection failure closes the session without attempting NDEF")

        let lossSeed = read(plugin, ["keepSessionAlive": true])
        let lossSession = NFCTagReaderSession.instances.last!
        let previousTag = FixtureMiFareTag([0x01, 0x02, 0x03, 0x04])
        finishTag(lossSession, previousTag)
        let lossID = try token(lossSeed)
        previousTag.isAvailable = false
        let lostContinuation = read(plugin, ["keepSessionAlive": true, "sessionId": lossID])
        previousTag.isAvailable = true
        lossSession.emit(previousTag)
        try check(lostContinuation.errors.isEmpty && lossSession.invalidateCount == 0 && lossSession.connectCallbacks.count == 1, "Retired object callbacks remain stale even when their availability value is true")
        let lostNextTag = FixtureMiFareTag([0x01, 0x02, 0x03, 0x05])
        lostNextTag.isAvailable = false
        lossSession.emit(lostNextTag)
        try check(lossSession.connectCallbacks.count == 2, "A new unavailable tag is not mistaken for the retired tag")
        lossSession.connectCallbacks[1](NSError(domain: "NFCFixture", code: 100)); pump()
        try check(lostContinuation.results.first?["uidHex"] as? String == "01020305", "Current-generation connection failure retains only that generation's UID")
        try check((lostContinuation.results.first?["ndefError"] as? String)?.hasPrefix("TAG_CONNECTION:") == true, "Continuous connection failure is retained with the partial UID")
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": lossID]).errors.first?.1 == "TAG_CONNECTION", "Actual connection failure remains terminal for the session token")

        for stage in ["status", "message"] {
            let optionalFailure = read(plugin)
            let optionalSession = NFCTagReaderSession.instances.last!
            let optionalTag = FixtureMiFareTag([0x00, 0x02, 0x03, 0x04])
            optionalSession.emit(optionalTag)
            optionalSession.connectCallbacks[0](nil); pump()
            if stage == "status" {
                optionalTag.statusCallbacks[0](.notSupported, -1, NSError(domain: "NFCFixture", code: 100)); pump()
            } else {
                optionalTag.statusCallbacks[0](.readWrite, 137, nil); pump()
                optionalTag.ndefCallbacks[0](nil, NSError(domain: "NFCFixture", code: 100)); pump()
            }
            let expected = stage == "status" ? "NDEF_STATUS:" : "NDEF_READ:"
            try check(optionalFailure.results.first?["uidHex"] as? String == "00020304", "NDEF failure preserves leading-zero UID evidence")
            try check((optionalFailure.results.first?["ndefError"] as? String)?.hasPrefix(expected) == true, "NDEF failure preserves its actual operation stage")
            try check((optionalFailure.results.first?["records"] as? [[String: Any]])?.isEmpty == true && optionalSession.invalidateCount == 1, "Failed NDEF invents no records and ends the physical session")
        }

        let unsupportedNdef = read(plugin)
        let unsupportedSession = NFCTagReaderSession.instances.last!
        let unsupportedTag = FixtureMiFareTag([0x01, 0x02, 0x03, 0x04])
        unsupportedSession.emit(unsupportedTag)
        unsupportedSession.connectCallbacks[0](nil); pump()
        unsupportedTag.statusCallbacks[0](.notSupported, 0, nil); pump()
        try check(unsupportedNdef.results.first?["ndefStatus"] as? String == "notSupported" && unsupportedNdef.results.first?["ndefError"] == nil, "NDEF unsupported is distinct from a failed NDEF operation")
        try check(unsupportedTag.ndefCallbacks.isEmpty && unsupportedNdef.results.first?["capacityBytes"] is NSNull, "Unsupported NDEF does not invent capacity or request a message")

        for interruption in ["system", "cancel", "background"] {
            let interrupted = read(plugin, ["keepSessionAlive": true])
            let interruptedSession = NFCTagReaderSession.instances.last!
            let interruptedTag = FixtureMiFareTag([0x00, 0x02, 0x03, 0x06])
            interruptedSession.emit(interruptedTag)
            if interruption == "system" {
                interruptedSession.end(.readerSessionInvalidationErrorUserCanceled)
            } else if interruption == "cancel" {
                cancel(plugin)
            } else {
                UIApplication.shared.applicationState = .background
                NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
                UIApplication.shared.applicationState = .active
            }
            let code = interruption == "background" ? "BACKGROUND" : "CANCELLED"
            let progress = interrupted.errorData.first.flatMap { $0 }?["partialResult"] as? [String: Any]
            try check(interrupted.results.isEmpty && interrupted.errors.first?.1 == code, "Interruption remains a rejected read, never an adoptable success")
            try check(progress?["uidHex"] as? String == "00020306" && (progress?["ndefError"] as? String)?.hasPrefix(code + ":") == true, "Interrupted read retains detected evidence separately with its terminal reason")
            try check(progress?["readerSessionId"] == nil, "Rejected partial evidence has no continuation capability")
            interruptedSession.connectCallbacks[0](nil); pump()
            try check(interruptedTag.statusCallbacks.isEmpty && interrupted.results.isEmpty && interrupted.errors.count == 1, "Late connection callback cannot revive or replace rejected evidence")
        }

        let noDetection = read(plugin)
        cancel(plugin)
        try check(noDetection.errors.first?.1 == "CANCELLED" && noDetection.errorData.first.flatMap({ $0 }) == nil, "Cancellation before detection does not invent partial evidence")

        let heldRead = read(plugin, ["keepSessionAlive": true])
        let heldSession = NFCTagReaderSession.instances.last!
        finishTag(heldSession, FixtureMiFareTag([0x01, 0x02, 0x03, 0x04]))
        let heldID = try token(heldRead)
        let timeoutRead = read(plugin, ["keepSessionAlive": true, "sessionId": heldID, "timeoutMs": 1000])
        pump(1.05)
        try check(timeoutRead.errors.first?.1 == "TIMEOUT" && heldSession.restartCount == 0, "Removal wait times out without inventing a new presentation")
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": heldID]).errors.first?.1 == "TIMEOUT", "Timeout terminal reason retained")

        let partial = read(plugin, ["keepSessionAlive": true, "timeoutMs": 1000])
        let partialSession = NFCTagReaderSession.instances.last!
        partialSession.emit(FixtureMiFareTag([0x01, 0x02, 0x03, 0x04]))
        pump(1.05)
        let partialID = try token(partial)
        try check(partial.results[0]["ndefError"] as? String == "TIMEOUT: The NFC read timed out.", "Partial UID timeout remains explicit evidence")
        try check(partialSession.invalidateCount == 1, "Partial UID error ends the physical session")
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": partialID]).errors.first?.1 == "TIMEOUT", "Partial-result token cannot silently reopen")

        let foreground = read(plugin, ["keepSessionAlive": true])
        let foregroundSession = NFCTagReaderSession.instances.last!
        finishTag(foregroundSession, FixtureMiFareTag([0x01, 0x02, 0x03, 0x04]))
        let foregroundID = try token(foreground)
        UIApplication.shared.applicationState = .background
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        UIApplication.shared.applicationState = .active
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": foregroundID]).errors.first?.1 == "BACKGROUND", "Backgrounding an idle session is terminal")

        var oldestID = ""
        for index in 0..<17 {
            let call = read(plugin, ["keepSessionAlive": true])
            let current = NFCTagReaderSession.instances.last!
            finishTag(current, FixtureMiFareTag([0x01, 0x02, 0x03, UInt8(index)]))
            let currentID = try token(call)
            if index == 0 { oldestID = currentID }
            cancel(plugin)
            try check(read(plugin, ["keepSessionAlive": true, "sessionId": currentID]).errors.first?.1 == "CANCELLED", "Explicit cancellation closes idle session")
        }
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": oldestID]).errors.first?.1 == "SESSION_ENDED", "Terminal history is bounded and evicted tokens still fail closed")
        let systemTimeout = read(plugin, ["keepSessionAlive": true])
        let timedSession = NFCTagReaderSession.instances.last!
        finishTag(timedSession, FixtureMiFareTag([0x01, 0x02, 0x03, 0x04]))
        let timedID = try token(systemTimeout)
        timedSession.end(.readerSessionInvalidationErrorSessionTimeout)
        try check(read(plugin, ["keepSessionAlive": true, "sessionId": timedID]).errors.first?.1 == "TIMEOUT", "System expiry between reads is retained")
        cancel(plugin)
        print("Passed \(assertions) controlled iOS reader assertions")
    }
    static func main() {
        do { try run() }
        catch { fputs("Reader harness failed: \(error)\n", stderr); exit(1) }
    }
}
`;
