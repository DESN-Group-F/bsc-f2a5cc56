import Foundation

/// One scanned, not-yet-registered tag in a batch intake.
/// Drafts are only staged on this iPhone; nothing exists on the server until the batch is confirmed.
struct IntakeEntry: Codable, Identifiable, Equatable, Sendable {
    enum Status: Codable, Equatable, Sendable {
        case draft
        case registered(String)   // battery ID from the verified receipt
        case failed(String)       // definitely not registered; the reason from the server
        case uncertain            // sent, outcome unknown; only "Try again" with the same request
    }

    let tagId: String
    let evidence: NFCEvidence
    var requestId: String?
    var status: Status

    var id: String { tagId }
    var uid: String { tagId.replacingOccurrences(of: "nfc:uid:", with: "") }
    var isPendingWork: Bool { status == .draft || status == .uncertain || isFailed }
    var isFailed: Bool { if case .failed = status { return true } else { return false } }
}

/// The batch as saved on the phone, per account and inventory.
struct IntakeBatchFile: Codable, Sendable {
    var details: RegistrationDetails
    var sessionId: String
    /// The details the session ID was first used with. The server freezes them per session,
    /// so changed details start a new session.
    var sessionDetails: RegistrationDetails?
    var entries: [IntakeEntry]
}

/// File-protected storage for batch intake drafts.
enum IntakeStore {
    private static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("IntakeDrafts", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return dir
    }

    private static func url(accountId: String, dataset: Dataset) -> URL {
        directory.appendingPathComponent("intake-\(accountId)-\(dataset.rawValue).json")
    }

    static func load(accountId: String, dataset: Dataset) -> IntakeBatchFile? {
        guard let data = try? Data(contentsOf: url(accountId: accountId, dataset: dataset)) else { return nil }
        return try? JSONDecoder().decode(IntakeBatchFile.self, from: data)
    }

    @discardableResult
    static func save(_ file: IntakeBatchFile, accountId: String, dataset: Dataset) -> Bool {
        guard let data = try? JSONEncoder().encode(file) else { return false }
        do {
            try data.write(to: url(accountId: accountId, dataset: dataset),
                           options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return true
        } catch {
            return false
        }
    }
}
