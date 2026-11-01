import SwiftUI

/// A request to open registration, optionally carrying a tag the scan station just read (Demo only).
struct RegistrationRequest: Identifiable {
    let id = UUID()
    var tagRead: TagRead? = nil
}

/// New battery registration: details → review → confirmed by the server.
/// Working inventory uses `operator_register` (untagged or a typed tag). In Demo a physically read tag
/// is registered through `intake` with its full NFC evidence; a read is never relabelled as typed.
struct RegisterBatteryView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let request: RegistrationRequest
    /// Preview mode only: open on the review step with a model applied.
    var previewReview = false

    private enum Step: Equatable { case form, review, done }

    @State private var step: Step = .form
    @State private var name = "Battery"
    @State private var chemistry = ""
    @State private var modelText = ""
    @State private var capacity: Double?
    @State private var voltage: Double?
    @State private var ownerId = ""
    @State private var roomId: String?
    @State private var manufactured: String?
    @State private var firstUseMode = "at_registration"
    @State private var firstUsed: String?
    @State private var scanned: TagRead?
    @State private var typedTag = ""
    @State private var chosenModel: BatteryModelChoice?
    @State private var appliedFields: [String] = []
    @State private var conflicts: [String] = []
    @State private var showModels = false
    @State private var requestId: String?
    @State private var working = false
    @State private var message: String?
    @State private var messageIsError = false
    @State private var confirmation: WriteConfirmation?
    @State private var reader = NFCReader()
    @State private var reading = false
    @State private var formKey = UUID()

    private var tint: Color { Tone.register }

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .form: form
                case .review: review
                case .done: done
                }
            }
            .navigationTitle(step == .done ? "Registered" : (step == .review ? "Check details" : "New battery"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .interactiveDismissDisabled(isLocked)
            .sheet(isPresented: $showModels) {
                ModelPickerView { choice in apply(choice) }
                    .presentationDetents([.large])
            }
            .onAppear(perform: prepare)
            .onDisappear { reader.stop() }
            .animation(.snappy, value: step)
        }
    }

    private var isLocked: Bool { working || (requestId.map { app.writes.entry(id: $0) != nil } ?? false) }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            if step == .form {
                Button("Cancel") { dismiss() }
            } else if step == .review {
                Button("Back") { step = .form; message = nil }.disabled(isLocked)
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            if step == .form {
                Button("Review") { toReview() }.fontWeight(.semibold).disabled(!problems.isEmpty)
            } else if step == .done {
                Button("Done") { dismiss() }.fontWeight(.semibold)
            }
        }
    }

    // MARK: Form

    private var form: some View {
        Form {
            Section {
                Button { showModels = true } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "square.stack.3d.down.right").font(.title3).foregroundStyle(tint)
                            .frame(width: 34, height: 34).background(tint.opacity(0.12), in: .rect(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(chosenModel?.label ?? "Start from a model").font(.body.weight(.semibold)).foregroundStyle(.primary)
                            Text(chosenModel.map { "\($0.originTitle) · fills the details below" } ?? "Optional · saved, inventory or reference models")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
                if let chosenModel {
                    ForEach(chosenModel.warnings ?? [], id: \.self) { warning in
                        Label(warning, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
                    }
                    if !conflicts.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Kept what you entered for \(conflicts.map(fieldTitle).joined(separator: ", ")).")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Use the model's values instead") { applyConflicts() }.font(.footnote.weight(.semibold))
                        }
                    }
                    Button("Don't use a model", role: .destructive) {
                        self.chosenModel = nil
                        appliedFields = []
                        conflicts = []
                    }
                    .font(.footnote)
                }
            }

            Section("Battery") {
                LabeledField(title: "Name") { TextField("Battery", text: $name).multilineTextAlignment(.trailing) }
                LabeledField(title: "Chemistry") { TextField("e.g. LiPo", text: $chemistry).multilineTextAlignment(.trailing) }
                LabeledField(title: "Model") { TextField("e.g. 3S 2200", text: $modelText).multilineTextAlignment(.trailing) }
                LabeledField(title: "Capacity") { UnitField(unit: "mAh", value: $capacity) }
                LabeledField(title: "Voltage") { UnitField(unit: "V", value: $voltage) }
            }
            .id(formKey)

            Section {
                tagRow
            } header: {
                Text("Tag")
            } footer: {
                Text(app.dataset.allowsNFCWrites
                     ? "Scan the tag stuck on the battery, or leave it untagged."
                     : "Tag scanning is Demo-only for now. Type a tag ID only if it's printed on the tag, or leave it untagged.")
            }

            Section("Responsible & storage") {
                Picker("Responsible", selection: $ownerId) {
                    if ownerId.isEmpty { Text("Choose…").tag("") }
                    ForEach(app.inventory.staffOwners) { person in
                        Text(person.accountId == app.user?.id ? "\(person.name) (me)" : person.name).tag(person.id)
                    }
                }
                LabeledContent("Building", value: "J18 · Willis Annexe")
                Picker("Home room", selection: $roomId) {
                    Text("Not specified").tag(String?.none)
                    ForEach(app.inventory.registrationRooms) { room in
                        Text(room.label + ((room.isPlaceholder ?? false) ? " · placeholder" : "")).tag(Optional(room.id))
                    }
                }
            }

            Section {
                OptionalDayPicker(title: "Manufactured", ymd: $manufactured, latest: Date())
                Picker("First use", selection: $firstUseMode) {
                    Text("From registration day").tag("at_registration")
                    Text("Known date").tag("date")
                    Text("Unknown").tag("unknown")
                }
                if firstUseMode == "date" {
                    OptionalDayPicker(title: "First used on", ymd: $firstUsed, latest: Date())
                }
            } header: {
                Text("Age")
            } footer: {
                Text("Leave the manufacture date blank if it isn't known. Time in service counts from the first-use date.")
            }

            if !problems.isEmpty {
                Section { ForEach(problems, id: \.self) { Text($0).font(.footnote).foregroundStyle(Tone.failure) } }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private var tagRow: some View {
        if let scanned {
            HStack {
                Label(scanned.tagId.replacingOccurrences(of: "nfc:uid:", with: ""), systemImage: "wave.3.right")
                    .font(.mono)
                Spacer()
                Button("Remove", role: .destructive) { self.scanned = nil }.buttonStyle(.borderless)
            }
        } else {
            if app.dataset.allowsNFCWrites && NFCReader.isAvailable {
                Button {
                    scanTag()
                } label: {
                    Label(reading ? "Hold near the tag…" : "Scan tag", systemImage: "wave.3.right")
                        .fontWeight(.semibold)
                }
                .disabled(reading)
            }
            TextField("Tag ID (optional)", text: $typedTag)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.mono)
        }
    }

    // MARK: Review

    private var review: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 0) {
                    ReviewRow(title: "Permanent ID", value: "Given by the server after you confirm")
                    ReviewRow(title: "Name", value: trimmed(name))
                    ReviewRow(title: "Model", value: trimmed(modelText).isEmpty ? "Not recorded" : trimmed(modelText))
                    ReviewRow(title: "Chemistry", value: trimmed(chemistry).isEmpty ? "Not recorded" : trimmed(chemistry))
                    ReviewRow(title: "Capacity", value: capacity.map { Format.capacity($0) } ?? "Not recorded")
                    ReviewRow(title: "Voltage", value: voltage.map { Format.voltage($0) } ?? "Not recorded")
                    ReviewRow(title: "Tag", value: tagSummary)
                    ReviewRow(title: "Responsible", value: owner?.name ?? "—")
                    ReviewRow(title: "Home", value: "J18 · " + (room.map { $0.name + (($0.isPlaceholder ?? false) ? " (placeholder)" : "") } ?? "Room not specified"))
                    ReviewRow(title: "Manufactured", value: manufactured.map { Sydney.longDay($0) } ?? "Not recorded")
                    ReviewRow(title: "First use", value: firstUseSummary, last: true)
                }
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))

                Text("Registers in \(app.dataset.title). It doesn't check the battery out or record where it is now.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)

                WriteStateView(requestId: requestId, message: message, isError: messageIsError)

                if let id = requestId, let entry = app.writes.entry(id: id) {
                    ActionButton(title: app.writes.sending.contains(id) ? "Checking…" : "Try again", tint: tint, busy: app.writes.sending.contains(id)) {
                        Task { await handle(await app.writes.retry(entry)) }
                    }
                } else {
                    ActionButton(title: working ? "Registering…" : "Register battery", tint: tint, busy: working) {
                        Task { await submit() }
                    }
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
    }

    // MARK: Done

    private var done: some View {
        VStack(spacing: 18) {
            InkView(tint: Tone.success, mood: .happy, reaction: 1, shadow: false)
                .frame(width: 120, height: 120)
                .padding(.top, 30)
            VStack(spacing: 6) {
                Text(confirmation?.title ?? "Registered").font(.title2.weight(.bold))
                Text("\(trimmed(name)) · \(app.dataset.title)").font(.subheadline).foregroundStyle(.secondary)
            }
            VStack(spacing: 8) {
                if let id = confirmation?.batteryId {
                    ActionButton(title: "View battery", tint: tint) {
                        app.pendingDetailId = id
                        app.tab = .inventory
                        dismiss()
                    }
                }
                Button {
                    registerAnother()
                } label: {
                    Text("Register another with these details").font(.body.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    // MARK: Logic

    private var owner: Person? { app.inventory.staffOwners.first { $0.id == ownerId } }
    private var room: Room? { roomId.flatMap { id in app.inventory.registrationRooms.first { $0.id == id } } }
    private var building: Building? { app.inventory.snapshot?.buildings?.first { $0.id == "J18" } }

    private var tagValue: String? {
        if let scanned { return scanned.tagId }
        let typed = trimmed(typedTag)
        return typed.isEmpty ? nil : typed
    }

    private var tagSummary: String {
        if let scanned { return "Scanned · \(scanned.tagId.replacingOccurrences(of: "nfc:uid:", with: ""))" }
        let typed = trimmed(typedTag)
        return typed.isEmpty ? "Untagged" : "Typed · \(typed)"
    }

    private var firstUseSummary: String {
        switch firstUseMode {
        case "date": return firstUsed.map { Sydney.longDay($0) } ?? "—"
        case "unknown": return "Unknown"
        default: return "Registration day"
        }
    }

    private var problems: [String] {
        var list: [String] = []
        let n = trimmed(name)
        if n.count < 2 || n.count > 120 { list.append("Name needs 2–120 characters.") }
        if trimmed(chemistry).count > 40 { list.append("Chemistry is limited to 40 characters.") }
        if trimmed(modelText).count > 120 { list.append("Model is limited to 120 characters.") }
        if let c = capacity, !(c > 0 && c <= 1_000_000) { list.append("Capacity must be above 0 mAh.") }
        if let v = voltage, !(v > 0 && v <= 1000) { list.append("Voltage must be between 0 and 1000 V.") }
        if owner == nil { list.append("Choose who is responsible.") }
        if building == nil { list.append("J18 isn't available yet. Pull to refresh Inventory and try again.") }
        if let tag = tagValue {
            if tag.count > 128 { list.append("Tag ID is limited to 128 characters.") }
            if let existing = app.inventory.battery(tagId: tag) { list.append("That tag is already registered to \(existing.id).") }
        }
        if firstUseMode == "date" && firstUsed == nil { list.append("Pick the first-use date, or choose another first-use option.") }
        if let m = manufactured, let f = firstUseMode == "date" ? firstUsed : nil, f < m {
            list.append("First use can't be before manufacture.")
        }
        let today = Sydney.ymd()
        if let m = manufactured, m > today { list.append("The manufacture date can't be in the future.") }
        if firstUseMode == "date", let f = firstUsed, f > today { list.append("The first-use date can't be in the future.") }
        if app.inventory.snapshot?.capabilities?.operatorRegistration != 1 && scanned == nil {
            list.append("This server hasn't confirmed registration from the app.")
        }
        return list
    }

    private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func prepare() {
        if ownerId.isEmpty, let me = app.inventory.staffOwners.first(where: { $0.accountId == app.user?.id }) { ownerId = me.id }
        if scanned == nil, let read = request.tagRead, app.dataset.allowsNFCWrites { scanned = read }
        if previewReview, app.preview != nil, step == .form, let model = PreviewFixtures.models.first {
            apply(model)
            manufactured = "2025-06-02"
            step = .review
        }
    }

    private func toReview() {
        guard problems.isEmpty else { return }
        message = nil
        step = .review
    }

    private func scanTag() {
        guard !reading else { return }
        reading = true
        reader.prompt = "Hold the top of your iPhone near the new battery's tag."
        reader.start { event in
            Task { @MainActor in
                switch event {
                case .read(let read):
                    if let existing = app.inventory.battery(tagId: read.tagId) {
                        reader.stop(message: "Already registered to \(existing.id)")
                        message = "That tag is already registered to \(existing.id)."
                        messageIsError = true
                        Haptics.refused()
                    } else {
                        scanned = read
                        typedTag = ""
                        reader.stop(message: "Tag read")
                        Haptics.accepted()
                    }
                case .failed(let text):
                    message = text
                    messageIsError = true
                case .ended:
                    reading = false
                }
            }
        }
    }

    private func apply(_ choice: BatteryModelChoice) {
        chosenModel = choice
        var applied: [String] = []
        var conflicting: [String] = []
        func take(_ field: String, model value: String, current: inout String, isDefault: Bool) {
            guard !value.isEmpty else { return }
            if trimmed(current).isEmpty || isDefault || trimmed(current) == value { current = value; applied.append(field) }
            else { conflicting.append(field) }
        }
        func takeNumber(_ field: String, model value: Double?, current: inout Double?) {
            guard let value else { return }
            if current == nil || current == value { current = value; applied.append(field) } else { conflicting.append(field) }
        }
        take("name", model: choice.name, current: &name, isDefault: trimmed(name) == "Battery")
        take("model", model: choice.model, current: &modelText, isDefault: false)
        take("chemistry", model: choice.chemistry, current: &chemistry, isDefault: false)
        takeNumber("capacityMah", model: choice.capacityMah, current: &capacity)
        takeNumber("voltage", model: choice.voltage, current: &voltage)
        appliedFields = applied
        conflicts = conflicting
        formKey = UUID()
    }

    private func applyConflicts() {
        guard let choice = chosenModel else { return }
        for field in conflicts {
            switch field {
            case "name": name = choice.name
            case "model": modelText = choice.model
            case "chemistry": chemistry = choice.chemistry
            case "capacityMah": capacity = choice.capacityMah
            case "voltage": voltage = choice.voltage
            default: break
            }
            if !appliedFields.contains(field) { appliedFields.append(field) }
        }
        conflicts = []
        formKey = UUID()
    }

    private func fieldTitle(_ field: String) -> String {
        switch field {
        case "capacityMah": return "capacity"
        default: return field
        }
    }

    private func submit() async {
        guard !working, problems.isEmpty, app.user != nil, let owner, let ownerAccount = owner.accountId, let building else { return }
        working = true
        defer { working = false }
        message = nil
        let newRequest = RequestID.make()
        let session = RequestID.make()
        let selection = chosenModel.map {
            ModelSelectionRef(origin: $0.origin, id: $0.id, contentHash: $0.contentHash, confirmed: true, appliedFields: appliedFields)
        }
        let common = RegistrationCommon(name: trimmed(name), chemistry: trimmed(chemistry), model: trimmed(modelText),
                                        capacityMah: capacity, voltage: voltage, ownerId: owner.id, homeBuildingId: "J18",
                                        homeRoomId: room?.id, manufacturedOn: manufactured,
                                        firstUsedOn: firstUseMode == "date" ? firstUsed : nil, modelSelection: selection)
        let body: Data?
        let action: String
        if let scanned, app.dataset.allowsNFCWrites {
            action = "intake"
            let evidence = scanned.evidence(adoptedAt: Sydney.timestamp())
            body = WriteCenter.inventoryBody(app.dataset, action: action, payload: NFCIntakePayload(
                requestId: newRequest, sessionId: session, scannedAt: scanned.result.observedAt, common: common,
                firstUseMode: firstUseMode, source: "native_nfc", nfcEvidence: evidence, tagId: scanned.tagId))
        } else {
            action = "operator_register"
            let bindings = DirectoryBindings(ownerVersion: owner.version, ownerAccountId: ownerAccount,
                                             buildingVersion: building.version, roomVersion: room?.version)
            body = WriteCenter.inventoryBody(app.dataset, action: action, payload: OperatorRegistrationPayload(
                requestId: newRequest, sessionId: session, source: "operator-entered-registration",
                tagId: scanned == nil ? tagValue : nil, directoryBindings: bindings, common: common, firstUseMode: firstUseMode))
        }
        guard let body else { message = "Couldn't prepare the request."; messageIsError = true; return }
        requestId = newRequest
        let outcome = await app.writes.submit(action: action, kind: "register", title: "Registering \(trimmed(name))",
                                              batteryIds: [], requestId: newRequest, body: body)
        await handle(outcome)
    }

    private func handle(_ outcome: WriteCenter.Outcome) async {
        switch outcome {
        case .confirmed(let result):
            confirmation = result
            message = nil
            step = .done
        case .rejected(let text), .notSent(let text):
            requestId = nil
            message = text
            messageIsError = true
        case .uncertain(let text):
            message = text
            messageIsError = true
        }
    }

    private func registerAnother() {
        scanned = nil
        typedTag = ""
        requestId = nil
        confirmation = nil
        message = nil
        step = .form
        if app.dataset.allowsNFCWrites && NFCReader.isAvailable { scanTag() }
    }
}

// MARK: - Pieces

struct LabeledField<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack {
            Text(title)
            Spacer(minLength: 16)
            content
        }
    }
}

/// Decimal entry with a trailing unit; blank means not recorded.
struct UnitField: View {
    let unit: String
    @Binding var value: Double?
    @State private var text = ""

    var body: some View {
        HStack(spacing: 4) {
            TextField("Not recorded", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
            Text(unit).foregroundStyle(.secondary)
        }
        .onAppear { text = value.map { Format.number($0) } ?? "" }
        .onChange(of: text) { _, new in
            let cleaned = new.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
            value = cleaned.isEmpty ? nil : Double(cleaned)
        }
    }
}

struct ReviewRow: View {
    let title: String
    let value: String
    var last = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).foregroundStyle(.secondary)
                Spacer(minLength: 16)
                Text(value).fontWeight(.semibold).multilineTextAlignment(.trailing)
            }
            .font(.subheadline)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            if !last { Divider().padding(.leading, 16) }
        }
    }
}

