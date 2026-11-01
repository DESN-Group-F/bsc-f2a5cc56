import Foundation

// MARK: - Write payloads (shapes follow docs/ios-native-api-contract.md §6)

struct NFCRecordEvidence: Codable, Sendable, Equatable {
    let tnf: Int
    let typeHex: String
    let idHex: String
    let payloadHex: String
}

struct NFCReadResult: Codable, Sendable, Equatable {
    let uidHex: String
    let technology: String
    let ndefStatus: String
    let capacityBytes: Int?
    let records: [NFCRecordEvidence]
    let ndefError: String?
    let observedAt: String

    enum CodingKeys: String, CodingKey { case uidHex, technology, ndefStatus, capacityBytes, records, ndefError, observedAt }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(uidHex, forKey: .uidHex)
        try c.encode(technology, forKey: .technology)
        try c.encode(ndefStatus, forKey: .ndefStatus)
        try c.encode(capacityBytes, forKey: .capacityBytes) // explicit null when unknown
        try c.encode(records, forKey: .records)
        try c.encodeIfPresent(ndefError, forKey: .ndefError)
        try c.encode(observedAt, forKey: .observedAt)
    }
}

/// Strict evidence object required for `native_nfc` bindings.
struct NFCEvidence: Codable, Sendable, Equatable {
    let attemptId: String
    var source: String = "native-nfc-reader"
    var platform: String = "ios"
    let startedAt: String
    let endedAt: String
    let adoptedAt: String
    let tagId: String
    let result: NFCReadResult
}

struct ScanBinding: Encodable, Sendable {
    let batteryId: String
    let tagId: String?
    let version: Int
    let nfcEvidence: NFCEvidence?

    enum CodingKeys: String, CodingKey { case batteryId, tagId, version, nfcEvidence }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(batteryId, forKey: .batteryId)
        try c.encode(tagId, forKey: .tagId) // null is meaningful for manual selection
        try c.encode(version, forKey: .version)
        try c.encodeIfPresent(nfcEvidence, forKey: .nfcEvidence)
    }
}

struct ScanContext: Encodable, Sendable {
    let sessionId: String
    let source: String
    let bindings: [ScanBinding]
}

struct ExpectedLoan: Encodable, Sendable {
    let batteryId: String
    let loanId: String
}

struct RoomReference: Encodable, Sendable {
    let roomId: String
    let version: Int
}

struct GroupReference: Codable, Equatable, Sendable {
    let id: String
    let version: Int
}

struct MovementPayload: Encodable, Sendable {
    let kind: String
    let requestId: String
    let batteryIds: [String]
    let expectedLoans: [ExpectedLoan]?
    let scan: ScanContext?
    let returnRoom: RoomReference?
    var teachingGroup: GroupReference? = nil
}

struct InventoryWrite<Payload: Encodable>: Encodable {
    let dataset: Dataset
    let action: String
    let payload: Payload
}

// MARK: - Service

/// Typed access to the endpoints the iOS client uses.
struct InventoryService: Sendable {
    let client: APIClient

    func session() async throws -> SessionResponse {
        try await client.get("/api/session").decoded(SessionResponse.self)
    }

    func signIn(username: String, password: String) async throws -> StaffUser {
        struct Credentials: Encodable { let username: String; let password: String }
        struct Body: Encodable { let action = "signin"; let payload: Credentials }
        let body = Body(payload: Credentials(username: username.trimmingCharacters(in: .whitespaces).lowercased(), password: password))
        let data = try await client.post("/api/session", json: body)
        return try data.decoded(SignInResponse.self).user
    }

    func signOut() async {
        struct Body: Encodable { let action = "signout" }
        _ = try? await client.post("/api/session", json: Body())
        client.tokens.clear(origin: client.origin)
    }

    func snapshot(_ dataset: Dataset) async throws -> InventorySnapshot {
        try await client.get("/api/inventory", query: [URLQueryItem(name: "dataset", value: dataset.rawValue)])
            .decoded(InventorySnapshot.self)
    }

    /// Idempotent one-time preparation of the shared Demonstration inventory.
    func initializeDemo() async throws {
        struct Body: Encodable { let dataset = "demo"; let action = "initialize_demo" }
        _ = try await client.post("/api/inventory", json: Body())
    }

    func detail(_ dataset: Dataset, batteryId: String) async throws -> BatteryDetail {
        try await client.get("/api/inventory", query: [URLQueryItem(name: "dataset", value: dataset.rawValue),
                                                       URLQueryItem(name: "batteryId", value: batteryId)])
            .decoded(BatteryDetail.self)
    }

    func messages(_ dataset: Dataset) async throws -> MessagesResponse {
        try await client.get("/api/messages", query: [URLQueryItem(name: "dataset", value: dataset.rawValue),
                                                      URLQueryItem(name: "visibility", value: "current")])
            .decoded(MessagesResponse.self)
    }

    func markRead(_ dataset: Dataset, messageId: String) async throws {
        struct ID: Encodable { let id: String }
        _ = try await client.post("/api/messages", json: InventoryWrite(dataset: dataset, action: "read", payload: ID(id: messageId)))
    }

    func completeTask(_ dataset: Dataset, cycleId: String, expectedVersion: Int, notes: String, requestId: String) async throws -> TaskCompletionReceipt {
        struct Payload: Encodable { let cycleId: String; let expectedVersion: Int; let notes: String }
        struct Body: Encodable { let dataset: Dataset; let action = "complete"; let requestId: String; let payload: Payload }
        let data = try await client.post("/api/task-plans", json: Body(dataset: dataset, requestId: requestId,
                                                                        payload: Payload(cycleId: cycleId, expectedVersion: expectedVersion, notes: notes)))
        return try data.decoded(OKEnvelope<TaskCompletionReceipt>.self).result
    }

    func models(_ dataset: Dataset) async throws -> [BatteryModelChoice] {
        try await client.get("/api/battery-models", query: [URLQueryItem(name: "dataset", value: dataset.rawValue)])
            .decoded(BatteryModelsResponse.self).models
    }

    /// Marks arrivals read up to the cursor the user actually saw. Idempotent; the server keeps the maximum.
    func acknowledgeArrivals(_ dataset: Dataset, throughSequence: Int) async throws {
        struct Cursor: Encodable { let throughSequence: Int }
        _ = try await client.post("/api/inventory", json: InventoryWrite(dataset: dataset, action: "new_arrivals_ack",
                                                                         payload: Cursor(throughSequence: throughSequence)))
    }

    /// Sends exact, previously persisted bytes. Retries must reuse them unchanged.
    func sendMovement(body: Data) async throws -> MovementReceipt {
        let data = try await client.post("/api/inventory", body: body)
        return try data.decoded(OKEnvelope<MovementReceipt>.self).result
    }
}

enum RequestID {
    /// Lowercase UUIDs: the server keys requests case-sensitively.
    static func make() -> String { UUID().uuidString.lowercased() }
}
