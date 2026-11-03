import SwiftUI

/// The shared details of a new battery (or a batch of them): everything except the tag.
/// Saved with batch drafts so a half-finished intake survives leaving the app.
struct RegistrationDetails: Codable, Equatable {
    var name = "Battery"
    var chemistry = ""
    var model = ""
    var capacity: Double?
    var voltage: Double?
    var ownerId = ""
    var roomId: String?
    var manufactured: String?
    var firstUseMode = "at_registration"
    var firstUsed: String?
    var chosenModel: BatteryModelChoice?
    var appliedFields: [String] = []
    var conflicts: [String] = []

    // MARK: Model application

    /// Fills empty (or default) fields from the model; differing values the user typed are kept until they choose otherwise.
    mutating func apply(_ choice: BatteryModelChoice) {
        chosenModel = choice
        var applied: [String] = []
        var conflicting: [String] = []
        func take(_ field: String, _ value: String, _ current: inout String, isDefault: Bool) {
            guard !value.isEmpty else { return }
            if current.jsTrimmed.isEmpty || isDefault || current.jsTrimmed == value { current = value; applied.append(field) }
            else { conflicting.append(field) }
        }
        func takeNumber(_ field: String, _ value: Double?, _ current: inout Double?) {
            guard let value else { return }
            if current == nil || current == value { current = value; applied.append(field) } else { conflicting.append(field) }
        }
        take("name", choice.name, &name, isDefault: name.jsTrimmed == "Battery")
        take("model", choice.model, &model, isDefault: false)
        take("chemistry", choice.chemistry, &chemistry, isDefault: false)
        takeNumber("capacityMah", choice.capacityMah, &capacity)
        takeNumber("voltage", choice.voltage, &voltage)
        appliedFields = applied
        conflicts = conflicting
    }

    mutating func applyConflicts() {
        guard let choice = chosenModel else { return }
        for field in conflicts {
            switch field {
            case "name": name = choice.name
            case "model": model = choice.model
            case "chemistry": chemistry = choice.chemistry
            case "capacityMah": capacity = choice.capacityMah
            case "voltage": voltage = choice.voltage
            default: break
            }
            if !appliedFields.contains(field) { appliedFields.append(field) }
        }
        conflicts = []
    }

    mutating func clearModel() {
        chosenModel = nil
        appliedFields = []
        conflicts = []
    }

    // MARK: Checks and payload

    @MainActor
    func owner(in inventory: InventoryModel) -> Person? { inventory.staffOwners.first { $0.id == ownerId } }
    @MainActor
    func room(in inventory: InventoryModel) -> Room? { roomId.flatMap { id in inventory.registrationRooms.first { $0.id == id } } }

    @MainActor
    func problems(in inventory: InventoryModel) -> [String] {
        var list: [String] = []
        let n = name.jsTrimmed
        if n.serverLength < 2 || n.serverLength > 120 { list.append("Name needs 2–120 characters.") }
        if chemistry.jsTrimmed.serverLength > 40 { list.append("Chemistry is limited to 40 characters.") }
        if model.jsTrimmed.serverLength > 120 { list.append("Model is limited to 120 characters.") }
        if let c = capacity, !(c > 0 && c <= 1_000_000) { list.append("Capacity must be above 0 mAh.") }
        if let v = voltage, !(v > 0 && v <= 1000) { list.append("Voltage must be between 0 and 1000 V.") }
        if owner(in: inventory) == nil { list.append("Choose who is responsible.") }
        if roomId != nil && room(in: inventory) == nil { list.append("That home room is no longer available.") }
        if inventory.snapshot?.buildings?.contains(where: { $0.id == "J18" }) != true {
            list.append("J18 isn't available yet. Pull to refresh Inventory and try again.")
        }
        if firstUseMode == "date" && firstUsed == nil { list.append("Pick the first-use date, or choose another first-use option.") }
        if let m = manufactured, firstUseMode == "date", let f = firstUsed, f < m { list.append("First use can't be before manufacture.") }
        let today = Sydney.ymd()
        if let m = manufactured, m > today { list.append("The manufacture date can't be in the future.") }
        if firstUseMode == "date", let f = firstUsed, f > today { list.append("The first-use date can't be in the future.") }
        return list
    }

