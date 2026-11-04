import Foundation

/// The two shared inventories on the server. `demo` is Demonstration, `live` is Working.
enum Dataset: String, Codable, CaseIterable, Identifiable, Sendable {
    case demo
    case live

    var id: String { rawValue }
    var title: String { self == .demo ? "Demo inventory" : "Working inventory" }
    var shortTitle: String { self == .demo ? "Demo" : "Working" }
    /// Native NFC business writes are accepted only in Demonstration (server rule).
    var allowsNFCWrites: Bool { self == .demo }
}

struct StaffUser: Codable, Equatable, Sendable {
    let id: String
    let username: String
    let displayName: String
    let email: String?
    let role: String
    let active: Bool?
    let version: Int?
    let defaultDataset: Dataset?

    var isAdmin: Bool { role == "admin" }
    var roleTitle: String { isAdmin ? "Administrator" : "Staff" }
}

struct SessionResponse: Decodable {
    let user: StaffUser?
    let setupRequired: Bool?
}

struct SignInResponse: Decodable {
    let user: StaffUser
}

/// The latest inspection (or concern) summarised in the snapshot.
struct InspectionBrief: Codable, Equatable, Sendable {
    let id: String
    let kind: String
    let outcome: String?
    let performedAt: String
    let inspectorName: String?
}

struct InspectionPreview: Codable, Equatable, Sendable {
    let validRecords: Int?
    let concernRecords: Int?
    let latest: InspectionBrief?
    let latestConcern: InspectionBrief?
}

struct BatteryRecord: Codable, Identifiable, Equatable, Hashable, Sendable {
    let id: String
    let name: String
    let chemistry: String?
    let model: String?
    let version: Int
    let tagId: String?
    let capacityMah: Double?
    let voltage: Double?
    let lifecycleStatus: String?
    let lifecycleAt: String?
    let lifecycleReason: String?
    let lifecycleDestination: String?
    let manufacturedOn: String?
    let firstUsedOn: String?
    let registeredAt: String?
    let ownerId: String?
    let ownerName: String?
    let ownerAccountId: String?
    let homeBuildingId: String?
    let homeBuildingName: String?
    let homeRoomId: String?
    let homeRoomName: String?
    let homeRoomNumber: String?
    let homeRoomIsPlaceholder: Bool?
    let loanId: String?
    let borrowerId: String?
    let borrowerName: String?
    let borrowerAccountId: String?
    let borrowerKind: String?
    let checkedOutAt: String?
    let lastCheckedOutAt: String?
    let observedRoom: String?
    let observedRoomId: String?
    let observedBuilding: String?
    let observationRoomSnapshot: String?
    let observedAt: String?
    let observationSource: String?
    let chargedAt: String?
    let chargeDurationMinutes: Double?
    let inspectionPreview: InspectionPreview?

    static func == (lhs: BatteryRecord, rhs: BatteryRecord) -> Bool {
        lhs.id == rhs.id && lhs.version == rhs.version && lhs.loanId == rhs.loanId && lhs.lifecycleStatus == rhs.lifecycleStatus
            && lhs.inspectionPreview == rhs.inspectionPreview && lhs.chargedAt == rhs.chargedAt && lhs.observedAt == rhs.observedAt
    }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    var isActive: Bool { (lifecycleStatus ?? "active") == "active" }
    var isInUse: Bool { isActive && loanId != nil }
    var isInStore: Bool { isActive && loanId == nil }
    var isScrapped: Bool { lifecycleStatus == "scrapped" }

    /// True when at least one specification is recorded.
    var hasSpecs: Bool {
        !(chemistry ?? "").isEmpty || !(model ?? "").isEmpty || capacityMah != nil || voltage != nil
    }

    /// "LiPo · 3S · 2200 mAh · 11.1 V" built only from recorded values.
    var specLine: String {
        var parts: [String] = []
        if let c = chemistry, !c.isEmpty { parts.append(c) }
        if let m = model, !m.isEmpty, m != chemistry { parts.append(m) }
        if let cap = capacityMah { parts.append(Format.capacity(cap)) }
        if let v = voltage { parts.append(Format.voltage(v)) }
        return parts.isEmpty ? "Specs not recorded" : parts.joined(separator: " · ")
    }

    var homeLine: String {
        let building = homeBuildingId ?? "—"
        if let room = homeRoomName, !room.isEmpty {
            let number = (homeRoomNumber?.isEmpty == false) ? "\(homeRoomNumber!) " : ""
            return "\(building) · \(number)\(room)"
        }
        return homeBuildingId == nil ? "Not recorded" : "\(building) · Room not set"
    }

    var statusTitle: String {
        switch lifecycleStatus ?? "active" {
        case "scrapped": return "Scrapped"
        case "permanently_removed": return "Permanently removed"
        default: return loanId == nil ? "In store" : "In use"
        }
    }

