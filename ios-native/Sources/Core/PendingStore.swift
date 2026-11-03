import Foundation

/// A business write whose exact bytes were saved before sending.
/// It stays here until a verified receipt or a final rejection settles it.
/// Files written by earlier builds (movements only) decode with `action == nil`.
struct PendingWrite: Codable, Identifiable, Sendable {
    let id: String            // requestId
    let accountId: String
    let dataset: Dataset
    let kind: String          // movement: "checkout" | "return"; otherwise the action's own kind
    let batteryIds: [String]
    let body: Data            // exact request body; never rebuilt
    let createdAt: Date
    var attempts: Int
    var action: String? = nil     // nil or "movement" for scan-station movements
    var endpoint: String? = nil   // nil means /api/inventory
    var title: String? = nil      // shown while the outcome is unknown

    var isMovement: Bool { (action ?? "movement") == "movement" }
    var path: String { endpoint ?? "/api/inventory" }
}

typealias PendingMovement = PendingWrite

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
    func save(_ pending: PendingWrite) throws {
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

    func all(accountId: String, dataset: Dataset) -> [PendingWrite] {
        lock.lock(); defer { lock.unlock() }
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return urls.compactMap { url in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(PendingWrite.self, from: data)
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

    /// Sydney calendar date "YYYY-MM-DD" of an instant.
    static func ymd(_ date: Date = Date()) -> String { ymdFormatter.string(from: date) }
    static func dateFromYMD(_ ymd: String?) -> Date? { ymd.flatMap { ymdFormatter.date(from: $0) } }
    private static let ymdFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = zone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// "3 Mar 2025" for a calendar date.
    static func longDay(_ ymd: String?) -> String {
        guard let d = dateFromYMD(ymd) else { return "—" }
        return dayMonthYear.string(from: d)
    }

    /// Formatters are expensive to make; each format is built once and reused.
    nonisolated(unsafe) private static var formatters: [String: DateFormatter] = [:]
    private static let formattersLock = NSLock()
    private static func formatter(_ format: String) -> DateFormatter {
        formattersLock.lock(); defer { formattersLock.unlock() }
        if let cached = formatters[format] { return cached }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = zone
        f.dateFormat = format
        formatters[format] = f
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

    enum Due: Equatable { case overdue(days: Int), today, upcoming }

    /// Where a due date stands relative to today in Sydney.
    static func due(_ ymd: String?) -> Due? {
        guard let days = days(since: ymd) else { return nil }
        if days > 0 { return .overdue(days: days) }
        return days == 0 ? .today : .upcoming
    }

    /// "Overdue · 2 days", "Due today", "Due Wed 4 Nov".
    static func dueText(_ ymd: String?) -> String {
        switch due(ymd) {
        case .overdue(let n): return "Overdue · \(n) \(n == 1 ? "day" : "days")"
        case .today: return "Due today"
        case .upcoming:
            guard let d = dateFromYMD(ymd) else { return "" }
            return "Due " + formatter("EEE d MMM").string(from: d)
        case nil: return ""
        }
    }

    static func days(since string: String?) -> Int? {
        guard let s = string else { return nil }
        let f = formatter("yyyy-MM-dd")
        guard let start = f.date(from: s) ?? date(s) else { return nil }
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: start), to: calendar.startOfDay(for: Date())).day
    }
}
