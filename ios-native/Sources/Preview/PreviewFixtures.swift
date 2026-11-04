import Foundation

/// Screens that can be opened directly with `-uiPreview <name>` for simulator screenshots.
/// Preview mode never contacts the server and uses only the fictional data below.
enum PreviewScreen: String, CaseIterable {
    case signin, scan, scanWelcome, scanList, scanReturn, scanDone, scanUncertain, scanDuplicate, scanGroup, scanRetire, scanRetireDone
    case scanRegister, scanRegisterEmpty, scanUnregistered
    case inventory, inventoryFiltered, newArrivals, detail, detailBottom, detailConcern, detailRetired
    case register, registerReview, inspection, retire, group, groupEditor, filter, pendingWrite, inkPlayground, inkMotion, newModel
    case scanReturnGroup, groupsHub, groupCheckout, groupCheckoutFilled, groupCheckoutOpen, groupReturn, lookup, labelScan
    case inbox, me

    static func fromLaunchArguments() -> PreviewScreen? {
        guard let raw = UserDefaults.standard.string(forKey: "uiPreview") else { return nil }
        return PreviewScreen(rawValue: raw)
    }

    /// Screens shown on their own instead of inside the tab bar.
    var isStandalone: Bool {
        switch self {
        case .register, .registerReview, .inspection, .retire, .groupEditor, .filter, .inkPlayground, .inkMotion, .newModel,
             .groupsHub, .groupCheckout, .groupCheckoutFilled, .groupCheckoutOpen, .groupReturn, .lookup, .labelScan: return true
        default: return false
        }
    }
}

@MainActor
enum PreviewFixtures {
    static let userId = "6f0d4a52-1c33-4f53-9a51-2b7f3c0c9a11"
    static let otherId = "0b8a1f7e-6d2c-4a77-8f61-93c1d2e4f5a6"
    static let groupId = "3c2b1a09-8f7e-4d6c-9b5a-0f1e2d3c4b5a"
    static let roboticsId = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d"
    static let runId = "7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928"

