import SwiftUI

/// Phone port of the web's shared inventory query (`lib/inventory-query.ts`).
/// Unknown values stay selectable and are never inferred; nulls sort last in both directions; ties use Battery ID.
struct InventoryFilter: Equatable {
    enum Sort: String, CaseIterable, Identifiable {
        case id, name, registered, manufactured, age, serviceAge = "service_age", checkout, charge, observed, capacity, voltage
        case chargeDuration = "charge_duration"
        var id: String { rawValue }
        var title: String {
            switch self {
            case .id: return "Battery ID"
            case .name: return "Battery name"
            case .registered: return "Registration time"
            case .manufactured: return "Manufacture date"
            case .age: return "Age since manufacture"
            case .serviceAge: return "Time in service"
            case .checkout: return "Latest check-out"
            case .charge: return "Latest charge"
            case .observed: return "Latest observation"
            case .capacity: return "Capacity"
            case .voltage: return "Voltage"
            case .chargeDuration: return "Latest charging duration"
            }
        }
    }

    enum Lifecycle: String, CaseIterable, Identifiable {
        case active, all, scrapped, permanentlyRemoved = "permanently_removed"
        var id: String { rawValue }
        var title: String {
            switch self {
            case .active: return "Active"
            case .all: return "All records"
            case .scrapped: return "Scrapped"
            case .permanentlyRemoved: return "Permanently removed"
            }
        }
    }

    enum Scope: String, CaseIterable, Identifiable {
        case all, responsible, borrowed
        var id: String { rawValue }
        var title: String {
            switch self {
            case .all: return "Everyone's"
            case .responsible: return "My batteries"
            case .borrowed: return "In use by me"
            }
        }
    }

    enum Availability: String, CaseIterable, Identifiable {
        case any, known, unknown
        var id: String { rawValue }
        var title: String {
            switch self {
            case .any: return "Any"
            case .known: return "Recorded"
            case .unknown: return "Not recorded"
            }
        }
    }

    var sort: Sort = .id
    var descending = false
    var lifecycle: Lifecycle = .active
    var scope: Scope = .all
    var groupId: String?
    var newArrivalsOnly = false

    var building = "all"
    var room = "all"            // "all", "__unspecified" or a room ID
    var observedRoom = "all"    // "all", "__not_observed", "__unavailable" or a room ID
    var owner = "all"           // people ID
    var holder = "all"          // account ID or "__legacy"

    var chemistry: String?
    var chemistryUnknown = false
    var model: String?
    var modelUnknown = false

    var capacityMode: Availability = .any
    var capacityMin: Double?
    var capacityMax: Double?
    var voltageMode: Availability = .any
    var voltageMin: Double?
    var voltageMax: Double?
    var ageMode: Availability = .any
    var ageMinDays: Int?
    var ageMaxDays: Int?
    var checkoutMode: Availability = .any
    var checkoutFrom: String?
    var checkoutTo: String?
    var chargeMode: Availability = .any
    var chargeFrom: String?
    var chargeTo: String?

    /// Criteria (not ordering) that narrow the list; used for the badge and Clear filters.
    var criteriaCount: Int {
        var n = 0
        if lifecycle != .active { n += 1 }
        if scope != .all { n += 1 }
        if groupId != nil { n += 1 }
        if newArrivalsOnly { n += 1 }
        if building != "all" { n += 1 }
        if room != "all" { n += 1 }
        if observedRoom != "all" { n += 1 }
        if owner != "all" { n += 1 }
        if holder != "all" { n += 1 }
        if chemistry != nil || chemistryUnknown { n += 1 }
        if model != nil || modelUnknown { n += 1 }
        if capacityMode != .any || capacityMin != nil || capacityMax != nil { n += 1 }
        if voltageMode != .any || voltageMin != nil || voltageMax != nil { n += 1 }
        if ageMode != .any || ageMinDays != nil || ageMaxDays != nil { n += 1 }
        if checkoutMode != .any || checkoutFrom != nil || checkoutTo != nil { n += 1 }
        if chargeMode != .any || chargeFrom != nil || chargeTo != nil { n += 1 }
        return n
    }

    var isSorted: Bool { sort != .id || descending }

