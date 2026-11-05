import Foundation

// Write payloads and receipts for registration, retirement, inspection and teaching groups.
// Shapes follow docs/ios-native-api-contract.md §7, §8, §10, §11 and the server's strict zod schemas:
// nullable fields without a server default are always sent as explicit nulls.

// MARK: - Text normalisation

extension String {
    /// Trims exactly what JavaScript's `String.prototype.trim` (and so zod's `.trim()`) removes,
    /// so the value we save and compare equals what the server stores and echoes.
    var jsTrimmed: String {
        trimmingCharacters(in: String.jsWhitespace)
    }

    /// Length as the server counts it (UTF-16 code units).
    var serverLength: Int { utf16.count }

    static let jsWhitespace: CharacterSet = {
        var set = CharacterSet.whitespaces   // Unicode Zs plus tab
        set.insert(charactersIn: "\n\u{0B}\u{0C}\r\u{2028}\u{2029}\u{FEFF}")
        return set
    }()
}

// MARK: - Registration (§7)

struct ModelSelectionRef: Codable, Equatable, Sendable {
    let origin: String
    let id: String
    let contentHash: String
    let confirmed: Bool
    let appliedFields: [String]
}

struct RegistrationCommon: Codable, Equatable, Sendable {
    let name: String
    let chemistry: String
    let model: String
    let capacityMah: Double?
    let voltage: Double?
    let ownerId: String
    let homeBuildingId: String?
    let homeRoomId: String?
    let manufacturedOn: String?
    let firstUsedOn: String?
    let modelSelection: ModelSelectionRef?

    enum CodingKeys: String, CodingKey {
        case name, chemistry, model, capacityMah, voltage, ownerId, homeBuildingId, homeRoomId, manufacturedOn, firstUsedOn, modelSelection
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(chemistry, forKey: .chemistry)
        try c.encode(model, forKey: .model)
        try c.encode(capacityMah, forKey: .capacityMah)
        try c.encode(voltage, forKey: .voltage)
        try c.encode(ownerId, forKey: .ownerId)
        try c.encode(homeBuildingId, forKey: .homeBuildingId)
        try c.encode(homeRoomId, forKey: .homeRoomId)
        try c.encode(manufacturedOn, forKey: .manufacturedOn)
        try c.encode(firstUsedOn, forKey: .firstUsedOn)
        try c.encodeIfPresent(modelSelection, forKey: .modelSelection)
    }
}

struct DirectoryBindings: Codable, Equatable, Sendable {
    let ownerVersion: Int
    let ownerAccountId: String
    let buildingVersion: Int
    let roomVersion: Int?

    enum CodingKeys: String, CodingKey { case ownerVersion, ownerAccountId, buildingVersion, roomVersion }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(ownerVersion, forKey: .ownerVersion)
        try c.encode(ownerAccountId, forKey: .ownerAccountId)
        try c.encode(buildingVersion, forKey: .buildingVersion)
        try c.encode(roomVersion, forKey: .roomVersion)
    }
}

/// `operator_register`: typed or untagged registration, both inventories.
struct OperatorRegistrationPayload: Codable, Sendable {
    let requestId: String
    let sessionId: String
    let source: String           // "operator-entered-registration"
    let tagId: String?
    let directoryBindings: DirectoryBindings
    let common: RegistrationCommon
    let firstUseMode: String     // at_registration | date | unknown

    enum CodingKeys: String, CodingKey { case requestId, sessionId, source, tagId, directoryBindings, common, firstUseMode }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(requestId, forKey: .requestId)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(source, forKey: .source)
        try c.encode(tagId, forKey: .tagId)
        try c.encode(directoryBindings, forKey: .directoryBindings)
        try c.encode(common, forKey: .common)
        try c.encode(firstUseMode, forKey: .firstUseMode)
    }
}

/// `intake` with `native_nfc`: a physically read tag with full evidence, where the server allows native NFC.
struct NFCIntakePayload: Codable, Sendable {
    let requestId: String
    let sessionId: String
    let scannedAt: String
    let common: RegistrationCommon
    let firstUseMode: String
    let source: String           // "native_nfc"
    let nfcEvidence: NFCEvidence
    let tagId: String
}

struct RegistrationReceipt: Decodable, Sendable {
    let requestId: String
    let sessionId: String
    let dataset: Dataset
    let actorAccountId: String
    let batteryId: String
    let tagId: String?
    let registeredAt: String
    let source: String
    let replayed: Bool
    let name: String
    let model: String
    let chemistry: String
    let capacityMah: Double?
    let voltage: Double?
    let ownerId: String
    let homeBuildingId: String?
    let homeRoomId: String?
    let manufacturedOn: String?
    let firstUsedOn: String?
    let scannedAt: String?
    let nfcEvidence: NFCEvidence?
}

