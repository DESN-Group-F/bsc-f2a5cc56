import Foundation

/// Screens that can be opened directly with `-uiPreview <name>` for simulator screenshots.
/// Preview mode never contacts the server and uses only the fictional data below.
enum PreviewScreen: String, CaseIterable {
    case signin, scan, scanWelcome, scanList, scanReturn, scanDone, scanUncertain, scanDuplicate, inventory, detail, inbox, me

    static func fromLaunchArguments() -> PreviewScreen? {
        guard let raw = UserDefaults.standard.string(forKey: "uiPreview") else { return nil }
        return PreviewScreen(rawValue: raw)
    }
}

@MainActor
enum PreviewFixtures {
    static let userId = "6f0d4a52-1c33-4f53-9a51-2b7f3c0c9a11"
    static let otherId = "0b8a1f7e-6d2c-4a77-8f61-93c1d2e4f5a6"

    static func apply(_ screen: PreviewScreen, to app: AppModel) {
        guard let snapshot = try? JSONDecoder().decode(InventorySnapshot.self, from: Data(snapshotJSON.utf8)) else { return }
        app.inventory.snapshot = snapshot
        app.inventory.lastRefreshed = Date()
        if let messages = try? JSONDecoder().decode([InboxMessage].self, from: Data(messagesJSON.utf8)) {
            app.inbox.messages = messages
            app.inbox.unreadCount = messages.filter(\.isUnread).count
        }
        app.session = screen == .signin ? .signedOut : .signedIn(snapshot.user)
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
        case .inventory: app.tab = .inventory
        case .detail:
            app.tab = .inventory
            app.pendingDetailId = "BAT-00000004"
        case .inbox: app.tab = .inbox
        case .me: app.tab = .me
        }
    }

    private static func battery(_ id: String, name: String, chemistry: String, model: String, capacity: Int?, voltage: Double?,
                                loan: String? = nil, borrower: (String, String)? = nil, checkedOut: String? = nil,
                                owner: (String, String) = ("Tim Wu", PreviewFixtures.userId), firstUsed: String = "2026-10-13") -> String {
        func q(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
        return """
        {"id":"\(id)","name":"\(name)","chemistry":"\(chemistry)","model":"\(model)","version":3,"tagId":"nfc:uid:04\(id.suffix(2))7862A62090",
         "capacityMah":\(capacity.map { String($0) } ?? "null"),"voltage":\(voltage.map { String($0) } ?? "null"),"lifecycleStatus":"active",
         "manufacturedOn":null,"firstUsedOn":"\(firstUsed)","registeredAt":"2026-10-13T00:07:03.065Z",
         "ownerId":"staff-\(owner.1)","ownerName":"\(owner.0)","ownerAccountId":"\(owner.1)",
         "homeBuildingId":"J18","homeBuildingName":"J18 - Willis Annexe","homeRoomId":"J18-DEMO-ROOM","homeRoomName":"Demo room","homeRoomNumber":null,
         "homeRoomIsPlaceholder":true,"loanId":\(q(loan)),"borrowerName":\(q(borrower?.0)),"borrowerAccountId":\(q(borrower?.1)),
         "checkedOutAt":\(q(checkedOut)),"lastCheckedOutAt":\(q(checkedOut)),"observedRoom":null,"observedAt":null}
        """
    }

    static var snapshotJSON: String {
        let now = Sydney.timestamp(Date().addingTimeInterval(-3 * 3600))
        let earlier = Sydney.timestamp(Date().addingTimeInterval(-26 * 3600))
        let batteries = [
            battery("BAT-00000015", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1, firstUsed: "2026-11-01"),
            battery("BAT-00000014", name: "Battery", chemistry: "Li-ion", model: "18650", capacity: 3000, voltage: 3.6, firstUsed: "2026-11-01"),
            battery("BAT-00000012", name: "Drone pack", chemistry: "LiPo", model: "4S", capacity: 1500, voltage: 14.8),
            battery("BAT-00000010", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1),
            battery("BAT-00000009", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1),
            battery("BAT-00000008", name: "Battery", chemistry: "LiPo", model: "3S", capacity: 2200, voltage: 11.1,
                    loan: "8d5e6f70-1a2b-4c3d-9e8f-001122334455", borrower: ("Jordan Chen", otherId), checkedOut: earlier),
            battery("BAT-00000007", name: "Robot base pack", chemistry: "NiMH", model: "7.2 V", capacity: 3000, voltage: 7.2,
                    loan: "9a6b7c80-2b3c-4d5e-8f90-112233445566", borrower: ("Tim Wu", userId), checkedOut: now),
            battery("BAT-00000004", name: "Drone pack", chemistry: "LiPo", model: "4S", capacity: 1500, voltage: 14.8,
                    loan: "7c4d5e60-0a1b-4c2d-8e7f-aabbccddeeff", borrower: ("Tim Wu", userId), checkedOut: now),
            battery("BAT-00000002", name: "Battery", chemistry: "", model: "", capacity: nil, voltage: nil, owner: ("Jordan Chen", otherId))
        ].joined(separator: ",")
        return """
        {"dataset":"demo",
         "user":{"id":"\(userId)","username":"tim","displayName":"Tim Wu","email":null,"role":"staff","active":true,"version":1,"defaultDataset":"demo"},
         "batteries":[\(batteries)],
         "people":[],"buildings":[{"id":"J18","version":1,"name":"J18 - Willis Annexe"}],
         "rooms":[{"id":"J18-DEMO-ROOM","version":1,"name":"Demo room","number":null,"isPlaceholder":true,"selectable":true,"buildingId":"J18"}],
         "staffDirectory":[],"teachingGroups":[],
         "newArrivals":{"serverNow":"\(Sydney.timestamp())","throughSequence":15,"acknowledgedThroughSequence":13,"unreadCount":2,
           "items":[{"batteryId":"BAT-00000015","sequence":15,"registeredAt":"\(earlier)","isUnread":true},
                    {"batteryId":"BAT-00000014","sequence":14,"registeredAt":"\(earlier)","isUnread":true}]}}
        """
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
