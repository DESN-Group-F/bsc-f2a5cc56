import Observation
import SwiftUI

enum AppTab: Hashable { case scan, inventory, inbox, me }

enum SessionState: Equatable {
    case checking
    case signedOut
    case signedIn(StaffUser)
}

/// Root state. Owns the service, the signed-in user and the selected inventory.
@MainActor
@Observable
final class AppModel {
    let preview: PreviewScreen?
    let service: InventoryService
    let pending = PendingStore()

    var session: SessionState = .checking
    var tab: AppTab = .scan
    /// A battery the Inventory tab should open next (deep link from other tabs or previews).
    var pendingDetailId: String?
    private(set) var dataset: Dataset = .demo

    /// Switching inventory clears what was loaded for the previous one.
    func select(_ newValue: Dataset) {
        guard newValue != dataset else { return }
        guard !scan.hasUnsettledWork else { return }
        dataset = newValue
        UserDefaults.standard.set(newValue.rawValue, forKey: "dataset")
        inventory.reset()
        scan.reset()
        inbox.reset()
        Task { await refreshAll() }
    }

    let inventory: InventoryModel
    let scan: ScanModel
    let inbox: InboxModel

    var user: StaffUser? {
        if case let .signedIn(user) = session { return user }
        return nil
    }

    init() {
        preview = PreviewScreen.fromLaunchArguments()
        service = InventoryService(client: APIClient())
        inventory = InventoryModel()
        scan = ScanModel()
        inbox = InboxModel()
        if let raw = UserDefaults.standard.string(forKey: "dataset"), let saved = Dataset(rawValue: raw) { dataset = saved }
        inventory.app = self
        scan.app = self
        inbox.app = self
        if let preview { PreviewFixtures.apply(preview, to: self) }
    }

    // MARK: Session

    func start() async {
        guard preview == nil else { return }
        let launched = Date()
        // Let Ink's drop-in finish (about half a second) instead of flashing the next screen.
        func settle() async {
            let remaining = 0.55 - Date().timeIntervalSince(launched)
            if remaining > 0 { try? await Task.sleep(for: .seconds(remaining)) }
        }
        guard service.client.hasSession else { await settle(); session = .signedOut; return }
        do {
            let response = try await service.session()
            await settle()
            if let user = response.user { await signedIn(user, welcome: false) } else { session = .signedOut }
        } catch {
            await settle()
            session = .signedOut
        }
    }

    func signIn(username: String, password: String) async throws {
        let user = try await service.signIn(username: username, password: password)
        Haptics.confirmed()
        await signedIn(user, welcome: true)
    }

    private func signedIn(_ user: StaffUser, welcome: Bool) async {
        if UserDefaults.standard.string(forKey: "dataset") == nil, let preferred = user.defaultDataset {
            dataset = preferred
        }
        tab = .scan
        session = .signedIn(user)
        if welcome {
            let first = user.displayName.split(separator: " ").first.map(String.init) ?? user.displayName
            scan.greet("Welcome back, \(first) · \(dataset.title)")
        }
        await refreshAll()
        scan.loadPending()
    }

    func signOut() async {
        await service.signOut()
        inventory.reset()
        scan.reset()
        inbox.reset()
        session = .signedOut
        tab = .scan
    }

    /// Any 401 ends the local session; pending writes stay on disk for the same account.
    func handle(_ error: Error) {
        if let failure = error as? APIFailure, failure.kind == .unauthorized {
            session = .signedOut
        }
    }

    func refreshAll() async {
        guard preview == nil, user != nil else { return }
        async let a: Void = inventory.refresh()
        async let b: Void = inbox.refresh()
        _ = await (a, b)
    }
}

// MARK: - Inventory

enum StatusFilter: String, CaseIterable, Identifiable {
    case all, inStore, inUse
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "All"
        case .inStore: return "In store"
        case .inUse: return "In use"
        }
    }
}

@MainActor
@Observable
final class InventoryModel {
    weak var app: AppModel?
    var snapshot: InventorySnapshot?
    var loading = false
    var lastError: String?
    var lastRefreshed: Date?
    private var demoInitialized = false

    var batteries: [BatteryRecord] { snapshot?.batteries ?? [] }
    var active: [BatteryRecord] { batteries.filter(\.isActive) }

