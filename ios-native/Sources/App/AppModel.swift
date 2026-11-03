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
    /// Registration sheet request, from Inventory or an unregistered tag on the scan station.
    var registration: RegistrationRequest?
    private(set) var dataset: Dataset = .demo

    /// Switching inventory clears what was loaded for the previous one.
    func select(_ newValue: Dataset) {
        guard newValue != dataset else { return }
        guard !scan.hasUnsettledWork, !writes.hasPending else { return }
        dataset = newValue
        UserDefaults.standard.set(newValue.rawValue, forKey: "dataset")
        inventory.reset()
        scan.reset()
        scan.unloadIntake()
        inbox.reset()
        writes.load()
        Task {
            await refreshAll()
            scan.loadPending()
        }
    }

    /// True while a request is unresolved anywhere; switching inventory or signing out waits for it.
    var hasUnsettledWork: Bool { scan.hasUnsettledWork || writes.hasPending }

    let inventory: InventoryModel
    let scan: ScanModel
    let inbox: InboxModel
    let writes: WriteCenter

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
        writes = WriteCenter()
        if let raw = UserDefaults.standard.string(forKey: "dataset"), let saved = Dataset(rawValue: raw) { dataset = saved }
        inventory.app = self
        scan.app = self
        inbox.app = self
        writes.app = self
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
        writes.load()
        scan.loadPending()
    }

    func signOut() async {
        await service.signOut()
        inventory.reset()
        scan.reset()
        scan.unloadIntake()
        inbox.reset()
        writes.reset()
        registration = nil
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
    var snapshot: InventorySnapshot? {
        didSet { receivedUptime = ProcessInfo.processInfo.systemUptime }
    }
    var loading = false
    var lastError: String?
    var lastRefreshed: Date?
    private var demoInitialized = false
    private var receivedUptime: TimeInterval = 0
    /// Ticks so 48-hour labels expire without a refresh.
    var clockTick = 0

    var batteries: [BatteryRecord] { snapshot?.batteries ?? [] }
    var active: [BatteryRecord] { batteries.filter(\.isActive) }
    var groups: [TeachingGroup] {
        (snapshot?.teachingGroups ?? []).filter { ($0.state ?? "active") == "active" && ($0.ownerAccountId == nil || $0.ownerAccountId == app?.user?.id) }
    }

    func reset() {
        snapshot = nil
        lastError = nil
        lastRefreshed = nil
    }

    @ObservationIgnored private let gate = RefreshGate()

    /// A refresh asked for while one is on the wire waits for a fresh one instead of being dropped,
    /// so a just-registered tag or a just-switched inventory is never judged on stale data.
    func refresh() async {
        guard let app, app.preview == nil else { return }
        await gate.run { [weak self] in await self?.load() }
    }

    private func load() async {
        guard let app else { return }
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

    // MARK: New arrivals

    /// Arrivals still inside the 48-hour window, judged by server time advanced with a monotonic clock.
    var recentArrivals: [NewArrivalItem] {
        _ = clockTick
        guard let arrivals = snapshot?.newArrivals, let serverNow = Sydney.date(arrivals.serverNow) else { return [] }
        let now = serverNow.addingTimeInterval(max(0, ProcessInfo.processInfo.systemUptime - receivedUptime))
        let activeIds = Set(active.map(\.id))
        return (arrivals.items ?? []).filter { item in
            guard let registered = Sydney.date(item.registeredAt), activeIds.contains(item.batteryId) else { return false }
            return registered <= now && now.timeIntervalSince(registered) < 48 * 3600
        }
    }
    var newArrivalIds: Set<String> { Set(recentArrivals.map(\.batteryId)) }
    var unreadArrivalIds: Set<String> { Set(recentArrivals.filter(\.isUnread).map(\.batteryId)) }
    var unreadArrivals: Int { recentArrivals.filter(\.isUnread).count }

    /// Explicit user action only: acknowledges the cursor of the snapshot on screen, never "latest".
    func acknowledgeArrivals() async {
        guard let app, app.preview == nil, let cursor = snapshot?.newArrivals?.throughSequence,
              cursor > (snapshot?.newArrivals?.acknowledgedThroughSequence ?? 0) else { return }
        do {
            try await app.service.acknowledgeArrivals(app.dataset, throughSequence: cursor)
            await refresh()
        } catch {
            app.handle(error)
        }
    }

    // MARK: Queries

    func filtered(status: StatusFilter, search: String, filter: InventoryFilter, accountId: String?) -> [BatteryRecord] {
        InventoryQuery.apply(batteries, filter: filter, status: status, search: search, viewer: accountId,
                             groups: groups, arrivalIds: newArrivalIds)
    }

    /// Simple active-only query used by pickers.
    func filtered(status: StatusFilter, search: String, onlyMine: Bool, onlyNew: Bool, accountId: String?) -> [BatteryRecord] {
        var filter = InventoryFilter()
        filter.newArrivalsOnly = onlyNew
        let list = filtered(status: status, search: search, filter: filter, accountId: accountId)
        guard onlyMine else { return list }
        return list.filter { ($0.borrowerAccountId == accountId && $0.isInUse) || $0.ownerAccountId == accountId }
    }

    func rooms(eligibleFor dataset: Dataset) -> [Room] {
        (snapshot?.rooms ?? []).filter { $0.eligibleForReturn(in: dataset) }
    }

    /// Rooms a new battery's registered home may use: selectable J18 rooms.
    var registrationRooms: [Room] {
        (snapshot?.rooms ?? []).filter { $0.buildingId == "J18" && ($0.selectable ?? false) }
    }

    /// Active staff people who can be responsible owners.
    var staffOwners: [Person] {
        let activeAccounts = Set((snapshot?.staffDirectory ?? []).filter { $0.active ?? true }.map(\.id))
        return (snapshot?.people ?? [])
            .filter { $0.role == "staff" && $0.accountId != nil && activeAccounts.contains($0.accountId!) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
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

    @ObservationIgnored private let gate = RefreshGate()

    func refresh() async {
        guard let app, app.preview == nil else { return }
        await gate.run { [weak self] in await self?.load() }
    }

    private func load() async {
        guard let app else { return }
        let dataset = app.dataset
        loading = true
        defer { loading = false }
        do {
            let response = try await app.service.messages(dataset)
            // Never show another inventory's messages after a switch.
            guard dataset == app.dataset else { return }
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

// MARK: - Refresh coalescing

/// Runs one refresh at a time. Callers that arrive while one is running share a single follow-up,
/// which starts after the current one ends and so reflects anything that changed meanwhile.
@MainActor
final class RefreshGate {
    private var current: Task<Void, Never>?
    private var followUp: Task<Void, Never>?

    func run(_ work: @escaping @MainActor () async -> Void) async {
        guard let running = current else {
            await begin(work).value
            return
        }
        if followUp == nil {
            followUp = Task { @MainActor [weak self] in
                await running.value
                guard let self else { return }
                self.followUp = nil
                await self.begin(work).value
            }
        }
        await followUp?.value
    }

    private func begin(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let task = Task { @MainActor in await work() }
        current = task
        Task { @MainActor [weak self] in
            await task.value
            if self?.current == task { self?.current = nil }
        }
        return task
    }
}