// MARK: - Retirement (§8)

struct LifecycleItem: Codable, Equatable, Sendable {
    let batteryId: String
    let version: Int
    let tagId: String?
    /// Present only for `native_nfc`: the full evidence of the physical read.
    var nfcEvidence: NFCEvidence? = nil

    enum CodingKeys: String, CodingKey { case batteryId, version, tagId, nfcEvidence }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(batteryId, forKey: .batteryId)
        try c.encode(version, forKey: .version)
        try c.encode(tagId, forKey: .tagId)
        try c.encodeIfPresent(nfcEvidence, forKey: .nfcEvidence)
    }
}

struct LifecyclePayload: Codable, Sendable {
    let requestId: String
    let kind: String             // scrapped | permanently_removed
    let reason: String
    let destination: String?
    let source: String           // manual_selection
    let items: [LifecycleItem]

    enum CodingKeys: String, CodingKey { case requestId, kind, reason, destination, source, items }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(requestId, forKey: .requestId)
        try c.encode(kind, forKey: .kind)
        try c.encode(reason, forKey: .reason)
        try c.encode(destination, forKey: .destination)
        try c.encode(source, forKey: .source)
        try c.encode(items, forKey: .items)
    }
}

struct LifecycleReceiptItem: Decodable, Sendable {
    let batteryId: String
    let version: Int
    let status: String
    let tagId: String?
    let nfcEvidence: NFCEvidence?
}

struct LifecycleReceipt: Decodable, Sendable {
    let requestId: String
    let dataset: Dataset
    let actorAccountId: String
    let kind: String
    let reason: String
    let destination: String?
    let at: String
    let replayed: Bool
    let source: String
    let items: [LifecycleReceiptItem]
}

/// `retired_asset` recover: brings scrapped batteries back to active.
struct RetiredAssetPayload: Codable, Sendable {
    let requestId: String
    let kind: String             // recover
    let items: [LifecycleItem]
}

struct RetiredAssetReceiptItem: Decodable, Sendable {
    let batteryId: String
    let version: Int
    let status: String
}

struct RetiredAssetReceipt: Decodable, Sendable {
    let requestId: String
    let dataset: Dataset
    let actorAccountId: String
    let kind: String
    let at: String
    let replayed: Bool
    let items: [RetiredAssetReceiptItem]
}

// MARK: - Inspection (§11)

struct InspectionPayload: Codable, Sendable {
    let requestId: String
    let batteryId: String
    let expectedBatteryVersion: Int
    let kind: String
    let outcome: String
    let performedAt: String
    let method: String
    let notes: String
    let reference: String
    let capacityMah: Double?

    enum CodingKeys: String, CodingKey {
        case requestId, batteryId, expectedBatteryVersion, kind, outcome, performedAt, method, notes, reference, capacityMah
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(requestId, forKey: .requestId)
        try c.encode(batteryId, forKey: .batteryId)
        try c.encode(expectedBatteryVersion, forKey: .expectedBatteryVersion)
        try c.encode(kind, forKey: .kind)
        try c.encode(outcome, forKey: .outcome)
        try c.encode(performedAt, forKey: .performedAt)
        try c.encode(method, forKey: .method)
        try c.encode(notes, forKey: .notes)
        try c.encode(reference, forKey: .reference)
        try c.encode(capacityMah, forKey: .capacityMah)
    }
}

struct InspectionReceipt: Decodable, Sendable {
    let requestId: String
    let dataset: Dataset
    let actorAccountId: String
    let batteryId: String
    let inspectionId: String
    let action: String
    let at: String
    let replayed: Bool
}

// MARK: - Teaching groups (§10)

struct TeachingGroupRequest: Codable, Sendable {
    let action: String           // create | update | remove
    let requestId: String
    let id: String
    let name: String?
    let notes: String?
    let batteryIds: [String]?
    let expectedVersion: Int?

    enum CodingKeys: String, CodingKey { case action, requestId, id, name, notes, batteryIds, expectedVersion }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(action, forKey: .action)
        try c.encode(requestId, forKey: .requestId)
        try c.encode(id, forKey: .id)
        if action != "remove" {
            try c.encode(name ?? "", forKey: .name)
            try c.encode(notes ?? "", forKey: .notes)
            try c.encode(batteryIds ?? [], forKey: .batteryIds)
        }
        if action != "create" { try c.encodeIfPresent(expectedVersion, forKey: .expectedVersion) }
    }
}

struct TeachingGroupWrite: Encodable {
    let dataset: Dataset
    let payload: TeachingGroupRequest
}

// MARK: - Reusable battery models

/// A new saved model (template) for this inventory. `id` is also the request ID, so resending the
/// same bytes replays the original save. Strict on the server: no other keys.
struct NewModelPayload: Codable, Equatable, Sendable {
    let id: String
    let brand: String
    let model: String
    let variant: String
    let name: String
    let chemistry: String
    let capacityMah: Double?
    let voltage: Double?
    let notes: String

