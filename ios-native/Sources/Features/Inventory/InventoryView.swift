import SwiftUI

struct InventoryView: View {
    @Environment(AppModel.self) private var app
    @Namespace private var zoom
    @State private var status: StatusFilter = .all
    @State private var search = ""
    @State private var onlyMine = false
    @State private var onlyNew = false
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Picker("Status", selection: $status) {
                        ForEach(StatusFilter.allCases) { filter in
                            Text("\(filter.title) \(count(filter))").tag(filter)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))

                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            FilterChip(title: "New arrivals", badge: app.inventory.unreadArrivals, isOn: $onlyNew)
                            FilterChip(title: "Mine", badge: 0, isOn: $onlyMine)
                        }
                    }
                    .scrollIndicators(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section {
                    ForEach(rows) { battery in
                        NavigationLink(value: battery.id) {
                            BatteryRow(battery: battery, isNew: app.inventory.newArrivalIds.contains(battery.id), myAccountId: app.user?.id)
                        }
                        .matchedTransitionSource(id: battery.id, in: zoom)
                    }
                } footer: {
                    if let refreshed = app.inventory.lastRefreshed {
                        Text("Updated \(refreshed.formatted(date: .omitted, time: .shortened))")
                    } else if let error = app.inventory.lastError {
                        Text(error)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if rows.isEmpty && app.inventory.snapshot != nil {
                    ContentUnavailableView.search(text: search)
                } else if app.inventory.snapshot == nil && app.inventory.loading {
                    ProgressView()
                }
            }
            .navigationTitle("Inventory")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { DatasetMenu(glass: false) }
            }
            .searchable(text: $search, prompt: "ID, name, model or person")
            .refreshable { await app.inventory.refresh() }
            .navigationDestination(for: String.self) { id in
                BatteryDetailView(batteryId: id)
                    .navigationTransition(.zoom(sourceID: id, in: zoom))
            }
            .onAppear { openPendingDetail() }
            .onChange(of: app.pendingDetailId) { openPendingDetail() }
            .animation(.snappy, value: status)
            .animation(.snappy, value: onlyMine)
            .animation(.snappy, value: onlyNew)
        }
    }

    private func openPendingDetail() {
        guard let id = app.pendingDetailId else { return }
        app.pendingDetailId = nil
        path = [id]
    }

    private var rows: [BatteryRecord] {
        app.inventory.filtered(status: status, search: search, onlyMine: onlyMine, onlyNew: onlyNew, accountId: app.user?.id)
    }

    private func count(_ filter: StatusFilter) -> Int {
        let all = app.inventory.active
        switch filter {
        case .all: return all.count
        case .inStore: return all.filter(\.isInStore).count
        case .inUse: return all.filter(\.isInUse).count
        }
    }
}

struct FilterChip: View {
    let title: String
    let badge: Int
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
            Haptics.tap()
        } label: {
            HStack(spacing: 6) {
                Text(title)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Tone.register, in: .capsule)
                }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(isOn ? Color(.systemBackground) : Color.primary)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(isOn ? Color.primary : Color(.secondarySystemGroupedBackground), in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

struct BatteryRow: View {
    let battery: BatteryRecord
    let isNew: Bool
    let myAccountId: String?

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(battery.name).font(.body.weight(.semibold))
                    if isNew {
                        Circle().fill(Tone.register).frame(width: 7, height: 7)
                            .accessibilityLabel("Newly registered")
                    }
                }
                HStack(spacing: 6) {
                    Text(battery.id).font(.monoSmall)
                    Text(battery.specLine).font(.footnote)
                }
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            StatusPill(battery: battery, myAccountId: myAccountId)
        }
        .padding(.vertical, 2)
    }
}