/// Large tinted glass action used at the bottom of write screens.
struct ActionButton: View {
    let title: String
    let tint: Color
    var foreground: Color = .white
    var busy = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if busy { ProgressView().tint(foreground) }
                Text(title)
            }
            .font(.headline)
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(tint).interactive(), in: .capsule)
        .disabled(busy)
    }
}

// MARK: - Model picker

struct ModelPickerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var onPick: (BatteryModelChoice) -> Void
    @State private var models: [BatteryModelChoice] = []
    @State private var search = ""
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).foregroundStyle(.secondary)
                }
                ForEach(groups) { group in
                    Section(group.title) {
                        ForEach(group.items) { model in
                            Button {
                                onPick(model)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(model.label).font(.body.weight(.semibold)).foregroundStyle(.primary)
                                    Text(specs(model)).font(.footnote).foregroundStyle(.secondary)
                                    if let status = model.verificationStatus, model.origin == "reference" {
                                        Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                                            .font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if loading { ProgressView() }
                else if groups.isEmpty && error == nil { ContentUnavailableView.search(text: search) }
            }
            .searchable(text: $search, prompt: "Brand, model or chemistry")
            .navigationTitle("Choose a model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { await load() }
        }
    }

    private struct ModelGroup: Identifiable {
        let title: String
        let items: [BatteryModelChoice]
        var id: String { title }
    }

    private var groups: [ModelGroup] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let matching = models.filter { m in
            q.isEmpty || [m.label, m.brand ?? "", m.model, m.chemistry, m.name].joined(separator: " ").lowercased().contains(q)
        }
        return ["saved", "inventory", "reference"].compactMap { origin in
            let items = matching.filter { $0.origin == origin }
            guard !items.isEmpty else { return nil }
            let title = origin == "saved" ? "Saved models" : (origin == "inventory" ? "Already in inventory" : "Reference catalogue")
            return ModelGroup(title: title, items: items)
        }
    }

    private func specs(_ m: BatteryModelChoice) -> String {
        var parts: [String] = []
        if !m.chemistry.isEmpty { parts.append(m.chemistry) }
        if let c = m.capacityMah { parts.append(Format.capacity(c)) }
        if let v = m.voltage { parts.append(Format.voltage(v)) }
        return parts.isEmpty ? m.name : parts.joined(separator: " · ")
    }

    private func load() async {
        if app.preview != nil {
            models = PreviewFixtures.models
            loading = false
            return
        }
        do {
            models = try await app.service.models(app.dataset)
            error = nil
        } catch {
            self.error = (error as? APIFailure)?.message ?? "Couldn't load models."
            app.handle(error)
        }
        loading = false
    }
}
