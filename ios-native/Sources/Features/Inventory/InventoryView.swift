import SwiftUI

enum InventoryRoute: Hashable {
    case battery(String)
    case group(String)
}

struct InventoryView: View {
    @Environment(AppModel.self) private var app
    @Namespace private var zoom
    @State private var status: StatusFilter = .all
    @State private var search = ""
    @State private var filter = InventoryFilter()
    @State private var path: [InventoryRoute] = []
    @State private var showFilter = false
    @State private var selecting = false
    @State private var selection: [String] = []
    @State private var action: SelectionAction?

    private enum SelectionAction: String, Identifiable {
        case retire, group
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if app.writes.hasPending {
                    Section {
                        PendingWriteBanner()
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                }

                if filter.lifecycle == .active && !selecting && search.isEmpty {
                    Section {
                        GroupStrip { group in path.append(.group(group.id)) } onCreate: { creatingGroup = true }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    } header: {
                        Text("Teaching groups")
                    }
                }

                Section {
                    Picker("Status", selection: $status) {
                        ForEach(StatusFilter.allCases) { item in
                            Text("\(item.title) \(count(item))").tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))

                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ChipButton(title: "Filter", systemImage: "line.3.horizontal.decrease", badge: filter.criteriaCount,
                                       isOn: filter.criteriaCount > 0 || filter.isSorted) { showFilter = true }
                            ChipButton(title: "New arrivals", badge: app.inventory.unreadArrivals, isOn: filter.newArrivalsOnly) {
                                toggleNewArrivals()
                            }
                            ChipButton(title: "My batteries", isOn: filter.scope == .responsible) {
                                filter.scope = filter.scope == .responsible ? .all : .responsible
                            }
                            ChipButton(title: "In use by me", isOn: filter.scope == .borrowed) {
                                filter.scope = filter.scope == .borrowed ? .all : .borrowed
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())

                    AppliedFilterChips(filter: $filter)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 0, trailing: 0))
                }

                Section {
                    ForEach(rows) { battery in
                        if selecting {
                            Button { toggle(battery.id) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: selection.contains(battery.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundStyle(selection.contains(battery.id) ? Tone.checkout : Color.secondary.opacity(0.5))
                                    BatteryRow(battery: battery, isNew: isNew(battery), isUnread: isUnread(battery), myAccountId: app.user?.id)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        } else {
                            NavigationLink(value: InventoryRoute.battery(battery.id)) {
                                BatteryRow(battery: battery, isNew: isNew(battery), isUnread: isUnread(battery), myAccountId: app.user?.id)
                            }
                            .matchedTransitionSource(id: battery.id, in: zoom)
                        }
                    }
                } header: {
                    if !rows.isEmpty { Text("\(rows.count) \(rows.count == 1 ? "battery" : "batteries")") }
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
                    if !search.isEmpty {
                        ContentUnavailableView.search(text: search)
                    } else {
                        ContentUnavailableView("No batteries match", systemImage: "line.3.horizontal.decrease.circle",
                                               description: Text("Change or clear the filters."))
                    }
                } else if app.inventory.snapshot == nil && app.inventory.loading {
                    ProgressView()
                }
            }
            .navigationTitle(selecting ? (selection.isEmpty ? "Select batteries" : "\(selection.count) selected") : "Inventory")
            .toolbar { toolbar }
            .searchable(text: $search, prompt: "ID, name, model, tag or person")
            .refreshable { await app.inventory.refresh() }
            .navigationDestination(for: InventoryRoute.self) { route in
                switch route {
                case .battery(let id):
                    BatteryDetailView(batteryId: id)
                        .navigationTransition(.zoom(sourceID: id, in: zoom))
                case .group(let id):
                    GroupDetailView(groupId: id)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if selecting { selectionBar.padding(.horizontal, 16).padding(.bottom, 8) }
            }
            .sheet(isPresented: $showFilter) {
                InventoryFilterSheet(filter: $filter)
                    .presentationDetents([.large])
            }
            .sheet(isPresented: $creatingGroup) {
                GroupEditorSheet(group: nil)
            }
            .sheet(item: $action) { which in
                switch which {
                case .retire:
                    RetireSheet(batteryIds: selection) { endSelection() }
                case .group:
                    AddToGroupSheet(batteryIds: selection)
                        .presentationDetents([.medium, .large])
                }
            }
            .onAppear {
                openPendingDetail()
                configurePreview()
            }
            .onChange(of: app.pendingDetailId) { openPendingDetail() }
            .onChange(of: app.dataset) { filter = InventoryFilter(); endSelection() }
            .animation(.snappy, value: status)
            .animation(.snappy, value: filter)
            .animation(.snappy, value: selecting)
        }
    }

