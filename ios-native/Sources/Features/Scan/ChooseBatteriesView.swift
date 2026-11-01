import SwiftUI

/// Pick batteries by hand. Shows only batteries that fit the current action.
struct ChooseBatteriesView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var selected: [String] = []
    @State private var kind: MovementKind = .checkout

    var body: some View {
        NavigationStack {
            List {
                if app.scan.isEmpty {
                    Section {
                        Picker("Action", selection: $kind) {
                            ForEach(MovementKind.allCases.filter { $0 != .register }) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                }
                Section {
                    if candidates.isEmpty {
                        ContentUnavailableView(emptyTitle, systemImage: "battery.0percent",
                                               description: Text(kind == .return ? "Nothing is checked out that matches." : "Nothing in store matches."))
                    }
                    ForEach(candidates) { battery in
                        Button {
                            toggle(battery.id)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: selected.contains(battery.id) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(selected.contains(battery.id) ? kind.tint : Color.secondary.opacity(0.5))
                                    .contentTransition(.symbolEffect(.replace))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(battery.name).font(.body.weight(.semibold))
                                    Text("\(battery.id) · \(battery.specLine)").font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                StatusPill(battery: battery, myAccountId: app.user?.id)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $search, prompt: "ID, name, model or person")
            .navigationTitle(kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(selected.isEmpty ? "Add" : "Add \(selected.count)") {
                        let batteries = selected.compactMap { app.inventory.battery(id: $0) }
                        if app.scan.isEmpty { app.scan.mode = kind }
                        app.scan.addSelected(batteries)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(selected.isEmpty)
                }
            }
            .onAppear { kind = app.scan.mode == .register ? .checkout : app.scan.mode }
            .onChange(of: kind) { selected = [] }
            .sensoryFeedback(.selection, trigger: selected)
        }
    }

    private var emptyTitle: String { search.isEmpty ? "No batteries" : "No matches" }

    private var candidates: [BatteryRecord] {
        let inList = Set(app.scan.items.map(\.id))
        return app.inventory.filtered(status: kind == .return ? .inUse : .inStore, search: search,
                                      onlyMine: false, onlyNew: false, accountId: app.user?.id)
            .filter { !inList.contains($0.id) }
    }

    private func toggle(_ id: String) {
        if let index = selected.firstIndex(of: id) { selected.remove(at: index) } else { selected.append(id) }
    }
}