    enum CodingKeys: String, CodingKey { case id, brand, model, variant, name, chemistry, capacityMah, voltage, notes }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(brand, forKey: .brand)
        try c.encode(model, forKey: .model)
        try c.encode(variant, forKey: .variant)
        try c.encode(name, forKey: .name)
        try c.encode(chemistry, forKey: .chemistry)
        try c.encode(capacityMah, forKey: .capacityMah)   // explicit null when unknown
        try c.encode(voltage, forKey: .voltage)
        try c.encode(notes, forKey: .notes)
    }
}

/// `POST /api/battery-models` body on the hosted release: `{dataset, payload}` only.
struct ModelWrite: Encodable {
    let dataset: Dataset
    let payload: NewModelPayload
}

struct ModelCreateReceipt: Decodable, Sendable {
    let model: BatteryModelChoice
    let requestId: String
    let actorAccountId: String
    let dataset: Dataset
    let replayed: Bool
}

struct TeachingGroupReceipt: Decodable, Sendable {
    let requestId: String
    let actorAccountId: String
    let dataset: Dataset
    let action: String
    let group: TeachingGroup
    let replayed: Bool
}

// MARK: - Receipt verification

/// Decodes the dataset and payload back out of a saved request body.
struct WriteEnvelope<Payload: Decodable>: Decodable {
    let dataset: Dataset
    let payload: Payload
}

/// What a confirmed write produced, for the screen that sent it.
struct WriteConfirmation: Sendable {
    let title: String
    var batteryId: String? = nil
    var group: TeachingGroup? = nil
    var model: BatteryModelChoice? = nil
    var replayed = false
}