    /// Clears criteria and ordering. Inside an opened teaching group, its membership stays fixed.
    mutating func clearCriteria(keepGroup: Bool = false) {
        let group = groupId
        self = InventoryFilter()
        if keepGroup { groupId = group }
    }

    /// The range fields can't contradict each other or the "Not recorded" choice.
    var problems: [String] {
        var issues: [String] = []
        func check(_ mode: Availability, _ hasBounds: Bool, _ label: String) {
            if mode == .unknown && hasBounds { issues.append("\(label): clear the range before choosing Not recorded.") }
        }
        check(capacityMode, capacityMin != nil || capacityMax != nil, "Capacity")
        check(voltageMode, voltageMin != nil || voltageMax != nil, "Voltage")
        check(ageMode, ageMinDays != nil || ageMaxDays != nil, "Age")
        check(checkoutMode, checkoutFrom != nil || checkoutTo != nil, "Latest check-out")
        check(chargeMode, chargeFrom != nil || chargeTo != nil, "Latest charge")
        if let a = capacityMin, let b = capacityMax, a > b { issues.append("Capacity: the maximum must be at least the minimum.") }
        if let a = voltageMin, let b = voltageMax, a > b { issues.append("Voltage: the maximum must be at least the minimum.") }
        if let a = ageMinDays, let b = ageMaxDays, a > b { issues.append("Age: the maximum must be at least the minimum.") }
        if let a = checkoutFrom, let b = checkoutTo, a > b { issues.append("Latest check-out: the end date must not be before the start.") }
        if let a = chargeFrom, let b = chargeTo, a > b { issues.append("Latest charge: the end date must not be before the start.") }
        return issues
    }
}

// MARK: - Query

enum InventoryQuery {
    static func apply(_ batteries: [BatteryRecord], filter f: InventoryFilter, status: StatusFilter, search: String,
                      viewer: String?, groups: [TeachingGroup], arrivalIds: Set<String>, today: String = Sydney.ymd()) -> [BatteryRecord] {
        let members = f.groupId.flatMap { id in groups.first { $0.id == id } }.map { Set($0.batteryIds) }
        if f.groupId != nil && members == nil { return [] }
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        let result = batteries.filter { b in
            if let members, !members.contains(b.id) { return false }
            switch f.scope {
            case .all: break
            case .responsible: if viewer == nil || b.ownerAccountId != viewer { return false }
            case .borrowed: if viewer == nil || b.loanId == nil || b.borrowerAccountId != viewer { return false }
            }
            if f.newArrivalsOnly && !(b.isActive && arrivalIds.contains(b.id)) { return false }
            switch f.lifecycle {
            case .all: break
            case .active: if !b.isActive { return false }
            case .scrapped: if b.lifecycleStatus != "scrapped" { return false }
            case .permanentlyRemoved: if b.lifecycleStatus != "permanently_removed" { return false }
            }
            switch status {
            case .all: break
            case .inStore: if !b.isInStore { return false }
            case .inUse: if !b.isInUse { return false }
            }
            if f.building != "all" && b.homeBuildingId != f.building { return false }
            if f.room != "all" {
                if f.room == "__unspecified" { if b.homeRoomId != nil { return false } } else if b.homeRoomId != f.room { return false }
            }
            if f.observedRoom != "all" {
                switch f.observedRoom {
                case "__not_observed": if b.observedAt != nil { return false }
                case "__unavailable": if b.observedAt == nil || b.observationRoomSnapshot == "recorded" { return false }
                default: if b.observedAt == nil || b.observedRoomId != f.observedRoom { return false }
                }
            }
            if f.owner != "all" && b.ownerId != f.owner { return false }
            if f.chemistryUnknown {
                if !(b.chemistry ?? "").trimmingCharacters(in: .whitespaces).isEmpty { return false }
            } else if let c = f.chemistry, (b.chemistry ?? "") != c { return false }
            if f.holder != "all" {
                guard b.loanId != nil else { return false }
                if f.holder == "__legacy" { if b.borrowerKind != "legacy" { return false } }
                else if b.borrowerKind != "staff" || b.borrowerAccountId != f.holder { return false }
            }
            if f.modelUnknown {
                if !(b.model ?? "").trimmingCharacters(in: .whitespaces).isEmpty { return false }
            } else if let m = f.model, (b.model ?? "") != m { return false }
            if !range(b.capacityMah, f.capacityMode, f.capacityMin, f.capacityMax) { return false }
            if !range(b.voltage, f.voltageMode, f.voltageMin, f.voltageMax) { return false }
            if !range(ageInDays(b.manufacturedOn, today).map { Double($0) }, f.ageMode, f.ageMinDays.map { Double($0) }, f.ageMaxDays.map { Double($0) }) { return false }
            if !dateRange(Sydney.date(b.lastCheckedOutAt).map { Sydney.ymd($0) }, f.checkoutMode, f.checkoutFrom, f.checkoutTo) { return false }
            if !dateRange(Sydney.date(b.chargedAt).map { Sydney.ymd($0) }, f.chargeMode, f.chargeFrom, f.chargeTo) { return false }
            if !query.isEmpty {
                let text = [b.id, b.name, b.chemistry, b.model, b.tagId, b.ownerName, b.borrowerName, b.homeBuildingId, b.homeBuildingName,
                            b.homeRoomNumber, b.homeRoomName, b.lifecycleReason, b.lifecycleDestination]
                    .map { $0 ?? "" }.joined(separator: " ").lowercased()
                if !text.contains(query) { return false }
            }
            return true
        }
        return sort(result, by: f.sort, descending: f.descending, today: today)
    }