    @MainActor
    func common(in inventory: InventoryModel) -> RegistrationCommon? {
        guard let owner = owner(in: inventory) else { return nil }
        let selection = chosenModel.map {
            ModelSelectionRef(origin: $0.origin, id: $0.id, contentHash: $0.contentHash, confirmed: true, appliedFields: appliedFields)
        }
        return RegistrationCommon(name: name.jsTrimmed, chemistry: chemistry.jsTrimmed, model: model.jsTrimmed,
                                  capacityMah: capacity, voltage: voltage, ownerId: owner.id, homeBuildingId: "J18",
                                  homeRoomId: room(in: inventory)?.id, manufacturedOn: manufactured,
                                  firstUsedOn: firstUseMode == "date" ? firstUsed : nil, modelSelection: selection)
    }

    /// "Battery · LiPo · 2200 mAh · 11.1 V"
    var specSummary: String {
        var parts = [name.jsTrimmed.isEmpty ? "Battery" : name.jsTrimmed]
        if !chemistry.jsTrimmed.isEmpty { parts.append(chemistry.jsTrimmed) }
        if !model.jsTrimmed.isEmpty { parts.append(model.jsTrimmed) }
        if let c = capacity { parts.append(Format.capacity(c)) }
        if let v = voltage { parts.append(Format.voltage(v)) }
        return parts.joined(separator: " · ")
    }

    var firstUseSummary: String {
        switch firstUseMode {
        case "date": return firstUsed.map { Sydney.longDay($0) } ?? "—"
        case "unknown": return "Unknown"
        default: return "Registration day"
        }
    }
}

/// The form sections for `RegistrationDetails`, shared by single registration and batch intake.
struct RegistrationDetailsSections: View {
    @Environment(AppModel.self) private var app
    @Binding var details: RegistrationDetails
    @State private var showModels = false
    @State private var creatingModel = false
    @State private var formKey = UUID()

    private var tint: Color { Tone.register }

