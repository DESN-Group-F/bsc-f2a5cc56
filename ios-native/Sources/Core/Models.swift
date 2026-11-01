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

struct InspectionPreview: Codable, Equatable, Sendable {
    let validRecords: Int?
    let concernRecords: Int?
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
    let borrowerName: String?
    let borrowerAccountId: String?
    let checkedOutAt: String?
    let lastCheckedOutAt: String?
    let observedRoom: String?
    let observedAt: String?

    static func == (lhs: BatteryRecord, rhs: BatteryRecord) -> Bool {
        lhs.id == rhs.id && lhs.version == rhs.version && lhs.loanId == rhs.loanId && lhs.lifecycleStatus == rhs.lifecycleStatus
    }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    var isActive: Bool { (lifecycleStatus ?? "active") == "active" }
    var isInUse: Bool { isActive && loanId != nil }
    var isInStore: Bool { isActive && loanId == nil }

    /// "LiPo · 3S · 2200 mAh" style summary built only from recorded values.
    var specLine: String {
        var parts: [String] = []
        if let c = chemistry, !c.isEmpty { parts.append(c) }
        if let m = model, !m.isEmpty, m != chemistry { parts.append(m) }
        if let cap = capacityMah { parts.append("\(Int(cap.rounded())) mAh") }
        if let v = voltage { parts.append(String(format: v.rounded() == v ? "%.0f V" : "%.1f V", v)) }
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
}

struct Person: Codable, Identifiable, Sendable {
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

struct TeachingGroup: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let notes: String?
    let batteryIds: [String]
    let version: Int
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

struct InventorySnapshot: Codable, Sendable {
    let dataset: Dataset
    let user: StaffUser
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
}

struct LoanRecord: Decodable, Identifiable, Sendable {
    let id: String
    let borrowerName: String?
    let checkedOutAt: String
    let returnedAt: String?
    let cancelledAt: String?
    let checkoutActorName: String?
    let returnActorName: String?
}

struct InspectionRecord: Decodable, Identifiable, Sendable {
    let id: String
    let kind: String
    let outcome: String
    let performedAt: String
    let inspectorName: String?
    let voidedAt: String?
}

struct UsageSummary: Decodable, Sendable {
    let totalCheckouts: Int?
    let totalCheckedOutSeconds: Int?
}

struct BatteryDetail: Decodable, Sendable {
    let battery: BatteryRecord
    let usageSummary: UsageSummary?
    let inspections: [InspectionRecord]?
    let loans: [LoanRecord]?
    let events: [AuditEvent]?
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
    let replayed: Bool?
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
