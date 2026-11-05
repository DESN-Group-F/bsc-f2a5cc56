import SwiftUI

/// A request to open registration, optionally carrying a tag the scan station just read.
struct RegistrationRequest: Identifiable {
    let id = UUID()
    var tagRead: TagRead? = nil
}

/// New battery registration: details → review → confirmed by the server.
/// Untagged or typed-tag registration uses `operator_register`. Where the server allows native NFC
/// (`AppModel.allowsNFC`), a physically read tag is registered through `intake` with its full NFC evidence;
/// a read is never relabelled as typed.
/// Batches of tagged batteries are registered from the Scan station's Register mode.
struct RegisterBatteryView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let request: RegistrationRequest
    /// Preview mode only: open on the review step with a model applied.
    var previewReview = false
    /// Preview mode only: open the form with this storage building chosen.
    var previewBuilding: String? = nil
    /// Preview mode only: a model typed before opening the model picker (two rows in its section).
    var previewTypedModel: String? = nil

    private enum Step: Equatable { case form, review, done }

    @State private var doneHop = 0
    @State private var step: Step = .form
    @State private var details = RegistrationDetails()
    @State private var scanned: TagRead?
    @State private var typedTag = ""
    @State private var requestId: String?
    @State private var working = false
    @State private var message: String?
    @State private var messageIsError = false
    @State private var confirmation: WriteConfirmation?
    @State private var reader = NFCReader()
    @State private var reading = false
    @State private var prepared = false

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
            RegistrationDetailsSections(details: $details)

            Section {
                tagRow
            } header: {
                Text("Tag")
            } footer: {
                Text(app.allowsNFC(.intake)
                     ? "Scan the tag stuck on the battery, or leave it untagged. For several new batteries, use Register on the Scan tab."
                     : "Tag scanning isn't turned on for this inventory yet. Type a tag ID only if it's printed on the tag, or leave it untagged.")
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
            if app.allowsNFC(.intake) && NFCReader.isAvailable {
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
                    ReviewRow(title: "Name", value: details.name.jsTrimmed)
                    ReviewRow(title: "Model", value: details.model.jsTrimmed.isEmpty ? "Not recorded" : details.model.jsTrimmed)
                    ReviewRow(title: "Chemistry", value: details.chemistry.jsTrimmed.isEmpty ? "Not recorded" : details.chemistry.jsTrimmed)
                    ReviewRow(title: "Capacity", value: details.capacity.map { Format.capacity($0) } ?? "Not recorded")
                    ReviewRow(title: "Voltage", value: details.voltage.map { Format.voltage($0) } ?? "Not recorded")
                    ReviewRow(title: "Tag", value: tagSummary)
                    ReviewRow(title: "Responsible", value: details.owner(in: app.inventory)?.name ?? "—")
                    ReviewRow(title: "Home", value: details.storageLine(in: app.inventory))
                    ReviewRow(title: "Manufactured", value: details.manufactured.map { Sydney.longDay($0) } ?? "Not recorded")
                    ReviewRow(title: "First use", value: details.firstUseSummary, last: true)
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
            InkView(tint: Tone.success, mood: .happy, reaction: doneHop, shadow: false)
                .frame(width: 120, height: 120)
                .task { doneHop += 1 }
                .padding(.top, 30)
            VStack(spacing: 6) {
                Text(confirmation?.title ?? "Registered").font(.title2.weight(.bold))
                Text("\(details.name.jsTrimmed) · \(app.dataset.title)").font(.subheadline).foregroundStyle(.secondary)
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

    private var tagValue: String? {
        if let scanned { return scanned.tagId }
        let typed = typedTag.jsTrimmed
        return typed.isEmpty ? nil : typed
    }

    private var tagSummary: String {
        if let scanned { return "Scanned · \(scanned.tagId.replacingOccurrences(of: "nfc:uid:", with: ""))" }
        let typed = typedTag.jsTrimmed
        return typed.isEmpty ? "Untagged" : "Typed · \(typed)"
    }

    private var problems: [String] {
        var list = details.problems(in: app.inventory)
        if let tag = tagValue {
            if tag.serverLength > 128 { list.append("Tag ID is limited to 128 characters.") }
            if let existing = app.inventory.battery(tagId: tag) { list.append("That tag is already registered to \(existing.id).") }
        }
        if app.inventory.snapshot?.capabilities?.operatorRegistration != 1 && scanned == nil {
            list.append("This server hasn't confirmed registration from the app.")
        }
        return list
    }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        details = app.scan.intakeDetails
        if details.ownerId.isEmpty, let me = app.inventory.staffOwners.first(where: { $0.accountId == app.user?.id }) { details.ownerId = me.id }
        if scanned == nil, let read = request.tagRead, app.allowsNFC(.intake) { scanned = read }
        if let building = previewBuilding, app.preview != nil { details.chooseBuilding(building) }
        if let model = previewTypedModel, app.preview != nil { details.model = model }
        if previewReview, app.preview != nil, let model = PreviewFixtures.models.first {
            details.apply(model)
            details.manufactured = "2025-06-02"
            details.chooseBuilding("E10")
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

    private func submit() async {
        guard !working, problems.isEmpty, app.user != nil, let owner = details.owner(in: app.inventory),
              let ownerAccount = owner.accountId, let building = details.building(in: app.inventory),
              let common = details.common(in: app.inventory) else { return }
        working = true
        defer { working = false }
        message = nil
        let newRequest = RequestID.make()
        let session = RequestID.make()
        let body: Data?
        let action: String
        if let scanned, app.allowsNFC(.intake) {
            action = "intake"
            let evidence = scanned.evidence(adoptedAt: Sydney.timestamp())
            body = WriteCenter.inventoryBody(app.dataset, action: action, payload: NFCIntakePayload(
                requestId: newRequest, sessionId: session, scannedAt: scanned.result.observedAt, common: common,
                firstUseMode: details.firstUseMode, source: "native_nfc", nfcEvidence: evidence, tagId: scanned.tagId))
        } else {
            action = "operator_register"
            let bindings = DirectoryBindings(ownerVersion: owner.version, ownerAccountId: ownerAccount,
                                             buildingVersion: building.version, roomVersion: details.room(in: app.inventory)?.version)
            body = WriteCenter.inventoryBody(app.dataset, action: action, payload: OperatorRegistrationPayload(
                requestId: newRequest, sessionId: session, source: "operator-entered-registration",
                tagId: scanned == nil ? tagValue : nil, directoryBindings: bindings, common: common, firstUseMode: details.firstUseMode))
        }
        guard let body else { message = "Couldn't prepare the request."; messageIsError = true; return }
        requestId = newRequest
        let outcome = await app.writes.submit(action: action, kind: "register", title: "Registering \(details.name.jsTrimmed)",
                                              batteryIds: [], requestId: newRequest, body: body)
        await handle(outcome)
    }

    private func handle(_ outcome: WriteCenter.Outcome) async {
        switch outcome {
        case .confirmed(let result):
            confirmation = result
            message = nil
            step = .done
            app.scan.rememberDetails(details)
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
        if app.allowsNFC(.intake) && NFCReader.isAvailable { scanTag() }
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
            .frame(maxWidth: .infinity, minHeight: 40)
        }
        .primaryButton(tint)
        .disabled(busy)
    }
}

// MARK: - Model picker

struct ModelPickerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// What's already typed, used to start a new model.
    var prefill = RegistrationDetails()
    var onPick: (BatteryModelChoice) -> Void
    @State private var creating = false
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
                if !loading {
                    Section {
                        Button { creating = true } label: {
                            Label(search.isEmpty ? "New model…" : "New model “\(search.trimmingCharacters(in: .whitespaces))”…",
                                  systemImage: "plus.circle.fill")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Tone.register)
                        }
                        .disabled(app.writes.hasPending)
                    } footer: {
                        Text("Not listed? Save its details once and reuse them for every battery of that model.")
                    }
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
            .sheet(isPresented: $creating) {
                NewModelSheet(prefill: newModelPrefill) { saved in
                    onPick(saved)
                    dismiss()
                }
            }
        }
    }

    /// A search that found nothing becomes the new model's name.
    private var newModelPrefill: RegistrationDetails {
        var details = prefill
        let typed = search.trimmingCharacters(in: .whitespaces)
        if !typed.isEmpty { details.model = typed }
        return details
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