    /// The most recent valid inspection found a concern that no later inspection superseded.
    var hasOpenConcern: Bool {
        guard let concern = inspectionPreview?.latestConcern else { return false }
        return inspectionPreview?.latest?.id == concern.id
    }
}

/// Number formatting shared by lists, detail and forms.
enum Format {
    static func capacity(_ mah: Double) -> String { "\(number(mah)) mAh" }
    static func voltage(_ v: Double) -> String { "\(number(v)) V" }
    static func number(_ value: Double) -> String {
        if value.rounded() == value && abs(value) < 1e12 { return String(Int(value)) }
        var text = String(format: "%.3f", value)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }
    /// "3 h 20 min", "45 min", "2 days 4 h".
    static func duration(seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        if minutes < 60 { return "\(max(minutes, 0)) min" }
        let hours = minutes / 60
        if hours < 48 { return minutes % 60 == 0 ? "\(hours) h" : "\(hours) h \(minutes % 60) min" }
        let days = hours / 24
        return hours % 24 == 0 ? "\(days) days" : "\(days) days \(hours % 24) h"
    }
}

struct Person: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let version: Int
    let name: String
    let role: String?
    let accountId: String?
}

struct Building: Codable, Identifiable, Sendable {
    let id: String
    let version: Int
    let name: String
}

struct Room: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let version: Int
    let name: String
    let number: String?
    let isPlaceholder: Bool?
    let selectable: Bool?
    let buildingId: String?

    var label: String {
        let base = (number?.isEmpty == false) ? "\(number!) · \(name)" : name
        return "\(buildingId ?? "J18") · \(base)"
    }
    func eligibleForReturn(in dataset: Dataset) -> Bool {
        buildingId == "J18" && (selectable ?? false) && (dataset == .demo || !(isPlaceholder ?? true))
    }
}

struct StaffDirectoryEntry: Codable, Identifiable, Sendable {
    let id: String
    let displayName: String
    let username: String?
    let active: Bool?
}

struct TeachingGroup: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let notes: String?
    let batteryIds: [String]
    let version: Int
    let ownerAccountId: String?
    let state: String?
    let createdAt: String?
    let updatedAt: String?
}

struct NewArrivalItem: Codable, Sendable {
    let batteryId: String
    let sequence: Int
    let registeredAt: String
    let isUnread: Bool
}

struct NewArrivals: Codable, Sendable {
    let serverNow: String?
    let throughSequence: Int?
    let acknowledgedThroughSequence: Int?
    let unreadCount: Int?
    let items: [NewArrivalItem]?
}

struct InventoryCapabilities: Codable, Sendable {
    let operatorRegistration: Int?
    let demoIntake: Int?
    let batteryModels: Int?
}

struct InventorySnapshot: Codable, Sendable {
    let dataset: Dataset
    let user: StaffUser
    let capabilities: InventoryCapabilities?
    let batteries: [BatteryRecord]
    let people: [Person]?
    let buildings: [Building]?
    let rooms: [Room]?
    let staffDirectory: [StaffDirectoryEntry]?
    let teachingGroups: [TeachingGroup]?
    let newArrivals: NewArrivals?
}

struct AuditEvent: Decodable, Identifiable, Sendable {
    let id: String
    let action: String
    let batteryId: String?
    let actorName: String?
    let at: String
    let details: AuditDetails?

    enum CodingKeys: String, CodingKey { case id, action, batteryId, actorName, at, details }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        action = try c.decode(String.self, forKey: .action)
        batteryId = try c.decodeIfPresent(String.self, forKey: .batteryId)
        actorName = try c.decodeIfPresent(String.self, forKey: .actorName)
        at = try c.decode(String.self, forKey: .at)
        // Details vary by action; only the few fields shown are read, and nothing in them can fail the event.
        details = try? c.decodeIfPresent(AuditDetails.self, forKey: .details)
    }
}

/// The parts of an event's details the app shows: which loan, and which teaching group or group checkout.
struct AuditDetails: Decodable, Sendable {
    let loanId: String?
    let groupName: String?
    let isGroupCheckout: Bool

    private struct Named: Decodable { let name: String? }
    private struct Identified: Decodable { let id: String? }
    enum CodingKeys: String, CodingKey { case loanId, teachingGroup, teachingCheckout }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        loanId = try? c.decodeIfPresent(String.self, forKey: .loanId)
        groupName = (try? c.decodeIfPresent(Named.self, forKey: .teachingGroup))?.name
        isGroupCheckout = (try? c.decodeIfPresent(Identified.self, forKey: .teachingCheckout))?.id != nil
    }
}

struct LoanRecord: Decodable, Identifiable, Sendable {
    let id: String
    let borrowerName: String?
    let borrowerAccountId: String?
    let checkedOutAt: String
    let returnedAt: String?
    let cancelledAt: String?
    let checkoutActorName: String?
    let returnActorName: String?
    let correctionReason: String?
}

