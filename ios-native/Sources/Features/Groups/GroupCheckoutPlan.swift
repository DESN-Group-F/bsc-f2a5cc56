import Foundation

/// Recorded-specification comparison, exactly as the server decides "same spec":
/// model, chemistry, capacity and voltage all recorded and equal. Unknown never matches.
enum TeachingSpec {
    static func matches(_ a: BatteryRecord, _ b: BatteryRecord) -> Bool {
        known(a) && known(b) && a.model == b.model && a.chemistry == b.chemistry
            && a.capacityMah == b.capacityMah && a.voltage == b.voltage
    }

    private static func known(_ b: BatteryRecord) -> Bool {
        guard let capacity = b.capacityMah, let voltage = b.voltage, capacity.isFinite, voltage.isFinite,
              capacity > 0, voltage > 0 else { return false }
        return !(b.model ?? "").jsTrimmed.isEmpty && !(b.chemistry ?? "").jsTrimmed.isEmpty
    }

    /// "Same model and specs", or what differs: "Capacity differs · Voltage not recorded".
    static func differences(_ original: BatteryRecord, _ actual: BatteryRecord) -> String {
        if matches(original, actual) { return "Same model and specs" }
        func text(_ s: String?) -> String? { let t = (s ?? "").jsTrimmed; return t.isEmpty ? nil : s }
        func number(_ d: Double?) -> Double? { d.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } }
        var parts: [String] = []
        func compare<T: Equatable>(_ label: String, _ a: T?, _ b: T?) {
            guard let a, let b else { parts.append("\(label) not recorded"); return }
            if a != b { parts.append("\(label) differs") }
        }
        compare("Model", text(original.model), text(actual.model))
        compare("Chemistry", text(original.chemistry), text(actual.chemistry))
        compare("Capacity", number(original.capacityMah), number(actual.capacityMah))
        compare("Voltage", number(original.voltage), number(actual.voltage))
        return parts.joined(separator: " · ")
    }
}

/// Numeric-aware ID order (BAT-9 before BAT-10), so suggestions come out the same every time.
func teachingIdOrder(_ a: String, _ b: String) -> Bool {
    let r = a.compare(b, options: [.numeric])
    return r == .orderedSame ? a < b : r == .orderedAscending
}

/// One member slot of a group checkout under review.
struct CheckoutSlot: Identifiable, Equatable {
    enum State: Equatable {
        /// In store: the member itself goes out.
        case inStore
        /// Already on loan to you outside any group checkout: continue that loan.
        case withYou
        /// On loan to someone else: needs a replacement or to be skipped.
        case borrowed(by: String)
        /// Separate checkout only: held by you in another open group checkout, so this run needs a replacement.
        case heldElsewhere(run: String)
        /// Covered by another of your open group checkouts; not part of this one.
        case inOtherCheckout(run: String)
        /// Scrapped or permanently removed: replace it in the group first.
        case retired(String)
        /// No longer in this inventory.
        case missing

        var needsReplacement: Bool {
            switch self {
            case .borrowed, .heldElsewhere: return true
            default: return false
            }
        }

        /// Members that can't be in this checkout at all.
        var isFixedOut: Bool {
            switch self {
            case .inOtherCheckout, .retired, .missing: return true
            default: return false
            }
        }
    }

    enum Method: String { case original, automatic, manual }

    let memberId: String
    let member: BatteryRecord?
    let state: State
    var actual: BatteryRecord?
    var method: Method
    var skipped: Bool

    var id: String { memberId }
    var isIncluded: Bool { !skipped && actual != nil && !state.isFixedOut }
    /// Still waiting for a replacement or an explicit "skip this time".
    var isUnfilled: Bool { !skipped && actual == nil && state.needsReplacement }
    var isReplacement: Bool { method != .original && actual != nil }
}

/// The review of one group checkout: every member classified, replacements chosen, nothing sent.
/// Built only from the latest inventory and your latest runs, and rebuilt after any rejection.
struct GroupCheckoutPlan: Equatable {
    let group: TeachingGroup
    let me: String
    let separate: Bool
    private(set) var slots: [CheckoutSlot]

