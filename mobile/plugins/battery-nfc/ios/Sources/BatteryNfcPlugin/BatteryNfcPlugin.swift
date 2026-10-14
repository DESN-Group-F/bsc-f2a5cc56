import Capacitor
import CoreFoundation
import CoreNFC
import Foundation
import UIKit

@objc(BatteryNfcPlugin)
public class BatteryNfcPlugin: CAPPlugin, CAPBridgedPlugin, NFCTagReaderSessionDelegate {
    public let identifier = "BatteryNfcPlugin"
    public let jsName = "BatteryNfc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    // The delegate and all state run on the main queue. A physical reader session
    // can own several explicitly requested reads; every read has its own identity.
    private var readerSession: NFCTagReaderSession?
    private var readerSessionID: String?
    private var readGeneration: UUID?
    private var pendingCall: CAPPluginCall?
    private var timeout: DispatchWorkItem?
    private var removalCheck: DispatchWorkItem?
    private var readingTag = false
    private var acceptingDetection = false
    private var keepSessionAlive = false
    private var retainedTag: NFCTag?
    private final class RetiredTagObject {
        weak var object: AnyObject?
        init(_ object: AnyObject) { self.object = object }
    }
    // Weak identity avoids retaining Core NFC resources after restartPolling.
    // Live identities are never evicted while the physical session continues.
    private var retiredTagObjects: [RetiredTagObject] = []
    private var readCount = 0
    private var partialResult: [String: Any]?
    private var backgroundObserver: NSObjectProtocol?
    private struct TerminalReason {
        let id: String
        let message: String
        let code: String
    }
    // Retain recent terminal reasons for continuation calls that arrive after a
    // cancellation/expiry between reads. Older tokens still fail closed.
    private var terminalSessions: [TerminalReason] = []

