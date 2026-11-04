import SwiftUI

/// Everything staff need about one battery before they pick it up: condition, specs, age, charge,
/// where it lives, who has it, and its history. Unknown values are shown as not recorded, never guessed.
struct BatteryDetailView: View {
    @Environment(AppModel.self) private var app
    let batteryId: String
    @State private var detail: BatteryDetail?
    @State private var loadError: String?
    @State private var sheet: DetailSheet?
    @State private var showAllHistory = false
    @State private var headerHidden = false

    private enum DetailSheet: String, Identifiable {
        case inspect, retire, recover, group
        var id: String { rawValue }
    }

    private var battery: BatteryRecord? { app.inventory.battery(id: batteryId) ?? detail?.battery }

    var body: some View {
        ScrollView {
            if let battery {
                VStack(alignment: .leading, spacing: 16) {
                    header(battery)

                    if let concern = openConcern(battery) {
                        ConcernCard(record: concern)
                    }

                    StatusCard(battery: battery, myAccountId: app.user?.id) {
                        if battery.isScrapped {
                            sheet = .recover
                        } else {
                            app.scan.begin(with: battery)
                            app.tab = .scan
                        }
                    }

                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                        Fact(title: "Capacity", value: battery.capacityMah.map { Format.capacity($0) } ?? "Not recorded")
                        Fact(title: "Voltage", value: battery.voltage.map { Format.voltage($0) } ?? "Not recorded")
                        Fact(title: "Chemistry", value: nonEmpty(battery.chemistry) ?? "Not recorded")
                        Fact(title: "Model", value: nonEmpty(battery.model) ?? "Not recorded")
                        Fact(title: "Age", value: age(battery), note: battery.manufacturedOn == nil ? nil : "since manufacture")
                        Fact(title: "In service", value: serviceAge(battery))
                        Fact(title: "Times borrowed", value: detail?.usageSummary?.totalCheckouts.map { String($0) } ?? "—")
                        Fact(title: "Total time out", value: totalOut ?? "—")
                    }

                    chargeCard(battery)

                    VStack(spacing: 0) {
                        InfoRow(title: "Responsible", value: battery.ownerName ?? "Not recorded")
                        Divider().padding(.leading, 16)
                        InfoRow(title: "Home", value: battery.homeLine, note: (battery.homeRoomIsPlaceholder ?? false) ? "placeholder" : nil)
                        Divider().padding(.leading, 16)
                        InfoRow(title: "Last seen", value: lastSeen(battery))
                        Divider().padding(.leading, 16)
                        InfoRow(title: "Tag", value: battery.tagId.map { $0.replacingOccurrences(of: "nfc:uid:", with: "NFC ") } ?? "Untagged")
                        Divider().padding(.leading, 16)
                        InfoRow(title: "Manufactured", value: battery.manufacturedOn.map { Sydney.longDay($0) } ?? "Not recorded")
                        Divider().padding(.leading, 16)
                        InfoRow(title: "First used", value: battery.firstUsedOn.map { Sydney.longDay($0) } ?? "Not recorded")
                        Divider().padding(.leading, 16)
                        InfoRow(title: "Registered", value: registered(battery))
                    }
                    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))

                    if detail == nil, let loadError {
                        // The battery itself is known; only its history didn't load.
                        HStack(spacing: 12) {
                            Image(systemName: "wifi.exclamationmark").foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Couldn't load inspections and history").font(.subheadline.weight(.semibold))
                                Text(loadError).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Button("Retry") { Task { await load() } }
                                .buttonStyle(.bordered)
                                .buttonBorderShape(.capsule)
                        }
                        .padding(14)
                        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
                    } else {
                        inspections(battery)
                        history
                    }
                }
                .padding(16)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Couldn't load this battery", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Try again") { Task { await load() } }.secondaryButton()
                }
                .padding(.top, 80)
            } else {
                ProgressView().padding(.top, 120)
            }
        }
        .defaultScrollAnchor(app.preview == .detailBottom ? .bottom : .top)
        .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 70 } action: { _, hidden in
            withAnimation(.easeInOut(duration: 0.18)) { headerHidden = hidden }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(headerHidden ? (battery?.name ?? batteryId) : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let battery, battery.isActive || battery.isScrapped {
                    Menu {
                        if battery.isActive {
                            Button { sheet = .inspect } label: { Label("Record inspection", systemImage: "checklist") }
                            Button { sheet = .group } label: { Label("Add to teaching group", systemImage: "person.3") }
                            Divider()
                            Button(role: .destructive) { sheet = .retire } label: { Label("Retire…", systemImage: "archivebox") }
                        } else if battery.isScrapped {
                            Button { sheet = .recover } label: { Label("Recover", systemImage: "arrow.uturn.backward") }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .disabled(app.writes.hasPending)
                }
            }
        }
        .sheet(item: $sheet) { which in
            if let battery {
                switch which {
                case .inspect:
                    InspectionSheet(battery: battery) { Task { await load() } }
                case .retire:
                    RetireSheet(batteryIds: [battery.id]) { Task { await load() } }
                case .recover:
                    RecoverSheet(battery: battery)
                        .presentationDetents([.medium])
                case .group:
                    AddToGroupSheet(batteryIds: [battery.id])
                        .presentationDetents([.medium, .large])
                }
            }
        }
        .navigationDestination(isPresented: $showAllHistory) {
            HistoryList(entries: timeline)
        }
        .task(id: "\(battery?.version ?? 0)-\(battery?.inspectionPreview?.latest?.id ?? "")") { await load() }
        .refreshable { await load() }
    }

    // MARK: Sections

    private func header(_ battery: BatteryRecord) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(battery.id).font(.mono).foregroundStyle(.secondary)
            Text(battery.name).font(.largeTitle.weight(.bold))
            Text(battery.specLine).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 4)
    }

    @ViewBuilder
    private func chargeCard(_ battery: BatteryRecord) -> some View {
        HStack(spacing: 12) {
            Image(systemName: battery.chargedAt == nil ? "bolt.slash" : "bolt.fill")
                .font(.title3)
                .foregroundStyle(battery.chargedAt == nil ? Color.secondary : Tone.success)
                .frame(width: 36, height: 36)
                .background((battery.chargedAt == nil ? Color.secondary : Tone.success).opacity(0.12), in: .rect(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 1) {
                Text("Last charge").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if let at = battery.chargedAt {
                    Text(Sydney.friendly(at) + (battery.chargeDurationMinutes.map { " · \(Format.duration(seconds: $0 * 60))" } ?? ""))
                        .font(.subheadline.weight(.semibold))
                } else {
                    Text("No charge recorded").font(.subheadline.weight(.semibold))
                }
            }
            Spacer()
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 18, style: .continuous))
    }

    @ViewBuilder
    private func inspections(_ battery: BatteryRecord) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Inspections").font(.title3.weight(.bold))
                Spacer()
                if battery.isActive {
                    Button { sheet = .inspect } label: { Label("Record", systemImage: "plus") }
                        .font(.subheadline.weight(.semibold))
                        .disabled(app.writes.hasPending)
                }
            }
            .padding(.horizontal, 4)
            let records = detail?.inspections ?? []
            if records.isEmpty {
                Text(detail == nil ? "Loading…" : "No inspections recorded yet.")
                    .font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 4)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(records.prefix(4))) { record in
                        InspectionRow(record: record)
                        if record.id != records.prefix(4).last?.id { Divider().padding(.leading, 38) }
                    }
                }
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
                if records.count > 4 {
                    Text("\(records.count - 4) older in History below").font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
                }
            }
        }
    }

    @ViewBuilder
    private var history: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("History").font(.title3.weight(.bold)).padding(.horizontal, 4)
            let entries = timeline
            if entries.isEmpty {
                Text(detail == nil ? "Loading…" : "Nothing recorded yet.").font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 4)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(entries.prefix(8))) { entry in TimelineRow(entry: entry) }
                    if entries.count > 8 {
                        Button { showAllHistory = true } label: {
                            HStack {
                                Text("Show all \(entries.count)")
                                Spacer()
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                            }
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
            }
        }
    }

    // MARK: Derived values

    private func openConcern(_ battery: BatteryRecord) -> InspectionRecord? {
        guard battery.isActive else { return nil }
        let valid = (detail?.inspections ?? []).filter { $0.voidedAt == nil }
        if let latest = valid.first, latest.outcome == "concern_observed" { return latest }
        if detail == nil, battery.hasOpenConcern, let brief = battery.inspectionPreview?.latestConcern {
            return InspectionRecord(id: brief.id, kind: brief.kind, outcome: "concern_observed", performedAt: brief.performedAt,
                                    recordedAt: nil, inspectorName: brief.inspectorName, method: nil, notes: nil,
                                    reference: nil, capacityMah: nil, voidedAt: nil, voidReason: nil)
        }
        return nil
    }

    private var totalOut: String? {
        guard let seconds = detail?.usageSummary?.totalCheckedOutSeconds else { return nil }
        return seconds < 60 ? "Under 1 min" : Format.duration(seconds: seconds)
    }

    private func lastSeen(_ battery: BatteryRecord) -> String {
        guard let at = battery.observedAt else { return "Never observed" }
        let place = battery.observationRoomSnapshot == "recorded"
            ? [battery.observedBuilding, battery.observedRoom].compactMap { $0 }.joined(separator: " · ")
            : "Room label unavailable"
        return "\(place) · \(Sydney.friendly(at))"
    }

    private func registered(_ battery: BatteryRecord) -> String {
        let at = Sydney.friendly(detail?.movementSummary?.registration?.at ?? battery.registeredAt)
        if let who = detail?.movementSummary?.registration?.actorName { return "\(at) · \(who)" }
        return at
    }

    private func load() async {
        guard app.preview == nil else {
            if detail == nil { detail = PreviewFixtures.detail(batteryId, inventory: app.inventory) }
            return
        }
        do {
            detail = try await app.service.detail(app.dataset, batteryId: batteryId)
            loadError = nil
        } catch {
            loadError = (error as? APIFailure)?.message ?? "Please try again."
            app.handle(error)
        }
    }

    private func nonEmpty(_ s: String?) -> String? { (s?.isEmpty ?? true) ? nil : s }

    private func age(_ battery: BatteryRecord) -> String {
        guard let days = InventoryQuery.ageInDays(battery.manufacturedOn, Sydney.ymd()) else { return "Not recorded" }
        return AgeText.describe(days: days)
    }

    private func serviceAge(_ battery: BatteryRecord) -> String {
        guard let end = InventoryQuery.serviceEnd(battery, Sydney.ymd()),
              let days = InventoryQuery.ageInDays(battery.firstUsedOn, end) else { return "Not recorded" }
        return AgeText.describe(days: days)
    }

    // MARK: Timeline

    private var timeline: [TimelineEntry] {
        guard let battery else { return [] }
        var entries: [TimelineEntry] = []
        if let reg = detail?.movementSummary?.registration {
            entries.append(TimelineEntry(id: "registered", title: "Registered" + (reg.actorName.map { " by \($0)" } ?? ""),
                                         detail: nil, at: reg.at, tint: Tone.register))
        }
        let events = detail?.events ?? []
        for loan in detail?.loans ?? [] {
            if loan.cancelledAt != nil {
                entries.append(TimelineEntry(id: loan.id + "-void", title: "Check-out corrected (voided)",
                                             detail: loan.correctionReason, at: loan.cancelledAt ?? loan.checkedOutAt, tint: .secondary))
                continue
            }
            // A loan that went out with a teaching group, or as part of a group checkout, says which.
            let out = events.first { $0.action == "checkout" && $0.details?.loanId == loan.id }?.details
            let groupLine = out?.groupName.map { out?.isGroupCheckout == true ? "Group checkout · \($0)" : "Teaching group · \($0)" }
            entries.append(TimelineEntry(id: loan.id + "-out", title: "Checked out by \(loan.borrowerName ?? "someone")",
                                         detail: groupLine, at: loan.checkedOutAt, tint: Tone.checkout))
            for event in events where event.action == "teaching_loan_continued" && event.details?.loanId == loan.id {
                entries.append(TimelineEntry(id: event.id, title: "Kept out for a group checkout",
                                             detail: event.details?.groupName, at: event.at, tint: Tone.checkout))
            }
            if let returned = loan.returnedAt {
                entries.append(TimelineEntry(id: loan.id + "-in", title: "Returned by \(loan.returnActorName ?? "someone")",
                                             detail: nil, at: returned, tint: Tone.returning))
            }
        }
        for record in detail?.inspections ?? [] {
            let voided = record.voidedAt != nil
            entries.append(TimelineEntry(id: "insp-" + record.id,
                                         title: "\(InspectionText.kind(record.kind)) · \(InspectionText.outcome(record.outcome))\(voided ? " (voided)" : "")",
                                         detail: [record.inspectorName, nonEmpty(record.notes)].compactMap { $0 }.joined(separator: " — "),
                                         at: record.performedAt, tint: voided ? .secondary : InspectionText.tint(record.outcome)))
        }
        for charge in detail?.charges ?? [] {
            entries.append(TimelineEntry(id: "charge-" + charge.id,
                                         title: "Charged" + (charge.durationMinutes.map { " · \(Format.duration(seconds: $0 * 60))" } ?? ""),
                                         detail: charge.actorName, at: charge.completedAt, tint: Tone.success))
        }
        for seen in (detail?.observations ?? []).prefix(20) {
            let place = seen.roomSnapshot == "recorded" ? [seen.roomBuilding, seen.roomName].compactMap { $0 }.joined(separator: " · ") : "Room label unavailable"
            entries.append(TimelineEntry(id: "seen-" + seen.id, title: "Seen in \(place)", detail: seen.source, at: seen.observedAt, tint: .teal))
        }
        if !battery.isActive, let at = battery.lifecycleAt {
            let detailText = [nonEmpty(battery.lifecycleReason), nonEmpty(battery.lifecycleDestination).map { "To \($0)" }].compactMap { $0 }.joined(separator: " · ")
            entries.append(TimelineEntry(id: "retired", title: battery.statusTitle, detail: detailText.isEmpty ? nil : detailText,
                                         at: at, tint: Tone.retire))
        }
        return entries.sorted { (Sydney.date($0.at) ?? .distantPast) > (Sydney.date($1.at) ?? .distantPast) }
    }
}

