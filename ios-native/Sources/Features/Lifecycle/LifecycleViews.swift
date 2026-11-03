import SwiftUI

// MARK: - Retire

/// Scrap or permanently remove one or more batteries after review.
/// The server guards each battery's exact version, tag and that it isn't on loan.
struct RetireSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let batteryIds: [String]
    var onFinished: (() -> Void)? = nil

    @State private var kind = "scrapped"
    @State private var reason = ""
    @State private var destination = ""
    @State private var requestId: String?
    @State private var working = false
    @State private var message: String?
    @State private var isError = false
    @State private var confirmation: WriteConfirmation?
    @State private var confirmPermanent = false

    var body: some View {
        NavigationStack {
            Form {
                if let confirmation {
                    Section {
                        Label(confirmation.title, systemImage: "checkmark.circle.fill")
                            .font(.headline).foregroundStyle(Tone.success)
                        if kind == "scrapped" {
                            Text("Scrapped batteries stay in the records and can be recovered from their detail page.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Section {
                        Picker("Outcome", selection: $kind) {
                            Text("Scrap").tag("scrapped")
                            Text("Permanently remove").tag("permanently_removed")
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                        .disabled(isLocked)
                    } footer: {
                        Text(kind == "scrapped"
                             ? "Out of service but kept in the records. It can be recovered later."
                             : "Leaves the inventory for good. This can't be undone from the app.")
                    }

                    Section("Batteries") {
                        ForEach(batteries) { battery in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(battery.name).font(.body.weight(.semibold))
                                    Text(battery.id).font(.monoSmall).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let issue = issue(for: battery) {
                                    Text(issue).font(.caption.weight(.semibold)).foregroundStyle(Tone.failure)
                                } else {
                                    StatusPill(battery: battery, myAccountId: app.user?.id)
                                }
                            }
                        }
                    }

                    Section("Reason (optional)") {
                        TextField("e.g. swollen cells, failed capacity test", text: $reason, axis: .vertical)
                            .lineLimit(2...5)
                            .disabled(isLocked)
                        if kind == "permanently_removed" {
                            TextField("Destination, e.g. battery recycling bin", text: $destination)
                                .disabled(isLocked)
                        }
                    }

                    Section {
                        WriteStateView(requestId: requestId, message: message, isError: isError)
                        if let id = requestId, let entry = app.writes.entry(id: id) {
                            ActionButton(title: app.writes.sending.contains(id) ? "Checking…" : "Try again", tint: Tone.failure,
                                         busy: app.writes.sending.contains(id)) {
                                Task { handle(await app.writes.retry(entry)) }
                            }
                        } else {
                            ActionButton(title: working ? "Saving…" : confirmTitle,
                                         tint: kind == "scrapped" ? Tone.retire : Tone.failure, busy: working) {
                                // Same rule as the scan station: permanent removal asks once more.
                                if kind == "permanently_removed" { confirmPermanent = true } else { Task { await submit() } }
                            }
                            .disabled(!blockers.isEmpty)
                            .confirmationDialog(confirmTitle + "?", isPresented: $confirmPermanent, titleVisibility: .visible) {
                                Button(confirmTitle, role: .destructive) { Task { await submit() } }
                            } message: {
                                Text("They leave the inventory for good. Their history stays, but this can't be undone in the app.")
                            }
                        }
                    } footer: {
                        if !blockers.isEmpty { Text(blockers.joined(separator: " ")) }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            .navigationTitle(batteries.count == 1 ? "Retire battery" : "Retire \(batteries.count) batteries")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: confirmation == nil ? .cancellationAction : .confirmationAction) {
                    Button(confirmation == nil ? "Cancel" : "Done") { dismiss() }
                        .disabled(isLocked)
                }
            }
            .interactiveDismissDisabled(isLocked)
        }
        // However the sheet closes (Done or a swipe down), a confirmed result ends the selection.
        .onDisappear { if confirmation != nil { onFinished?() } }
    }

    private var batteries: [BatteryRecord] { batteryIds.compactMap { app.inventory.battery(id: $0) } }
    private var isLocked: Bool { working || (requestId.map { app.writes.entry(id: $0) != nil } ?? false) }

    private var confirmTitle: String {
        let n = batteries.count
        let what = n == 1 ? "battery" : "\(n) batteries"
        return kind == "scrapped" ? "Scrap \(what)" : "Remove \(what) permanently"
    }

    private func issue(for battery: BatteryRecord) -> String? {
        if !battery.isActive { return battery.statusTitle }
        if battery.isInUse { return "Return it first" }
        return nil
    }

    private var blockers: [String] {
        var list: [String] = []
        if batteries.count != batteryIds.count { list.append("Some batteries are no longer in this inventory.") }
        if batteries.contains(where: { issue(for: $0) != nil }) { list.append("Only active batteries in store can be retired.") }
        if reason.jsTrimmed.serverLength > 1000 { list.append("The reason is limited to 1000 characters.") }
        if destination.jsTrimmed.serverLength > 200 { list.append("The destination is limited to 200 characters.") }
        return list
    }

    private func submit() async {
        guard blockers.isEmpty, !working, !batteries.isEmpty else { return }
        working = true
        defer { working = false }
        let newRequest = RequestID.make()
        let trimmedReason = reason.jsTrimmed
        let trimmedDestination = destination.jsTrimmed
        let payload = LifecyclePayload(
            requestId: newRequest, kind: kind, reason: trimmedReason,
            destination: kind == "permanently_removed" && !trimmedDestination.isEmpty ? trimmedDestination : nil,
            source: "manual_selection",
            items: batteries.map { LifecycleItem(batteryId: $0.id, version: $0.version, tagId: $0.tagId) })
        guard let body = WriteCenter.inventoryBody(app.dataset, action: "lifecycle", payload: payload) else { return }
        requestId = newRequest
        let title = batteries.count == 1 ? "Retiring \(batteries[0].id)" : "Retiring \(batteries.count) batteries"
        handle(await app.writes.submit(action: "lifecycle", kind: kind, title: title, batteryIds: batteries.map(\.id),
                                       requestId: newRequest, body: body))
    }

    private func handle(_ outcome: WriteCenter.Outcome) {
        switch outcome {
        case .confirmed(let result):
            confirmation = result
            message = nil
        case .rejected(let text), .notSent(let text):
            requestId = nil
            message = text
            isError = true
        case .uncertain(let text):
            message = text
            isError = true
        }
    }
}

// MARK: - Recover

/// Brings a scrapped battery back to active with its identity and history intact.
struct RecoverSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let battery: BatteryRecord

    @State private var requestId: String?
    @State private var working = false
    @State private var message: String?
    @State private var isError = false
    @State private var done = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text(done ? "\(battery.id) is active again." :
                        "\(battery.id) returns to the inventory as In store. Its scrap record and history stay.")
                    .font(.body)
                WriteStateView(requestId: requestId, message: message, isError: isError)
                Spacer()
                if done {
                    ActionButton(title: "Done", tint: Tone.success) { dismiss() }
                } else if let id = requestId, let entry = app.writes.entry(id: id) {
                    ActionButton(title: "Try again", tint: Tone.success, busy: app.writes.sending.contains(id)) {
                        Task { handle(await app.writes.retry(entry)) }
                    }
                } else {
                    ActionButton(title: working ? "Recovering…" : "Recover battery", tint: Tone.success, busy: working) {
                        Task { await submit() }
                    }
                }
            }
            .padding(20)
            .navigationTitle("Recover")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working || done) }
            }
        }
    }

    private func submit() async {
        guard !working else { return }
        working = true
        defer { working = false }
        let newRequest = RequestID.make()
        let payload = RetiredAssetPayload(requestId: newRequest, kind: "recover",
                                          items: [LifecycleItem(batteryId: battery.id, version: battery.version, tagId: battery.tagId)])
        guard let body = WriteCenter.inventoryBody(app.dataset, action: "retired_asset", payload: payload) else { return }
        requestId = newRequest
        handle(await app.writes.submit(action: "retired_asset", kind: "recover", title: "Recovering \(battery.id)",
                                       batteryIds: [battery.id], requestId: newRequest, body: body))
    }

    private func handle(_ outcome: WriteCenter.Outcome) {
        switch outcome {
        case .confirmed: done = true; message = nil
        case .rejected(let text), .notSent(let text): requestId = nil; message = text; isError = true
        case .uncertain(let text): message = text; isError = true
        }
    }
}

