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

    // All session state is accessed on the main queue. The session object is the
    // request identity; a callback from an invalidated session cannot finish a new read.
    private var readerSession: NFCTagReaderSession?
    private var pendingCall: CAPPluginCall?
    private var timeout: DispatchWorkItem?
    private var readingTag = false
    private var partialResult: [String: Any]?
    private var backgroundObserver: NSObjectProtocol?

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
            guard self.readerSession == nil, self.pendingCall == nil else {
                call.reject("An NFC read is already running. Finish or cancel it first.", "BUSY"); return
            }
            guard NFCTagReaderSession.readingAvailable else {
                call.reject("Core NFC tag reading is unavailable on this device.", "UNAVAILABLE"); return
            }
            guard UIApplication.shared.applicationState == .active else {
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
            guard let session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
                call.reject("The NFC reader session could not be created.", "UNAVAILABLE"); return
            }
            self.readerSession = session
            self.pendingCall = call
            self.readingTag = false
            self.partialResult = nil
            session.alertMessage = "Hold the top of your iPhone near one battery NFC tag. This read does not change the tag."
            let timeout = DispatchWorkItem { [weak self, weak session] in
                guard let self = self, let session = session, self.readerSession === session else { return }
                self.fail(session, message: "The NFC read timed out.", code: "TIMEOUT", preserveUid: true)
            }
            self.timeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + duration / 1_000, execute: timeout)
            session.begin()
        }
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.cancelPending(message: "NFC reading was cancelled.", code: "CANCELLED")
            call.resolve()
        }
    }

    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.readerSession === session, !self.readingTag else { return }
            guard tags.count == 1, let tag = tags.first else {
                self.fail(session, message: "Present one tag at a time and start a new read.", code: "MULTIPLE_TAGS"); return
            }
            guard case let .miFare(mifare) = tag else {
                self.fail(session, message: "This diagnostic reader supports NFC-A MIFARE tags such as NTAG213.", code: "UNSUPPORTED_TAG"); return
            }
            guard !mifare.identifier.isEmpty else {
                self.fail(session, message: "The reader did not return a tag identifier.", code: "NO_UID"); return
            }
            self.readingTag = true
            self.partialResult = [
                "uidHex": Self.hex(mifare.identifier),
                "technology": "NFC-A / ISO 14443 / \(Self.family(mifare.mifareFamily))",
                "ndefStatus": "unknown", "capacityBytes": NSNull(), "records": [[String: Any]](),
                "observedAt": ISO8601DateFormatter().string(from: Date())
            ]
            session.connect(to: tag) { [weak self] error in
                DispatchQueue.main.async {
                    guard let self = self, self.readerSession === session else { return }
                    if let error = error {
                        self.fail(session, message: Self.errorText(error), code: "TAG_CONNECTION", preserveUid: true); return
                    }
                    mifare.queryNDEFStatus { [weak self] status, capacity, error in
                        DispatchQueue.main.async {
                            guard let self = self, self.readerSession === session else { return }
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
                                    guard let self = self, self.readerSession === session else { return }
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
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.readerSession === session else { return }
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
    }

    private func cancelPending(message: String, code: String) {
        if let session = readerSession { fail(session, message: message, code: code) }
    }

    private func fail(_ session: NFCTagReaderSession, message: String, code: String, preserveUid: Bool = false, invalidate: Bool = true) {
        guard readerSession === session else { return }
        if preserveUid, var result = partialResult {
            result["ndefError"] = "\(code): \(message)"
            finish(session, result: result, invalidate: invalidate)
        } else {
            let call = clear(session)
            if invalidate { session.invalidate() }
            call?.reject(message, code)
        }
    }

    private func completePartial(_ session: NFCTagReaderSession) {
        guard let result = partialResult else { return }
        finish(session, result: result)
    }

    private func finish(_ session: NFCTagReaderSession, result: [String: Any], invalidate: Bool = true) {
        guard readerSession === session else { return }
        let call = clear(session)
        if invalidate {
            session.alertMessage = result["ndefError"] == nil ? "Tag read. No tag data was changed." : "Tag ID read. NDEF details are incomplete."
            session.invalidate()
        }
        call?.resolve(result)
    }

    private func clear(_ session: NFCTagReaderSession) -> CAPPluginCall? {
        guard readerSession === session else { return nil }
        timeout?.cancel()
        timeout = nil
        let call = pendingCall
        pendingCall = nil
        readerSession = nil
        readingTag = false
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
