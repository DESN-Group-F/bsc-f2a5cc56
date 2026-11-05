import Observation
import SwiftUI
import UIKit

enum AppTab: Hashable { case scan, inventory, inbox, me }

enum SessionState: Equatable {
    case checking
    case signedOut
    case signedIn(StaffUser)
}

/// A group checkout flow, shown as one sheet above the tabs wherever it was started.
enum GroupFlow: Identifiable, Equatable {
    /// Open group checkouts and your groups, from the Groups button on Scan.
    case hub
    /// Review and check out a whole teaching group.
    case checkout(groupId: String)
    /// Return all or part of one group checkout.
    case returnRun(runId: String)

    var id: String {
        switch self {
        case .hub: return "hub"
        case .checkout(let id): return "checkout-" + id
        case .returnRun(let id): return "return-" + id
        }
    }
}

/// Where a screen's Ink sits, so one Ink can travel from sign-in to the scan stage.
enum InkStage: Hashable { case signIn, scan }

/// The Ink that travels between screens. Its frame is in window coordinates.
struct InkTravel: Equatable {
    var frame: CGRect
    /// Ink is drawn at its starting size and scaled, so the simulation never sees a half-animated layout.
    var baseSide: CGFloat
    /// False while it still wears the sign-in success green; true once it heads for the stage.
    var departed = false
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
    /// The group checkout sheet, from Scan, a group's page or a scan suggestion.
    var groupFlow: GroupFlow?
    /// Batteries just looked up by tag or label, shown as cards when the reader or camera closes.
    var lookup: LookupPresentation?
    /// The label camera, for a look-up or for adding to the scan station's list.
    var labelScan: LabelScanPurpose?
    private(set) var dataset: Dataset = .demo
    /// Shown on the launch screen when the session couldn't be checked (offline, server down).
    private(set) var launchError: String?
    /// Window-space frames of each screen's Ink, reported by the screens themselves.
    var inkAnchors: [InkStage: CGRect] = [:]
    /// Non-nil while the travelling Ink is on screen (sign-in → Scan).
    var travel: InkTravel?
    private var lastSignedInId: String?

    /// Switching inventory clears what was loaded for the previous one.
    func select(_ newValue: Dataset) {
        guard newValue != dataset else { return }
        guard !scan.hasUnsettledWork, !writes.hasPending else { return }
        dataset = newValue
        UserDefaults.standard.set(newValue.rawValue, forKey: "dataset")
        inventory.reset()
        runs.reset()
        groupFlow = nil
        lookup = nil
        labelScan = nil
        if let user, let saved = SessionCache.snapshot(accountId: user.id, dataset: newValue) {
            // Show the saved copy of the other inventory at once; the refresh replaces it.
            inventory.restore(saved.0, savedAt: saved.1)
        }
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
    let runs: TeachingRunsModel

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
        runs = TeachingRunsModel()
        if let raw = UserDefaults.standard.string(forKey: "dataset"), let saved = Dataset(rawValue: raw) { dataset = saved }
        inventory.app = self
        scan.app = self
        inbox.app = self
        writes.app = self
        runs.app = self
        if let preview {
            PreviewFixtures.apply(preview, to: self)
        } else if service.client.hasSession, let user = SessionCache.user() {
            // Signed in last time: open straight onto Scan with what was saved, then confirm with the server.
            // The first frame after the system launch screen is the app itself — no splash, no wait.
            session = .signedIn(user)
            lastSignedInId = user.id
            if let saved = SessionCache.snapshot(accountId: user.id, dataset: dataset) {
                inventory.restore(saved.0, savedAt: saved.1)
            }
        } else if !service.client.hasSession {
            // The session ended while the app was closed: nothing saved for it stays on the phone.
            SessionCache.clear()
        }
    }

    /// False only while the scan stage waits to rise in around the Ink arriving from sign-in.
    var stageShown = true

    // MARK: Session

    func start() async {
        guard preview == nil else { return }
        if let user {
            await resume(user)
            return
        }
        await checkSession()
    }

    /// Opened from the saved session: local work comes back at once, then the server confirms.
    private func resume(_ cached: StaffUser) async {
        writes.load()
        scan.loadPending()
        do {
            let response = try await service.session()
            // A sign-out tapped while this was in flight wins.
            guard case .signedIn(let shown) = session, shown.id == cached.id else { return }
            guard let current = response.user else { endSession(); return }
            if current.id != cached.id {
                // The server knows someone else: take its word and start clean for them.
                await signedIn(current, greet: false)
                return
            }
            SessionCache.saveUser(current)
            session = .signedIn(current)
            await refreshAll()
        } catch let failure as APIFailure where failure.kind == .unauthorized {
            guard user?.id == cached.id else { return }
            endSession()
        } catch {
            // Offline or the server is down: stay signed in. Reads show the saved copy if there is one;
            // writes still go through the exact-request rules and are refused or retried by the server.
            guard user?.id == cached.id else { return }
            await refreshAll()
            if inventory.snapshot != nil {
                inventory.lastError = "Can't reach the server. Showing the copy saved on this iPhone."
            }
        }
    }