// MARK: - Pieces

enum AgeText {
    /// "12 days", "5 months", "2 years 3 months".
    static func describe(days: Int) -> String {
        if days < 1 { return "Under a day" }
        if days < 60 { return "\(days) day\(days == 1 ? "" : "s")" }
        let months = Int(Double(days) / 30.44)
        if months < 24 { return "\(months) months" }
        let years = months / 12, rest = months % 12
        return rest == 0 ? "\(years) years" : "\(years) y \(rest) mo"
    }
}

struct TimelineEntry: Identifiable {
    let id: String
    let title: String
    let detail: String?
    let at: String
    let tint: Color
}

struct TimelineRow: View {
    let entry: TimelineEntry

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(entry.tint).frame(width: 10, height: 10).padding(.top, 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.title).font(.body.weight(.semibold))
                if let detail = entry.detail, !detail.isEmpty {
                    Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                }
                Text(Sydney.friendly(entry.at)).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

struct HistoryList: View {
    let entries: [TimelineEntry]

    var body: some View {
        List(entries) { entry in
            TimelineRow(entry: entry).listRowInsets(EdgeInsets())
        }
        .listStyle(.insetGrouped)
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct InspectionRow: View {
    let record: InspectionRecord

    var body: some View {
        let voided = record.voidedAt != nil
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(voided ? Color.secondary : InspectionText.tint(record.outcome)).frame(width: 10, height: 10).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("\(InspectionText.kind(record.kind)) · \(InspectionText.outcome(record.outcome))")
                        .font(.subheadline.weight(.semibold))
                        .strikethrough(voided)
                    Spacer()
                    Text(Sydney.friendly(record.performedAt)).font(.caption).foregroundStyle(.secondary)
                }
                if let capacity = record.capacityMah {
                    Text("Measured \(Format.capacity(capacity))").font(.footnote)
                }
                if let notes = record.notes, !notes.isEmpty {
                    Text(notes).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                }
                Text(voided ? "Voided" + (record.voidReason.map { ": \($0)" } ?? "") : (record.inspectorName ?? ""))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

/// Shown above everything when the most recent inspection found a concern.
struct ConcernCard: View {
    let record: InspectionRecord

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").font(.title3).foregroundStyle(Tone.failure)
            VStack(alignment: .leading, spacing: 3) {
                Text("Concern at last inspection").font(.subheadline.weight(.bold))
                Text("\(InspectionText.kind(record.kind)) · \(Sydney.friendly(record.performedAt))" + (record.inspectorName.map { " · \($0)" } ?? ""))
                    .font(.footnote).foregroundStyle(.secondary)
                if let notes = record.notes, !notes.isEmpty {
                    Text(notes).font(.footnote)
                }
                Text("Check it before use. A later inspection with no concern clears this.").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Tone.failure.opacity(0.1), in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Tone.failure.opacity(0.3)))
    }
}

struct StatusCard: View {
    let battery: BatteryRecord
    let myAccountId: String?
    var action: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(battery.statusTitle).font(.footnote.weight(.semibold)).opacity(0.85)
                Text(headline).font(.title3.weight(.bold))
                if let line = retiredLine {
                    Text(line).font(.footnote).opacity(0.9)
                }
            }
            Spacer()
            if battery.isActive || battery.isScrapped {
                Button(action: action) {
                    Text(buttonTitle)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(buttonForeground)
                        .padding(.horizontal, 16)
                        .frame(height: 40)
                        .background(buttonBackground, in: .capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .foregroundStyle(.white)
        .padding(16)
        .background(background, in: .rect(cornerRadius: 22, style: .continuous))
        .shadow(color: background.opacity(0.3), radius: 14, y: 8)
    }

    private var buttonTitle: String {
        if battery.isScrapped { return "Recover" }
        return battery.isInUse ? "Return" : "Check out"
    }
    private var buttonForeground: Color {
        if battery.isScrapped { return Tone.retire }
        return battery.isInUse ? Tone.returnInk : Tone.checkout
    }
    private var buttonBackground: Color { battery.isInUse ? Tone.returning : Color.white }

    private var background: Color {
        if !battery.isActive { return Tone.retire }
        return battery.isInUse ? Tone.checkout : Color(red: 0.20, green: 0.22, blue: 0.27)
    }

    private var headline: String {
        if !battery.isActive { return battery.isScrapped ? "Out of service" : "No longer in inventory" }
        guard battery.isInUse else { return "Ready to check out" }
        let who = (battery.borrowerAccountId != nil && battery.borrowerAccountId == myAccountId) ? "you" : (battery.borrowerName ?? "someone")
        return "With \(who) since \(Sydney.shortTime(battery.checkedOutAt))"
    }

    private var retiredLine: String? {
        guard !battery.isActive else { return nil }
        var parts: [String] = []
        if let at = battery.lifecycleAt { parts.append(Sydney.friendly(at)) }
        if let reason = battery.lifecycleReason, !reason.isEmpty { parts.append(reason) }
        if let destination = battery.lifecycleDestination, !destination.isEmpty { parts.append("to \(destination)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct Fact: View {
    let title: String
    let value: String
    var note: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).tracking(0.5)
            Text(value).font(.headline).lineLimit(2).minimumScaleFactor(0.85)
            if let note { Text(note).font(.caption2).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16, style: .continuous))
    }
}

struct InfoRow: View {
    let title: String
    let value: String
    var note: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value).fontWeight(.semibold).multilineTextAlignment(.trailing)
            if let note { Text(note).font(.caption.weight(.semibold)).foregroundStyle(.orange) }
        }
        .font(.subheadline)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