    static func sort(_ batteries: [BatteryRecord], by sort: InventoryFilter.Sort, descending: Bool, today: String = Sydney.ymd()) -> [BatteryRecord] {
        enum Key { case text(String), number(Double) }
        func time(_ s: String?) -> Key? { Sydney.date(s).map { .number($0.timeIntervalSince1970) } }
        func key(_ b: BatteryRecord) -> Key? {
            switch sort {
            case .id: return .text(b.id)
            case .name:
                let name = b.name.trimmingCharacters(in: .whitespaces)
                return name.isEmpty ? nil : .text(name)
            case .registered: return time(b.registeredAt)
            case .manufactured: return Sydney.dateFromYMD(b.manufacturedOn).map { .number($0.timeIntervalSince1970) }
            case .age: return ageInDays(b.manufacturedOn, today).map { .number(Double($0)) }
            case .serviceAge:
                guard let end = serviceEnd(b, today) else { return nil }
                return ageInDays(b.firstUsedOn, end).map { .number(Double($0)) }
            case .checkout: return time(b.lastCheckedOutAt)
            case .charge: return time(b.chargedAt)
            case .observed: return time(b.observedAt)
            case .capacity: return b.capacityMah.map { .number($0) }
            case .voltage: return b.voltage.map { .number($0) }
            case .chargeDuration: return b.chargeDurationMinutes.map { .number($0) }
            }
        }
        let keyed = batteries.map { ($0, key($0)) }
        return keyed.sorted { lhs, rhs in
            switch (lhs.1, rhs.1) {
            case (nil, nil): return idOrder(lhs.0.id, rhs.0.id)
            case (nil, _): return false
            case (_, nil): return true
            case let (a?, b?):
                let compared: ComparisonResult
                switch (a, b) {
                case let (.number(x), .number(y)): compared = x < y ? .orderedAscending : (x > y ? .orderedDescending : .orderedSame)
                case let (.text(x), .text(y)): compared = x.compare(y, options: [.numeric, .caseInsensitive, .diacriticInsensitive])
                default: compared = .orderedSame
                }
                if compared == .orderedSame { return idOrder(lhs.0.id, rhs.0.id) }
                return descending ? compared == .orderedDescending : compared == .orderedAscending
            }
        }.map(\.0)
    }

    private static func idOrder(_ a: String, _ b: String) -> Bool {
        let r = a.compare(b, options: .numeric)
        return r == .orderedSame ? a < b : r == .orderedAscending
    }

    private static func range(_ value: Double?, _ mode: InventoryFilter.Availability, _ low: Double?, _ high: Double?) -> Bool {
        if mode == .unknown { return value == nil }
        guard let value else { return mode == .any && low == nil && high == nil }
        return (low.map { value >= $0 } ?? true) && (high.map { value <= $0 } ?? true)
    }