struct InspectionRecord: Decodable, Identifiable, Sendable {
    let id: String
    let kind: String
    let outcome: String
    let performedAt: String
    let recordedAt: String?
    let inspectorName: String?
    let method: String?
    let notes: String?
    let reference: String?
    let capacityMah: Double?
    let voidedAt: String?
    let voidReason: String?
}

struct UsageSummary: Decodable, Sendable {
    let totalCheckouts: Int?
    let completedCheckouts: Int?
    let activeCheckouts: Int?
    /// Fractional seconds from the server; null when a recorded duration is invalid.
    let totalCheckedOutSeconds: Double?
}

struct InspectionSummary: Decodable, Sendable {
    let totalRecords: Int?
    let validRecords: Int?
}

struct RegistrationInfo: Decodable, Sendable {
    let at: String
    let actorName: String?
}

struct MovementSummary: Decodable, Sendable {
    let activeLoan: LoanRecord?
    let latestReturn: LoanRecord?
    let registration: RegistrationInfo?
}

struct ChargeRecord: Decodable, Identifiable, Sendable {
    let id: String
    let completedAt: String
    let percentage: Double?
    let durationMinutes: Double?
    let actorName: String?
}

struct ObservationRecord: Decodable, Identifiable, Sendable {
    let id: String
    let roomName: String?
    let roomBuilding: String?
    let roomSnapshot: String?
    let observedAt: String
    let source: String?
}

struct BatteryDetail: Decodable, Sendable {
    let battery: BatteryRecord
    let usageSummary: UsageSummary?
    let inspections: [InspectionRecord]?
    let inspectionSummary: InspectionSummary?
    let movementSummary: MovementSummary?
    let loans: [LoanRecord]?
    let charges: [ChargeRecord]?
    let observations: [ObservationRecord]?
    let events: [AuditEvent]?
}

/// A model choice from `GET /api/battery-models`: saved, derived from inventory, or the reference catalogue.
struct BatteryModelChoice: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let origin: String
    let label: String
    let brand: String?
    let variant: String?
    let name: String
    let model: String
    let chemistry: String
    let capacityMah: Double?
    let voltage: Double?
    let capacityBasis: String?
    let verificationStatus: String?
    let notes: String?
    let warnings: [String]?
    let contentHash: String

    var originTitle: String {
        switch origin {
        case "saved": return "Saved model"
        case "inventory": return "Already in inventory"
        default: return "Reference"
        }
    }
}

struct BatteryModelsResponse: Decodable, Sendable {
    let models: [BatteryModelChoice]
}

struct TaskCycle: Decodable, Sendable {
    let id: String
    let version: Int
    let status: String?
    let dueOn: String?
    let canComplete: Bool?
    let planRemoved: Bool?
    let title: String?
    let description: String?
}

struct InboxMessage: Decodable, Identifiable, Sendable {
    let id: String
    let version: Int
    let title: String
    let body: String?
    let createdAt: String
    let readAt: String?
    let dueOn: String?
    let taskStatus: String?
    let cycleVersion: Int?
    let cycle: TaskCycle?

    var isUnread: Bool { readAt == nil }
    var isOpenTask: Bool { taskStatus == "open" && (cycle?.canComplete ?? false) && !(cycle?.planRemoved ?? false) }
}

struct MessagesResponse: Decodable, Sendable {
    let messages: [InboxMessage]
    let unreadCount: Int?
}

/// Movement receipt returned by `POST /api/inventory {action:"movement"}`.
struct MovementReceipt: Codable, Sendable {
    let kind: String
    let batteryIds: [String]
    let count: Int
    let at: String
    let requestId: String
    let borrowerAccountId: String?
    let borrower: String?
    let replayed: Bool?
    let teachingGroup: GroupEvidence?
    let scan: ScanEcho?
}

/// The scan context as sent and as echoed in a movement receipt.
struct ScanEcho: Codable, Equatable, Sendable {
    struct Binding: Codable, Equatable, Sendable {
        let batteryId: String
        let tagId: String?
        let version: Int
        let nfcEvidence: NFCEvidence?
    }
    let sessionId: String
    let source: String
    let bindings: [Binding]

    var sorted: ScanEcho { ScanEcho(sessionId: sessionId, source: source, bindings: bindings.sorted { $0.batteryId < $1.batteryId }) }
}

/// Teaching group evidence attached to a group-scoped operation's receipt.
struct GroupEvidence: Codable, Sendable {
    let id: String
    let version: Int
    let name: String
    let ownerAccountId: String
    let operationId: String
    let batteryIds: [String]
}

struct ReadReceipt: Decodable, Sendable {
    let id: String
    let readAt: String?
}

struct TaskCompletionReceipt: Decodable, Sendable {
    let id: String
    let version: Int
    let status: String
}

struct OKEnvelope<T: Decodable>: Decodable {
    let ok: Bool?
    let result: T
}

struct ErrorEnvelope: Decodable {
    let error: String?
    let code: String?
}