/// Checks a server receipt against the exact saved request, the way the web client does.
/// A receipt that doesn't match leaves the request unresolved.
enum ReceiptCheck {
    static func verify(_ entry: PendingWrite, response: Data) -> WriteConfirmation? {
        let decoder = JSONDecoder()
        switch entry.action {
        case "operator_register":
            guard let sent = try? decoder.decode(WriteEnvelope<OperatorRegistrationPayload>.self, from: entry.body),
                  let r = try? decoder.decode(OKEnvelope<RegistrationReceipt>.self, from: response).result else { return nil }
            let p = sent.payload
            guard r.requestId == p.requestId, r.sessionId == p.sessionId, r.dataset == entry.dataset,
                  r.actorAccountId == entry.accountId, r.tagId == p.tagId, r.source == p.source,
                  matches(r, p.common), firstUse(r, mode: p.firstUseMode, common: p.common),
                  r.batteryId.range(of: "^BAT-\\d{8,}$", options: .regularExpression) != nil else { return nil }
            return WriteConfirmation(title: "\(r.batteryId) registered", batteryId: r.batteryId, replayed: r.replayed)

        case "intake":
            guard let sent = try? decoder.decode(WriteEnvelope<NFCIntakePayload>.self, from: entry.body),
                  let r = try? decoder.decode(OKEnvelope<RegistrationReceipt>.self, from: response).result else { return nil }
            let p = sent.payload
            guard r.requestId == p.requestId, r.sessionId == p.sessionId, r.dataset == entry.dataset,
                  r.actorAccountId == entry.accountId, r.tagId == p.tagId, r.source == "native_nfc",
                  r.nfcEvidence == p.nfcEvidence, r.scannedAt == p.scannedAt,
                  matches(r, p.common), firstUse(r, mode: p.firstUseMode, common: p.common),
                  r.batteryId.range(of: "^BAT-\\d{8,}$", options: .regularExpression) != nil else { return nil }
            return WriteConfirmation(title: "\(r.batteryId) registered", batteryId: r.batteryId, replayed: r.replayed)

        case "lifecycle":
            guard let sent = try? decoder.decode(WriteEnvelope<LifecyclePayload>.self, from: entry.body),
                  let r = try? decoder.decode(OKEnvelope<LifecycleReceipt>.self, from: response).result else { return nil }
            let p = sent.payload
            guard r.requestId == p.requestId, r.dataset == entry.dataset, r.actorAccountId == entry.accountId,
                  r.kind == p.kind, r.reason == p.reason, r.destination == p.destination, r.source == p.source,
                  r.items.count == p.items.count else { return nil }
            for (item, sentItem) in zip(r.items, p.items) {
                guard item.batteryId == sentItem.batteryId, item.tagId == sentItem.tagId,
                      item.version == sentItem.version + 1, item.status == p.kind,
                      item.nfcEvidence == sentItem.nfcEvidence else { return nil }
            }
            let n = p.items.count
            let verb = p.kind == "scrapped" ? "scrapped" : "permanently removed"
            return WriteConfirmation(title: n == 1 ? "\(p.items[0].batteryId) \(verb)" : "\(n) batteries \(verb)", replayed: r.replayed)

        case "retired_asset":
            guard let sent = try? decoder.decode(WriteEnvelope<RetiredAssetPayload>.self, from: entry.body),
                  let r = try? decoder.decode(OKEnvelope<RetiredAssetReceipt>.self, from: response).result else { return nil }
            let p = sent.payload
            guard r.requestId == p.requestId, r.dataset == entry.dataset, r.actorAccountId == entry.accountId,
                  r.kind == p.kind, r.items.count == p.items.count else { return nil }
            for (item, sentItem) in zip(r.items, p.items) {
                guard item.batteryId == sentItem.batteryId, item.version == sentItem.version + 1, item.status == "active" else { return nil }
            }
            let n = p.items.count
            return WriteConfirmation(title: n == 1 ? "\(p.items[0].batteryId) recovered" : "\(n) batteries recovered", replayed: r.replayed)

        case "inspection":
            guard let sent = try? decoder.decode(WriteEnvelope<InspectionPayload>.self, from: entry.body),
                  let r = try? decoder.decode(OKEnvelope<InspectionReceipt>.self, from: response).result else { return nil }
            let p = sent.payload
            guard r.requestId == p.requestId, r.dataset == entry.dataset, r.actorAccountId == entry.accountId,
                  r.batteryId == p.batteryId, r.action == "inspection" else { return nil }
            return WriteConfirmation(title: "Inspection recorded", batteryId: p.batteryId, replayed: r.replayed)

        case "teaching_group":
            guard let sent = try? decoder.decode(WriteEnvelope<TeachingGroupRequest>.self, from: entry.body),
                  let r = try? decoder.decode(OKEnvelope<TeachingGroupReceipt>.self, from: response).result else { return nil }
            let p = sent.payload, g = r.group
            let expectedVersion = p.action == "create" ? 1 : (p.expectedVersion ?? 0) + 1
            guard r.actorAccountId == entry.accountId, r.dataset == entry.dataset, r.action == p.action,
                  r.requestId == p.requestId, g.ownerAccountId == entry.accountId, g.id == p.id, g.version == expectedVersion,
                  g.state == (p.action == "remove" ? "archived" : "active") else { return nil }
            if p.action != "remove" {
                guard g.name == p.name, (g.notes ?? "") == (p.notes ?? ""), g.batteryIds == (p.batteryIds ?? []) else { return nil }
            }
            let title: String
            switch p.action {
            case "create": title = "“\(g.name)” created"
            case "remove": title = "“\(g.name)” deleted"
            default: title = "“\(g.name)” saved"
            }
            return WriteConfirmation(title: title, group: g, replayed: r.replayed)

        case "teaching_checkout":
            return verifyTeachingCheckout(entry, response: response)

        case "battery_model":
            // Same checks as the web's verifyModelCreateReceipt: identity, account, inventory, and every field as sent.
            guard let sent = try? decoder.decode(WriteEnvelope<NewModelPayload>.self, from: entry.body),
                  let r = try? decoder.decode(OKEnvelope<ModelCreateReceipt>.self, from: response).result else { return nil }
            let p = sent.payload, m = r.model
            guard r.requestId == p.id, r.actorAccountId == entry.accountId, r.dataset == entry.dataset,
                  m.origin == "saved", m.id == p.id,
                  m.contentHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  (m.brand ?? "") == p.brand, m.model == p.model, (m.variant ?? "") == p.variant, m.name == p.name,
                  m.chemistry == p.chemistry, m.capacityMah == p.capacityMah, m.voltage == p.voltage,
                  (m.notes ?? "") == p.notes else { return nil }
            return WriteConfirmation(title: "“\(m.label)” saved as a model", model: m, replayed: r.replayed)

        default:
            return nil
        }
    }

    private static func matches(_ r: RegistrationReceipt, _ c: RegistrationCommon) -> Bool {
        r.name == c.name && r.model == c.model && r.chemistry == c.chemistry && r.capacityMah == c.capacityMah
            && r.voltage == c.voltage && r.ownerId == c.ownerId && r.homeBuildingId == c.homeBuildingId
            && r.homeRoomId == c.homeRoomId && r.manufacturedOn == c.manufacturedOn
    }

    /// `at_registration` means the Sydney calendar date of the server's registration time.
    private static func firstUse(_ r: RegistrationReceipt, mode: String, common: RegistrationCommon) -> Bool {
        switch mode {
        case "at_registration":
            guard let at = Sydney.date(r.registeredAt) else { return false }
            return r.firstUsedOn == Sydney.ymd(at)
        case "date": return r.firstUsedOn == common.firstUsedOn
        default: return r.firstUsedOn == nil
        }
    }
}
