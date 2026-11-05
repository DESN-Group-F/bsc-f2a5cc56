import SwiftUI

/// One tag or label read while looking up. `batteryId` is nil when nothing in this inventory matches.
struct LookupRead: Identifiable {
    enum Kind {
        /// An NFC tag, with its read evidence (kept for registering an unknown tag).
        case tag(TagRead)
        /// A printed label carrying this battery ID.
        case label(String)
    }

    let id: String
    let batteryId: String?
    let kind: Kind

    init(tag: TagRead, batteryId: String?) {
        id = tag.tagId
        self.batteryId = batteryId
        kind = .tag(tag)
    }

    init(label: String, batteryId: String?) {
        id = "label:" + label
        self.batteryId = batteryId
        kind = .label(label)
    }

    var tagRead: TagRead? { if case .tag(let read) = kind { return read } else { return nil } }
    var labelId: String? { if case .label(let id) = kind { return id } else { return nil } }
}

/// The batteries just looked up, newest first, and how they were read.
struct LookupPresentation: Identifiable {
    enum Origin { case tag, label }
    let id = UUID()
    let reads: [LookupRead]
    var origin: Origin = .tag
}

/// Read-only cards for the batteries just scanned with Look up. Nothing here changes anything until
/// an action hands the battery to the scan station's usual reviewed list.
struct LookupSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let presentation: LookupPresentation
    @State private var selected: String?

    private var current: LookupRead? {
        presentation.reads.first { $0.id == selected } ?? presentation.reads.first
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if presentation.reads.count > 1 { picker }
                    if let current {
                        if let id = current.batteryId, let battery = app.inventory.battery(id: id) {
                            BatteryLookupCard(battery: battery) { action in run(action, battery: battery) }
                        } else {
                            unregisteredCard(current)
                        }
                    }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(presentation.reads.count > 1 ? "\(presentation.reads.count) looked up" : "Look up")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if presentation.origin == .label || app.scan.canLookUp {
                    ToolbarItem(placement: .confirmationAction) {
                        Button { scanAgain() } label: {
                            Label("Scan again", systemImage: presentation.origin == .label ? "qrcode.viewfinder" : "wave.3.right")
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// Several tags in one go: a row of IDs to flip between them.
    private var picker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(presentation.reads) { read in
                    let isOn = read.id == current?.id
                    let battery = read.batteryId.flatMap { app.inventory.battery(id: $0) }
                    Button {
                        selected = read.id
                        Haptics.tap()
                    } label: {
                        HStack(spacing: 6) {
                            if battery?.hasOpenConcern == true { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Tone.failure) }
                            Text(read.batteryId ?? read.labelId ?? "Unregistered").font(.monoSmall)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 36)
                        .foregroundStyle(isOn ? Color.white : Color.primary)
                        .background(isOn ? Tone.ink : Color(.secondarySystemGroupedBackground), in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func unregisteredCard(_ read: LookupRead) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let id = read.labelId {
                Label("No battery \(id) in this inventory", systemImage: "questionmark.circle")
                    .font(.headline)
                Text("The label is for this inventory, but no battery here has this ID. It may have been removed.")
                    .font(.subheadline).foregroundStyle(.secondary)
            } else {
                Label("This tag isn't registered", systemImage: "questionmark.circle")
                    .font(.headline)
                Text("Tag \(read.id.replacingOccurrences(of: "nfc:uid:", with: ""))")
                    .font(.mono).foregroundStyle(.secondary)
                Text("No battery in this inventory has this tag. If it's a new battery, register it first.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if let tagRead = read.tagRead, app.allowsNFC(.intake) {
                Button {
                    after { app.registration = RegistrationRequest(tagRead: tagRead) }
                } label: {
                    Text("Register this battery").font(.headline).foregroundStyle(.white).frame(maxWidth: .infinity, minHeight: 40)
                }
                .primaryButton(Tone.register)
                .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
    }

    private func run(_ action: BatteryLookupCard.Action, battery: BatteryRecord) {
        switch action {
        case .details:
            after {
                app.pendingDetailId = battery.id
                app.tab = .inventory
            }
        case .move:
            after {
                app.scan.takeFromLookup(battery)
                app.tab = .scan
            }
        case .returnRun(let id):
            after { app.groupFlow = .returnRun(runId: id) }
        }
    }

    private func scanAgain() {
        let origin = presentation.origin
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            if origin == .label { app.labelScan = .lookUp } else { app.scan.startLookup() }
        }
    }

    /// Closes this sheet first, so the next screen or sheet presents cleanly.
    private func after(_ work: @escaping @MainActor () -> Void) {
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            work()
        }
    }
}

/// Everything worth knowing at a glance about one battery, from the latest inventory.
struct BatteryLookupCard: View {
    @Environment(AppModel.self) private var app
    let battery: BatteryRecord
    var onAction: (Action) -> Void

    enum Action { case details, move, returnRun(String) }

    var body: some View {
        let groups = app.inventory.groups.filter { $0.batteryIds.contains(battery.id) }
        let run = app.runs.openRun(holding: battery)
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                BatteryGlyph(tint: tint, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(battery.name).font(.title3.weight(.bold))
                    Text(battery.id).font(.mono).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                StatusPill(battery: battery, myAccountId: app.user?.id)
            }

            Text(statusSentence).font(.subheadline.weight(.semibold))

            if battery.hasOpenConcern, let concern = battery.inspectionPreview?.latestConcern {
                Label {
                    Text("Concern recorded · \(InspectionText.kind(concern.kind)), \(Sydney.friendly(concern.performedAt))\(concern.inspectorName.map { " by \($0)" } ?? "")")
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Tone.failure)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Tone.failure.opacity(0.1), in: .rect(cornerRadius: 14, style: .continuous))
            }

            VStack(spacing: 0) {
                fact("Specs", battery.specLine)
                fact("Home", battery.homeLine)
                if let owner = battery.ownerName, !owner.isEmpty { fact("Responsible", owner) }
                if let latest = battery.inspectionPreview?.latest {
                    fact("Last inspection", "\(InspectionText.kind(latest.kind)) · \(InspectionText.outcome(latest.outcome)) · \(Sydney.friendly(latest.performedAt))")
                }
                if let charged = battery.chargedAt {
                    let minutes = battery.chargeDurationMinutes.map { " · \(Format.duration(seconds: $0 * 60))" } ?? ""
                    fact("Last charged", Sydney.friendly(charged) + minutes)
                }
                if let seen = battery.observedAt {
                    fact("Last seen", [battery.observedRoom, Sydney.friendly(seen)].compactMap { $0 }.joined(separator: " · "))
                }
                if !groups.isEmpty { fact("Groups", groups.map(\.name).joined(separator: ", ")) }
            }
            .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 14, style: .continuous))

            if let run {
                Button { onAction(.returnRun(run.id)) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "person.3.fill").foregroundStyle(Tone.returnGlyph)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Out in “\(run.teachingGroup.name)”").font(.subheadline.weight(.semibold))
                            Text("Started \(run.startedText) · \(run.outstanding.count) still out").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 4)
                        Text("Return together").font(.footnote.weight(.bold)).foregroundStyle(Tone.returnInk)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Tone.returning, in: .capsule)
                            .fixedSize()
                    }
                    .padding(12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 14, style: .continuous))
            }

            VStack(spacing: 8) {
                if battery.isActive {
                    let returning = battery.isInUse
                    Button { onAction(.move) } label: {
                        Text(returning ? "Return" : "Check out")
                            .font(.headline)
                            .foregroundStyle(returning ? Tone.returnInk : Color.white)
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .primaryButton(returning ? Tone.returning : Tone.checkout)
                    .disabled(app.scan.hasUnsettledWork || app.writes.hasPending)
                }
                Button { onAction(.details) } label: {
                    Text("Full details").font(.headline).frame(maxWidth: .infinity, minHeight: 36)
                }
                .secondaryButton()
            }
            if battery.isActive {
                Text(battery.isInUse ? "Return opens the scan station with this battery, ready to review and confirm."
                                     : "Check out opens the scan station with this battery, ready to review and confirm.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
    }

    private var tint: Color {
        if !battery.isActive { return Tone.retire }
        return battery.isInUse ? Tone.returnGlyph : Tone.checkout
    }

    private var statusSentence: String {
        if !battery.isActive {
            let reason = (battery.lifecycleReason ?? "").isEmpty ? "" : " · \(battery.lifecycleReason ?? "")"
            return "\(battery.statusTitle)\(battery.lifecycleAt.map { " \(Sydney.friendly($0))" } ?? "")\(reason)"
        }
        guard battery.isInUse else { return "In store" }
        let since = battery.checkedOutAt.map { " since \(Sydney.friendly($0))" } ?? ""
        if battery.borrowerAccountId != nil && battery.borrowerAccountId == app.user?.id { return "With you\(since)" }
        return "With \(battery.borrowerName ?? "someone")\(since)"
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value).font(.subheadline.weight(.medium)).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }
}