    func reset() {
        snapshot = nil
        lastError = nil
        lastRefreshed = nil
    }

    func refresh() async {
        guard let app, app.preview == nil, !loading else { return }
        let dataset = app.dataset
        loading = true
        defer { loading = false }
        do {
            if dataset == .demo && !demoInitialized {
                try await app.service.initializeDemo()
                demoInitialized = true
            }
            let snap = try await app.service.snapshot(dataset)
            // Never show another account's or another inventory's data.
            guard snap.dataset == app.dataset, snap.user.id == app.user?.id else { return }
            snapshot = snap
            lastRefreshed = Date()
            lastError = nil
        } catch {
            lastError = (error as? APIFailure)?.message ?? "Couldn't refresh."
            app.handle(error)
        }
    }

    func battery(id: String) -> BatteryRecord? { batteries.first { $0.id == id } }
    func battery(tagId: String) -> BatteryRecord? { batteries.first { $0.tagId == tagId } }

    func mine(_ accountId: String?) -> [BatteryRecord] {
        active.filter { $0.isInUse && $0.borrowerAccountId == accountId }
    }
    func responsible(_ accountId: String?) -> [BatteryRecord] {
        active.filter { $0.ownerAccountId == accountId }
    }

    var newArrivalIds: Set<String> { Set((snapshot?.newArrivals?.items ?? []).map(\.batteryId)) }
    var unreadArrivals: Int { snapshot?.newArrivals?.unreadCount ?? 0 }

    func rooms(eligibleFor dataset: Dataset) -> [Room] {
        (snapshot?.rooms ?? []).filter { $0.eligibleForReturn(in: dataset) }
    }

    func filtered(status: StatusFilter, search: String, onlyMine: Bool, onlyNew: Bool, accountId: String?) -> [BatteryRecord] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        let arrivals = newArrivalIds
        return active.filter { b in
            switch status {
            case .all: break
            case .inStore: if !b.isInStore { return false }
            case .inUse: if !b.isInUse { return false }
            }
            if onlyMine && !(b.borrowerAccountId == accountId && b.isInUse) && b.ownerAccountId != accountId { return false }
            if onlyNew && !arrivals.contains(b.id) { return false }
            guard !query.isEmpty else { return true }
            let fields = [b.id, b.name, b.chemistry, b.model, b.tagId, b.ownerName, b.borrowerName, b.homeBuildingId, b.homeRoomName, b.homeRoomNumber]
            return fields.contains { ($0 ?? "").lowercased().contains(query) }
        }
        .sorted { a, b in
            let na = arrivals.contains(a.id), nb = arrivals.contains(b.id)
            if na != nb { return na }
            return a.id.compare(b.id, options: .numeric) == .orderedDescending
        }
    }
}

// MARK: - Inbox

@MainActor
@Observable
final class InboxModel {
    weak var app: AppModel?
    var messages: [InboxMessage] = []
    var unreadCount = 0
    var loading = false
    var lastError: String?

    var tasks: [InboxMessage] { messages.filter(\.isOpenTask) }
    var others: [InboxMessage] { messages.filter { !$0.isOpenTask } }

    func reset() { messages = []; unreadCount = 0; lastError = nil }

    func refresh() async {
        guard let app, app.preview == nil, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let response = try await app.service.messages(app.dataset)
            messages = response.messages.sorted { $0.createdAt > $1.createdAt }
            unreadCount = response.unreadCount ?? messages.filter(\.isUnread).count
            lastError = nil
        } catch {
            lastError = (error as? APIFailure)?.message
            app.handle(error)
        }
    }

    func markRead(_ message: InboxMessage) async {
        guard let app, message.isUnread, app.preview == nil else { return }
        do {
            try await app.service.markRead(app.dataset, messageId: message.id)
            await refresh()
        } catch { app.handle(error) }
    }

    /// Completion carries a request ID so a retry after a lost response is safe.
    func complete(_ message: InboxMessage, notes: String, requestId: String) async throws {
        guard let app, let cycle = message.cycle else { return }
        _ = try await app.service.completeTask(app.dataset, cycleId: cycle.id, expectedVersion: message.cycleVersion ?? cycle.version,
                                               notes: notes, requestId: requestId)
        Haptics.confirmed()
        await refresh()
    }
}
