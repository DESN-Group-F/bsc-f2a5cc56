import SwiftUI
import UIKit

enum InventoryRoute: Hashable {
    case battery(String)
    case group(String)
}

struct InventoryView: View {
    @Environment(AppModel.self) private var app
    @State private var inspecting: BatteryRecord?
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
        // One filter-and-sort pass per update; the status counts and the visible rows come from it.
        let matching = app.inventory.filtered(status: .all, search: search, filter: filter, accountId: app.user?.id)
        let rows = Self.narrow(matching, to: status)
        let counts: [StatusFilter: Int] = [.all: matching.count,
                                           .inStore: matching.filter(\.isInStore).count,
                                           .inUse: matching.filter(\.isInUse).count]
        let newIds = app.inventory.newArrivalIds
        let unreadIds = app.inventory.unreadArrivalIds
        let scanIsFree: Bool = { if case .done = app.scan.phase { return true }; return app.scan.isEmpty }()
        let canStartScan = scanIsFree && !app.hasUnsettledWork && app.scan.phase != .submitting
        NavigationStack(path: $path) {
            List {
                if app.writes.hasPending {
                    Section {
                        PendingWriteBanner()
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                }

                if filter.lifecycle == .active && !selecting && search.isEmpty && !app.inventory.groups.isEmpty {
                    Section {
                        GroupStrip { group in path.append(.group(group.id)) } onCreate: { creatingGroup = true }
                            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    } header: {
                        Text("Teaching groups")
                    }
                }

                Section {
                    Picker("Status", selection: $status) {
                        ForEach(StatusFilter.allCases) { item in
                            Text("\(item.title) \(counts[item] ?? 0)").tag(item)
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
                                    BatteryRow(battery: battery, isNew: newIds.contains(battery.id),
                                               isUnread: unreadIds.contains(battery.id), myAccountId: app.user?.id)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selection.contains(battery.id) ? .isSelected : [])
                        } else {
                            NavigationLink(value: InventoryRoute.battery(battery.id)) {
                                BatteryRow(battery: battery, isNew: newIds.contains(battery.id),
                                           isUnread: unreadIds.contains(battery.id), myAccountId: app.user?.id)
                            }
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                if battery.isActive && canStartScan {
                                    Button { startScan(with: battery) } label: {
                                        Label(battery.isInUse ? "Return" : "Check out",
                                              systemImage: battery.isInUse ? "arrow.down.to.line" : "arrow.up.right")
                                    }
                                    .tint(battery.isInUse ? Tone.returning : Tone.checkout)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                if battery.isActive {
                                    Button { addToGroup(battery) } label: { Label("Group", systemImage: "person.3") }
                                        .tint(.indigo)
                                }
                            }
                            .contextMenu {
                                if battery.isActive {
                                    Button { startScan(with: battery) } label: {
                                        Label(battery.isInUse ? "Return" : "Check out",
                                              systemImage: battery.isInUse ? "arrow.down.to.line" : "arrow.up.right")
                                    }
                                    .disabled(!canStartScan)
                                    Button { inspecting = battery } label: { Label("Record inspection", systemImage: "checklist") }
                                    Button { addToGroup(battery) } label: { Label("Add to group", systemImage: "person.3") }
                                }
                                Button { UIPasteboard.general.string = battery.id } label: { Label("Copy ID", systemImage: "doc.on.doc") }
                            }
                        }
                    }
                } header: {
                    if !rows.isEmpty { Text("\(rows.count) \(rows.count == 1 ? "battery" : "batteries")") }
                } footer: {
                    if app.inventory.snapshot != nil, let refreshed = app.inventory.lastRefreshed {
                        let time = refreshed.formatted(date: Calendar.current.isDateInToday(refreshed) ? .omitted : .abbreviated,
                                                       time: .shortened)
                        if app.inventory.lastError != nil {
                            Label("Couldn't refresh · showing \(time)", systemImage: "wifi.exclamationmark")
                        } else if app.inventory.isSavedCopy {
                            Text(app.inventory.loading ? "Saved copy from \(time) · updating…" : "Saved copy from \(time)")
                        } else {
                            Text("Updated \(time)")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if app.inventory.snapshot == nil {
                    if let error = app.inventory.lastError, !app.inventory.loading {
                        ContentUnavailableView {
                            Label("Couldn't load the inventory", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(error)
                        } actions: {
                            Button("Try again") { Task { await app.inventory.refresh() } }
                                .secondaryButton()
                        }
                    } else {
                        ProgressView()
                    }
                } else if rows.isEmpty {
                    if !search.isEmpty {
                        ContentUnavailableView.search(text: search)
                    } else if app.inventory.active.isEmpty && filter == InventoryFilter() && status == .all {
                        ContentUnavailableView {
                            Label("No batteries yet", systemImage: "battery.0percent")
                        } description: {
                            Text("Register the first battery to start the inventory.")
                        } actions: {
                            Button("Register a battery") { app.registration = RegistrationRequest() }
                                .primaryButton(Tone.register)
                        }
                    } else {
                        ContentUnavailableView {
                            Label("No batteries match", systemImage: "line.3.horizontal.decrease.circle")
                        } description: {
                            Text("Nothing fits these filters.")
                        } actions: {
                            Button("Clear filters") {
                                filter = InventoryFilter()
                                status = .all
                            }
                            .secondaryButton()
                        }
                    }
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
            .sheet(item: $inspecting) { battery in
                InspectionSheet(battery: battery)
            }
            .sheet(item: $action, onDismiss: { if !selecting { selection = [] } }) { which in
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
        ToolbarItemGroup(placement: .topBarTrailing) {
            if selecting {
                let visible = rows
                let limit = min(visible.count, 100)
                Button(!selection.isEmpty && selection.count >= limit ? "Select none"
                       : (visible.count > 100 ? "Select first 100" : "Select all")) {
                    if !selection.isEmpty && selection.count >= limit { selection = [] } else { selection = Array(visible.prefix(100).map(\.id)) }
                }
            } else {
                if app.scan.canLookUp {
                    Button { app.scan.startLookup() } label: { Image(systemName: "sensor.tag.radiowaves.forward") }
                        .accessibilityLabel("Look up by tag")
                        .disabled(app.scan.readerActive || app.inventory.snapshot == nil)
                }
                Button("Select") { selecting = true }
                    .disabled(app.inventory.snapshot == nil)
                Menu {
                    Button { app.registration = RegistrationRequest() } label: { Label("Register a new battery", systemImage: "plus.circle") }
                    Button { creatingGroup = true } label: { Label("New teaching group", systemImage: "person.3") }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add")
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
            }
            .secondaryButton()
            .disabled(!(allInStore || allInUse))

            Button { action = .group } label: {
                Label("Group", systemImage: "person.3")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .secondaryButton()
            .disabled(chosen.isEmpty || chosen.count > 100)

            Button { action = .retire } label: {
                Label("Retire", systemImage: "archivebox")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tone.failure)
                    .frame(maxWidth: .infinity)
            }
            .secondaryButton()
            .disabled(chosen.isEmpty || chosen.count > 100 || app.writes.hasPending)
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

    static func narrow(_ batteries: [BatteryRecord], to status: StatusFilter) -> [BatteryRecord] {
        switch status {
        case .all: return batteries
        case .inStore: return batteries.filter(\.isInStore)
        case .inUse: return batteries.filter(\.isInUse)
        }
    }

    /// Swipe or menu shortcut into the reviewed scan flow (one battery, one confirm on Scan).
    private func startScan(with battery: BatteryRecord) {
        app.scan.begin(with: battery)
        app.tab = .scan
        Haptics.tap()
    }

    private func addToGroup(_ battery: BatteryRecord) {
        selection = [battery.id]
        action = .group
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
            .frame(minHeight: 34)
            .background(isOn ? Color.primary : Color(.secondarySystemGroupedBackground), in: .capsule)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
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
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // At accessibility text sizes the status moves under the name instead of squeezing it.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                                                  : AnyLayout(HStackLayout(spacing: 12))
        layout {
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
                .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            StatusPill(battery: battery, myAccountId: myAccountId)
        }
        .padding(.vertical, 2)
    }
}