    private static func dateRange(_ value: String?, _ mode: InventoryFilter.Availability, _ low: String?, _ high: String?) -> Bool {
        if mode == .unknown { return value == nil }
        guard let value else { return mode == .any && low == nil && high == nil }
        return (low.map { value >= $0 } ?? true) && (high.map { value <= $0 } ?? true)
    }

    /// Whole days between two calendar dates; nil when unknown or the start is after the end.
    static func ageInDays(_ start: String?, _ end: String) -> Int? {
        guard let s = start, let a = utcDay(s), let b = utcDay(end), a <= b else { return nil }
        return Int((b.timeIntervalSince(a) / 86_400).rounded())
    }

    /// Service time ends at recorded retirement.
    static func serviceEnd(_ b: BatteryRecord, _ today: String) -> String? {
        if b.isActive { return today }
        guard let at = Sydney.date(b.lifecycleAt) else { return nil }
        let retired = Sydney.ymd(at)
        return retired <= today ? retired : nil
    }

    private static let utc: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static func utcDay(_ s: String) -> Date? { utc.date(from: s) }
}

// MARK: - Filter sheet

struct InventoryFilterSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Binding var filter: InventoryFilter
    /// Inside an opened teaching group, membership is fixed and not shown as a choice.
    var fixedGroup = false
    @State private var draft = InventoryFilter()

    var body: some View {
        let batteries = app.inventory.batteries
        NavigationStack {
            Form {
                Section("Sort") {
                    Picker("Sort by", selection: $draft.sort) {
                        ForEach(InventoryFilter.Sort.allCases) { Text($0.title).tag($0) }
                    }
                    Picker("Order", selection: $draft.descending) {
                        Text(ascendingTitle).tag(false)
                        Text(descendingTitle).tag(true)
                    }
                    .pickerStyle(.segmented)
                }

                Section("Show") {
                    Picker("Records", selection: $draft.lifecycle) {
                        ForEach(InventoryFilter.Lifecycle.allCases) { Text($0.title).tag($0) }
                    }
                    Picker("Whose", selection: $draft.scope) {
                        ForEach(InventoryFilter.Scope.allCases) { Text($0.title).tag($0) }
                    }
                    if !fixedGroup && !app.inventory.groups.isEmpty {
                        Picker("Teaching group", selection: $draft.groupId) {
                            Text("Any").tag(String?.none)
                            ForEach(app.inventory.groups) { Text($0.name).tag(Optional($0.id)) }
                        }
                    }
                    Toggle("New arrivals only", isOn: $draft.newArrivalsOnly)
                }

                Section("Battery details") {
                    valuePicker("Chemistry", values: distinct(batteries.map { $0.chemistry ?? "" }), selection: $draft.chemistry, unknown: $draft.chemistryUnknown)
                    valuePicker("Model", values: distinct(batteries.map { $0.model ?? "" }), selection: $draft.model, unknown: $draft.modelUnknown)
                    RangeRow(title: "Capacity", unit: "mAh", mode: $draft.capacityMode, low: $draft.capacityMin, high: $draft.capacityMax)
                    RangeRow(title: "Voltage", unit: "V", mode: $draft.voltageMode, low: $draft.voltageMin, high: $draft.voltageMax)
                }

                Section("People") {
                    Picker("Responsible", selection: $draft.owner) {
                        Text("Anyone").tag("all")
                        ForEach(owners) { Text($0.name).tag($0.id) }
                    }
                    Picker("Who has it", selection: $draft.holder) {
                        Text("Anyone").tag("all")
                        ForEach(holders) { Text($0.name).tag($0.id) }
                    }
                }

                Section("Location") {
                    if buildings.count > 1 {
                        Picker("Home building", selection: $draft.building) {
                            Text("Any").tag("all")
                            ForEach(buildings, id: \.self) { Text($0).tag($0) }
                        }
                    }
                    Picker("Home room", selection: $draft.room) {
                        Text("Any").tag("all")
                        Text("Room not specified").tag("__unspecified")
                        ForEach(app.inventory.snapshot?.rooms ?? []) { room in
                            Text(room.label + ((room.isPlaceholder ?? false) ? " · placeholder" : "")).tag(room.id)
                        }
                    }
                    Picker("Last seen in", selection: $draft.observedRoom) {
                        Text("Any").tag("all")
                        Text("Never observed").tag("__not_observed")
                        Text("Room label unavailable").tag("__unavailable")
                        ForEach(observedRooms) { Text($0.name).tag($0.id) }
                    }
                }

                Section {
                    DayRangeRow(title: "Age since manufacture", mode: $draft.ageMode, low: $draft.ageMinDays, high: $draft.ageMaxDays)
                    DateRangeRow(title: "Latest check-out", mode: $draft.checkoutMode, from: $draft.checkoutFrom, to: $draft.checkoutTo)
                    DateRangeRow(title: "Latest charge", mode: $draft.chargeMode, from: $draft.chargeFrom, to: $draft.chargeTo)
                } header: {
                    Text("Age & activity")
                } footer: {
                    Text("Dates use Sydney time. Unknown values are only matched by Not recorded or Any.")
                }

                if !draft.problems.isEmpty {
                    Section { ForEach(draft.problems, id: \.self) { Text($0).foregroundStyle(Tone.failure) } }
                }

                Section {
                    Button("Clear filters", role: .destructive) {
                        withAnimation { draft.clearCriteria(keepGroup: fixedGroup) }
                    }
                    .disabled(draft == cleared)
                }
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Show \(preview.count)") {
                        filter = draft
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(!draft.problems.isEmpty)
                }
            }
            .onAppear { draft = filter }
        }
    }

    private var cleared: InventoryFilter {
        var f = draft
        f.clearCriteria(keepGroup: fixedGroup)
        return f
    }

    private var preview: [BatteryRecord] {
        InventoryQuery.apply(app.inventory.batteries, filter: draft, status: .all, search: "", viewer: app.user?.id,
                             groups: app.inventory.groups, arrivalIds: app.inventory.newArrivalIds)
    }

    private var ascendingTitle: String {
        switch draft.sort {
        case .id, .name: return "A → Z"
        case .registered, .manufactured, .checkout, .charge, .observed: return "Oldest first"
        default: return "Lowest first"
        }
    }

    private var descendingTitle: String {
        switch draft.sort {
        case .id, .name: return "Z → A"
        case .registered, .manufactured, .checkout, .charge, .observed: return "Newest first"
        default: return "Highest first"
        }
    }

    private func distinct(_ values: [String]) -> [String] {
        Array(Set(values.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty })).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    @ViewBuilder
    private func valuePicker(_ title: String, values: [String], selection: Binding<String?>, unknown: Binding<Bool>) -> some View {
        Picker(title, selection: Binding<String>(
            get: { unknown.wrappedValue ? "__unknown" : (selection.wrappedValue ?? "__any") },
            set: { value in
                unknown.wrappedValue = value == "__unknown"
                selection.wrappedValue = (value == "__any" || value == "__unknown") ? nil : value
            })) {
            Text("Any").tag("__any")
            Text("Not recorded").tag("__unknown")
            ForEach(values, id: \.self) { Text($0).tag($0) }
        }
    }

    private var owners: [Person] {
        let used = Set(app.inventory.batteries.compactMap(\.ownerId))
        return (app.inventory.snapshot?.people ?? []).filter { used.contains($0.id) }.sorted { $0.name < $1.name }
    }

    private struct Choice: Identifiable {
        let id: String
        let name: String
    }

    private var holders: [Choice] {
        var seen: [String: String] = [:]
        var legacy = false
        for b in app.inventory.batteries where b.loanId != nil {
            if b.borrowerKind == "legacy" { legacy = true } else if let id = b.borrowerAccountId { seen[id] = b.borrowerName ?? "Staff" }
        }
        var list = seen.map { Choice(id: $0.key, name: $0.key == app.user?.id ? "Me" : $0.value) }.sorted { $0.name < $1.name }
        if legacy { list.append(Choice(id: "__legacy", name: "Legacy borrower")) }
        return list
    }

    private var buildings: [String] {
        Array(Set(app.inventory.batteries.compactMap(\.homeBuildingId))).sorted()
    }

    private var observedRooms: [Choice] {
        var latest: [String: (label: String, at: Date)] = [:]
        for b in app.inventory.batteries {
            guard let id = b.observedRoomId, let at = Sydney.date(b.observedAt) else { continue }
            let label = b.observationRoomSnapshot == "recorded" && b.observedRoom != nil
                ? [b.observedBuilding, b.observedRoom].compactMap { $0 }.joined(separator: " · ")
                : "Room ID: \(id) · label unavailable"
            if let existing = latest[id], existing.at >= at { continue }
            latest[id] = (label, at)
        }
        return latest.map { Choice(id: $0.key, name: $0.value.label) }.sorted { $0.name < $1.name }
    }
}

