import Observation
import SwiftUI
import UIKit

/// Summary of a server-confirmed movement, shown on the done screen.
struct DoneBattery: Identifiable, Equatable {
    let id: String
    let name: String
}

struct DoneSummary: Equatable {
    let kind: MovementKind
    let batteries: [DoneBattery]
    let at: String
    let replayed: Bool
    let roomLabel: String?
    /// Retirement only: "scrapped" or "permanently removed", and the recorded reason.
    var verb: String? = nil
    var note: String? = nil

    var title: String {
        let n = batteries.count
        return "\(n) \(n == 1 ? "battery" : "batteries") \(verb ?? kind.pastTense)"
    }
}

/// The scan station: one list, one confirm. Nothing is sent until the user confirms,
/// and nothing is shown as done until the server's receipt is verified.
@MainActor
@Observable
final class ScanModel {
    enum Source: String { case nfc = "native_nfc", selection = "selection" }

    enum Phase: Equatable {
        case scanning
        case submitting
        case done(DoneSummary)
        case uncertain
    }

    struct Item: Identifiable, Equatable {
        let battery: BatteryRecord
        let tagId: String?
        let evidence: NFCEvidence?
        var id: String { battery.id }
    }

    struct Notice: Equatable {
        enum Kind: Equatable { case duplicate, refused, info, greeting }
        let kind: Kind
        let text: String
        var actionTitle: String? = nil
        /// What the system tag sheet says, when it differs from the on-screen text.
        var sheetText: String? = nil
        let id = UUID()
        /// A notice with an action stays until the next scan or until it's used.
        var isSticky: Bool { actionTitle != nil }
    }

    weak var app: AppModel?

    var mode: MovementKind = .checkout
    private(set) var items: [Item] = []
    private(set) var source: Source?
    private(set) var phase: Phase = .scanning
    private(set) var notice: Notice?
    private(set) var mood: InkMood = .idle
    private(set) var reaction = 0
    private(set) var latestId: String?
    private(set) var readerActive = false
    private(set) var pendingWrites: [PendingMovement] = []
    /// Set when the list was started from a teaching group; the movement then carries the group reference.
    private(set) var group: TeachingGroup?
    /// The last tag that wasn't registered, so "Register" can carry its evidence (Demo only).
    private(set) var unregisteredRead: TagRead?
    var returnRoomId: String?
    /// Retire mode: outcome and optional details, chosen before confirming.
    var retireKind = "scrapped"
    var retireReason = ""
    var retireDestination = ""
    var confirmPermanent = false
    /// The lifecycle request sent from this station, while its outcome is unknown.
    private(set) var retireRequestId: String?
    var showChooser = false
    var submissionError: String?

    private var sessionId = RequestID.make()
    private let reader = NFCReader()
    private var moodToken = 0
    private var noticeToken = 0

    var hasUnsettledWork: Bool { !pendingWrites.isEmpty || phase == .submitting }

    var retireConfirmTitle: String {
        let n = items.count
        let what = n == 1 ? "battery" : "\(n) batteries"
        return retireKind == "scrapped" ? "Scrap \(what)" : "Remove \(what) permanently"
    }
    var isEmpty: Bool { items.isEmpty }

    /// Ink's colour: green on success, red on refusal, otherwise the action's colour.
    var tint: Color {
        switch mood {
        case .happy: return Tone.success
        case .surprised: return Tone.failure
        default: return mode.tint
        }
    }

    var readerPrompt: String {
        if mode == .register {
            let n = intakeEntries.filter { $0.status == .draft }.count
            return n == 0 ? "Hold the top of your iPhone near a new battery's tag."
                : "\(n) new in your batch. Hold near the next one, or tap Cancel to review — your batch stays."
        }
        guard !items.isEmpty else { return "Hold the top of your iPhone near a battery tag." }
        let added = latestId.map { "\($0) added · " } ?? ""
        return "\(added)\(items.count) to \(mode.title.lowercased()). Hold near the next one, or tap Cancel to review — your list stays."
    }

    /// Batch registration progress while the requests go out one by one.
    private(set) var intakeProgress: (sent: Int, total: Int)?

    /// Whether the station currently shows a list for the selected action.
    var hasList: Bool { mode == .register ? !intakeEntries.isEmpty : !items.isEmpty }
    var listCount: Int { mode == .register ? intakeEntries.count : items.count }

    // MARK: Lifecycle

    func reset() {
        reader.stop()
        items = []
        source = nil
        sessionId = RequestID.make()
        notice = nil
        mood = .idle
        latestId = nil
        returnRoomId = nil
        submissionError = nil
        group = nil
        unregisteredRead = nil
        retireReason = ""
        retireDestination = ""
        if phase != .uncertain { phase = .scanning }
    }

    /// A different person signed in: drop the previous person's station state entirely.
    /// Their unresolved requests stay on disk under their account and come back when they sign in.
    func resetForNewAccount() {
        reset()
        retireRequestId = nil
        pendingWrites = []
        phase = .scanning
    }

