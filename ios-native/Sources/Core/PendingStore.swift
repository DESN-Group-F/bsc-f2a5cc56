import Foundation

/// A business write whose exact bytes were saved before sending.
/// It stays here until a verified receipt or a final rejection settles it.
struct PendingMovement: Codable, Identifiable, Sendable {
    let id: String            // requestId
    let accountId: String
    let dataset: Dataset
    let kind: String          // "checkout" | "return"
    let batteryIds: [String]
    let body: Data            // exact request body; never rebuilt
    let createdAt: Date
    var attempts: Int
}

/// Durable, file-protected storage for unresolved writes. One file per request.
final class PendingStore: @unchecked Sendable {
    private let directory: URL
    private let lock = NSLock()

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = base.appendingPathComponent("PendingWrites", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }

    /// Saves and reads back. Callers must not send when this throws.
    func save(_ pending: PendingMovement) throws {
        lock.lock(); defer { lock.unlock() }
        let url = file(for: pending.id)
        let data = try JSONEncoder().encode(pending)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let readBack = try Data(contentsOf: url)
        guard readBack == data else { throw CocoaError(.fileWriteUnknown) }
    }

    func remove(id: String) {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: file(for: id))
    }

    func all(accountId: String, dataset: Dataset) -> [PendingMovement] {
        lock.lock(); defer { lock.unlock() }
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return urls.compactMap { url in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(PendingMovement.self, from: data)
        }
        .filter { $0.accountId == accountId && $0.dataset == dataset }
        .sorted { $0.createdAt < $1.createdAt }
    }

    private func file(for id: String) -> URL {
        directory.appendingPathComponent("movement-\(id).json")
    }
}

/// Dates shown in the app use Australia/Sydney, matching the server's business calendar.
enum Sydney {
    static let zone = TimeZone(identifier: "Australia/Sydney")!

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func date(_ string: String?) -> Date? {
        guard let s = string else { return nil }
        return iso.date(from: s) ?? isoPlain.date(from: s)
    }

    static func timestamp(_ date: Date = Date()) -> String { iso.string(from: date) }

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = zone
        f.dateFormat = format
        return f
    }
    private static let time = formatter("HH:mm")
    private static let dayMonth = formatter("d MMM")
    private static let dayMonthYear = formatter("d MMM yyyy")

    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    /// "11:02", "Yesterday, 15:40", "30 Oct, 15:40", "3 Mar 2025".
    static func friendly(_ string: String?) -> String {
        guard let d = date(string) else { return "—" }
        let cal = calendar
        if cal.isDateInToday(d) { return "Today, \(time.string(from: d))" }
        if cal.isDateInYesterday(d) { return "Yesterday, \(time.string(from: d))" }
        if cal.component(.year, from: d) == cal.component(.year, from: Date()) {
            return "\(dayMonth.string(from: d)), \(time.string(from: d))"
        }
        return dayMonthYear.string(from: d)
    }

    static func shortTime(_ string: String?) -> String {
        guard let d = date(string) else { return "—" }
        return Calendar.current.isDateInToday(d) || calendar.isDateInToday(d) ? time.string(from: d) : friendly(string)
    }

    /// "YYYY-MM-DD" calendar date → "9 Nov".
    static func day(_ ymd: String?) -> (month: String, day: String, isToday: Bool)? {
        guard let s = ymd else { return nil }
        let f = formatter("yyyy-MM-dd")
        guard let d = f.date(from: s) else { return nil }
        let month = formatter("MMM").string(from: d).uppercased()
        let day = formatter("d").string(from: d)
        return (month, day, calendar.isDateInToday(d))
    }

    static func days(since string: String?) -> Int? {
        guard let s = string else { return nil }
        let f = formatter("yyyy-MM-dd")
        guard let start = f.date(from: s) ?? date(s) else { return nil }
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: start), to: calendar.startOfDay(for: Date())).day
    }
}