    var body: some View {
        Section {
            Button { showModels = true } label: {
                HStack(spacing: 12) {
                    Image(systemName: "square.stack.3d.down.right").font(.title3).foregroundStyle(tint)
                        .frame(width: 34, height: 34).background(tint.opacity(0.12), in: .rect(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(details.chosenModel?.label ?? "Start from a model").font(.body.weight(.semibold)).foregroundStyle(.primary)
                        Text(details.chosenModel.map { "\($0.originTitle) · fills the details below" } ?? "Optional · saved, inventory or reference models")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let chosen = details.chosenModel {
                ForEach(chosen.warnings ?? [], id: \.self) { warning in
                    Label(warning, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
                }
                if !details.conflicts.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Kept what you entered for \(details.conflicts.map { $0 == "capacityMah" ? "capacity" : $0 }.joined(separator: ", ")).")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Use the model's values instead") {
                            details.applyConflicts()
                            formKey = UUID()
                        }
                        .font(.footnote.weight(.semibold))
                    }
                }
                Button("Don't use a model", role: .destructive) { details.clearModel() }
                    .font(.footnote)
            } else if !details.model.jsTrimmed.isEmpty {
                // A model that isn't saved yet: one tap keeps it for the next batch.
                Button { creatingModel = true } label: {
                    Label("Save “\(details.model.jsTrimmed)” as a reusable model", systemImage: "plus.square.on.square")
                        .font(.footnote.weight(.semibold))
                }
                .disabled(app.writes.hasPending)
            }
        }
        .sheet(isPresented: $showModels) {
            ModelPickerView(prefill: details) { choice in
                details.apply(choice)
                formKey = UUID()
            }
            .presentationDetents([.large])
        }
        .sheet(isPresented: $creatingModel) {
            NewModelSheet(prefill: details) { saved in
                details.apply(saved)
                formKey = UUID()
            }
        }

        Section("Battery") {
            LabeledField(title: "Name") { TextField("Battery", text: $details.name).multilineTextAlignment(.trailing) }
            LabeledField(title: "Chemistry") { TextField("e.g. LiPo", text: $details.chemistry).multilineTextAlignment(.trailing) }
            LabeledField(title: "Model") { TextField("e.g. 3S 2200", text: $details.model).multilineTextAlignment(.trailing) }
            LabeledField(title: "Capacity") { UnitField(unit: "mAh", value: $details.capacity) }
            LabeledField(title: "Voltage") { UnitField(unit: "V", value: $details.voltage) }
        }
        .id(formKey)

        Section("Responsible & storage") {
            Picker("Responsible", selection: $details.ownerId) {
                if details.ownerId.isEmpty { Text("Choose…").tag("") }
                ForEach(app.inventory.staffOwners) { person in
                    Text(person.accountId == app.user?.id ? "\(person.name) (me)" : person.name).tag(person.id)
                }
            }
            LabeledContent("Building", value: "J18 · Willis Annexe")
            Picker("Home room", selection: $details.roomId) {
                Text("Not specified").tag(String?.none)
                ForEach(app.inventory.registrationRooms) { room in
                    Text(room.label + ((room.isPlaceholder ?? false) ? " · placeholder" : "")).tag(Optional(room.id))
                }
            }
        }

        Section {
            OptionalDayPicker(title: "Manufactured", ymd: $details.manufactured, latest: Date())
            Picker("First use", selection: $details.firstUseMode) {
                Text("From registration day").tag("at_registration")
                Text("Known date").tag("date")
                Text("Unknown").tag("unknown")
            }
            if details.firstUseMode == "date" {
                OptionalDayPicker(title: "First used on", ymd: $details.firstUsed, latest: Date())
            }
        } header: {
            Text("Age")
        } footer: {
            Text("Leave the manufacture date blank if it isn't known. Time in service counts from the first-use date.")
        }
    }
}

/// Edits the shared details of a batch intake on the scan station.
struct BatchDetailsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var draft = RegistrationDetails()
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("These apply to every battery you scan in this batch. Each one still gets its own permanent ID.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                RegistrationDetailsSections(details: $draft)
                let problems = draft.problems(in: app.inventory)
                if !problems.isEmpty {
                    Section { ForEach(problems, id: \.self) { Text($0).font(.footnote).foregroundStyle(Tone.failure) } }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Batch details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        app.scan.updateIntakeDetails(draft)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                draft = app.scan.intakeDetails
            }
        }
    }
}

// MARK: - Save a new reusable model

