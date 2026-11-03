import CoreNFC
import Foundation
import UIKit

/// One physical tag read, with the evidence the server expects for `native_nfc`.
struct TagRead: Sendable {
    let tagId: String           // "nfc:uid:<UPPERCASE HEX>"
    let attemptId: String
    let startedAt: String
    let endedAt: String
    let result: NFCReadResult

    func evidence(adoptedAt: String) -> NFCEvidence {
        NFCEvidence(attemptId: attemptId, startedAt: startedAt, endedAt: endedAt, adoptedAt: adoptedAt, tagId: tagId, result: result)
    }
}

enum ReaderEvent: Sendable {
    case read(TagRead)
    case failed(String)
    case ended(userCancelled: Bool)
}

/// Continuous CoreNFC reader. The system sheet stays up while the user scans tag after tag;
/// a tag must leave the field before the next read is accepted.
@MainActor
final class NFCReader: NSObject, NFCTagReaderSessionDelegate {
    static var isAvailable: Bool { NFCTagReaderSession.readingAvailable }

    private var session: NFCTagReaderSession?
    private var onEvent: ((ReaderEvent) -> Void)?
    private var reading = false
    private var waitingForRemoval: NFCTag?
    private var sessionStarted = Date()
    private(set) var isRunning = false

    /// The line shown inside the system sheet. Updated as the list grows.
    var prompt: String = "Hold the top of your iPhone near a battery tag." {
        didSet { if !flashing { session?.alertMessage = prompt } }
    }
    private var flashing = false
    private var flashToken = 0

    /// Shows an outcome (duplicate, refusal, switch) in the system sheet, then goes back to the prompt.
    /// The sheet covers the app, so this is the only place the user can read what just happened.
    func flash(_ text: String, seconds: Double = 1.6) {
        guard let session else { return }
        flashToken += 1
        let token = flashToken
        flashing = true
        session.alertMessage = text
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, token == self.flashToken else { return }
                self.flashing = false
                if self.session === session { session.alertMessage = self.prompt }
            }
        }
    }

    func start(onEvent: @escaping (ReaderEvent) -> Void) {
        guard session == nil, NFCTagReaderSession.readingAvailable else {
            if !NFCTagReaderSession.readingAvailable { onEvent(.failed("This iPhone can't read NFC tags.")) }
            return
        }
        guard let created = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
            onEvent(.failed("The tag reader couldn't start."))
            return
        }
        self.onEvent = onEvent
        session = created
        sessionStarted = Date()
        isRunning = true
        created.alertMessage = prompt
        created.begin()
    }

    func stop(message: String? = nil) {
        guard let session else { return }
        if let message { session.alertMessage = message }
        session.invalidate()
    }

    // MARK: NFCTagReaderSessionDelegate

    nonisolated func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        let cancelled = (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorUserCanceled
            || (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorFirstNDEFTagRead
        let timeout = (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorSessionTimeout
        MainActor.assumeIsolated {
            guard self.session === session else { return }
            self.session = nil
            self.isRunning = false
            self.reading = false
            self.flashing = false
            self.waitingForRemoval = nil
            let handler = self.onEvent
            self.onEvent = nil
            if timeout { handler?(.failed("The reader timed out. Tap Ink to keep scanning.")) }
            handler?(.ended(userCancelled: cancelled || timeout))
        }
    }

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        MainActor.assumeIsolated { self.handle(session, tags: tags) }
    }

    private func handle(_ session: NFCTagReaderSession, tags: [NFCTag]) {
        guard self.session === session, !reading, waitingForRemoval == nil else { return }
        guard tags.count == 1, let tag = tags.first else {
            session.alertMessage = "One tag at a time, please."
            restart(session, after: 0.6)
            return
        }
        guard case let .miFare(mifare) = tag, !mifare.identifier.isEmpty else {
            onEvent?(.failed("This kind of tag isn't supported."))
            restart(session, after: 0.8)
            return
        }
        reading = true
        let started = Sydney.timestamp(sessionStarted)
        let uid = mifare.identifier.map { String(format: "%02X", $0) }.joined()
        let technology = "NFC-A / ISO 14443 / \(Self.family(mifare.mifareFamily))"
        let attemptId = RequestID.make()
        var status = "unknown"
        var capacity: Int?
        var records: [NFCRecordEvidence] = []

        func finish(ndefError: String?) {
            let now = Sydney.timestamp()
            let result = NFCReadResult(uidHex: uid, technology: technology, ndefStatus: status, capacityBytes: capacity,
                                       records: records, ndefError: ndefError, observedAt: now)
            let read = TagRead(tagId: "nfc:uid:\(uid)", attemptId: attemptId, startedAt: started, endedAt: now, result: result)
            reading = false
            waitingForRemoval = tag
            onEvent?(.read(read))
            waitForRemoval(session)
        }

        session.connect(to: tag) { [weak self] error in
            DispatchQueue.main.async { MainActor.assumeIsolated {
                guard let self, self.session === session else { return }
                if let error {
                    finish(ndefError: "TAG_CONNECTION: \(error.localizedDescription)")
                    return
                }
                mifare.queryNDEFStatus { ndefStatus, cap, error in
                    DispatchQueue.main.async { MainActor.assumeIsolated {
                        guard self.session === session else { return }
                        if let error {
                            finish(ndefError: "NDEF_STATUS: \(error.localizedDescription)")
                            return
                        }
                        switch ndefStatus {
                        case .notSupported: status = "notSupported"; finish(ndefError: nil); return
                        case .readOnly: status = "readOnly"
                        case .readWrite: status = "readWrite"
                        @unknown default: status = "unknown"
                        }
                        capacity = cap >= 0 ? cap : nil
                        mifare.readNDEF { message, error in
                            DispatchQueue.main.async { MainActor.assumeIsolated {
                                guard self.session === session else { return }
                                if let error {
                                    let zeroLength = (error as? NFCReaderError)?.code == .ndefReaderSessionErrorZeroLengthMessage
                                    finish(ndefError: zeroLength ? nil : "NDEF_READ: \(error.localizedDescription)")
                                    return
                                }
                                records = (message?.records ?? []).prefix(100).map { r in
                                    NFCRecordEvidence(tnf: Int(r.typeNameFormat.rawValue),
                                                      typeHex: Self.hex(r.type), idHex: Self.hex(r.identifier),
                                                      payloadHex: String(Self.hex(r.payload).prefix(32768)))
                                }
                                finish(ndefError: nil)
                            } }
                        }
                    } }
                }
            } }
        }
    }

    /// Waits until the last tag leaves the field, then polls for the next one.
    private func waitForRemoval(_ session: NFCTagReaderSession) {
        guard self.session === session else { return }
        if let tag = waitingForRemoval, tag.isAvailable {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                MainActor.assumeIsolated { self?.waitForRemoval(session) }
            }
            return
        }
        waitingForRemoval = nil
        session.restartPolling()
    }

    private func restart(_ session: NFCTagReaderSession, after delay: TimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.session === session else { return }
                if !self.flashing { session.alertMessage = self.prompt }
                session.restartPolling()
            }
        }
    }

    private static func hex(_ data: Data) -> String { data.map { String(format: "%02X", $0) }.joined() }

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
