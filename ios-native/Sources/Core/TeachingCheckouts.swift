import Foundation

// Group checkouts ("teaching checkouts") on the server's own run model: POST/GET /api/teaching-checkouts.
// One run records, for each group member slot, which battery was meant, which one actually went out,
// and the exact loan. Returning a run returns only those loans. Shapes follow the server's strict
// schemas (lib/teaching-checkouts.ts): nullable fields are sent as explicit nulls, optional ones omitted.

// MARK: - Requests

/// `{batteryId, tagId, version}` exactly as reviewed. A null tag is meaningful.
struct TeachingBinding: Codable, Equatable, Sendable {
    let batteryId: String
    let tagId: String?
    let version: Int

    enum CodingKeys: String, CodingKey { case batteryId, tagId, version }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(batteryId, forKey: .batteryId)
        try c.encode(tagId, forKey: .tagId)
        try c.encode(version, forKey: .version)
    }

    init(_ battery: BatteryRecord) {
        batteryId = battery.id
        tagId = battery.tagId
        version = battery.version
    }

    init(batteryId: String, tagId: String?, version: Int) {
        self.batteryId = batteryId
        self.tagId = tagId
        self.version = version
    }
}

/// Where a choice came from. The phone only chooses from the inventory list (`selection`);
/// tag and native NFC sources on the review stay on the web for now.
struct TeachingSourceRef: Codable, Equatable, Sendable {
    var kind = "selection"
}

struct TeachingMappingRequest: Codable, Equatable, Sendable {
    let original: TeachingBinding
    let actual: TeachingBinding
    /// The member's current loan as reviewed (someone else's, yours, or none).
    let originalLoanId: String?
    /// Set only to continue a loan you already hold, keeping its ID and checkout time.
    let existingLoanId: String?
    let method: String           // original | automatic | manual
    let source: TeachingSourceRef

    enum CodingKeys: String, CodingKey { case original, actual, originalLoanId, existingLoanId, method, source }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(original, forKey: .original)
        try c.encode(actual, forKey: .actual)
        try c.encode(originalLoanId, forKey: .originalLoanId)
        try c.encodeIfPresent(existingLoanId, forKey: .existingLoanId)
        try c.encode(method, forKey: .method)
        try c.encode(source, forKey: .source)
    }
}

/// `action: "checkout"`: one new run for a teaching group.
struct TeachingCheckoutPayload: Codable, Sendable {
    var action = "checkout"
    let requestId: String
    let teachingGroup: GroupReference
    /// "all": no personal boundary beyond the server's own rules.
    var personalScope = "all"
    let mappings: [TeachingMappingRequest]
    /// Sent only when true: a second run while another run of this group is still out.
    let separateCheckout: Bool?

    enum CodingKeys: String, CodingKey { case action, requestId, teachingGroup, personalScope, mappings, separateCheckout }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(action, forKey: .action)
        try c.encode(requestId, forKey: .requestId)
        try c.encode(teachingGroup, forKey: .teachingGroup)
        try c.encode(personalScope, forKey: .personalScope)
        try c.encode(mappings, forKey: .mappings)
        if separateCheckout == true { try c.encode(true, forKey: .separateCheckout) }
    }
}

struct TeachingReturnItem: Codable, Equatable, Sendable {
    let batteryId: String
    let tagId: String?
    let version: Int
    /// The run's own recorded loan. A later loan of the same battery is never substituted.
    let loanId: String
    let source: TeachingSourceRef?

    enum CodingKeys: String, CodingKey { case batteryId, tagId, version, loanId, source }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(batteryId, forKey: .batteryId)
        try c.encode(tagId, forKey: .tagId)
        try c.encode(version, forKey: .version)
        try c.encode(loanId, forKey: .loanId)
        try c.encodeIfPresent(source, forKey: .source)
    }
}

/// `action: "return"`: all or part of one run's outstanding loans.
struct TeachingReturnPayload: Codable, Sendable {
    var action = "return"
    let requestId: String
    let runId: String
    var personalScope = "all"
    let items: [TeachingReturnItem]
}