private struct RangeRow: View {
    let title: String
    let unit: String
    @Binding var mode: InventoryFilter.Availability
    @Binding var low: Double?
    @Binding var high: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(title, selection: $mode) {
                ForEach(InventoryFilter.Availability.allCases) { Text($0.title).tag($0) }
            }
            if mode != .unknown {
                HStack {
                    NumberField(placeholder: "Min \(unit)", value: $low)
                    Text("–").foregroundStyle(.secondary)
                    NumberField(placeholder: "Max \(unit)", value: $high)
                }
            }
        }
    }
}

private struct DayRangeRow: View {
    let title: String
    @Binding var mode: InventoryFilter.Availability
    @Binding var low: Int?
    @Binding var high: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(title, selection: $mode) {
                ForEach(InventoryFilter.Availability.allCases) { Text($0.title).tag($0) }
            }
            if mode != .unknown {
                HStack {
                    NumberField(placeholder: "Min days", value: Binding(get: { low.map { Double($0) } }, set: { low = $0.map { Int($0) } }), decimals: false)
                    Text("–").foregroundStyle(.secondary)
                    NumberField(placeholder: "Max days", value: Binding(get: { high.map { Double($0) } }, set: { high = $0.map { Int($0) } }), decimals: false)
                }
            }
        }
    }
}