    @State private var creatingGroup = false

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            if selecting {
                Button("Cancel") { endSelection() }
            } else {
                DatasetMenu(glass: false)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            if selecting {
                Button(selection.count == rows.count && !rows.isEmpty ? "Select none" : "Select all") {
                    if selection.count == rows.count { selection = [] } else { selection = Array(rows.prefix(100).map(\.id)) }
                }
            } else {
                Menu {
                    Button { app.registration = RegistrationRequest() } label: { Label("Register a new battery", systemImage: "plus.circle") }
                    Button { creatingGroup = true } label: { Label("New teaching group", systemImage: "person.3") }
                    Button { selecting = true } label: { Label("Select batteries", systemImage: "checkmark.circle") }
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(app.user == nil)
            }
        }
    }

    // MARK: Selection

    private var selectedBatteries: [BatteryRecord] { selection.compactMap { app.inventory.battery(id: $0) } }

    private var selectionBar: some View {
        let chosen = selectedBatteries
        let allInStore = !chosen.isEmpty && chosen.allSatisfy(\.isInStore)
        let allInUse = !chosen.isEmpty && chosen.allSatisfy(\.isInUse)
        return HStack(spacing: 8) {
            Button {
                app.scan.begin(list: chosen, mode: allInUse ? .return : .checkout)
                app.tab = .scan
                endSelection()
            } label: {
                Label(allInUse ? "Return" : "Check out", systemImage: allInUse ? "arrow.down.to.line" : "arrow.up.right")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .disabled(!(allInStore || allInUse))
            .opacity(allInStore || allInUse ? 1 : 0.45)

            Button { action = .group } label: {
                Label("Group", systemImage: "person.3")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .disabled(chosen.isEmpty || chosen.count > 100)
            .opacity(chosen.isEmpty ? 0.45 : 1)

            Button { action = .retire } label: {
                Label("Retire", systemImage: "archivebox")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tone.failure)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .disabled(chosen.isEmpty || chosen.count > 100 || app.writes.hasPending)
            .opacity(chosen.isEmpty ? 0.45 : 1)
        }
    }

    private func toggle(_ id: String) {
        if let index = selection.firstIndex(of: id) { selection.remove(at: index) }
        else if selection.count < 100 { selection.append(id) }
        Haptics.tap()
    }

    private func endSelection() {
        selecting = false
        selection = []
    }

    // MARK: Helpers

    /// Opening New arrivals is the explicit action that acknowledges what's on screen.
    private func toggleNewArrivals() {
        if filter.newArrivalsOnly {
            filter.newArrivalsOnly = false
            return
        }
        var opened = InventoryFilter()
        opened.newArrivalsOnly = true
        opened.sort = .registered
        opened.descending = true
        filter = opened
        status = .all
        Task { await app.inventory.acknowledgeArrivals() }
    }

    private func configurePreview() {
        guard let screen = app.preview else { return }
        switch screen {
        case .inventoryFiltered:
            filter.chemistry = "LiPo"
            filter.sort = .capacity
            filter.descending = true
        case .newArrivals:
            toggleNewArrivals()
        case .group:
            if let group = app.inventory.groups.first { path = [.group(group.id)] }
        default:
            break
        }
    }

    private func openPendingDetail() {
        guard let id = app.pendingDetailId else { return }
        app.pendingDetailId = nil
        path = [.battery(id)]
    }

    private var rows: [BatteryRecord] {
        app.inventory.filtered(status: status, search: search, filter: filter, accountId: app.user?.id)
    }

    private func isNew(_ battery: BatteryRecord) -> Bool { app.inventory.newArrivalIds.contains(battery.id) }
    private func isUnread(_ battery: BatteryRecord) -> Bool { app.inventory.unreadArrivalIds.contains(battery.id) }

    private func count(_ item: StatusFilter) -> Int {
        var base = filter
        base.newArrivalsOnly = filter.newArrivalsOnly
        return app.inventory.filtered(status: item, search: search, filter: base, accountId: app.user?.id).count
    }
}

struct ChipButton: View {
    let title: String
    var systemImage: String? = nil
    var badge: Int = 0
    let isOn: Bool
    var action: () -> Void

    var body: some View {
        Button {
            action()
            Haptics.tap()
        } label: {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(isOn ? Tone.checkout : Tone.failure, in: .capsule)
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
    var isUnread: Bool = false
    let myAccountId: String?

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(battery.name).font(.body.weight(.semibold)).lineLimit(1)
                    if battery.hasOpenConcern && battery.isActive {
                        Image(systemName: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Tone.failure)
                            .accessibilityLabel("Concern at last inspection")
                    }
                    if isNew {
                        Text("New")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Tone.register)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Tone.register.opacity(0.12), in: .capsule)
                            .overlay(alignment: .topTrailing) {
                                if isUnread {
                                    Circle().fill(Tone.failure).frame(width: 7, height: 7).offset(x: 3, y: -3)
                                }
                            }
                            .accessibilityLabel(isUnread ? "Newly registered, unread" : "Newly registered")
                    }
                }
                HStack(spacing: 6) {
                    Text(battery.id).font(.monoSmall).fixedSize()
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