// MARK: - Inspection

enum InspectionText {
    static func kind(_ raw: String) -> String {
        switch raw {
        case "visual_check": return "Visual check"
        case "functional_check": return "Functional check"
        case "capacity_measurement": return "Capacity measurement"
        default: return "Other check"
        }
    }

    static func outcome(_ raw: String?) -> String {
        switch raw {
        case "no_concern_observed": return "No concern"
        case "concern_observed": return "Concern"
        case "inconclusive": return "Inconclusive"
        default: return "Concern"
        }
    }

    static func tint(_ raw: String?) -> Color {
        switch raw {
        case "no_concern_observed": return Tone.success
        case "inconclusive": return .orange
        default: return Tone.failure
        }
    }
}

/// Appends an inspection record. Staff and administrators can record; voiding is web-only (administrators).
struct InspectionSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let battery: BatteryRecord
    var onSaved: (() -> Void)? = nil

    @State private var kind = "visual_check"
    @State private var outcome = "no_concern_observed"
    @State private var performedAt = Date().addingTimeInterval(-5)
    @State private var method = ""
    @State private var notes = ""
    @State private var reference = ""
    @State private var measured: Double?
    @State private var requestId: String?
    @State private var working = false
    @State private var message: String?
    @State private var isError = false
    @State private var saved = false

    var body: some View {
        NavigationStack {
            Form {
                if saved {
                    Section {
                        Label("Inspection recorded", systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(Tone.success)
                        Text("\(InspectionText.kind(kind)) · \(InspectionText.outcome(outcome))").foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        Picker("Check", selection: $kind) {
                            Text("Visual check").tag("visual_check")
                            Text("Functional check").tag("functional_check")
                            Text("Capacity measurement").tag("capacity_measurement")
                            Text("Other").tag("other")
                        }
                        Picker("Result", selection: $outcome) {
                            Text("No concern").tag("no_concern_observed")
                            Text("Concern").tag("concern_observed")
                            Text("Inconclusive").tag("inconclusive")
                        }
                        .pickerStyle(.segmented)
                        DatePicker("Checked at", selection: $performedAt, in: ...Date(), displayedComponents: [.date, .hourAndMinute])
                            .environment(\.timeZone, Sydney.zone)
                            .environment(\.locale, Locale(identifier: "en_AU"))
                    } header: {
                        Text("\(battery.id) · \(battery.name)")
                    }

                    if kind == "capacity_measurement" {
                        Section("Measurement") {
                            LabeledField(title: "Measured capacity") { UnitField(unit: "mAh", value: $measured) }
                            TextField("Method and conditions (required)", text: $method, axis: .vertical).lineLimit(2...4)
                        }
                    }

                    Section {
                        TextField(notesPrompt, text: $notes, axis: .vertical).lineLimit(3...6)
                        TextField("Reference, e.g. test sheet number (optional)", text: $reference)
                        if kind != "capacity_measurement" {
                            TextField("Method (optional)", text: $method)
                        }
                    } header: {
                        Text(notesRequired ? "Notes (required)" : "Notes")
                    }

                    Section {
                        WriteStateView(requestId: requestId, message: message, isError: isError)
                        if let id = requestId, let entry = app.writes.entry(id: id) {
                            ActionButton(title: "Try again", tint: Color.primary, foreground: Color(.systemBackground),
                                         busy: app.writes.sending.contains(id)) {
                                Task { handle(await app.writes.retry(entry)) }
                            }
                        } else {
                            ActionButton(title: working ? "Saving…" : "Record inspection", tint: InspectionText.tint(outcome), busy: working) {
                                Task { await submit() }
                            }
                            .disabled(!problems.isEmpty)
                        }
                    } footer: {
                        if !problems.isEmpty { Text(problems.joined(separator: " ")) }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            .navigationTitle("Record inspection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: saved ? .confirmationAction : .cancellationAction) {
                    Button(saved ? "Done" : "Cancel") {
                        if saved { onSaved?() }
                        dismiss()
                    }
                    .disabled(working)
                }
            }
            .interactiveDismissDisabled(working || (requestId.map { app.writes.entry(id: $0) != nil } ?? false))
        }
    }

    private var notesRequired: Bool { outcome == "concern_observed" || kind == "other" }
    private var notesPrompt: String { outcome == "concern_observed" ? "What did you notice?" : "Notes" }

    private var problems: [String] {
        var list: [String] = []
        if !battery.isActive { list.append("Retired batteries can't get new inspections.") }
        if notesRequired && notes.jsTrimmed.isEmpty {
            list.append(outcome == "concern_observed" ? "Describe the concern." : "Describe the check.")
        }
        if kind == "capacity_measurement" {
            if measured == nil || (measured ?? 0) <= 0 { list.append("Enter the measured capacity.") }
            if (measured ?? 0) > 1_000_000 { list.append("The measured capacity is too large.") }
            if method.jsTrimmed.isEmpty { list.append("Describe the method.") }
        }
        if performedAt > Date() { list.append("The time can't be in the future.") }
        if notes.jsTrimmed.serverLength > 2000 || method.jsTrimmed.serverLength > 1000 || reference.jsTrimmed.serverLength > 1000 {
            list.append("A field is too long.")
        }
        return list
    }

    private func submit() async {
        guard problems.isEmpty, !working else { return }
        working = true
        defer { working = false }
        let newRequest = RequestID.make()
        // The server allows no future time; keep a small margin behind the phone clock.
        let at = min(performedAt, Date().addingTimeInterval(-5))
        let payload = InspectionPayload(
            requestId: newRequest, batteryId: battery.id, expectedBatteryVersion: battery.version,
            kind: kind, outcome: outcome, performedAt: Sydney.timestamp(at),
            method: method.jsTrimmed,
            notes: notes.jsTrimmed,
            reference: reference.jsTrimmed,
            capacityMah: kind == "capacity_measurement" ? measured : nil)
        guard let body = WriteCenter.inventoryBody(app.dataset, action: "inspection", payload: payload) else { return }
        requestId = newRequest
        handle(await app.writes.submit(action: "inspection", kind: kind, title: "Inspection of \(battery.id)",
                                       batteryIds: [battery.id], requestId: newRequest, body: body))
    }

    private func handle(_ outcome: WriteCenter.Outcome) {
        switch outcome {
        case .confirmed: saved = true; message = nil
        case .rejected(let text), .notSent(let text): requestId = nil; message = text; isError = true
        case .uncertain(let text): message = text; isError = true
        }
    }
}