private struct DateRangeRow: View {
    let title: String
    @Binding var mode: InventoryFilter.Availability
    @Binding var from: String?
    @Binding var to: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(title, selection: $mode) {
                ForEach(InventoryFilter.Availability.allCases) { Text($0.title).tag($0) }
            }
            if mode != .unknown {
                OptionalDayPicker(title: "From", ymd: $from)
                OptionalDayPicker(title: "To", ymd: $to)
            }
        }
    }
}

/// A calendar date that can be left blank. Values are Sydney calendar dates.
struct OptionalDayPicker: View {
    let title: String
    @Binding var ymd: String?
    var latest: Date? = nil

    var body: some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            if let value = ymd, let date = Sydney.dateFromYMD(value) {
                DatePicker(title, selection: Binding(get: { date }, set: { ymd = Sydney.ymd($0) }),
                           in: ...(latest ?? .distantFuture), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.timeZone, Sydney.zone)
                    .environment(\.locale, Locale(identifier: "en_AU"))
                Button { ymd = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear \(title)")
            } else {
                Button("Set date") { ymd = Sydney.ymd(min(Date(), latest ?? Date())) }
                    .buttonStyle(.borderless)
            }
        }
    }
}

/// Numeric text entry that keeps an optional value; blank means not set.
struct NumberField: View {
    let placeholder: String
    @Binding var value: Double?
    var decimals = true
    @State private var text = ""

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(decimals ? .decimalPad : .numberPad)
            .textFieldStyle(.roundedBorder)
            .onAppear { text = value.map { Format.number($0) } ?? "" }
            .onChange(of: text) { _, new in
                let trimmed = new.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
                value = trimmed.isEmpty ? nil : Double(trimmed).flatMap { $0 >= 0 && $0.isFinite ? $0 : nil }
            }
            .onChange(of: value) { _, new in
                if new == nil && !text.isEmpty && Double(text.replacingOccurrences(of: ",", with: ".")) != nil { text = "" }
            }
    }
}

/// Removable chips for the applied criteria, shown above results.
struct AppliedFilterChips: View {
    @Environment(AppModel.self) private var app
    @Binding var filter: InventoryFilter
    var fixedGroup = false