/// `POST /api/teaching-checkouts` body: `{dataset, payload}` only.
struct DatasetWrite<Payload: Encodable>: Encodable {
    let dataset: Dataset
    let payload: Payload
}

// MARK: - Runs and receipts as the server returns them

/// A battery as recorded in a run. A purge leaves only `{batteryId, deleted: true}`.
struct TeachingSnapshotEcho: Decodable, Sendable {
    let batteryId: String
    let tagId: String?
    let version: Int?
    let name: String?
    let model: String?
    let deleted: Bool?

    var isDeleted: Bool { deleted == true }
}

struct TeachingSourceEcho: Decodable, Equatable, Sendable {
    let kind: String
    /// Native NFC sources carry reader evidence; the phone never sends any here.
    let hasEvidence: Bool

    enum CodingKeys: String, CodingKey { case kind, evidence }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        hasEvidence = c.contains(.evidence)
    }

    func matches(_ sent: TeachingSourceRef?) -> Bool {
        guard let sent else { return false }
        return kind == sent.kind && !hasEvidence
    }
}

struct TeachingMappingEcho: Decodable, Sendable {
    let original: TeachingSnapshotEcho
    let actual: TeachingSnapshotEcho
    let originalLoanId: String?
    let method: String
    let source: TeachingSourceEcho?
    let loanId: String?
    let loanOrigin: String?
}

struct TeachingRunItem: Decodable, Identifiable, Sendable {
    let batteryId: String
    let loanId: String?
    /// outstanding | returned | cancelled | deleted, derived from the loan itself, so an ordinary
    /// return of the same loan shows here as returned.
    let status: String
    let tagId: String?
    let version: Int?
    let returnedAt: String?
    let checkedOutAt: String?
    let originalBatteryId: String?
    /// Swapped out on the web but not handed back yet.
    let pendingReturn: Bool?

    var id: String { loanId ?? batteryId }
    var isOutstanding: Bool { status == "outstanding" }
}

/// A run as listed by `GET /api/teaching-checkouts`, or as echoed in a receipt (no items).
struct TeachingRun: Decodable, Identifiable, Sendable {
    let id: String
    let dataset: Dataset
    let actorAccountId: String
    let actorName: String?
    let teachingGroup: GroupEvidence
    let requestedBatteryIds: [String]
    let mappings: [TeachingMappingEcho]
    let createdAt: String
    let separateCheckout: Bool?
    let items: [TeachingRunItem]?
    let revision: Int?
    let currentMappings: [TeachingMappingEcho]?

    var allItems: [TeachingRunItem] { items ?? [] }
    var outstanding: [TeachingRunItem] { allItems.filter(\.isOutstanding) }
    var isOpen: Bool { !outstanding.isEmpty }

    /// The member slot an item fills: recorded on the item, or found through its exact loan.
    func memberId(of item: TeachingRunItem) -> String? {
        if let id = item.originalBatteryId { return id }
        return (mappings + (currentMappings ?? [])).first { $0.loanId == item.loanId && $0.actual.batteryId == item.batteryId }?
            .original.batteryId
    }

    /// "Today, 09:12" style label for the moment the run started.
    var startedText: String { Sydney.friendly(createdAt) }
}

struct TeachingRunsResponse: Decodable, Sendable {
    let runs: [TeachingRun]
}

struct TeachingReturnItemEcho: Decodable, Sendable {
    let batteryId: String
    let tagId: String?
    let version: Int
    let loanId: String
    let source: TeachingSourceEcho?

    func matches(_ sent: TeachingReturnItem) -> Bool {
        guard batteryId == sent.batteryId, tagId == sent.tagId, version == sent.version, loanId == sent.loanId else { return false }
        switch (source, sent.source) {
        case (nil, nil): return true
        case let (echo?, ref?): return echo.matches(ref)
        default: return false
        }
    }
}

struct TeachingCheckoutReceipt: Decodable, Sendable {
    let requestId: String
    let actorAccountId: String
    let dataset: Dataset
    let action: String
    let run: TeachingRun
    let revision: Int?
    let returnedItems: [TeachingReturnItemEcho]?
    let at: String
    let replayed: Bool?
}

// MARK: - Receipt verification

extension ReceiptCheck {
    private struct ActionProbe: Decodable { let action: String }