    public override func load() {
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.cancelPending(message: "NFC reading stopped because the app entered the background.", code: "BACKGROUND")
        }
    }

    deinit {
        if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
        timeout?.cancel()
        removalCheck?.cancel()
        readerSession?.invalidate()
    }

    @objc public func getAvailability(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let available = NFCTagReaderSession.readingAvailable
            var result: [String: Any] = ["available": available, "enabled": available, "platform": "ios"]
            if !available {
                result["reason"] = "Core NFC tag reading is unavailable on this device."
            } else {
                result["reason"] = "Device support is available; a signed app with NFC permission and a successful tag session is still required."
            }
            call.resolve(result)
        }
    }

    @objc public func read(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.reject("NFC plugin is no longer available.", "UNAVAILABLE"); return }
            var keepAlive = false
            if let raw = call.options["keepSessionAlive"] {
                guard let number = raw as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
                    call.reject("keepSessionAlive must be a boolean.", "INVALID_ARGUMENT"); return
                }
                keepAlive = number.boolValue
            }
            var continuationID: String?
            if let raw = call.options["sessionId"] {
                guard let value = raw as? String, !value.isEmpty, value.count <= 64, keepAlive else {
                    call.reject("sessionId requires keepSessionAlive and a non-empty session token.", "INVALID_ARGUMENT"); return
                }
                continuationID = value
            }
            if let id = continuationID {
                guard self.readerSessionID == id, self.readerSession != nil, self.keepSessionAlive else {
                    if let reason = self.terminalSessions.last(where: { $0.id == id }) {
                        call.reject(reason.message, reason.code)
                    } else {
                        call.reject("This NFC session has ended. Start a new scan explicitly.", "SESSION_ENDED")
                    }
                    return
                }
            } else if self.readerSession != nil {
                call.reject("An NFC session is already open. Continue or cancel it first.", "BUSY"); return
            }
            guard self.pendingCall == nil else {
                call.reject("An NFC read is already running. Finish or cancel it first.", "BUSY"); return
            }
            guard NFCTagReaderSession.readingAvailable else {
                call.reject("Core NFC tag reading is unavailable on this device.", "UNAVAILABLE"); return
            }
            // A system sheet may take focus while the app remains foreground
            // inactive. Only a validated, already-owned NFC session may continue
            // there; a fresh session still requires an active app. Actual
            // backgrounding and Core NFC invalidation remain terminal.
            let applicationState = UIApplication.shared.applicationState
            let continuingForegroundSession = continuationID != nil && applicationState == .inactive
            guard applicationState == .active || continuingForegroundSession else {
                self.cancelPending(message: "NFC reading stopped because the app entered the background.", code: "BACKGROUND")
                call.reject("Keep the app in the foreground to read a tag.", "BACKGROUND"); return
            }
            guard let usage = Bundle.main.object(forInfoDictionaryKey: "NFCReaderUsageDescription") as? String,
                  !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                call.reject("The app is missing its NFC usage description.", "CONFIGURATION"); return
            }
            var duration = 20_000.0
            if let raw = call.options["timeoutMs"] {
                guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                      number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
                      (1_000.0...60_000.0).contains(number.doubleValue) else {
                    call.reject("timeoutMs must be an integer from 1000 to 60000.", "INVALID_ARGUMENT"); return
                }
                duration = number.doubleValue
            }
            let session: NFCTagReaderSession
            if continuationID != nil, let existing = self.readerSession {
                session = existing
            } else {
                guard let created = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
                    call.reject("The NFC reader session could not be created.", "UNAVAILABLE"); return
                }
                session = created
                self.readerSession = session
                self.readerSessionID = UUID().uuidString
                self.keepSessionAlive = keepAlive
                self.readCount = 0
            }
            let generation = UUID()
            self.readGeneration = generation
            self.pendingCall = call
            self.readingTag = false
            self.acceptingDetection = continuationID == nil
            self.partialResult = nil
            let timeout = DispatchWorkItem { [weak self, weak session] in
                guard let self = self, let session = session, self.owns(session, generation) else { return }
                self.fail(session, message: "The NFC read timed out.", code: "TIMEOUT", preserveUid: true)
            }
            self.timeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + duration / 1_000, execute: timeout)
            if continuationID != nil {
                self.waitForRemoval(session, generation: generation)
            } else {
                session.alertMessage = "Hold the top of your iPhone near one battery NFC tag. This read does not change the tag."
                session.begin()
            }
        }
    }

    private func owns(_ session: NFCTagReaderSession, _ generation: UUID) -> Bool {
        readerSession === session && readGeneration == generation && pendingCall != nil
    }

    private func waitForRemoval(_ session: NFCTagReaderSession, generation: UUID) {
        guard owns(session, generation) else { return }
        // Do not restart polling while the previously read tag is available:
        // restartPolling invalidates old tag objects, which is not evidence of
        // physical removal. Check availability before discarding that reference.
        if let tag = retainedTag, tag.isAvailable {
            session.alertMessage = "\(readCount) read. Move this tag away before presenting the next tag."
            let check = DispatchWorkItem { [weak self, weak session] in
                guard let self = self, let session = session else { return }
                self.waitForRemoval(session, generation: generation)
            }
            removalCheck = check
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: check)
            return
        }
        removalCheck = nil
        if case let .miFare(tag)? = retainedTag {
            retiredTagObjects.removeAll { $0.object == nil }
            guard retiredTagObjects.count < 256 else {
                fail(session, message: "This NFC session has reached its reference limit. Saved reads are retained; start a new scan explicitly.", code: "SESSION_ENDED")
                return
            }
            retiredTagObjects.append(RetiredTagObject(tag))
        }
        retainedTag = nil
        acceptingDetection = true
        session.alertMessage = "\(readCount) read. Hold the top of your iPhone near the next battery NFC tag."
        session.restartPolling()
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.cancelPending(message: "NFC reading was cancelled.", code: "CANCELLED")
            call.resolve()
        }
    }

    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        // Capture ownership when Core NFC delivers this delegate event, not
        // in a later queued block which might belong to a subsequent read.
        guard let generation = readGeneration, owns(session, generation), acceptingDetection, !readingTag else { return }
        // Only retired object identities are stale callbacks. Availability is
        // a changing RF/session observation, not a substitute for connect's
        // result or a reason to discard an identifier Core NFC already detected.
        let currentTags = tags.filter { tag in
            guard case let .miFare(mifare) = tag else { return true }
            return !retiredTagObjects.contains { $0.object === (mifare as AnyObject) }
        }
        if !tags.isEmpty && currentTags.isEmpty { return }
        guard currentTags.count == 1, let tag = currentTags.first else {
            self.fail(session, message: "Present one tag at a time and start a new read.", code: "MULTIPLE_TAGS"); return
        }
        guard case let .miFare(mifare) = tag else {
            self.fail(session, message: "This diagnostic reader supports NFC-A MIFARE tags such as NTAG213.", code: "UNSUPPORTED_TAG"); return
        }
        guard !mifare.identifier.isEmpty else {
            self.fail(session, message: "The reader did not return a tag identifier.", code: "NO_UID"); return
        }
        self.readingTag = true
        self.acceptingDetection = false
        self.retainedTag = tag
        self.partialResult = [
            "uidHex": Self.hex(mifare.identifier),
            "technology": "NFC-A / ISO 14443 / \(Self.family(mifare.mifareFamily))",
            "ndefStatus": "unknown", "capacityBytes": NSNull(), "records": [[String: Any]](),
            "observedAt": ISO8601DateFormatter().string(from: Date())
        ]
        session.connect(to: tag) { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self, self.owns(session, generation) else { return }
                if let error = error {
                    self.fail(session, message: Self.errorText(error), code: "TAG_CONNECTION", preserveUid: true); return
                }
                mifare.queryNDEFStatus { [weak self] status, capacity, error in
                    DispatchQueue.main.async {
                        guard let self = self, self.owns(session, generation) else { return }
                        if let error = error {
                            self.fail(session, message: Self.errorText(error), code: "NDEF_STATUS", preserveUid: true); return
                        }
                        switch status {
                        case .notSupported:
                            self.partialResult?["ndefStatus"] = "notSupported"
                            self.completePartial(session); return
                        case .readOnly:
                            self.partialResult?["ndefStatus"] = "readOnly"
                        case .readWrite:
                            self.partialResult?["ndefStatus"] = "readWrite"
                        @unknown default:
                            self.partialResult?["ndefStatus"] = "unknown"
                        }
                        self.partialResult?["capacityBytes"] = capacity >= 0 ? capacity as Any : NSNull()
                        mifare.readNDEF { [weak self] message, error in
                            DispatchQueue.main.async {
                                guard let self = self, self.owns(session, generation) else { return }
                                if let error = error {
                                    // An initialized blank tag has no NDEF message; its UID is still real evidence.
                                    if let nfcError = error as? NFCReaderError,
                                       nfcError.code == .ndefReaderSessionErrorZeroLengthMessage {
                                        self.completePartial(session)
                                    } else {
                                        self.fail(session, message: Self.errorText(error), code: "NDEF_READ", preserveUid: true)
                                    }
                                    return
                                }
                                self.partialResult?["records"] = (message?.records ?? []).map { record in
                                    ["tnf": Int(record.typeNameFormat.rawValue), "typeHex": Self.hex(record.type),
                                     "idHex": Self.hex(record.identifier), "payloadHex": Self.hex(record.payload)] as [String: Any]
                                }
                                self.completePartial(session)
                            }
                        }
                    }
                }
            }
        }
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        // Invalidation owns the entire physical session, including an idle
        // interval or a newer read in that same session. It is not a delayed
        // result of the preceding read and must terminate the current owner.
        guard readerSession === session else { return }
        let nfcError = error as? NFCReaderError
        let cancelled = nfcError?.code == .readerSessionInvalidationErrorUserCanceled
        let code: String
        switch nfcError?.code {
        case .readerSessionInvalidationErrorUserCanceled: code = "CANCELLED"
        case .readerSessionInvalidationErrorSessionTimeout: code = "TIMEOUT"
        case .readerSessionInvalidationErrorSystemIsBusy: code = "BUSY"
        default: code = "NFC_SESSION"
        }
        self.fail(session, message: Self.errorText(error), code: code, preserveUid: !cancelled, invalidate: false)
    }

    private func cancelPending(message: String, code: String) {
        if let session = readerSession { fail(session, message: message, code: code) }
    }

    private func fail(_ session: NFCTagReaderSession, message: String, code: String, preserveUid: Bool = false, invalidate: Bool = true) {
        guard readerSession === session else { return }
        let id = keepSessionAlive ? readerSessionID : nil
        if let id = id {
            terminalSessions.append(TerminalReason(id: id, message: message, code: code))
            if terminalSessions.count > 16 { terminalSessions.removeFirst(terminalSessions.count - 16) }
        }
        if preserveUid, var result = partialResult {
            result["ndefError"] = "\(code): \(message)"
            if let id = id { result["readerSessionId"] = id }
            finish(session, result: result, invalidate: invalidate, retainSession: false)
        } else {
            // Cancellation/backgrounding must remain rejected reads. Retain
            // already detected evidence separately without making it adoptable.
            var data: [String: Any]?
            if var result = partialResult {
                result["ndefError"] = "\(code): \(message)"
                data = ["partialResult": result]
            }
            let call = clear(session)
            if invalidate { session.invalidate() }
            call?.reject(message, code, nil, data)
        }
    }

    private func completePartial(_ session: NFCTagReaderSession) {
        guard let result = partialResult else { return }
        finish(session, result: result)
    }

    private func finish(_ session: NFCTagReaderSession, result: [String: Any], invalidate: Bool = true, retainSession: Bool = true) {
        guard readerSession === session else { return }
        if keepSessionAlive && retainSession {
            var result = result
            result["readerSessionId"] = readerSessionID
            readCount += 1
            let call = clearRead()
            session.alertMessage = "\(readCount) read. Move this tag away before presenting the next tag. No inventory change has been confirmed."
            call?.resolve(result)
            return
        }
        let call = clear(session)
        if invalidate {
            session.alertMessage = result["ndefError"] == nil ? "Tag read. No tag data was changed." : "Tag ID read. NDEF details are incomplete."
            session.invalidate()
        }
        call?.resolve(result)
    }

    private func clear(_ session: NFCTagReaderSession) -> CAPPluginCall? {
        guard readerSession === session else { return nil }
        let call = clearRead()
        readerSession = nil
        readerSessionID = nil
        keepSessionAlive = false
        retainedTag = nil
        retiredTagObjects.removeAll()
        readCount = 0
        return call
    }

    private func clearRead() -> CAPPluginCall? {
        timeout?.cancel()
        timeout = nil
        removalCheck?.cancel()
        removalCheck = nil
        let call = pendingCall
        pendingCall = nil
        readGeneration = nil
        readingTag = false
        acceptingDetection = false
        partialResult = nil
        return call
    }

    private static func hex(_ data: Data) -> String { data.map { String(format: "%02X", $0) }.joined() }
    private static func errorText(_ error: Error) -> String {
        let value = error as NSError
        return "\(value.domain) \(value.code): \(value.localizedDescription)"
    }
    private static func family(_ family: NFCMiFareFamily) -> String {
        switch family {
        case .ultralight: return "MIFARE Ultralight"
        case .plus: return "MIFARE Plus"
        case .desfire: return "MIFARE DESFire"
        case .unknown: return "MIFARE (family unknown)"
        @unknown default: return "MIFARE (family unknown)"
        }
    }
}
