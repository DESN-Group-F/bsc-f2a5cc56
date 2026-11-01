import Observation
import SwiftUI

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

    var title: String {
        let n = batteries.count
        return "\(n) \(n == 1 ? "battery" : "batteries") \(kind.pastTense)"
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
        let id = UUID()
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
    var returnRoomId: String?
    var showChooser = false
    var submissionError: String?

    private var sessionId = RequestID.make()
    private let reader = NFCReader()
    private var moodToken = 0
    private var noticeToken = 0

    var hasUnsettledWork: Bool { !pendingWrites.isEmpty || phase == .submitting }
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
        items.isEmpty
            ? "Hold the top of your iPhone near a battery tag."
            : "\(items.count) in your list. Hold near the next battery. Tap Cancel to review — your list stays."
    }

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
        if phase != .uncertain { phase = .scanning }
    }

    func greet(_ text: String) {
        show(.init(kind: .greeting, text: text))
        setMood(.happy, hold: 0.9)
        reaction += 1
    }

    func scanMore() {
        guard pendingWrites.isEmpty else { phase = .uncertain; return }
        items = []
        source = nil
        sessionId = RequestID.make()
        latestId = nil
        mood = .idle
        phase = .scanning
    }

    func setMode(_ newMode: MovementKind) {
        guard phase == .scanning, newMode != mode else { return }
        if !items.isEmpty {
            show(.init(kind: .info, text: "Clear the list to switch to \(newMode.title)."))
            return
        }
        mode = newMode
        Haptics.tap()
    }

    // MARK: Reading tags

    func tapInk() {
        guard let app, phase == .scanning else { return }
        if readerActive { return }
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
        var battery = app.inventory.battery(tagId: read.tagId)
        if battery == nil {
            // Maybe registered moments ago on another device.
            await app.inventory.refresh()
            battery = app.inventory.battery(tagId: read.tagId)
        }
        guard let battery else {
            refuse("This tag isn't registered", action: "Register")
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
        guard pendingWrites.isEmpty, phase != .submitting else { return }
        reset()
        mode = battery.isInUse ? .return : .checkout
        add(battery, tagId: battery.tagId, evidence: nil, from: .selection)
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
        if items.isEmpty {
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
        items.insert(Item(battery: battery, tagId: tagId, evidence: evidence), at: 0)
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
    }

    private func holderPhrase(_ battery: BatteryRecord, me: String?) -> String {
        if battery.borrowerAccountId != nil && battery.borrowerAccountId == me { return "with you" }
        return "with \(StatusPill.shortName(battery.borrowerName))"
    }

    private func refuse(_ text: String, action: String? = nil) {
        show(.init(kind: .refused, text: text, actionTitle: action))
        setMood(.surprised, hold: 1.4)
        Haptics.refused()
    }

    private func show(_ newNotice: Notice) {
        notice = newNotice
        noticeToken += 1
        let token = noticeToken
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.4))
            if token == self.noticeToken { self.notice = nil }
        }
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
        guard let app, let user = app.user, phase == .scanning, !items.isEmpty, pendingWrites.isEmpty else { return }
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
        let payload = MovementPayload(kind: mode.rawValue, requestId: requestId, batteryIds: ids, expectedLoans: loans,
                                      scan: ScanContext(sessionId: sessionId, source: usedSource.rawValue, bindings: bindings),
                                      returnRoom: room)
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

    func retryPending() async {
        guard let entry = pendingWrites.first, phase != .submitting else { return }
        phase = .submitting
        await send(entry, isRetry: true)
    }

    func loadPending() {
        guard let app, let user = app.user else { return }
        pendingWrites = app.pending.all(accountId: user.id, dataset: app.dataset)
        if !pendingWrites.isEmpty { phase = .uncertain }
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
                  Set(receipt.batteryIds) == Set(entry.batteryIds),
                  receipt.count == entry.batteryIds.count,
                  entry.kind != "checkout" || receipt.borrowerAccountId == entry.accountId else {
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