    /// The same checks as the web's verifyTeachingCheckoutReceipt for the two actions the phone sends.
    static func verifyTeachingCheckout(_ entry: PendingWrite, response: Data) -> WriteConfirmation? {
        let decoder = JSONDecoder()
        guard let probe = try? decoder.decode(WriteEnvelope<ActionProbe>.self, from: entry.body).payload,
              let r = try? decoder.decode(OKEnvelope<TeachingCheckoutReceipt>.self, from: response).result,
              r.actorAccountId == entry.accountId, r.dataset == entry.dataset, r.run.dataset == entry.dataset,
              r.action == probe.action else { return nil }
        let run = r.run
        switch probe.action {
        case "checkout":
            guard let p = try? decoder.decode(WriteEnvelope<TeachingCheckoutPayload>.self, from: entry.body).payload else { return nil }
            let g = run.teachingGroup
            let actualIds = p.mappings.map(\.actual.batteryId)
            guard r.requestId == p.requestId, run.id == p.requestId, run.createdAt == r.at,
                  run.actorAccountId == entry.accountId, (run.separateCheckout ?? false) == (p.separateCheckout ?? false),
                  g.id == p.teachingGroup.id, g.version == p.teachingGroup.version, g.ownerAccountId == entry.accountId,
                  g.operationId == p.requestId, g.batteryIds.sorted() == actualIds.sorted(),
                  run.requestedBatteryIds == p.mappings.map(\.original.batteryId),
                  run.mappings.count == p.mappings.count else { return nil }
            var loans = Set<String>()
            for (echo, sent) in zip(run.mappings, p.mappings) {
                guard !echo.original.isDeleted, !echo.actual.isDeleted,
                      echo.original.batteryId == sent.original.batteryId, echo.actual.batteryId == sent.actual.batteryId,
                      echo.original.tagId == sent.original.tagId, echo.actual.tagId == sent.actual.tagId,
                      echo.original.version == sent.original.version, echo.actual.version == sent.actual.version,
                      echo.originalLoanId == sent.originalLoanId, echo.method == sent.method,
                      echo.source?.matches(sent.source) == true,
                      let loanId = echo.loanId, !loans.contains(loanId) else { return nil }
                if let existing = sent.existingLoanId {
                    guard loanId == existing, echo.loanOrigin == "existing" else { return nil }
                } else {
                    guard echo.loanOrigin != "existing" else { return nil }
                }
                loans.insert(loanId)
            }
            let n = p.mappings.count
            return WriteConfirmation(title: "Checked out \(n) for “\(g.name)”", replayed: r.replayed ?? false)

        case "return":
            guard let p = try? decoder.decode(WriteEnvelope<TeachingReturnPayload>.self, from: entry.body).payload,
                  let returned = r.returnedItems else { return nil }
            guard r.requestId == p.requestId, run.id == p.runId, run.actorAccountId == entry.accountId,
                  returned.count == p.items.count,
                  zip(returned, p.items).allSatisfy({ $0.matches($1) }),
                  let started = Sydney.date(run.createdAt), let at = Sydney.date(r.at), started <= at else { return nil }
            let n = p.items.count
            return WriteConfirmation(title: "Returned \(n) from “\(run.teachingGroup.name)”", replayed: r.replayed ?? false)

        default:
            return nil
        }
    }
}

// MARK: - Service

extension InventoryService {
    /// Your own runs in this inventory, newest first.
    func teachingRuns(_ dataset: Dataset) async throws -> [TeachingRun] {
        try await client.get("/api/teaching-checkouts", query: [URLQueryItem(name: "dataset", value: dataset.rawValue)])
            .decoded(TeachingRunsResponse.self).runs
    }

    /// One run, read fresh: the only source for which loans a return sends.
    func teachingRun(_ dataset: Dataset, id: String) async throws -> TeachingRun? {
        try await client.get("/api/teaching-checkouts", query: [URLQueryItem(name: "dataset", value: dataset.rawValue),
                                                                 URLQueryItem(name: "runId", value: id)])
            .decoded(TeachingRunsResponse.self).runs.first { $0.id == id }
    }
}