    static func apply(_ screen: PreviewScreen, to app: AppModel) {
        guard let snapshot = try? JSONDecoder().decode(InventorySnapshot.self, from: Data(snapshotJSON.utf8)) else { return }
        app.inventory.snapshot = snapshot
        app.inventory.lastRefreshed = Date()
        if let messages = try? JSONDecoder().decode([InboxMessage].self, from: Data(messagesJSON.utf8)) {
            app.inbox.messages = messages
            app.inbox.unreadCount = messages.filter(\.isUnread).count
        }
        app.session = screen == .signin ? .signedOut : .signedIn(snapshot.user)
        if let runs = try? JSONDecoder().decode([TeachingRun].self, from: Data(runsJSON.utf8)) {
            app.runs.preview(runs)
        }
        let byId = Dictionary(uniqueKeysWithValues: snapshot.batteries.map { ($0.id, $0) })
        let inStore = ["BAT-00000012", "BAT-00000010", "BAT-00000009"].compactMap { byId[$0] }
        switch screen {
        case .signin: break
        case .scan: app.tab = .scan
        case .scanWelcome:
            app.tab = .scan
            app.scan.previewNotice(.init(kind: .greeting, text: "Welcome back, Tim · Demo inventory"), mood: .happy)
        case .scanList:
            app.tab = .scan
            app.scan.previewState(items: inStore, mode: .checkout, phase: .scanning)
        case .scanDuplicate:
            app.tab = .scan
            app.scan.previewState(items: inStore, mode: .checkout, phase: .scanning)
            app.scan.previewNotice(.init(kind: .duplicate, text: "Already in the list · BAT-00000009"), mood: .puzzled)
        case .scanUnregistered:
            app.tab = .scan
            app.scan.previewState(items: Array(inStore.prefix(2)), mode: .checkout, phase: .scanning)
            app.scan.previewNotice(.init(kind: .refused, text: "This tag isn't registered", actionTitle: "Register", action: .register), mood: .surprised)
        case .scanGroup:
            app.tab = .scan
            if let first = byId["BAT-00000009"] {
                app.scan.previewState(items: [first], mode: .checkout, phase: .scanning)
                app.scan.previewNotice(.init(kind: .info, text: "In “ENGG1000 Lab A”", actionTitle: "Whole group",
                                             action: .groupCheckout([groupId])), mood: .happy)
            }
        case .scanReturnGroup:
            app.tab = .scan
            if let first = byId["BAT-00000007"] {
                app.scan.previewState(items: [first], mode: .return, phase: .scanning)
                app.scan.previewNotice(.init(kind: .info, text: "From “Robotics demo” · 2 out", actionTitle: "Return 2",
                                             action: .returnRun(runId)), mood: .happy)
            }
        case .scanRegister:
            app.tab = .scan
            let now = Sydney.timestamp()
            let reads = ["04A1B2C3D4E5F6", "04A1B2C3D4E5F7", "04A1B2C3D4E5F8"].map { uid in
                TagRead(tagId: "nfc:uid:\(uid)", attemptId: RequestID.make(), startedAt: now, endedAt: now,
                        result: NFCReadResult(uidHex: uid, technology: "NFC-A / ISO 14443 / MIFARE Ultralight", ndefStatus: "readWrite",
                                              capacityBytes: 137, records: [], ndefError: nil, observedAt: now))
            }
            var details = RegistrationDetails()
            if let model = models.first { details.apply(model) }
            details.ownerId = "staff-\(userId)"
            app.scan.previewIntake(reads, details: details)
        case .scanRegisterEmpty:
            app.tab = .scan
            var details = RegistrationDetails()
            details.ownerId = "staff-\(userId)"
            app.scan.previewIntake([], details: details)
        case .scanRetire:
            app.tab = .scan
            let old = ["BAT-00000009", "BAT-00000002"].compactMap { byId[$0] }
            app.scan.previewState(items: old, mode: .retire, phase: .scanning)
            app.scan.retireReason = "Swollen cells"
        case .scanRetireDone:
            app.tab = .scan
            let old = ["BAT-00000009", "BAT-00000002"].compactMap { byId[$0] }
            app.scan.previewState(items: old, mode: .retire, phase: .done(DoneSummary(
                kind: .retire, batteries: old.map { DoneBattery(id: $0.id, name: $0.name) }.sorted { $0.id < $1.id },
                at: Sydney.timestamp(), replayed: false, roomLabel: nil, verb: "scrapped", note: "Swollen cells")))
        case .scanReturn:
            app.tab = .scan
            let mine = ["BAT-00000004", "BAT-00000007"].compactMap { byId[$0] }
            app.scan.previewState(items: mine, mode: .return, phase: .scanning, source: .selection)
        case .scanDone:
            app.tab = .scan
            app.scan.previewState(items: inStore, mode: .checkout, phase: .done(DoneSummary(
                kind: .checkout,
                batteries: inStore.map { DoneBattery(id: $0.id, name: $0.name) }.sorted { $0.id < $1.id },
                at: Sydney.timestamp(), replayed: false, roomLabel: nil)))
        case .scanUncertain:
            app.tab = .scan
            app.scan.previewState(items: inStore, mode: .checkout, phase: .uncertain)
            app.scan.previewPending(PendingMovement(id: "preview", accountId: userId, dataset: .demo, kind: "checkout",
                                                    batteryIds: inStore.map(\.id), body: Data(), createdAt: Date(), attempts: 1))
        case .inventory, .inventoryFiltered, .newArrivals: app.tab = .inventory
        case .detail, .detailBottom:
            app.tab = .inventory
            app.pendingDetailId = "BAT-00000004"
        case .detailConcern:
            app.tab = .inventory
            app.pendingDetailId = "BAT-00000008"
        case .detailRetired:
            app.tab = .inventory
            app.pendingDetailId = "BAT-00000003"
        case .group:
            app.tab = .inventory
        case .pendingWrite:
            app.tab = .me
            app.writes.previewPending(PendingWrite(id: "preview-write", accountId: userId, dataset: .demo, kind: "scrapped",
                                                   batteryIds: ["BAT-00000002"], body: Data(), createdAt: Date(), attempts: 1,
                                                   action: "lifecycle", title: "Retiring BAT-00000002"))
        case .register, .registerReview, .inspection, .retire, .groupEditor, .filter, .inkPlayground, .inkMotion, .newModel,
             .groupsHub, .groupCheckout, .groupCheckoutFilled, .groupCheckoutOpen, .groupReturn, .lookup, .labelScan:
            app.tab = .inventory
        case .inbox: app.tab = .inbox
        case .me: app.tab = .me
        }
    }

    // MARK: Data