    static func == (lhs: GroupCheckoutPlan, rhs: GroupCheckoutPlan) -> Bool {
        lhs.group.id == rhs.group.id && lhs.group.version == rhs.group.version && lhs.separate == rhs.separate && lhs.slots == rhs.slots
    }

    /// Classifies every member against the latest records. `previous` keeps the choices that still hold.
    init(group: TeachingGroup, batteries: [BatteryRecord], runs: [TeachingRun], me: String, separate: Bool,
         keeping previous: GroupCheckoutPlan? = nil) {
        self.group = group
        self.me = me
        self.separate = separate
        let byId = Dictionary(batteries.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let open = runs.filter { $0.actorAccountId == me && $0.isOpen }

        func runLabel(_ run: TeachingRun) -> String {
            run.teachingGroup.id == group.id ? run.startedText : "“\(run.teachingGroup.name)”, \(run.startedText)"
        }
        // Your open run of this group that still has this member slot out.
        func coveringSlot(_ memberId: String) -> TeachingRun? {
            open.first { run in
                run.teachingGroup.id == group.id && run.outstanding.contains { run.memberId(of: $0) == memberId }
            }
        }
        // Your open run (any group) that has this exact battery out.
        func coveringBattery(_ batteryId: String) -> TeachingRun? {
            open.first { run in run.outstanding.contains { $0.batteryId == batteryId } }
        }

        var built: [CheckoutSlot] = []
        for memberId in group.batteryIds {
            guard let member = byId[memberId] else {
                built.append(CheckoutSlot(memberId: memberId, member: nil, state: .missing, actual: nil, method: .original, skipped: false))
                continue
            }
            let state: CheckoutSlot.State
            if !member.isActive {
                state = .retired(member.statusTitle)
            } else if !separate, let run = coveringSlot(memberId) {
                state = .inOtherCheckout(run: runLabel(run))
            } else if member.loanId != nil {
                if member.borrowerAccountId == me {
                    if let run = coveringBattery(memberId) {
                        state = separate ? .heldElsewhere(run: runLabel(run)) : .inOtherCheckout(run: runLabel(run))
                    } else {
                        state = .withYou
                    }
                } else {
                    state = .borrowed(by: Self.shortName(member.borrowerName))
                }
            } else {
                state = .inStore
            }
            let fillsItself = state == .inStore || state == .withYou
            var slot = CheckoutSlot(memberId: memberId, member: member, state: state,
                                    actual: fillsItself ? member : nil, method: .original, skipped: false)
            if let old = previous?.slots.first(where: { $0.memberId == memberId }), old.state == state || (old.state.needsReplacement && state.needsReplacement) {
                slot.skipped = old.skipped && !state.isFixedOut
            }
            built.append(slot)
        }
        slots = built

        // Keep earlier replacements that are still available and still valid for their slot.
        if let previous {
            for old in previous.slots where old.isReplacement {
                guard let index = slots.firstIndex(where: { $0.memberId == old.memberId }), slots[index].state.needsReplacement,
                      !slots[index].skipped, let chosen = old.actual, let latest = byId[chosen.id],
                      pool(from: batteries, excludingSlot: old.memberId).contains(where: { $0.id == latest.id }) else { continue }
                if old.method == .automatic, let member = slots[index].member, !TeachingSpec.matches(member, latest) { continue }
                slots[index].actual = latest
                slots[index].method = old.method
            }
        }
    }

    /// "Jordan Chen" → "J. Chen", as on status pills.
    static func shortName(_ name: String?) -> String {
        guard let name, !name.isEmpty else { return "someone" }
        let parts = name.split(separator: " ")
        guard parts.count > 1, let first = parts.first?.first else { return name }
        return "\(first). \(parts.dropFirst().joined(separator: " "))"
    }

    // MARK: Counts

    var included: [CheckoutSlot] { slots.filter(\.isIncluded) }
    var unfilled: [CheckoutSlot] { slots.filter(\.isUnfilled) }
    var inStoreCount: Int { slots.filter { $0.state == .inStore }.count }
    var withYouCount: Int { slots.filter { $0.state == .withYou }.count }
    var needCount: Int { slots.filter { $0.state.needsReplacement }.count }
    var replacements: [CheckoutSlot] { slots.filter { $0.isIncluded && $0.isReplacement } }
    var canSubmit: Bool { !included.isEmpty && unfilled.isEmpty }

    /// "6 members · 3 in store · 1 with you · 2 to fill".
    var summary: String {
        var parts = ["\(slots.count) \(slots.count == 1 ? "member" : "members")"]
        if inStoreCount > 0 { parts.append("\(inStoreCount) in store") }
        if withYouCount > 0 { parts.append("\(withYouCount) with you") }
        if needCount > 0 { parts.append("\(needCount) to fill") }
        let out = slots.filter(\.state.isFixedOut).count
        if out > 0 { parts.append("\(out) can't go") }
        return parts.joined(separator: " · ")
    }

    // MARK: Choosing replacements

    /// Batteries that can stand in: active, in store, not members of this group, and not already
    /// chosen for another slot. Suggestions never reserve stock; the server checks again on confirm.
    func pool(from batteries: [BatteryRecord], excludingSlot memberId: String? = nil) -> [BatteryRecord] {
        let members = Set(group.batteryIds)
        let taken = Set(slots.filter { $0.memberId != memberId && $0.isReplacement && !$0.skipped }.compactMap { $0.actual?.id })
        return batteries.filter { $0.isInStore && !members.contains($0.id) && !taken.contains($0.id) }
            .sorted { teachingIdOrder($0.id, $1.id) }
    }

    /// Fills every open slot with the first same-spec battery. Returns how many stayed unfilled.
    @discardableResult
    mutating func replaceAll(from batteries: [BatteryRecord]) -> (filled: Int, unfilled: Int) {
        var filled = 0
        for index in slots.indices where slots[index].isUnfilled {
            guard let member = slots[index].member,
                  let match = pool(from: batteries).first(where: { TeachingSpec.matches(member, $0) }) else { continue }
            slots[index].actual = match
            slots[index].method = .automatic
            filled += 1
        }
        return (filled, unfilled.count)
    }

    mutating func choose(_ battery: BatteryRecord, for memberId: String) {
        guard let index = slots.firstIndex(where: { $0.memberId == memberId }), slots[index].state.needsReplacement,
              battery.isInStore, !group.batteryIds.contains(battery.id) else { return }
        slots[index].actual = battery
        slots[index].method = .manual
        slots[index].skipped = false
    }

    mutating func clearReplacement(_ memberId: String) {
        guard let index = slots.firstIndex(where: { $0.memberId == memberId }), slots[index].isReplacement else { return }
        slots[index].actual = nil
        slots[index].method = .original
    }

    /// Skipping a slot drops its replacement, so that battery is free for another slot.
    mutating func setSkipped(_ memberId: String, _ skipped: Bool) {
        guard let index = slots.firstIndex(where: { $0.memberId == memberId }), !slots[index].state.isFixedOut else { return }
        slots[index].skipped = skipped
        if skipped && slots[index].isReplacement {
            slots[index].actual = nil
            slots[index].method = .original
        }
    }

    mutating func skipUnfilled() {
        for index in slots.indices where slots[index].isUnfilled { slots[index].skipped = true }
    }

    // MARK: Request

    /// One mapping per included slot, in the group's member order.
    var mappings: [TeachingMappingRequest] {
        included.compactMap { slot in
            guard let member = slot.member, let actual = slot.actual else { return nil }
            let continuing = slot.state == .withYou && slot.method == .original
            return TeachingMappingRequest(original: TeachingBinding(member), actual: TeachingBinding(actual),
                                          originalLoanId: member.loanId,
                                          existingLoanId: continuing ? member.loanId : nil,
                                          method: slot.method.rawValue, source: TeachingSourceRef())
        }
    }
}