    var body: some View {
        let chips = items
        if !chips.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(chips, id: \.title) { chip in
                        Button {
                            withAnimation(.snappy) { chip.remove(&filter) }
                            Haptics.tap()
                        } label: {
                            HStack(spacing: 4) {
                                Text(chip.title).lineLimit(1)
                                Image(systemName: "xmark").font(.caption2.weight(.bold))
                            }
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 10)
                            .frame(height: 28)
                            .background(Tone.checkout.opacity(0.12), in: .capsule)
                            .foregroundStyle(Tone.checkout)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove filter \(chip.title)")
                    }
                    Button("Clear filters") {
                        withAnimation(.snappy) { filter.clearCriteria(keepGroup: fixedGroup) }
                    }
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.borderless)
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private struct Chip {
        let title: String
        let remove: (inout InventoryFilter) -> Void
    }

    private var items: [Chip] {
        var list: [Chip] = []
        let f = filter
        if f.isSorted { list.append(Chip(title: "Sort: \(f.sort.title)\(f.descending ? " ↓" : " ↑")") { $0.sort = .id; $0.descending = false }) }
        if f.lifecycle != .active { list.append(Chip(title: f.lifecycle.title) { $0.lifecycle = .active }) }
        if f.scope != .all { list.append(Chip(title: f.scope.title) { $0.scope = .all }) }
        if !fixedGroup, let id = f.groupId {
            let name = app.inventory.groups.first { $0.id == id }?.name ?? "Teaching group"
            list.append(Chip(title: name) { $0.groupId = nil })
        }
        if f.newArrivalsOnly { list.append(Chip(title: "New arrivals") { $0.newArrivalsOnly = false }) }
        if f.building != "all" { list.append(Chip(title: f.building) { $0.building = "all" }) }
        if f.room != "all" {
            let label = f.room == "__unspecified" ? "Room not specified" : (app.inventory.snapshot?.rooms?.first { $0.id == f.room }?.name ?? f.room)
            list.append(Chip(title: "Home: \(label)") { $0.room = "all" })
        }
        if f.observedRoom != "all" { list.append(Chip(title: "Last seen") { $0.observedRoom = "all" }) }
        if f.owner != "all" {
            let name = app.inventory.snapshot?.people?.first { $0.id == f.owner }?.name ?? "Owner"
            list.append(Chip(title: "Responsible: \(name)") { $0.owner = "all" })
        }
        if f.holder != "all" { list.append(Chip(title: "Who has it") { $0.holder = "all" }) }
        if f.chemistryUnknown || f.chemistry != nil {
            list.append(Chip(title: f.chemistryUnknown ? "Chemistry not recorded" : f.chemistry!) { $0.chemistry = nil; $0.chemistryUnknown = false })
        }
        if f.modelUnknown || f.model != nil {
            list.append(Chip(title: f.modelUnknown ? "Model not recorded" : f.model!) { $0.model = nil; $0.modelUnknown = false })
        }
        if f.capacityMode != .any || f.capacityMin != nil || f.capacityMax != nil {
            list.append(Chip(title: "Capacity") { $0.capacityMode = .any; $0.capacityMin = nil; $0.capacityMax = nil })
        }
        if f.voltageMode != .any || f.voltageMin != nil || f.voltageMax != nil {
            list.append(Chip(title: "Voltage") { $0.voltageMode = .any; $0.voltageMin = nil; $0.voltageMax = nil })
        }
        if f.ageMode != .any || f.ageMinDays != nil || f.ageMaxDays != nil {
            list.append(Chip(title: "Age") { $0.ageMode = .any; $0.ageMinDays = nil; $0.ageMaxDays = nil })
        }
        if f.checkoutMode != .any || f.checkoutFrom != nil || f.checkoutTo != nil {
            list.append(Chip(title: "Check-out date") { $0.checkoutMode = .any; $0.checkoutFrom = nil; $0.checkoutTo = nil })
        }
        if f.chargeMode != .any || f.chargeFrom != nil || f.chargeTo != nil {
            list.append(Chip(title: "Charge date") { $0.chargeMode = .any; $0.chargeFrom = nil; $0.chargeTo = nil })
        }
        return list
    }
}