    func greet(_ text: String) {
        show(.init(kind: .greeting, text: text))
        setMood(.happy, hold: 0.9)
        reaction += 1
    }

    func scanMore() {
        guard pendingWrites.isEmpty, retireRequestId == nil else { phase = .uncertain; return }
        notice = nil
        retireReason = ""
        retireDestination = ""
        items = []
        source = nil
        sessionId = RequestID.make()
        latestId = nil
        group = nil
        mood = .idle
        phase = .scanning
    }

    func setMode(_ newMode: MovementKind) {
        // From the done screen, picking an action simply starts the next round.
        if case .done = phase { scanMore() }
        guard phase == .scanning, newMode != mode else { return }
        // A list in progress: ask what to do with it instead of refusing (a batch intake is saved
        // separately, so switching to or from Register never touches it).
        if !items.isEmpty && newMode != .register {
            modeSwitch = newMode
            return
        }
        mode = newMode
        Haptics.tap()
    }

    /// The action the user picked while a list was in progress; drives the switch dialog.
    var modeSwitch: MovementKind?

    /// Whether a battery already in the list can go straight into another action.
    func fits(_ battery: BatteryRecord, _ kind: MovementKind) -> Bool {
        guard battery.isActive else { return false }
        switch kind {
        case .checkout: return battery.isInStore
        case .return: return battery.isInUse
        case .retire: return !battery.isInUse
        case .register: return false
        }
    }

    func carryCount(to kind: MovementKind) -> Int { items.filter { fits($0.battery, kind) }.count }

    /// Switches action, keeping the batteries that fit the new one (and their tag evidence).
    /// Nothing is sent: the moved list is reviewed and confirmed on the new action as usual.
    func switchMode(to kind: MovementKind, keepingList keep: Bool) {
        modeSwitch = nil
        guard phase == .scanning else { return }
        let before = items.count
        if keep {
            items = items.filter { fits($0.battery, kind) }
        } else {
            items = []
            sessionId = RequestID.make()
        }
        // A teaching-group reference and return room belong to the old action.
        group = nil
        returnRoomId = nil
        retireReason = ""
        retireDestination = ""
        latestId = items.first?.id
        if items.isEmpty { source = nil }
        mode = kind
        Haptics.tap()
        let dropped = before - items.count
        if keep && dropped > 0 {
            show(.init(kind: .info, text: "\(items.count) moved to \(kind.title) · \(dropped) didn't fit and were left out"))
        }
    }

    // MARK: Reading tags