/// Records a model that isn't in the catalogue yet (brand, model, variant and its specifications) so
/// this inventory can reuse it as a template for later batches. It doesn't register any battery.
/// Sent through the write centre: exact bytes saved first, receipt verified field by field, same-byte retry.
struct NewModelSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var prefill: RegistrationDetails
    var onSaved: (BatteryModelChoice) -> Void

    @State private var brand = ""
    @State private var model = ""
    @State private var variant = ""
    @State private var name = ""
    @State private var chemistry = ""
    @State private var capacity: Double?
    @State private var voltage: Double?
    @State private var notes = ""
    @State private var loaded = false
    @State private var requestId: String?
    @State private var working = false
    @State private var message: String?
    @State private var isError = false

    private var tint: Color { Tone.register }
    private var isLocked: Bool { working || (requestId.map { app.writes.entry(id: $0) != nil } ?? false) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Save a model once, then choose it for every battery of that kind. Saving the model doesn't register a battery.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Model") {
                    LabeledField(title: "Brand") { TextField("e.g. Tattu", text: $brand).multilineTextAlignment(.trailing) }
                    LabeledField(title: "Model") { TextField("Required, e.g. R-Line 1550", text: $model).multilineTextAlignment(.trailing) }
                    LabeledField(title: "Variant") { TextField("e.g. 4S XT60", text: $variant).multilineTextAlignment(.trailing) }
                }
                .disabled(isLocked)
                Section {
                    LabeledField(title: "Battery name") { TextField("e.g. Drone pack", text: $name).multilineTextAlignment(.trailing) }
                    LabeledField(title: "Chemistry") { TextField("e.g. LiPo", text: $chemistry).multilineTextAlignment(.trailing) }
                    LabeledField(title: "Capacity") { UnitField(unit: "mAh", value: $capacity) }
                    LabeledField(title: "Voltage") { UnitField(unit: "V", value: $voltage) }
                } header: {
                    Text("Fills in for each battery")
                } footer: {
                    Text("Use the label's nominal voltage, not the charge limit.")
                }
                .disabled(isLocked)
                Section("Notes (optional)") {
                    TextField("e.g. Where the label is, how to tell variants apart", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                        .disabled(isLocked)
                }
                Section {
                    WriteStateView(requestId: requestId, message: message, isError: isError)
                    if let id = requestId, let entry = app.writes.entry(id: id) {
                        ActionButton(title: app.writes.sending.contains(id) ? "Checking…" : "Try again", tint: tint,
                                     busy: app.writes.sending.contains(id)) {
                            Task { handle(await app.writes.retry(entry)) }
                        }
                    } else {
                        ActionButton(title: working ? "Saving…" : "Save model", tint: tint, busy: working) {
                            Task { await save() }
                        }
                        .disabled(!problems.isEmpty)
                    }
                } footer: {
                    if !problems.isEmpty { Text(problems.joined(separator: " ")) }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("New model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(isLocked) }
            }
            .interactiveDismissDisabled(isLocked)
            .onAppear {
                guard !loaded else { return }
                loaded = true
                // Start from what's already typed for the batch, so a new model is one tap away.
                model = prefill.model
                // The default name "Battery" says nothing; the model is a better starting point.
                name = prefill.name.jsTrimmed == "Battery" && !prefill.model.jsTrimmed.isEmpty ? prefill.model : prefill.name
                chemistry = prefill.chemistry
                capacity = prefill.capacity
                voltage = prefill.voltage
            }
        }
    }

    private var problems: [String] {
        var list: [String] = []
        let m = model.jsTrimmed, n = name.jsTrimmed
        if m.isEmpty { list.append("Enter the model.") } else if m.serverLength > 120 { list.append("The model is limited to 120 characters.") }
        if n.serverLength < 2 || n.serverLength > 120 { list.append("The battery name needs 2–120 characters.") }
        if brand.jsTrimmed.serverLength > 80 { list.append("The brand is limited to 80 characters.") }
        if variant.jsTrimmed.serverLength > 120 { list.append("The variant is limited to 120 characters.") }
        if chemistry.jsTrimmed.serverLength > 40 { list.append("Chemistry is limited to 40 characters.") }
        if notes.jsTrimmed.serverLength > 1000 { list.append("Notes are limited to 1000 characters.") }
        if let c = capacity, !(c > 0 && c <= 1_000_000) { list.append("Capacity must be above 0 mAh.") }
        if let v = voltage, !(v > 0 && v <= 1000) { list.append("Voltage must be between 0 and 1000 V.") }
        return list
    }

    private func save() async {
        guard problems.isEmpty, !working else { return }
        working = true
        defer { working = false }
        message = nil
        let id = RequestID.make()
        let payload = NewModelPayload(id: id, brand: brand.jsTrimmed, model: model.jsTrimmed, variant: variant.jsTrimmed,
                                      name: name.jsTrimmed, chemistry: chemistry.jsTrimmed, capacityMah: capacity,
                                      voltage: voltage, notes: notes.jsTrimmed)
        guard let body = WriteCenter.modelBody(app.dataset, payload: payload) else {
            message = "Couldn't prepare the request."; isError = true
            return
        }
        requestId = id
        handle(await app.writes.submit(action: "battery_model", kind: "battery_model", title: "Saving model \(payload.model)",
                                       batteryIds: [], requestId: id, body: body, endpoint: "/api/battery-models"))
    }

    private func handle(_ outcome: WriteCenter.Outcome) {
        switch outcome {
        case .confirmed(let confirmation):
            requestId = nil
            if let saved = confirmation.model {
                onSaved(saved)
                dismiss()
            }
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
