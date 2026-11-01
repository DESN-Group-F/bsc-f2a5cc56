import SwiftUI

/// Horizontal strip of the user's private teaching groups at the top of Inventory.
struct GroupStrip: View {
    @Environment(AppModel.self) private var app
    var onOpen: (TeachingGroup) -> Void
    var onCreate: () -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(app.inventory.groups) { group in
                    Button { onOpen(group) } label: { GroupCard(group: group) }
                        .buttonStyle(.plain)
                }
                Button(action: onCreate) {
                    VStack(alignment: .leading, spacing: 6) {
                        Image(systemName: "plus").font(.title3.weight(.semibold))
                        Spacer(minLength: 0)
                        Text(app.inventory.groups.isEmpty ? "New teaching group" : "New group")
                            .font(.subheadline.weight(.semibold))
                        Text("Save a class set").font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(width: 128, height: 104, alignment: .leading)
                    .padding(12)
                    .background(Color(.secondarySystemGroupedBackground).opacity(0.6), in: .rect(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.secondary.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }
}

struct GroupCard: View {
    @Environment(AppModel.self) private var app
    let group: TeachingGroup

    var body: some View {
        let members = group.batteryIds.compactMap { app.inventory.battery(id: $0) }
        let out = members.filter(\.isInUse).count
        let inStore = members.filter(\.isInStore).count
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "person.3.fill").font(.subheadline).foregroundStyle(Tone.checkout)
            Spacer(minLength: 0)
            Text(group.name).font(.subheadline.weight(.bold)).lineLimit(2).multilineTextAlignment(.leading)
            HStack(spacing: 6) {
                Text("\(group.batteryIds.count)").fontWeight(.semibold)
                Text(out > 0 ? "· \(out) out" : "· \(inStore) in store")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(width: 128, height: 104, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 3, y: 1)
    }
}

/// One teaching group: its members, and check out / return of the whole set.
struct GroupDetailView: View {
    @Environment(AppModel.self) private var app
    let groupId: String
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var deleteMessage: String?
    @State private var deleting = false
    @State private var deleteRequestId: String?
    @Environment(\.dismiss) private var dismiss

    private var group: TeachingGroup? { app.inventory.groups.first { $0.id == groupId } }

    var body: some View {
        Group {
            if let group {
                let members = group.batteryIds.compactMap { app.inventory.battery(id: $0) }
                let inStore = members.filter(\.isInStore)
                let inUse = members.filter(\.isInUse)
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.name).font(.largeTitle.weight(.bold))
                            if let notes = group.notes, !notes.isEmpty {
                                Text(notes).font(.subheadline).foregroundStyle(.secondary)
                            }
                            Text("\(group.batteryIds.count) batteries · \(inStore.count) in store · \(inUse.count) in use")
                                .font(.footnote.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 2)
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 6, trailing: 4))

                        HStack(spacing: 8) {
                            GroupActionTile(title: "Check out", detail: "\(inStore.count) in store", tint: Tone.checkout, onTint: .white,
                                            enabled: !inStore.isEmpty) {
                                app.scan.begin(group: group, batteries: inStore, mode: .checkout)
                                app.tab = .scan
                            }
                            GroupActionTile(title: "Return", detail: "\(inUse.count) in use", tint: Tone.returning, onTint: Tone.returnInk,
                                            enabled: !inUse.isEmpty) {
                                app.scan.begin(group: group, batteries: inUse, mode: .return)
                                app.tab = .scan
                            }
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    } footer: {
                        Text("You'll review the list on Scan before anything is saved. Remove any battery that isn't going out.")
                    }

                    Section("Members") {
                        ForEach(members) { battery in
                            NavigationLink(value: InventoryRoute.battery(battery.id)) {
                                BatteryRow(battery: battery, isNew: false, myAccountId: app.user?.id)
                            }
                        }
                        let missing = group.batteryIds.count - members.count
                        if missing > 0 {
                            Text("\(missing) member\(missing == 1 ? "" : "s") no longer in this inventory.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }

                    if let deleteMessage {
                        Section { Text(deleteMessage).foregroundStyle(Tone.failure) }
                    }
                }
                .listStyle(.insetGrouped)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button { editing = true } label: { Label("Edit group", systemImage: "pencil") }
                            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete group", systemImage: "trash") }
                        } label: {
                            Image(systemName: "ellipsis")
                        }
                        .disabled(deleting)
                    }
                }
                .sheet(isPresented: $editing) {
                    GroupEditorSheet(group: group)
                }
                .confirmationDialog("Delete “\(group.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("Delete group", role: .destructive) { Task { await delete(group) } }
                } message: {
                    Text("Only the saved selection is removed. Batteries, loans and history stay as they are.")
                }
            } else {
                ContentUnavailableView("Group not found", systemImage: "person.3",
                                       description: Text("It may have been deleted or belongs to another inventory."))
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func delete(_ group: TeachingGroup) async {
        guard !deleting else { return }
        deleting = true
        defer { deleting = false }
        let newRequest = RequestID.make()
        let request = TeachingGroupRequest(action: "remove", requestId: newRequest, id: group.id, name: nil, notes: nil,
                                           batteryIds: nil, expectedVersion: group.version)
        guard let body = WriteCenter.groupBody(app.dataset, payload: request) else { return }
        deleteRequestId = newRequest
        let outcome = await app.writes.submit(action: "teaching_group", kind: "remove", title: "Deleting “\(group.name)”",
                                              batteryIds: [], requestId: newRequest, body: body, endpoint: "/api/teaching-groups")
        switch outcome {
        case .confirmed: dismiss()
        case .rejected(let text), .notSent(let text), .uncertain(let text): deleteMessage = text
        }
    }
}

private struct GroupActionTile: View {
    let title: String
    let detail: String
    let tint: Color
    let onTint: Color
    let enabled: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.caption).opacity(0.85)
            }
            .foregroundStyle(enabled ? onTint : Color.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(enabled ? tint : Color(.tertiarySystemFill), in: .rect(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

/// Create or edit a teaching group: name, notes and up to 100 members.
struct GroupEditorSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let group: TeachingGroup?
    var presetMembers: [String] = []
    var onSaved: ((TeachingGroup) -> Void)? = nil

    @State private var name = ""
    @State private var notes = ""
    @State private var members: [String] = []
    @State private var search = ""
    @State private var requestId: String?
    @State private var working = false
    @State private var message: String?
    @State private var isError = false
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Name, e.g. ENGG1000 Lab A", text: $name)
                    TextField("Notes (optional)", text: $notes, axis: .vertical).lineLimit(1...3)
                }
                Section {
                    WriteStateView(requestId: requestId, message: message, isError: isError)
                    if let id = requestId, let entry = app.writes.entry(id: id) {
                        Button("Try again") { Task { handle(await app.writes.retry(entry)) } }
                            .disabled(app.writes.sending.contains(id))
                    }
                }
                Section {
                    ForEach(candidates) { battery in
                        Button { toggle(battery.id) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: members.contains(battery.id) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(members.contains(battery.id) ? Tone.checkout : Color.secondary.opacity(0.5))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(battery.name).font(.body.weight(.semibold))
                                    Text("\(battery.id) · \(battery.specLine)").font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Members · \(members.count) of 100")
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $search, prompt: "Find batteries to add")
            .navigationTitle(group == nil ? "New group" : "Edit group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(isLocked) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Saving…" : "Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(!problems.isEmpty || isLocked)
                }
            }
            .interactiveDismissDisabled(isLocked)
            .sensoryFeedback(.selection, trigger: members)
            .onAppear {
                guard !loaded else { return }
                loaded = true
                name = group?.name ?? ""
                notes = group?.notes ?? ""
                members = group?.batteryIds ?? []
                for id in presetMembers where !members.contains(id) { members.append(id) }
            }
        }
    }

    private var isLocked: Bool { working || (requestId.map { app.writes.entry(id: $0) != nil } ?? false) }

    /// Selected members first, then other active batteries.
    private var candidates: [BatteryRecord] {
        let all = app.inventory.filtered(status: .all, search: search, onlyMine: false, onlyNew: false, accountId: app.user?.id)
        let chosen = members.compactMap { id in all.first { $0.id == id } }
        return chosen + all.filter { !members.contains($0.id) }
    }

    private var problems: [String] {
        var list: [String] = []
        let n = name.jsTrimmed
        if n.isEmpty || n.serverLength > 80 { list.append("Name needs 1–80 characters.") }
        if notes.jsTrimmed.serverLength > 500 { list.append("Notes are limited to 500 characters.") }
        if members.isEmpty { list.append("Add at least one battery.") }
        if members.count > 100 { list.append("A group holds at most 100 batteries.") }
        let duplicate = app.inventory.groups.contains { $0.id != group?.id && $0.name.lowercased() == n.lowercased() }
        if duplicate { list.append("You already have a group with this name.") }
        return list
    }

    private func toggle(_ id: String) {
        if let index = members.firstIndex(of: id) { members.remove(at: index) }
        else if members.count < 100 { members.append(id) }
    }

    private func save() async {
        guard problems.isEmpty, !working else { return }
        working = true
        defer { working = false }
        let newRequest = RequestID.make()
        let request = TeachingGroupRequest(action: group == nil ? "create" : "update", requestId: newRequest,
                                           id: group?.id ?? RequestID.make(),
                                           name: name.jsTrimmed,
                                           notes: notes.jsTrimmed,
                                           batteryIds: members, expectedVersion: group?.version)
        guard let body = WriteCenter.groupBody(app.dataset, payload: request) else { return }
        requestId = newRequest
        handle(await app.writes.submit(action: "teaching_group", kind: request.action, title: "Saving “\(request.name ?? "")”",
                                       batteryIds: members, requestId: newRequest, body: body, endpoint: "/api/teaching-groups"))
    }

    private func handle(_ outcome: WriteCenter.Outcome) {
        switch outcome {
        case .confirmed(let result):
            if let saved = result.group { onSaved?(saved) }
            dismiss()
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

/// Adds chosen batteries to an existing group, or starts a new group with them.
struct AddToGroupSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let batteryIds: [String]
    @State private var editing: TeachingGroup?
    @State private var creating = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { creating = true } label: { Label("New group with \(batteryIds.count == 1 ? "this battery" : "these \(batteryIds.count)")", systemImage: "plus") }
                }
                if !app.inventory.groups.isEmpty {
                    Section("Add to") {
                        ForEach(app.inventory.groups) { group in
                            let adding = batteryIds.filter { !group.batteryIds.contains($0) }.count
                            Button { editing = group } label: {
                                HStack {
                                    Text(group.name).foregroundStyle(.primary)
                                    Spacer()
                                    Text(adding == 0 ? "Already in" : "+\(adding)").foregroundStyle(.secondary)
                                }
                            }
                            .disabled(adding == 0)
                        }
                    }
                }
            }
            .navigationTitle("Teaching group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .sheet(item: $editing) { group in
                GroupEditorSheet(group: group, presetMembers: batteryIds) { _ in dismiss() }
            }
            .sheet(isPresented: $creating) {
                GroupEditorSheet(group: nil, presetMembers: batteryIds) { _ in dismiss() }
            }
        }
    }
}