    func tapInk() {
        // The station stays open after a confirmed result: tapping Ink starts the next round.
        if case .done = phase { scanMore() }
        guard let app, phase == .scanning else { return }
        if readerActive { return }
        if mode == .register && !(app.dataset.allowsNFCWrites && NFCReader.isAvailable) {
            // Without tag scanning, registration is one battery at a time with the form.
            app.registration = RegistrationRequest()
            return
        }
        guard app.dataset.allowsNFCWrites else {
            show(.init(kind: .info, text: "Tag scanning is Demo-only for now. Pick batteries from the list."))
            showChooser = true
            return
        }
        guard NFCReader.isAvailable else {
            show(.init(kind: .info, text: "This iPhone can't read tags. Pick batteries from the list."))
            showChooser = true
            return
        }
        if source == .selection && !items.isEmpty {
            show(.init(kind: .info, text: "This list was picked by hand. Confirm or clear it before scanning tags."))
            return
        }
        readerActive = true
        setMood(.listening, hold: nil)
        Haptics.prepare()
        reader.prompt = readerPrompt
        reader.start { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
    }

    private func handle(_ event: ReaderEvent) {
        switch event {
        case .read(let read):
            Task { await accept(read) }
        case .failed(let message):
            show(.init(kind: .refused, text: message))
        case .ended:
            readerActive = false
            if mood == .listening { setMood(.idle, hold: nil) }
        }
    }

    private func accept(_ read: TagRead) async {
        guard let app else { return }
        if mode == .register {
            addIntake(read)
            reader.prompt = readerPrompt
            return
        }
        var battery = app.inventory.battery(tagId: read.tagId)
        if battery == nil {
            // Maybe registered moments ago on another device.
            await app.inventory.refresh()
            battery = app.inventory.battery(tagId: read.tagId)
        }
        guard let battery else {
            unregisteredRead = read
            refuse("This tag isn't registered", action: "Register",
                   sheet: "This tag isn't registered. Tap Cancel, then Register to add it.")
            return
        }
        let evidence = read.evidence(adoptedAt: Sydney.timestamp())
        add(battery, tagId: read.tagId, evidence: evidence, from: .nfc)
        reader.prompt = readerPrompt
    }

    /// Adds batteries picked from the list.
    func addSelected(_ batteries: [BatteryRecord]) {
        guard phase == .scanning else { return }
        if source == .nfc && !items.isEmpty {
            show(.init(kind: .info, text: "This list came from tag scans. Confirm or clear it before adding by hand."))
            return
        }
        for battery in batteries { add(battery, tagId: battery.tagId, evidence: nil, from: .selection) }
    }

    /// Starts a fresh list with one battery, e.g. from its detail page.
    func begin(with battery: BatteryRecord) {
        if case .done = phase { scanMore() }
        guard pendingWrites.isEmpty, phase != .submitting else { return }
        reset()
        mode = battery.isInUse ? .return : .checkout
        add(battery, tagId: battery.tagId, evidence: nil, from: .selection)
    }

    /// Starts a fresh list from a teaching group's members. The confirm carries the group reference,
    /// so the server checks membership and records the group in its history.
    func begin(group: TeachingGroup, batteries: [BatteryRecord], mode newMode: MovementKind) {
        if case .done = phase { scanMore() }
        guard pendingWrites.isEmpty, phase != .submitting, !batteries.isEmpty else { return }
        reset()
        mode = newMode
        for battery in batteries { add(battery, tagId: battery.tagId, evidence: nil, from: .selection) }
        self.group = group
        show(.init(kind: .info, text: "\(group.name) · \(items.count) \(items.count == 1 ? "battery" : "batteries")"))
    }

    /// Starts a fresh list from batteries chosen in Inventory.
    func begin(list batteries: [BatteryRecord], mode newMode: MovementKind) {
        if case .done = phase { scanMore() }
        guard pendingWrites.isEmpty, phase != .submitting, !batteries.isEmpty else { return }
        reset()
        mode = newMode
        for battery in batteries { add(battery, tagId: battery.tagId, evidence: nil, from: .selection) }
    }

    /// Opens registration for the tag that just failed lookup.
    func registerUnregisteredTag() {
        guard let app else { return }
        if let read = unregisteredRead, app.dataset.allowsNFCWrites, items.isEmpty, phase == .scanning {
            // Start (or add to) a batch intake with the tag that was just read.
            mode = .register
            addIntake(read)
            return
        }
        app.registration = RegistrationRequest(tagRead: app.dataset.allowsNFCWrites ? unregisteredRead : nil)
    }

    private func add(_ battery: BatteryRecord, tagId: String?, evidence: NFCEvidence?, from newSource: Source) {
        guard let app else { return }
        if items.contains(where: { $0.battery.id == battery.id }) {
            show(.init(kind: .duplicate, text: "Already in the list · \(battery.id)"))
            setMood(.puzzled, hold: 1.4)
            Haptics.duplicate()
            return
        }
        guard battery.isActive else {
            refuse("\(battery.id) is \(battery.statusTitle.lowercased())")
            return
        }
        if mode == .retire {
            if battery.isInUse {
                refuse("\(battery.id) is \(holderPhrase(battery, me: app.user?.id)) — return it first")
                return
            }
        } else if items.isEmpty {
            // The first battery decides the action, so nobody has to pick it in advance.
            if mode == .checkout && battery.isInUse {
                mode = .return
                show(.init(kind: .info, text: "Switched to Return — it's \(holderPhrase(battery, me: app.user?.id))"))
            } else if mode == .return && battery.isInStore {
                mode = .checkout
                show(.init(kind: .info, text: "Switched to Check out — it's in store"))
            }
        } else if mode == .checkout && battery.isInUse {
            refuse("\(battery.id) is \(holderPhrase(battery, me: app.user?.id)) — return it first")
            return
        } else if mode == .return && battery.isInStore {
            refuse("\(battery.id) is already in store")
            return
        }
        if let current = group, !current.batteryIds.contains(battery.id) {
            group = nil
            show(.init(kind: .info, text: "\(battery.id) isn't in \(current.name), so this is now an ordinary list"))
        }
        items.insert(Item(battery: battery, tagId: tagId, evidence: evidence), at: 0)
        if notice?.isSticky == true { notice = nil }
        source = newSource
        latestId = battery.id
        setMood(.happy, hold: 0.7)
        reaction += 1
        Haptics.accepted()
    }

    func remove(_ item: Item) {
        guard phase == .scanning else { return }
        items.removeAll { $0.id == item.id }
        if items.isEmpty {
            source = nil
            sessionId = RequestID.make()
            latestId = nil
            group = nil
        }
        Haptics.tap()
    }

    func clear() {
        guard phase == .scanning else { return }
        reader.stop()
        items = []
        source = nil
        sessionId = RequestID.make()
        latestId = nil
        group = nil
    }

    private func holderPhrase(_ battery: BatteryRecord, me: String?) -> String {
        if battery.borrowerAccountId != nil && battery.borrowerAccountId == me { return "with you" }
        return "with \(StatusPill.shortName(battery.borrowerName))"
    }

    private func refuse(_ text: String, action: String? = nil, sheet: String? = nil) {
        show(.init(kind: .refused, text: text, actionTitle: action, sheetText: sheet))
        setMood(.surprised, hold: 1.4)
        Haptics.refused()
    }

    private func show(_ newNotice: Notice) {
        notice = newNotice
        noticeToken += 1
        let token = noticeToken
        // The system sheet hides the app while scanning, so the outcome goes there too.
        if readerActive, newNotice.kind != .greeting {
            reader.flash(newNotice.sheetText ?? newNotice.text)
        }
        let voiceOver = UIAccessibility.isVoiceOverRunning
        if voiceOver, !readerActive {
            UIAccessibility.post(notification: .announcement, argument: newNotice.text)
        }
        guard !newNotice.isSticky else { return }
        let seconds = voiceOver ? 4.5 : 2.6
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            if token == self.noticeToken { self.notice = nil }
        }
    }