    /// No saved session to open: check with the server while Ink waits on the launch screen.
    func checkSession() async {
        session = .checking
        guard service.client.hasSession else { endSession(); return }
        do {
            let response = try await service.session()
            guard session == .checking else { return }
            if let user = response.user { await signedIn(user, greet: false) } else { endSession() }
        } catch let failure as APIFailure where failure.kind == .unauthorized {
            endSession()
        } catch {
            guard session == .checking else { return }
            // Don't sign anyone out because the network dropped; offer to try again.
            launchError = "Can't reach the server. Check your connection and try again."
        }
    }

    /// Checks the credentials. The caller plays the success moment, then calls `enter`.
    func signIn(username: String, password: String) async throws -> StaffUser {
        let user = try await service.signIn(username: username, password: password)
        // Pair the new token with this person straight away; nothing saved for anyone else survives.
        if SessionCache.user()?.id != user.id { SessionCache.clear() }
        SessionCache.saveUser(user)
        Haptics.confirmed()
        return user
    }

    /// Opens the app after sign-in. Ink travels from the sign-in header to the scan stage while
    /// the inventory loads; the two never wait for each other.
    func enter(_ user: StaffUser, inkFrame: CGRect?) async {
        let animate = inkFrame != nil && !UIAccessibility.isReduceMotionEnabled
        if animate, let inkFrame {
            inkAnchors[.scan] = nil
            stageShown = false
            travel = InkTravel(frame: inkFrame, baseSide: max(inkFrame.width, 1))
        }
        Task { await signedIn(user, greet: !animate) }
        guard animate else { return }
        // Wait (briefly) for Scan to lay out and report where its Ink sits.
        for _ in 0..<30 where inkAnchors[.scan] == nil {
            try? await Task.sleep(for: .milliseconds(16))
        }
        guard let target = inkAnchors[.scan] else { travel = nil; stageShown = true; greet(user); return }
        travel?.departed = true
        stageShown = true
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) { travel?.frame = target }
        try? await Task.sleep(for: .seconds(0.58))
        withAnimation(.easeOut(duration: 0.14)) { travel = nil }
        greet(user)
    }

    private func greet(_ user: StaffUser) {
        let first = user.displayName.split(separator: " ").first.map(String.init) ?? user.displayName
        scan.greet("Welcome back, \(first) · \(dataset.title)")
    }

    private func signedIn(_ user: StaffUser, greet shouldGreet: Bool) async {
        if UserDefaults.standard.string(forKey: "dataset") == nil, let preferred = user.defaultDataset {
            dataset = preferred
            // Remember it, so the next launch (which opens from the saved session) uses it too.
            UserDefaults.standard.set(preferred.rawValue, forKey: "dataset")
        }
        if let previous = lastSignedInId, previous != user.id {
            // Someone else signs in on this phone: nothing of the previous person's stays on screen.
            inventory.reset()
            scan.resetForNewAccount()
            scan.unloadIntake()
            inbox.reset()
            writes.reset()
            runs.reset()
            groupFlow = nil
            lookup = nil
            labelScan = nil
        }
        lastSignedInId = user.id
        SessionCache.saveUser(user)
        tab = .scan
        launchError = nil
        session = .signedIn(user)
        if shouldGreet { greet(user) }
        writes.load()
        scan.loadPending()
        await refreshAll()
    }

    /// The server says this session is over. Saved read copies go; pending writes stay on disk
    /// for the same account, as before.
    private func endSession() {
        SessionCache.clear()
        session = .signedOut
    }

    func signOut() async {
        await service.signOut()
        SessionCache.clear()
        inkAnchors = [:]
        inventory.reset()
        scan.reset()
        scan.unloadIntake()
        inbox.reset()
        writes.reset()
        runs.reset()
        registration = nil
        groupFlow = nil
        lookup = nil
        labelScan = nil
        session = .signedOut
        tab = .scan
    }

    /// Any 401 ends the local session; pending writes stay on disk for the same account.
    func handle(_ error: Error) {
        if let failure = error as? APIFailure, failure.kind == .unauthorized {
            endSession()
        }
    }

    func refreshAll() async {
        guard preview == nil, user != nil else { return }
        async let a: Void = inventory.refresh()
        async let b: Void = inbox.refresh()
        async let c: Void = runs.refresh()
        _ = await (a, b, c)
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
    /// True while the list on screen is the copy saved at the last launch, not yet refreshed.
    private(set) var isSavedCopy = false

    func restore(_ saved: InventorySnapshot, savedAt: Date) {
        snapshot = saved
        // Age the saved server clock by how long the copy has been sitting, so 48-hour labels stay honest.
        receivedUptime = ProcessInfo.processInfo.systemUptime - max(0, Date().timeIntervalSince(savedAt))
        lastRefreshed = savedAt
        isSavedCopy = true
    }
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
        isSavedCopy = false
    }

    private let gate = RefreshGate()

    /// A refresh asked for while one is on the wire waits for a fresh one instead of being dropped,
    /// so a just-registered tag or a just-switched inventory is never judged on stale data.
    func refresh() async {
        guard let app, app.preview == nil else { return }
        await gate.run { [weak self] in await self?.load() }
    }

    private func load() async {
        guard let app, app.user != nil else { return }
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
            isSavedCopy = false
            if case .signedIn = app.session { SessionCache.save(snap) }
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

    /// Buildings a new battery may be stored in: the supported list, in its order, as this inventory records them.
    var storageBuildings: [Building] {
        let recorded = snapshot?.buildings ?? []
        return StorageBuildings.supported.compactMap { id in recorded.first { $0.id == id } }
    }

    /// Rooms a new battery's registered home may use in a building: selectable rooms, which exist only in J18.
    func registrationRooms(in buildingId: String) -> [Room] {
        guard StorageBuildings.hasRooms(buildingId) else { return [] }
        return (snapshot?.rooms ?? []).filter { $0.buildingId == buildingId && ($0.selectable ?? false) }
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
    /// True once a load has succeeded for this inventory, so "empty" is never shown while unknown.
    private(set) var loaded = false

    var tasks: [InboxMessage] { messages.filter(\.isOpenTask) }
    var others: [InboxMessage] { messages.filter { !$0.isOpenTask } }

    func reset() { messages = []; unreadCount = 0; lastError = nil; loaded = false }

    private let gate = RefreshGate()

    func refresh() async {
        guard let app, app.preview == nil else { return }
        await gate.run { [weak self] in await self?.load() }
    }

    private func load() async {
        guard let app, let viewer = app.user?.id else { return }
        let dataset = app.dataset
        loading = true
        defer { loading = false }
        do {
            let response = try await app.service.messages(dataset)
            // Never show another inventory's or another person's messages.
            guard dataset == app.dataset, viewer == app.user?.id else { return }
            messages = response.messages.sorted { $0.createdAt > $1.createdAt }
            unreadCount = response.unreadCount ?? messages.filter(\.isUnread).count
            lastError = nil
            loaded = true
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

// MARK: - Group checkouts

/// Your group checkouts in this inventory, as the server lists them. Used for display and for
/// suggestions only: a return always reads its run fresh before sending.
@MainActor
@Observable
final class TeachingRunsModel {
    weak var app: AppModel?
    private(set) var runs: [TeachingRun] = []
    private(set) var loaded = false
    var lastError: String?
    /// Bumped on every successful load, so open reviews can reclassify against the latest runs.
    private(set) var generation = 0

    private let gate = RefreshGate()

    func reset() { runs = []; loaded = false; lastError = nil; generation += 1 }

    var open: [TeachingRun] { runs.filter(\.isOpen) }

    func open(forGroup id: String) -> [TeachingRun] { open.filter { $0.teachingGroup.id == id } }

    /// The open run that has this battery out on this exact loan.
    func openRun(holding battery: BatteryRecord) -> TeachingRun? {
        guard let loan = battery.loanId else { return nil }
        return open.first { run in run.outstanding.contains { $0.batteryId == battery.id && $0.loanId == loan } }
    }

    func refresh() async {
        guard let app, app.preview == nil else { return }
        await gate.run { [weak self] in await self?.load() }
    }

    private func load() async {
        guard let app, let viewer = app.user?.id else { return }
        let dataset = app.dataset
        do {
            let list = try await app.service.teachingRuns(dataset)
            // Never show another inventory's or another person's checkouts.
            guard dataset == app.dataset, viewer == app.user?.id else { return }
            runs = list.filter { $0.actorAccountId == viewer && $0.dataset == dataset }
            loaded = true
            lastError = nil
            generation += 1
        } catch {
            guard dataset == app.dataset, viewer == app.user?.id else { return }
            lastError = (error as? APIFailure)?.message ?? "Couldn't load group checkouts."
            app.handle(error)
        }
    }

    /// Reads one run fresh and keeps the list in step with it.
    func latest(_ id: String) async throws -> TeachingRun? {
        guard let app, let viewer = app.user?.id else { return nil }
        if app.preview != nil { return runs.first { $0.id == id } }
        let dataset = app.dataset
        let run = try await app.service.teachingRun(dataset, id: id)
        guard dataset == app.dataset, viewer == app.user?.id else { return nil }
        if let run, run.dataset == dataset {
            if let index = runs.firstIndex(where: { $0.id == id }) { runs[index] = run } else if run.actorAccountId == viewer { runs.insert(run, at: 0) }
            return run
        }
        runs.removeAll { $0.id == id }
        return nil
    }

    func preview(_ list: [TeachingRun]) {
        runs = list
        loaded = true
    }
}

// MARK: - Refresh coalescing

/// Runs one refresh at a time. Callers that arrive while one is running are answered by one more
/// pass that starts after it, so they always see data fetched after they asked.
@MainActor
final class RefreshGate {
    private var running = false
    private var again = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func run(_ work: @escaping @MainActor () async -> Void) async {
        if running {
            again = true
            await withCheckedContinuation { waiting.append($0) }
            return
        }
        running = true
        repeat {
            again = false
            await work()
        } while again
        running = false
        let done = waiting
        waiting = []
        done.forEach { $0.resume() }
    }
}