    private static func battery(_ id: String, name: String, chemistry: String, model: String, capacity: Int?, voltage: Double?,
                                loan: String? = nil, borrower: (String, String)? = nil, checkedOut: String? = nil,
                                owner: (String, String) = ("Tim Wu", PreviewFixtures.userId), firstUsed: String? = "2026-10-13",
                                manufactured: String? = nil, charged: String? = nil, chargeMinutes: Int? = nil,
                                lifecycle: String = "active", lifecycleAt: String? = nil, reason: String? = nil,
                                inspection: String = "null", observed: (String, String)? = nil) -> String {
        func q(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
        return """
        {"id":"\(id)","name":"\(name)","chemistry":"\(chemistry)","model":"\(model)","version":3,"tagId":"nfc:uid:04\(id.suffix(2))7862A62090",
         "capacityMah":\(capacity.map { String($0) } ?? "null"),"voltage":\(voltage.map { String($0) } ?? "null"),"lifecycleStatus":"\(lifecycle)",
         "lifecycleAt":\(q(lifecycleAt)),"lifecycleReason":\(q(reason)),"lifecycleDestination":null,
         "manufacturedOn":\(q(manufactured)),"firstUsedOn":\(q(firstUsed)),"registeredAt":"2026-10-13T00:07:03.065Z",
         "ownerId":"staff-\(owner.1)","ownerName":"\(owner.0)","ownerAccountId":"\(owner.1)",
         "homeBuildingId":"J18","homeBuildingName":"J18 - Willis Annexe","homeRoomId":"J18-DEMO-ROOM","homeRoomName":"Demo room","homeRoomNumber":null,
         "homeRoomIsPlaceholder":true,"loanId":\(q(loan)),"borrowerName":\(q(borrower?.0)),"borrowerAccountId":\(q(borrower?.1)),
         "borrowerKind":\(loan == nil ? "null" : "\"staff\""),
         "checkedOutAt":\(q(checkedOut)),"lastCheckedOutAt":\(q(checkedOut)),
         "observedRoom":\(q(observed?.0)),"observedRoomId":\(observed == nil ? "null" : "\"J18-DEMO-WORKSPACE\""),"observedBuilding":\(observed == nil ? "null" : "\"J18 - Willis Annexe\""),
         "observationRoomSnapshot":\(observed == nil ? "null" : "\"recorded\""),"observedAt":\(q(observed?.1)),"observationSource":\(observed == nil ? "null" : "\"Staff return confirmation\""),
         "chargedAt":\(q(charged)),"chargeDurationMinutes":\(chargeMinutes.map { String($0) } ?? "null"),
         "inspectionPreview":\(inspection)}
        """
    }

    static var snapshotJSON: String {
        let now = Sydney.timestamp(Date().addingTimeInterval(-3 * 3600))
        let earlier = Sydney.timestamp(Date().addingTimeInterval(-26 * 3600))
        let lastWeek = Sydney.timestamp(Date().addingTimeInterval(-6 * 86400))
        let concern = """
        {"validRecords":2,"concernRecords":1,
         "latest":{"id":"i-2","kind":"visual_check","outcome":"concern_observed","performedAt":"\(earlier)","recordedAt":"\(earlier)","inspectorName":"Jordan Chen"},
         "latestConcern":{"id":"i-2","kind":"visual_check","performedAt":"\(earlier)","recordedAt":"\(earlier)","inspectorName":"Jordan Chen"}}
        """
        let ok = """
        {"validRecords":1,"concernRecords":0,
         "latest":{"id":"i-1","kind":"functional_check","outcome":"no_concern_observed","performedAt":"\(lastWeek)","recordedAt":"\(lastWeek)","inspectorName":"Tim Wu"},
         "latestConcern":null}
        """
        let batteries = [
            battery("BAT-00000016", name: "Robot base pack", chemistry: "NiMH", model: "7.2 V", capacity: 3000, voltage: 7.2,
                    loan: "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9", borrower: ("Tim Wu", userId), checkedOut: now),
            battery("BAT-00000015", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1, firstUsed: "2026-11-01"),
            battery("BAT-00000014", name: "Battery", chemistry: "Li-ion", model: "18650", capacity: 3000, voltage: 3.6, firstUsed: "2026-11-01"),
            battery("BAT-00000012", name: "Drone pack", chemistry: "LiPo", model: "4S", capacity: 1500, voltage: 14.8,
                    manufactured: "2025-06-02", charged: earlier, chargeMinutes: 75, inspection: ok),
            battery("BAT-00000010", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1, charged: lastWeek, chargeMinutes: 90),
            battery("BAT-00000009", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1),
            battery("BAT-00000008", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1,
                    loan: "8d5e6f70-1a2b-4c3d-9e8f-001122334455", borrower: ("Jordan Chen", otherId), checkedOut: earlier, inspection: concern),
            battery("BAT-00000007", name: "Robot base pack", chemistry: "NiMH", model: "7.2 V", capacity: 3000, voltage: 7.2,
                    loan: "9a6b7c80-2b3c-4d5e-8f90-112233445566", borrower: ("Tim Wu", userId), checkedOut: now, manufactured: "2024-02-19"),
            battery("BAT-00000004", name: "Drone pack", chemistry: "LiPo", model: "4S", capacity: 1500, voltage: 14.8,
                    loan: "7c4d5e60-0a1b-4c2d-8e7f-aabbccddeeff", borrower: ("Tim Wu", userId), checkedOut: now,
                    manufactured: "2025-03-10", charged: lastWeek, chargeMinutes: 120, inspection: ok,
                    observed: ("Demo workspace", lastWeek)),
            battery("BAT-00000003", name: "Old drone pack", chemistry: "LiPo", model: "4S", capacity: 1300, voltage: 14.8,
                    lifecycle: "scrapped", lifecycleAt: lastWeek, reason: "Swollen cells"),
            battery("BAT-00000002", name: "Battery", chemistry: "", model: "", capacity: nil, voltage: nil,
                    owner: ("Jordan Chen", otherId), firstUsed: nil)
        ].joined(separator: ",")
        return """
        {"dataset":"demo",
         "user":{"id":"\(userId)","username":"tim","displayName":"Tim Wu","email":null,"role":"staff","active":true,"version":1,"defaultDataset":"demo"},
         "capabilities":{"operatorRegistration":1,"demoIntake":1,"batteryModels":1},
         "batteries":[\(batteries)],
         "people":[{"id":"staff-\(userId)","version":1,"name":"Tim Wu","role":"staff","accountId":"\(userId)"},
                   {"id":"staff-\(otherId)","version":1,"name":"Jordan Chen","role":"staff","accountId":"\(otherId)"}],
         "buildings":[{"id":"J18","version":1,"name":"J18 - Willis Annexe"}],
         "rooms":[{"id":"J18-DEMO-ROOM","version":1,"name":"Demo room","number":null,"isPlaceholder":true,"selectable":true,"buildingId":"J18"},
                  {"id":"J18-DEMO-WORKSPACE","version":1,"name":"Demo workspace","number":null,"isPlaceholder":true,"selectable":true,"buildingId":"J18"}],
         "staffDirectory":[{"id":"\(userId)","displayName":"Tim Wu","username":"tim","active":true},
                           {"id":"\(otherId)","displayName":"Jordan Chen","username":"jordan","active":true}],
         "teachingGroups":[{"id":"\(groupId)","name":"ENGG1000 Lab A","notes":"Thursday 2–5 pm, J18 workshop",
                            "batteryIds":["BAT-00000009","BAT-00000010","BAT-00000012","BAT-00000008","BAT-00000004","BAT-00000003"],"version":2,
                            "ownerAccountId":"\(userId)","state":"active","createdAt":"\(lastWeek)","updatedAt":"\(lastWeek)"},
                           {"id":"\(roboticsId)","name":"Robotics demo","notes":"",
                            "batteryIds":["BAT-00000007","BAT-00000014","BAT-00000016"],"version":1,
                            "ownerAccountId":"\(userId)","state":"active","createdAt":"\(lastWeek)","updatedAt":"\(lastWeek)"}],
         "newArrivals":{"serverNow":"\(Sydney.timestamp())","throughSequence":15,"acknowledgedThroughSequence":13,"unreadCount":2,
           "items":[{"batteryId":"BAT-00000015","sequence":15,"registeredAt":"\(earlier)","isUnread":true},
                    {"batteryId":"BAT-00000014","sequence":14,"registeredAt":"\(earlier)","isUnread":true}]}}
        """
    }

    /// Three tags looked up in one go: a battery with a concern, one out in a group checkout, one in store.
    static var lookupPresentation: LookupPresentation {
        let now = Sydney.timestamp()
        let reads = ["BAT-00000008", "BAT-00000007", "BAT-00000012"].map { id -> LookupRead in
            let uid = "04\(id.suffix(2))7862A62090"
            let read = TagRead(tagId: "nfc:uid:\(uid)", attemptId: RequestID.make(), startedAt: now, endedAt: now,
                               result: NFCReadResult(uidHex: uid, technology: "NFC-A / ISO 14443 / MIFARE Ultralight", ndefStatus: "readWrite",
                                                     capacityBytes: 137, records: [], ndefError: nil, observedAt: now))
            return LookupRead(tag: read, batteryId: id)
        }
        return LookupPresentation(reads: reads)
    }

    /// One open group checkout of "Robotics demo": two still out, one already back.
    static var runsJSON: String {
        let started = Sydney.timestamp(Date().addingTimeInterval(-3 * 3600))
        let back = Sydney.timestamp(Date().addingTimeInterval(-1 * 3600))
        let loans = ["BAT-00000007": "9a6b7c80-2b3c-4d5e-8f90-112233445566", "BAT-00000014": "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f70819",
                     "BAT-00000016": "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9"]
        let ids = ["BAT-00000007", "BAT-00000014", "BAT-00000016"]
        func tag(_ id: String) -> String { "nfc:uid:04\(id.suffix(2))7862A62090" }
        func snap(_ id: String) -> String { "{\"batteryId\":\"\(id)\",\"tagId\":\"\(tag(id))\",\"version\":3,\"name\":\"Battery\",\"model\":\"\"}" }
        let mappings = ids.map { id in
            "{\"original\":\(snap(id)),\"actual\":\(snap(id)),\"originalLoanId\":null,\"method\":\"original\",\"source\":{\"kind\":\"selection\"},\"loanId\":\"\(loans[id] ?? "")\",\"loanOrigin\":\"new\",\"specificationMatch\":true,\"differences\":[]}"
        }.joined(separator: ",")
        let items = ids.map { id in
            let returned = id == "BAT-00000014"
            let status = returned ? "returned" : "outstanding"
            let returnedAt = returned ? "\"" + back + "\"" : "null"
            let loan = loans[id] ?? ""
            return "{\"batteryId\":\"\(id)\",\"loanId\":\"\(loan)\",\"status\":\"\(status)\",\"tagId\":\"\(tag(id))\",\"version\":3,\"returnedAt\":\(returnedAt),\"checkedOutAt\":\"\(started)\",\"originalBatteryId\":\"\(id)\",\"pendingReturn\":false}"
        }.joined(separator: ",")
        return """
        [{"id":"\(runId)","dataset":"demo","actorAccountId":"\(userId)","actorName":"Tim Wu",
          "teachingGroup":{"id":"\(roboticsId)","version":1,"name":"Robotics demo","ownerAccountId":"\(userId)","operationId":"\(runId)","batteryIds":["BAT-00000007","BAT-00000014","BAT-00000016"]},
          "requestedBatteryIds":["BAT-00000007","BAT-00000014","BAT-00000016"],
          "mappings":[\(mappings)],"createdAt":"\(started)","items":[\(items)],"revision":1}]
        """
    }

    static func detail(_ batteryId: String, inventory: InventoryModel) -> BatteryDetail? {
        guard let battery = inventory.battery(id: batteryId), let data = try? JSONEncoder().encode(battery),
              let batteryJSON = String(data: data, encoding: .utf8) else { return nil }
        let day = 86400.0
        func t(_ daysAgo: Double) -> String { Sydney.timestamp(Date().addingTimeInterval(-daysAgo * day)) }
        let concern = batteryId == "BAT-00000008"
        let concernRecord = concern
            ? "{\"id\":\"i-2\",\"kind\":\"visual_check\",\"outcome\":\"concern_observed\",\"performedAt\":\"\(t(1.1))\",\"recordedAt\":\"\(t(1.1))\",\"inspectorName\":\"Jordan Chen\",\"method\":\"\",\"notes\":\"Slight puffing on one side. Kept out of the charging cabinet.\",\"reference\":\"\",\"capacityMah\":null,\"voidedAt\":null,\"voidReason\":null},"
            : ""
        let json = """
        {"battery":\(batteryJSON),
         "usageSummary":{"totalCheckouts":7,"completedCheckouts":6,"activeCheckouts":1,"totalCheckedOutSeconds":131420.5},
         "inspections":[\(concernRecord)
           {"id":"i-1","kind":"capacity_measurement","outcome":"no_concern_observed","performedAt":"\(t(6))","recordedAt":"\(t(6))","inspectorName":"Tim Wu","method":"0.5C discharge to 3.3 V/cell","notes":"","reference":"Test sheet 14","capacityMah":1420,"voidedAt":null,"voidReason":null}],
         "inspectionSummary":{"totalRecords":\(concern ? 2 : 1),"validRecords":\(concern ? 2 : 1)},
         "movementSummary":{"activeLoan":null,"latestReturn":null,"registration":{"at":"2026-10-13T00:07:03.065Z","actorName":"Jordan Chen"}},
         "loans":[{"id":"l-3","borrowerName":"Tim Wu","borrowerAccountId":"\(userId)","checkedOutAt":"\(t(0.12))","returnedAt":null,"cancelledAt":null,"checkoutActorName":"Tim Wu","returnActorName":null,"correctionReason":null},
                  {"id":"l-2","borrowerName":"Jordan Chen","borrowerAccountId":"\(otherId)","checkedOutAt":"\(t(3))","returnedAt":"\(t(2.8))","cancelledAt":null,"checkoutActorName":"Jordan Chen","returnActorName":"Jordan Chen","correctionReason":null},
                  {"id":"l-1","borrowerName":"Tim Wu","borrowerAccountId":"\(userId)","checkedOutAt":"\(t(9))","returnedAt":"\(t(8.7))","cancelledAt":null,"checkoutActorName":"Tim Wu","returnActorName":"Tim Wu","correctionReason":null}],
         "charges":[{"id":"c-1","completedAt":"\(t(6))","percentage":null,"durationMinutes":120,"actorName":"Jordan Chen"}],
         "observations":[],
         "events":[]}
        """
        return try? JSONDecoder().decode(BatteryDetail.self, from: Data(json.utf8))
    }

    static var models: [BatteryModelChoice] {
        let json = """
        [{"id":"m-1","origin":"saved","label":"Turnigy 3S 2200 mAh","brand":"Turnigy","variant":"","name":"Battery","model":"3S 2200","chemistry":"LiPo","capacityMah":2200,"voltage":11.1,"capacityBasis":"rated","verificationStatus":"staff_entered","notes":"","warnings":[],"contentHash":"\(String(repeating: "a", count: 64))"},
         {"id":"inv-1","origin":"inventory","label":"Drone pack · LiPo 4S","brand":"","variant":"","name":"Drone pack","model":"4S","chemistry":"LiPo","capacityMah":1500,"voltage":14.8,"capacityBasis":null,"verificationStatus":"inventory_derived","notes":"","warnings":[],"contentHash":"\(String(repeating: "b", count: 64))"},
         {"id":"ref-1","origin":"reference","label":"Samsung INR18650-30Q","brand":"Samsung","variant":"30Q","name":"18650 cell","model":"INR18650-30Q","chemistry":"Li-ion","capacityMah":3000,"voltage":3.6,"capacityBasis":"nominal","verificationStatus":"manufacturer_datasheet","notes":"","warnings":["Check the cell is genuine before relying on the rated capacity."],"contentHash":"\(String(repeating: "c", count: 64))"}]
        """
        return (try? JSONDecoder().decode([BatteryModelChoice].self, from: Data(json.utf8))) ?? []
    }

    static var messagesJSON: String {
        let today = DateFormatter.ymdSydney.string(from: Date())
        let later = DateFormatter.ymdSydney.string(from: Date().addingTimeInterval(7 * 86400))
        let created = Sydney.timestamp(Date().addingTimeInterval(-2 * 3600))
        return """
        [{"id":"a1","version":1,"title":"Reminder: storage area review","body":"Check labels, damage and charge storage in J18.",
          "createdAt":"\(created)","readAt":null,"dueOn":"\(today)","taskStatus":"open","cycleVersion":2,
          "cycle":{"id":"c1","version":2,"status":"open","dueOn":"\(today)","canComplete":true,"planRemoved":false,"title":"Storage area review","description":null}},
         {"id":"a2","version":1,"title":"Inventory reconciliation","body":"End of teaching week count for the Demo inventory.",
          "createdAt":"\(created)","readAt":null,"dueOn":"\(later)","taskStatus":"open","cycleVersion":1,
          "cycle":{"id":"c2","version":1,"status":"open","dueOn":"\(later)","canComplete":true,"planRemoved":false,"title":"Inventory reconciliation","description":null}},
         {"id":"a3","version":1,"title":"2 new batteries registered","body":"BAT-00000014 and BAT-00000015 by Jordan Chen.",
          "createdAt":"\(created)","readAt":null,"dueOn":null,"taskStatus":null,"cycleVersion":null,"cycle":null}]
        """
    }
}

extension DateFormatter {
    static let ymdSydney: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = Sydney.zone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