    func dismissNotice() {
        notice = nil
        noticeToken += 1
    }

    private func setMood(_ newMood: InkMood, hold: Double?) {
        mood = newMood
        moodToken += 1
        guard let hold else { return }
        let token = moodToken
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(hold))
            if token == self.moodToken { self.mood = self.readerActive ? .listening : .idle }
        }
    }

    // MARK: Confirming

    func confirm() async {
        if mode == .register {
            await confirmIntake()
            return
        }
        guard let app, let user = app.user, phase == .scanning, !items.isEmpty, pendingWrites.isEmpty else { return }
        if mode == .retire {
            await confirmRetire()
            return
        }
        guard !app.writes.hasPending else {
            submissionError = "Another request is waiting for confirmation. Try it again first (Inventory or Me)."
            return
        }
        reader.stop()
        submissionError = nil
        let requestId = RequestID.make()
        let ordered = items.sorted { $0.battery.id < $1.battery.id }
        let ids = ordered.map(\.battery.id)
        let usedSource = source ?? .selection
        let bindings = ordered.map { item in
            ScanBinding(batteryId: item.battery.id,
                        tagId: usedSource == .nfc ? item.tagId : item.battery.tagId,
                        version: item.battery.version,
                        nfcEvidence: usedSource == .nfc ? item.evidence : nil)
        }
        let loans: [ExpectedLoan]? = mode == .return
            ? ordered.compactMap { item in item.battery.loanId.map { ExpectedLoan(batteryId: item.battery.id, loanId: $0) } }
            : nil
        var room: RoomReference?
        if mode == .return, let roomId = returnRoomId,
           let match = app.inventory.rooms(eligibleFor: app.dataset).first(where: { $0.id == roomId }) {
            room = RoomReference(roomId: match.id, version: match.version)
        }
        var payload = MovementPayload(kind: mode.rawValue, requestId: requestId, batteryIds: ids, expectedLoans: loans,
                                      scan: ScanContext(sessionId: sessionId, source: usedSource.rawValue, bindings: bindings),
                                      returnRoom: room)
        if let group, ids.allSatisfy({ group.batteryIds.contains($0) }) {
            payload.teachingGroup = GroupReference(id: group.id, version: group.version)
        }
        let body: Data
        do {
            body = try JSONEncoder().encode(InventoryWrite(dataset: app.dataset, action: "movement", payload: payload))
        } catch {
            submissionError = "Couldn't prepare the request."
            return
        }
        let entry = PendingMovement(id: requestId, accountId: user.id, dataset: app.dataset, kind: mode.rawValue,
                                    batteryIds: ids, body: body, createdAt: Date(), attempts: 0)
        // Save before sending; if the phone can't keep it, don't send it.
        do { try app.pending.save(entry) } catch {
            submissionError = "Couldn't save the request on this iPhone, so nothing was sent."
            return
        }
        pendingWrites = [entry]
        phase = .submitting
        await send(entry, isRetry: false)
    }

    // MARK: Batch intake (Register)

    private(set) var intakeEntries: [IntakeEntry] = []
    private(set) var intakeDetails = RegistrationDetails()
    private var intakeSessionId = RequestID.make()
    private var intakeSessionDetails: RegistrationDetails?
    private var intakeOwner: (account: String, dataset: Dataset)?
    var showBatchDetails = false

    var intakeDraftCount: Int { intakeEntries.filter { $0.status == .draft || $0.isFailed }.count }
    var intakeHasUncertain: Bool { intakeEntries.contains { $0.status == .uncertain } }
    var intakeProblems: [String] {
        guard let app else { return [] }
        return intakeDetails.problems(in: app.inventory)
    }

    private func loadIntake() {
        guard let app, let user = app.user else { return }
        intakeOwner = (user.id, app.dataset)
        if let file = IntakeStore.load(accountId: user.id, dataset: app.dataset) {
            intakeDetails = file.details
            intakeSessionId = file.sessionId
            intakeSessionDetails = file.sessionDetails
            intakeEntries = file.entries
        } else {
            intakeDetails = RegistrationDetails()
            intakeSessionId = RequestID.make()
            intakeSessionDetails = nil
            intakeEntries = []
        }
        if intakeDetails.ownerId.isEmpty, let me = app.inventory.staffOwners.first(where: { $0.accountId == user.id }) {
            intakeDetails.ownerId = me.id
        }
    }

    @discardableResult
    private func saveIntake() -> Bool {
        guard let app, let user = app.user, app.preview == nil else { return true }
        guard intakeOwner?.account == user.id, intakeOwner?.dataset == app.dataset else { return false }
        return IntakeStore.save(IntakeBatchFile(details: intakeDetails, sessionId: intakeSessionId,
                                                sessionDetails: intakeSessionDetails, entries: intakeEntries),
                                accountId: user.id, dataset: app.dataset)
    }

    /// Forgets the in-memory batch (the saved file stays) when the account or inventory changes.
    func unloadIntake() {
        intakeOwner = nil
        intakeEntries = []
        intakeDetails = RegistrationDetails()
        intakeSessionDetails = nil
    }

    func updateIntakeDetails(_ details: RegistrationDetails) {
        intakeDetails = details
        saveIntake()
    }

    /// A successful single registration becomes the starting point for the next one.
    func rememberDetails(_ details: RegistrationDetails) {
        guard intakeEntries.isEmpty else { return }
        intakeDetails = details
        saveIntake()
    }

    private func addIntake(_ read: TagRead) {
        guard let app else { return }
        if intakeOwner == nil { loadIntake() }
        if let existing = app.inventory.battery(tagId: read.tagId) {
            refuse("Already registered as \(existing.id)")
            return
        }
        if intakeEntries.contains(where: { $0.tagId == read.tagId }) {
            show(.init(kind: .duplicate, text: "Already in the batch · \(read.tagId.replacingOccurrences(of: "nfc:uid:", with: ""))"))
            setMood(.puzzled, hold: 1.4)
            Haptics.duplicate()
            return
        }
        guard intakeEntries.count < 100 else {
            refuse("A batch holds up to 100 tags. Register these first.")
            return
        }
        intakeEntries.insert(IntakeEntry(tagId: read.tagId, evidence: read.evidence(adoptedAt: Sydney.timestamp()),
                                         requestId: nil, status: .draft), at: 0)
        guard saveIntake() else {
            intakeEntries.removeFirst()
            refuse("Couldn't save the scan on this iPhone. Try again.")
            return
        }
        latestId = intakeEntries[0].uid
        if notice?.isSticky == true { notice = nil }
        setMood(.happy, hold: 0.7)
        reaction += 1
        Haptics.accepted()
    }

    func removeIntake(_ entry: IntakeEntry) {
        guard phase == .scanning, entry.status != .uncertain else { return }
        intakeEntries.removeAll { $0.id == entry.id }
        saveIntake()
        Haptics.tap()
    }

    /// Settles uncertain entries whose request was resolved elsewhere (for example from the banner).
    private func reconcileIntake() {
        guard let app else { return }
        var changed = false
        let onDisk = Set(app.user.map { app.pending.all(accountId: $0.id, dataset: app.dataset).map(\.id) } ?? [])
        for index in intakeEntries.indices where intakeEntries[index].status == .uncertain {
            // Settled only when the exact request is gone from memory and from the phone's storage.
            guard let requestId = intakeEntries[index].requestId, app.writes.entry(id: requestId) == nil,
                  !onDisk.contains(requestId) else { continue }
            if let battery = app.inventory.battery(tagId: intakeEntries[index].tagId) {
                intakeEntries[index].status = .registered(battery.id)
            } else {
                // Settled without a registration we can see yet. Sending again is safe: a tag can only be registered once.
                intakeEntries[index].status = .draft
                intakeEntries[index].requestId = nil
            }
            changed = true
        }
        if changed { saveIntake() }
    }

    /// Registers every draft in the batch, one exact request per tag, stopping at the first unknown outcome.
    private func confirmIntake() async {
        guard let app, app.user != nil, phase == .scanning || phase == .submitting else { return }
        reconcileIntake()
        guard !intakeHasUncertain else { phase = .uncertain; return }
        let targets = intakeEntries.filter { $0.status == .draft || $0.isFailed }.map(\.id)
        guard !targets.isEmpty else { finishIntakeBatch(); return }
        guard app.dataset.allowsNFCWrites else {
            submissionError = "Batch registration with tags is Demo-only for now."
            return
        }
        guard intakeProblems.isEmpty, let common = intakeDetails.common(in: app.inventory) else {
            submissionError = "Check the batch details first."
            showBatchDetails = true
            return
        }
        guard !app.writes.hasPending, pendingWrites.isEmpty else {
            submissionError = "Another request is waiting for confirmation. Try it again first (Inventory or Me)."
            return
        }
        reader.stop()
        submissionError = nil
        if intakeSessionDetails != intakeDetails {
            intakeSessionId = RequestID.make()
            intakeSessionDetails = intakeDetails
        }
        phase = .submitting
        intakeProgress = (0, targets.count)
        defer { intakeProgress = nil }
        for (offset, id) in targets.enumerated() {
            intakeProgress = (offset, targets.count)
            guard let index = intakeEntries.firstIndex(where: { $0.id == id }) else { continue }
            let entry = intakeEntries[index]
            let requestId = RequestID.make()
            let payload = NFCIntakePayload(requestId: requestId, sessionId: intakeSessionId, scannedAt: entry.evidence.result.observedAt,
                                           common: common, firstUseMode: intakeDetails.firstUseMode, source: "native_nfc",
                                           nfcEvidence: entry.evidence, tagId: entry.tagId)
            guard let body = WriteCenter.inventoryBody(app.dataset, action: "intake", payload: payload) else { continue }
            intakeEntries[index].requestId = requestId
            intakeEntries[index].status = .uncertain
            saveIntake()
            let outcome = await app.writes.submit(action: "intake", kind: "register", title: "Registering tag \(entry.uid)",
                                                  batteryIds: [], requestId: requestId, body: body)
            guard let current = intakeEntries.firstIndex(where: { $0.id == id }) else { continue }
            switch outcome {
            case .confirmed(let result):
                intakeEntries[current].status = .registered(result.batteryId ?? "")
                saveIntake()
            case .rejected(let text):
                intakeEntries[current].status = .failed(text)
                saveIntake()
            case .notSent(let text):
                intakeEntries[current].status = entry.status
                intakeEntries[current].requestId = entry.requestId
                saveIntake()
                submissionError = text
                phase = .scanning
                return
            case .uncertain(let text):
                submissionError = text
                phase = .uncertain
                Haptics.refused()
                return
            }
        }
        finishIntakeBatch()
    }

    func retryIntake() async {
        guard let app, phase != .submitting else { return }
        reconcileIntake()
        guard let index = intakeEntries.firstIndex(where: { $0.status == .uncertain }),
              let requestId = intakeEntries[index].requestId, let pending = app.writes.entry(id: requestId) else {
            phase = .scanning
            if intakeEntries.contains(where: { $0.status == .draft }) { await confirmIntake() } else { finishIntakeBatch() }
            return
        }
        phase = .submitting
        let outcome = await app.writes.retry(pending)
        guard let current = intakeEntries.firstIndex(where: { $0.requestId == requestId }) else { return }
        switch outcome {
        case .confirmed(let result):
            intakeEntries[current].status = .registered(result.batteryId ?? "")
        case .rejected(let text):
            intakeEntries[current].status = .failed(text)
        case .notSent(let text), .uncertain(let text):
            submissionError = text
            phase = .uncertain
            return
        }
        saveIntake()
        phase = .scanning
        // Carry on with the drafts that hadn't been sent yet.
        if intakeEntries.contains(where: { $0.status == .draft }) { await confirmIntake() } else { finishIntakeBatch() }
    }

    /// Moves registered tags out of the batch. Rejected ones stay, with their reason, for review.
    private func finishIntakeBatch() {
        let registered = intakeEntries.compactMap { entry -> DoneBattery? in
            if case let .registered(id) = entry.status { return DoneBattery(id: id.isEmpty ? entry.uid : id, name: intakeDetails.name.jsTrimmed) }
            return nil
        }
        intakeEntries.removeAll { if case .registered = $0.status { return true } else { return false } }
        saveIntake()
        let failed = intakeEntries.filter(\.isFailed).count
        if !registered.isEmpty && failed == 0 {
            phase = .done(DoneSummary(kind: .register, batteries: registered.sorted { $0.id < $1.id }, at: Sydney.timestamp(),
                                      replayed: false, roomLabel: nil, verb: "registered", note: intakeDetails.specSummary))
            setMood(.happy, hold: 1.6)
            reaction += 1
            Task { await app?.inventory.refresh() }
        } else {
            phase = .scanning
            if failed > 0 {
                submissionError = registered.isEmpty
                    ? "\(failed) not registered — see the reasons in the list."
                    : "\(registered.count) registered. \(failed) not registered — see the reasons in the list."
                refuse(registered.isEmpty ? "Not registered" : "\(registered.count) registered, \(failed) not")
            }
            Task { await app?.inventory.refresh() }
        }
    }

    func previewIntake(_ reads: [TagRead], details: RegistrationDetails) {
        intakeDetails = details
        intakeEntries = reads.map { IntakeEntry(tagId: $0.tagId, evidence: $0.evidence(adoptedAt: Sydney.timestamp()), requestId: nil, status: .draft) }
        if intakeEntries.count > 2 { intakeEntries[2].status = .failed("This tag is already registered to another battery.") }
        mode = .register
        latestId = intakeEntries.first?.uid
    }

    // MARK: Retiring

    /// Sends the reviewed list as one `lifecycle` write through the shared write center.
    private func confirmRetire() async {
        guard let app else { return }
        guard !app.writes.hasPending else {
            submissionError = "Another request is waiting for confirmation. Try it again first (Inventory or Me)."
            return
        }
        reader.stop()
        submissionError = nil
        let requestId = RequestID.make()
        let ordered = items.sorted { $0.battery.id < $1.battery.id }
        let fromTags = source == .nfc
        let reason = retireReason.jsTrimmed
        let destination = retireDestination.jsTrimmed
        let payload = LifecyclePayload(
            requestId: requestId, kind: retireKind, reason: reason,
            destination: retireKind == "permanently_removed" && !destination.isEmpty ? destination : nil,
            source: fromTags ? "native_nfc" : "manual_selection",
            items: ordered.map { item in
                LifecycleItem(batteryId: item.battery.id, version: item.battery.version,
                              tagId: fromTags ? item.tagId : item.battery.tagId,
                              nfcEvidence: fromTags ? item.evidence : nil)
            })
        guard let body = WriteCenter.inventoryBody(app.dataset, action: "lifecycle", payload: payload) else {
            submissionError = "Couldn't prepare the request."
            return
        }
        retireRequestId = requestId
        phase = .submitting
        let n = ordered.count
        let title = n == 1 ? "Retiring \(ordered[0].battery.id)" : "Retiring \(n) batteries"
        let outcome = await app.writes.submit(action: "lifecycle", kind: retireKind, title: title,
                                              batteryIds: ordered.map(\.battery.id), requestId: requestId, body: body)
        await finishRetire(outcome)
    }

    func retryRetire() async {
        guard let app, let id = retireRequestId, let entry = app.writes.entry(id: id), phase != .submitting else { return }
        phase = .submitting
        await finishRetire(await app.writes.retry(entry))
    }

    var retireIsPending: Bool {
        guard let id = retireRequestId else { return false }
        return app?.writes.entry(id: id) != nil
    }

    private func finishRetire(_ outcome: WriteCenter.Outcome) async {
        guard let app else { return }
        switch outcome {
        case .confirmed:
            let names = Dictionary(uniqueKeysWithValues: items.map { ($0.battery.id, $0.battery.name) })
            let verb = retireKind == "scrapped" ? "scrapped" : "permanently removed"
            let reason = retireReason.jsTrimmed
            phase = .done(DoneSummary(kind: .retire,
                                      batteries: items.map(\.battery.id).sorted().map { DoneBattery(id: $0, name: names[$0] ?? "Battery") },
                                      at: Sydney.timestamp(), replayed: false, roomLabel: nil, verb: verb,
                                      note: reason.isEmpty ? nil : reason))
            retireRequestId = nil
            submissionError = nil
            setMood(.happy, hold: 1.6)
            reaction += 1
        case .rejected(let text), .notSent(let text):
            retireRequestId = nil
            phase = .scanning
            submissionError = text
            refuse(text)
            await app.inventory.refresh()
            reviewAgainstLatest()
        case .uncertain(let text):
            submissionError = text
            phase = .uncertain
        }
    }

    /// "Not confirmed yet" is only true while something is actually unresolved. A request can be settled
    /// elsewhere (the banner in Inventory or Me), so this brings the station back instead of leaving it stuck.
    func reconcileUncertain() async {
        guard let app, phase == .uncertain else { return }
        reconcileIntake()
        guard pendingWrites.isEmpty, !intakeHasUncertain else { return }
        if let id = retireRequestId {
            guard app.writes.entry(id: id) == nil else { return }
            retireRequestId = nil
            submissionError = nil
            phase = .scanning
            await app.inventory.refresh()
            reviewAgainstLatest()
            show(.init(kind: .info, text: items.isEmpty ? "Settled from the banner. The list is up to date."
                                                         : "Settled from the banner. Check the list before confirming."))
            return
        }
        submissionError = nil
        phase = .scanning
    }

    func retryPending() async {
        guard let entry = pendingWrites.first, phase != .submitting else { return }
        phase = .submitting
        await send(entry, isRetry: true)
    }

    func loadPending() {
        guard let app, let user = app.user else { return }
        pendingWrites = app.pending.all(accountId: user.id, dataset: app.dataset).filter(\.isMovement)
        if !pendingWrites.isEmpty { phase = .uncertain }
        loadIntake()
    }

    private func send(_ entry: PendingMovement, isRetry: Bool) async {
        guard let app else { return }
        var attempt = entry
        attempt.attempts += 1
        try? app.pending.save(attempt)
        pendingWrites = [attempt]
        do {
            let receipt = try await app.service.sendMovement(body: entry.body)
            guard receipt.requestId == entry.id,
                  receipt.kind == entry.kind,
                  receipt.batteryIds.count == entry.batteryIds.count,
                  Set(receipt.batteryIds).count == receipt.batteryIds.count,
                  Set(receipt.batteryIds) == Set(entry.batteryIds),
                  receipt.count == entry.batteryIds.count,
                  Sydney.date(receipt.at) != nil,
                  entry.kind != "checkout" || (receipt.borrowerAccountId == entry.accountId
                                               && !(receipt.borrower ?? "").trimmingCharacters(in: .whitespaces).isEmpty),
                  Self.groupEvidenceMatches(receipt.teachingGroup, entry: entry),
                  Self.scanEvidenceMatches(receipt.scan, entry: entry) else {
                markUncertain("The server's receipt didn't match this request. It's kept so you can check it.")
                return
            }
            settle(entry, receipt: receipt)
        } catch let failure as APIFailure {
            switch failure.kind {
            case .rejected where !isRetry || failure.isFinalRejection:
                app.pending.remove(id: entry.id)
                pendingWrites = []
                phase = .scanning
                submissionError = failure.message
                refuse(isRetry ? "Not recorded: \(failure.message)" : failure.message)
                await app.inventory.refresh()
                reviewAgainstLatest()
            case .unauthorized where !isRetry:
                // Nothing ran on this attempt. Keep the list; sign in and confirm again.
                app.pending.remove(id: entry.id)
                pendingWrites = []
                phase = .scanning
                app.handle(failure)
            default:
                markUncertain(failure.message)
                app.handle(failure)
            }
        } catch {
            markUncertain("Couldn't confirm with the server.")
        }
    }

    private struct GroupProbe: Decodable { let teachingGroup: GroupReference?; let scan: ScanEcho? }

    /// The receipt must retain the reviewed scan source and exact bindings (order-independent).
    static func scanEvidenceMatches(_ echoed: ScanEcho?, entry: PendingMovement) -> Bool {
        guard let sent = (try? JSONDecoder().decode(WriteEnvelope<GroupProbe>.self, from: entry.body))?.payload.scan else {
            return true
        }
        guard let echoed else { return false }
        return echoed.sorted == sent.sorted
    }

    /// After a rejection the reviewed versions, loans and group version are stale. Rebuild the list from
    /// the latest inventory so the next confirm is a fresh review, dropping batteries that no longer fit.
    private func reviewAgainstLatest() {
        guard let app else { return }
        var refreshed: [Item] = []
        var dropped: [String] = []
        for item in items {
            guard let latest = app.inventory.battery(id: item.battery.id), latest.isActive,
                  mode == .return ? latest.isInUse : latest.isInStore,
                  source != .nfc || latest.tagId == item.tagId else {
                dropped.append(item.battery.id)
                continue
            }
            refreshed.append(Item(battery: latest, tagId: source == .nfc ? item.tagId : latest.tagId, evidence: item.evidence))
        }
        items = refreshed
        if let current = group {
            group = app.inventory.groups.first { $0.id == current.id }
            if let updated = group, !items.allSatisfy({ updated.batteryIds.contains($0.battery.id) }) { group = nil }
        }
        if items.isEmpty { source = nil; sessionId = RequestID.make(); latestId = nil; group = nil }
        if !dropped.isEmpty {
            submissionError = (submissionError.map { $0 + " " } ?? "") + "Removed from the list after refreshing: \(dropped.joined(separator: ", "))."
        }
    }

    /// A group-scoped movement must come back with matching group evidence; an ordinary one must not have any.
    static func groupEvidenceMatches(_ evidence: GroupEvidence?, entry: PendingMovement) -> Bool {
        let sent = (try? JSONDecoder().decode(WriteEnvelope<GroupProbe>.self, from: entry.body))?.payload.teachingGroup
        guard let sent else { return evidence == nil }
        guard let evidence else { return false }
        return evidence.id == sent.id && evidence.version == sent.version && evidence.ownerAccountId == entry.accountId
            && evidence.operationId == entry.id && evidence.batteryIds.sorted() == entry.batteryIds.sorted()
    }

    private func markUncertain(_ message: String) {
        submissionError = message
        phase = .uncertain
        Haptics.refused()
    }

    private func settle(_ entry: PendingMovement, receipt: MovementReceipt) {
        guard let app else { return }
        app.pending.remove(id: entry.id)
        pendingWrites = []
        let names = Dictionary(uniqueKeysWithValues: items.map { ($0.battery.id, $0.battery.name) })
        let kind = MovementKind(rawValue: receipt.kind) ?? mode
        var roomLabel: String?
        if kind == .return, let id = returnRoomId { roomLabel = app.inventory.rooms(eligibleFor: app.dataset).first { $0.id == id }?.label }
        let summary = DoneSummary(kind: kind,
                                  batteries: receipt.batteryIds.sorted().map { DoneBattery(id: $0, name: names[$0] ?? "Battery") },
                                  at: receipt.at, replayed: receipt.replayed ?? false, roomLabel: roomLabel)
        phase = .done(summary)
        submissionError = nil
        setMood(.happy, hold: 1.6)
        reaction += 1
        Haptics.confirmed()
        Task { await app.inventory.refresh() }
    }

    // MARK: Preview support

    func previewState(items: [BatteryRecord], mode: MovementKind, phase: Phase, source: Source = .nfc) {
        self.mode = mode
        self.items = items.map { Item(battery: $0, tagId: $0.tagId, evidence: nil) }
        self.source = items.isEmpty ? nil : source
        self.latestId = items.first?.id
        self.phase = phase
        if case .done = phase { mood = .happy }
    }

    func previewPending(_ entry: PendingMovement) {
        pendingWrites = [entry]
        submissionError = "Couldn't reach the server. Check your connection and try again."
    }

    func previewNotice(_ notice: Notice, mood: InkMood) {
        self.notice = notice
        self.mood = mood
    }
}
