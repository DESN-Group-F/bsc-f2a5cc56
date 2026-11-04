import SwiftUI

/// Screens inside the group checkout sheet.
enum GroupRoute: Hashable {
    case checkout(String)
    case returnRun(String)
}

/// One sheet for everything group checkouts do: pick a group, review its checkout, return a run.
struct GroupFlowSheet: View {
    let flow: GroupFlow

    var body: some View {
        NavigationStack {
            root
                .navigationDestination(for: GroupRoute.self) { route in
                    switch route {
                    case .checkout(let id): GroupCheckoutView(groupId: id)
                    case .returnRun(let id): RunReturnView(runId: id)
                    }
                }
        }
    }

    @ViewBuilder
    private var root: some View {
        switch flow {
        case .hub: GroupsHubView()
        case .checkout(let id): GroupCheckoutView(groupId: id, isRoot: true)
        case .returnRun(let id): RunReturnView(runId: id, isRoot: true)
        }
    }
}

// MARK: - Hub

/// From the Groups button on Scan: what's out now, and your groups to check out.
struct GroupsHubView: View {
    @Environment(AppModel.self) private var app
    @State private var creating = false

    var body: some View {
        let open = app.runs.open
        let groups = app.inventory.groups
        List {
            if app.writes.hasPending {
                Section { PendingWriteBanner() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if !open.isEmpty {
                Section {
                    ForEach(open) { run in
                        NavigationLink(value: GroupRoute.returnRun(run.id)) { OpenRunRow(run: run) }
                    }
                } header: {
                    Text("Out now")
                } footer: {
                    Text("Returning a group checkout returns only its own batteries, on their own loans.")
                }
            }
            Section {
                ForEach(groups) { group in
                    NavigationLink(value: GroupRoute.checkout(group.id)) { GroupPickRow(group: group) }
                }
                Button { creating = true } label: { Label("New group", systemImage: "plus") }
            } header: {
                Text("Check out a group")
            } footer: {
                if !groups.isEmpty {
                    Text("You'll see every member before anything is saved: what's in store, what's with you, and what needs a stand-in.")
                }
            }
            if let error = app.runs.lastError {
                Section { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(Tone.failure).font(.footnote) }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Groups")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Close") { app.groupFlow = nil } }
        }
        .refreshable { await app.refreshAll() }
        .task { await app.runs.refresh() }
        .sheet(isPresented: $creating) { GroupEditorSheet(group: nil) }
    }
}

struct OpenRunRow: View {
    @Environment(AppModel.self) private var app
    let run: TeachingRun

    var body: some View {
        let out = run.outstanding.count
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(run.teachingGroup.name).font(.body.weight(.semibold))
                Text("Started \(run.startedText) · \(out) of \(run.allItems.count) out")
                    .font(.footnote).foregroundStyle(.secondary)
                if app.inventory.groups.first(where: { $0.id == run.teachingGroup.id }) == nil {
                    Text("Group since changed or deleted · this checkout is kept as it was")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Text("Return \(out)")
                .font(.footnote.weight(.bold))
                .foregroundStyle(Tone.returnInk)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Tone.returning, in: .capsule)
                .fixedSize()
        }
        .accessibilityElement(children: .combine)
    }
}

private struct GroupPickRow: View {
    @Environment(AppModel.self) private var app
    let group: TeachingGroup

    var body: some View {
        let members = group.batteryIds.compactMap { app.inventory.battery(id: $0) }
        let inStore = members.filter(\.isInStore).count
        VStack(alignment: .leading, spacing: 2) {
            Text(group.name).font(.body.weight(.semibold))
            Text("\(group.batteryIds.count) \(group.batteryIds.count == 1 ? "battery" : "batteries") · \(inStore) in store")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Group checkout review

/// Reviews and checks out a whole teaching group as one group checkout (a run on the server).
/// Built from freshly loaded records; nothing is saved until "Check out".
struct GroupCheckoutView: View {
    @Environment(AppModel.self) private var app
    let groupId: String
    var isRoot = false

    @State private var plan: GroupCheckoutPlan?
    @State private var separate = false
    @State private var loading = false
    @State private var loadError: String?
    @State private var requestId: String?
    @State private var pendingKind: PendingKind?
    @State private var message: String?
    @State private var isError = false
    @State private var done: CheckoutDone?
    @State private var picking: Pick?
    @State private var permanent: PermanentChoice?
    /// The group as saved by a replacement here, until the inventory refresh catches up.
    @State private var savedGroup: TeachingGroup?
    /// The first load has finished, so "not available" is never shown while still unknown.
    @State private var loadedOnce = false
    /// The open checkout of this group being returned from the warning, pushed on top of the review.
    @State private var returningRunId: String?

    private enum PendingKind: Equatable { case checkout, groupUpdate }

    struct CheckoutDone: Equatable {
        let title: String
        let at: String
        let count: Int
        let swaps: [Swap]
        let continued: Int
        struct Swap: Equatable, Identifiable { let member: String; let actual: String; let note: String; var id: String { member } }
    }

    /// What the replacement list is for: a stand-in this time, or a permanent change to the group.
    struct Pick: Identifiable {
        let memberId: String
        let permanent: Bool
        var id: String { memberId + (permanent ? "-p" : "") }
    }

    struct PermanentChoice: Identifiable {
        let memberId: String
        let battery: BatteryRecord
        var id: String { memberId + battery.id }
    }

    private var group: TeachingGroup? {
        let listed = app.inventory.groups.first { $0.id == groupId }
        guard let saved = savedGroup else { return listed }
        guard let listed else { return saved }
        return listed.version >= saved.version ? listed : saved
    }

    private var isSending: Bool { requestId.map { app.writes.sending.contains($0) } ?? false }
    private var isPending: Bool { requestId.map { app.writes.entry(id: $0) != nil } ?? false }
    private var locked: Bool { isSending || isPending }

    var body: some View {
        Group {
            if let done {
                CheckoutDoneView(done: done, groupName: group?.name ?? plan?.group.name ?? "Group") { app.groupFlow = nil }
            } else if let plan {
                review(plan)
            } else if !loadedOnce || loading || app.inventory.snapshot == nil {
                ProgressView("Loading the latest records…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("Group not available", systemImage: "person.3",
                                       description: Text(loadError ?? "It may have been deleted, or it belongs to another inventory."))
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(done == nil ? "Check out group" : "")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(locked)
        .interactiveDismissDisabled(locked)
        .toolbar {
            if isRoot && done == nil {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { app.groupFlow = nil }.disabled(locked) }
            }
        }
        // Also when coming back from a return pushed on top: the runs have changed.
        .onAppear { Task { await reload() } }
        // Records refreshed elsewhere (a poll, a request settled from the banner): reclassify, keeping choices.
        .onChange(of: app.inventory.lastRefreshed) { if loadedOnce && !locked && !loading && done == nil { rebuild() } }
        .onChange(of: app.runs.generation) { if loadedOnce && !locked && !loading && done == nil { rebuild() } }
        .navigationDestination(item: $returningRunId) { id in RunReturnView(runId: id) }
        .sheet(item: $picking) { pick in pickerSheet(pick) }
        .confirmationDialog(permanentTitle, isPresented: Binding(get: { permanent != nil }, set: { if !$0 { permanent = nil } }),
                            titleVisibility: .visible, presenting: permanent) { choice in
            Button("Replace in group") { Task { await replaceInGroup(choice) } }
        } message: { _ in
            Text("Only this member changes. The group's name, notes and other members stay as they are, and past checkouts aren't touched.")
        }
    }

    private var permanentTitle: String {
        guard let permanent, let group else { return "" }
        return "Replace \(permanent.memberId) with \(permanent.battery.id) in “\(group.name)”?"
    }

    // MARK: Review

    @ViewBuilder
    private func review(_ plan: GroupCheckoutPlan) -> some View {
        let toFill = plan.slots.filter { $0.state.needsReplacement && !$0.skipped }
        let goingOut = plan.slots.filter { !$0.state.needsReplacement && $0.isIncluded }
        let notThisTime = plan.slots.filter { $0.state.isFixedOut || $0.skipped }
        let openRuns = app.runs.open(forGroup: plan.group.id)
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.group.name).font(.title2.weight(.bold))
                    Text(plan.summary).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    if let notes = plan.group.notes, !notes.isEmpty {
                        Text(notes).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 4, trailing: 4))
            }

            if app.writes.hasPending && !isPending {
                Section { PendingWriteBanner() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }

            if let loadError {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Couldn't load the latest records", systemImage: "wifi.exclamationmark").font(.subheadline.weight(.semibold))
                        Text("\(loadError) Checking out needs the current state of every member.").font(.footnote).foregroundStyle(.secondary)
                        Button("Try again") { Task { await reload() } }.font(.subheadline.weight(.semibold))
                    }
                }
            }

            if !openRuns.isEmpty {
                Section { openRunBanner(openRuns) }
            }

            if !toFill.isEmpty {
                Section {
                    ForEach(toFill) { slot in slotRow(slot, plan: plan) }
                    if !plan.unfilled.isEmpty {
                        Button { replaceAll() } label: {
                            Label("Fill with same-spec batteries", systemImage: "wand.and.stars")
                        }
                        .disabled(locked)
                    }
                } header: {
                    Text("To fill · \(toFill.count)")
                } footer: {
                    Text("Suggestions are batteries in store with the same recorded model, chemistry, capacity and voltage. They aren't reserved — if one goes out before you confirm, nothing is saved and the review updates.")
                }
            }

            if !goingOut.isEmpty {
                Section("Going out · \(goingOut.count)") {
                    ForEach(goingOut) { slot in slotRow(slot, plan: plan) }
                }
            }

            if !notThisTime.isEmpty {
                Section("Not this time · \(notThisTime.count)") {
                    ForEach(notThisTime) { slot in slotRow(slot, plan: plan) }
                }
            }

            if let message {
                Section {
                    Label(message, systemImage: isError ? "exclamationmark.circle" : "checkmark.circle")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(isError ? Tone.failure : Tone.success)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await reload() }
        .animation(.snappy, value: plan)
        .safeAreaInset(edge: .bottom, spacing: 0) { confirmBar(plan) }
    }

    @ViewBuilder
    private func openRunBanner(_ runs: [TeachingRun]) -> some View {
        let out = runs.reduce(0) { $0 + $1.outstanding.count }
        VStack(alignment: .leading, spacing: 10) {
            Label(out == 1 ? "1 battery from this group is still out" : "\(out) batteries from this group are still out",
                  systemImage: "clock.arrow.circlepath")
                .font(.subheadline.weight(.bold))
            Text(separate
                 ? "Separate checkout: a second checkout alongside the one still out. It uses different batteries, and members held there get stand-ins."
                  : "From your checkout started \(runs[0].startedText). Return it first, or start a separate checkout for another class.")
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Button { returningRunId = runs[0].id } label: {
                    Text(runs[0].outstanding.count == out ? "Return \(out)" : "Return")
                        .font(.footnote.weight(.bold)).foregroundStyle(Tone.returnInk)
                        .padding(.horizontal, 12).frame(minHeight: 34)
                        .background(Tone.returning, in: .capsule)
                }
                .buttonStyle(.plain)
                Button {
                    separate.toggle()
                    rebuild()
                } label: {
                    Text(separate ? "Not separate" : "Separate checkout")
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12).frame(minHeight: 34)
                        .background(Color(.tertiarySystemFill), in: .capsule)
                }
                .buttonStyle(.plain)
            }
            .disabled(locked)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func slotRow(_ slot: CheckoutSlot, plan: GroupCheckoutPlan) -> some View {
        HStack(alignment: .top, spacing: 12) {
            slotText(slot)
            Spacer(minLength: 4)
            slotMenu(slot)
        }
        .padding(.vertical, 2)
    }

    private func slotText(_ slot: CheckoutSlot) -> some View {
        HStack(alignment: .top, spacing: 12) {
            BatteryGlyph(tint: glyphTint(slot), size: 34)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(slot.memberId).font(.mono)
                    if let name = slot.member?.name { Text(name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                }
                Text(stateText(slot)).font(.footnote).foregroundStyle(slot.isUnfilled ? Tone.failure : Color.secondary)
                if let actual = slot.actual, slot.isReplacement, let member = slot.member {
                    Label {
                        Text("\(actual.id) · \(slot.method == .automatic ? "suggested" : "chosen by you") · \(TeachingSpec.differences(member, actual))")
                    } icon: {
                        Image(systemName: "arrow.turn.down.right")
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Tone.checkout)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func glyphTint(_ slot: CheckoutSlot) -> Color {
        if slot.isIncluded { return Tone.checkout }
        if slot.isUnfilled { return Tone.failure }
        return .secondary
    }

    private func stateText(_ slot: CheckoutSlot) -> String {
        if slot.skipped {
            if case .borrowed(let by) = slot.state { return "Skipped this time · with \(by)" }
            return "Skipped this time"
        }
        switch slot.state {
        case .inStore: return "In store"
        case .withYou:
            let since = slot.member?.checkedOutAt.map { " from \(Sydney.friendly($0))" } ?? ""
            return "With you · keeps your loan\(since)"
        case .borrowed(let by): return slot.actual == nil ? "With \(by) · needs a stand-in" : "With \(by)"
        case .heldElsewhere(let run): return slot.actual == nil ? "Out in \(run) · needs a stand-in" : "Out in \(run)"
        case .inOtherCheckout(let run): return "Already out in \(run)"
        case .retired(let status): return "\(status) · replace it in the group to use this slot"
        case .missing: return "No longer in this inventory · replace it in the group"
        }
    }

    @ViewBuilder
    private func slotMenu(_ slot: CheckoutSlot) -> some View {
        let actions = menuActions(slot)
        if !actions.isEmpty {
            Menu {
                ForEach(actions, id: \.title) { action in
                    Button(role: action.destructive ? .destructive : nil) { action.run() } label: {
                        Label(action.title, systemImage: action.icon)
                    }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
                    .foregroundStyle(slot.isUnfilled ? Tone.checkout : Color.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .disabled(locked)
            .accessibilityLabel("Options for \(slot.memberId)")
        }
    }

    private struct SlotAction {
        let title: String
        let icon: String
        var destructive = false
        let run: () -> Void
    }

    private func menuActions(_ slot: CheckoutSlot) -> [SlotAction] {
        var list: [SlotAction] = []
        let id = slot.memberId
        if slot.state.needsReplacement && !slot.skipped {
            list.append(SlotAction(title: slot.actual == nil ? "Choose a stand-in…" : "Choose another stand-in…", icon: "list.bullet") {
                picking = Pick(memberId: id, permanent: false)
            })
            if slot.isReplacement {
                list.append(SlotAction(title: "Remove stand-in", icon: "minus.circle") { mutate { $0.clearReplacement(id) } })
            }
        }
        switch slot.state {
        case .retired, .missing:
            list.append(SlotAction(title: "Replace in group…", icon: "arrow.triangle.swap") { picking = Pick(memberId: id, permanent: true) })
        case .inOtherCheckout:
            break
        default:
            if slot.skipped {
                list.append(SlotAction(title: "Include this time", icon: "plus.circle") { mutate { $0.setSkipped(id, false) } })
            } else {
                list.append(SlotAction(title: "Skip this time", icon: "forward") { mutate { $0.setSkipped(id, true) } })
            }
        }
        return list
    }

    @ViewBuilder
    private func confirmBar(_ plan: GroupCheckoutPlan) -> some View {
        let n = plan.included.count
        let unfilled = plan.unfilled.count
        // With a checkout of this group still out, checking out again is a deliberate separate checkout.
        let needsChoice = !app.runs.open(forGroup: plan.group.id).isEmpty && !plan.separate
        let enabled = plan.canSubmit && !needsChoice && !locked && loadError == nil && !loading && !app.writes.hasPending
        VStack(spacing: 8) {
            if isPending && !isSending {
                VStack(alignment: .leading, spacing: 6) {
                    WriteStateView(requestId: requestId, message: nil, isError: true)
                    Button { Task { await retry() } } label: {
                        Text("Try again").font(.headline).frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .secondaryButton()
                }
            } else {
                if needsChoice {
                    Text("Return the checkout still out, or choose Separate checkout above.")
                        .font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                } else if unfilled > 0 {
                    ViewThatFits(in: .horizontal) {
                        HStack {
                            unfilledHint(unfilled)
                            Spacer()
                            skipButton(unfilled)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            unfilledHint(unfilled)
                            skipButton(unfilled)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 4)
                }
                Button { Task { await confirm() } } label: {
                    HStack(spacing: 10) {
                        if isSending { ProgressView().tint(.white) }
                        Text(isSending ? "Checking out…" : (n == 0 ? "Nothing to check out" : "Check out \(n) \(n == 1 ? "battery" : "batteries")"))
                            .contentTransition(.numericText(value: Double(n)))
                    }
                    .font(.headline)
                    .foregroundStyle(enabled || isSending ? Color.white : Color.secondary)
                    .frame(maxWidth: .infinity, minHeight: 42)
                }
                .primaryButton(Tone.checkout)
                .disabled(!enabled)
                .onChange(of: isSending) { _, sending in if sending { Haptics.press() } }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .background(.bar)
    }

    private func unfilledHint(_ n: Int) -> some View {
        Text("\(n) to fill or skip").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
    }

    private func skipButton(_ n: Int) -> some View {
        Button("Skip \(n == 1 ? "it" : "them") this time") { mutate { $0.skipUnfilled() } }
            .font(.footnote.weight(.semibold))
            .disabled(locked)
    }

    // MARK: Pickers

    @ViewBuilder
    private func pickerSheet(_ pick: Pick) -> some View {
        if let plan {
            let slot = plan.slots.first { $0.memberId == pick.memberId }
            ReplacementPicker(title: pick.permanent ? "Replace in group" : "Choose a stand-in",
                              member: slot?.member,
                              candidates: plan.pool(from: app.inventory.batteries, excludingSlot: pick.permanent ? nil : pick.memberId),
                              footnote: pick.permanent
                                ? "The chosen battery becomes a member of “\(plan.group.name)” in place of \(pick.memberId), from now on."
                                : "Only for this checkout. \(pick.memberId) stays in the group.") { battery in
                if pick.permanent {
                    permanent = PermanentChoice(memberId: pick.memberId, battery: battery)
                } else {
                    mutate { $0.choose(battery, for: pick.memberId) }
                }
            }
        }
    }

    // MARK: Actions

    private func mutate(_ change: (inout GroupCheckoutPlan) -> Void) {
        guard !locked, var current = plan else { return }
        change(&current)
        plan = current
        Haptics.tap()
    }

    private func replaceAll() {
        guard !locked, var current = plan else { return }
        let result = current.replaceAll(from: app.inventory.batteries)
        plan = current
        isError = false
        if result.filled == 0 {
            message = "No battery in store has the same recorded specs. Choose a stand-in by hand, or skip."
            isError = true
            Haptics.refused()
        } else {
            message = result.unfilled == 0 ? "Filled \(result.filled) with same-spec batteries."
                : "Filled \(result.filled). \(result.unfilled) still open — choose by hand, or skip."
            Haptics.accepted()
        }
    }

    private func reload() async {
        guard !locked else { return }
        loading = true
        defer { loading = false }
        async let a: Void = app.inventory.refresh()
        async let b: Void = app.runs.refresh()
        _ = await (a, b)
        loadError = app.inventory.lastError ?? app.runs.lastError
        rebuild()
        loadedOnce = true
    }

    private func rebuild() {
        guard let group, let me = app.user?.id, app.inventory.snapshot != nil else { plan = nil; return }
        // "Separate" only means something while another checkout of this group is out.
        if separate && app.runs.open(forGroup: group.id).isEmpty { separate = false }
        plan = GroupCheckoutPlan(group: group, batteries: app.inventory.batteries, runs: app.runs.runs, me: me,
                                 separate: separate, keeping: plan?.group.id == group.id ? plan : nil)
        if app.preview == .groupCheckoutFilled, var filled = plan, !filled.unfilled.isEmpty {
            filled.replaceAll(from: app.inventory.batteries)
            plan = filled
        }
    }

    private func confirm() async {
        guard let plan, plan.canSubmit, !locked, loadError == nil, !app.writes.hasPending else { return }
        let mappings = plan.mappings
        guard !mappings.isEmpty else { return }
        guard mappings.count <= 100 else {
            message = "A group checkout holds at most 100 batteries."
            isError = true
            return
        }
        let id = RequestID.make()
        let payload = TeachingCheckoutPayload(requestId: id, teachingGroup: GroupReference(id: plan.group.id, version: plan.group.version),
                                              mappings: mappings, separateCheckout: plan.separate ? true : nil)
        guard let body = WriteCenter.teachingBody(app.dataset, payload: payload) else {
            message = "Couldn't prepare the request."
            isError = true
            return
        }
        requestId = id
        pendingKind = .checkout
        message = nil
        let outcome = await app.writes.submit(action: "teaching_checkout", kind: "checkout",
                                              title: "Checking out “\(plan.group.name)”",
                                              batteryIds: mappings.map(\.actual.batteryId), requestId: id, body: body,
                                              endpoint: "/api/teaching-checkouts")
        await handle(outcome, reviewed: plan)
    }

    private func retry() async {
        guard let id = requestId, let entry = app.writes.entry(id: id), let plan else { return }
        let outcome = await app.writes.retry(entry)
        if pendingKind == .groupUpdate {
            await handleGroupUpdate(outcome, memberId: nil, battery: nil)
        } else {
            await handle(outcome, reviewed: plan)
        }
    }

    private func handle(_ outcome: WriteCenter.Outcome, reviewed: GroupCheckoutPlan) async {
        switch outcome {
        case .confirmed(let result):
            requestId = nil
            pendingKind = nil
            let swaps = reviewed.replacements.compactMap { slot -> CheckoutDone.Swap? in
                guard let member = slot.member, let actual = slot.actual else { return nil }
                return .init(member: slot.memberId, actual: actual.id, note: TeachingSpec.differences(member, actual))
            }
            withAnimation(.snappy) {
                done = CheckoutDone(title: result.title, at: Sydney.timestamp(), count: reviewed.included.count, swaps: swaps,
                                    continued: reviewed.included.filter { $0.state == .withYou }.count)
            }
        case .rejected(let text), .notSent(let text):
            requestId = nil
            pendingKind = nil
            message = text + " Nothing was checked out; the review now shows the latest records."
            isError = true
            await reload()
        case .uncertain(let text):
            message = text
            isError = true
        }
    }

    /// Permanently swaps one member of the group (scrapped or gone) for another battery, then rebuilds the review.
    private func replaceInGroup(_ choice: PermanentChoice) async {
        permanent = nil
        guard let group, !locked, !app.writes.hasPending else { return }
        guard let index = group.batteryIds.firstIndex(of: choice.memberId), !group.batteryIds.contains(choice.battery.id) else {
            message = "The group changed. Check its members and try again."
            isError = true
            return
        }
        var members = group.batteryIds
        members[index] = choice.battery.id
        let id = RequestID.make()
        let request = TeachingGroupRequest(action: "update", requestId: id, id: group.id, name: group.name, notes: group.notes ?? "",
                                           batteryIds: members, expectedVersion: group.version)
        guard let body = WriteCenter.groupBody(app.dataset, payload: request) else { return }
        requestId = id
        pendingKind = .groupUpdate
        message = nil
        let outcome = await app.writes.submit(action: "teaching_group", kind: "update",
                                              title: "Replacing \(choice.memberId) in “\(group.name)”",
                                              batteryIds: members, requestId: id, body: body, endpoint: "/api/teaching-groups")
        await handleGroupUpdate(outcome, memberId: choice.memberId, battery: choice.battery.id)
    }

    private func handleGroupUpdate(_ outcome: WriteCenter.Outcome, memberId: String?, battery: String?) async {
        switch outcome {
        case .confirmed(let result):
            requestId = nil
            pendingKind = nil
            if let saved = result.group { savedGroup = saved }
            message = memberId.flatMap { m in battery.map { "\(m) replaced by \($0) in the group." } } ?? result.title
            isError = false
            await reload()
        case .rejected(let text), .notSent(let text):
            requestId = nil
            pendingKind = nil
            message = text + " The group wasn't changed. It's been reloaded — check it and try again."
            isError = true
            await reload()
        case .uncertain(let text):
            message = text
            isError = true
        }
    }
}

/// After a confirmed group checkout: what went out, and which slots used stand-ins.
private struct CheckoutDoneView: View {
    let done: GroupCheckoutView.CheckoutDone
    let groupName: String
    var onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 56, weight: .semibold))
                    .foregroundStyle(Tone.success)
                    .symbolEffect(.bounce, value: done)
                VStack(spacing: 6) {
                    Text(done.title).font(.title2.weight(.bold)).multilineTextAlignment(.center)
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                if !done.swaps.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Stand-ins this time").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6)
                        ForEach(done.swaps) { swap in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(swap.member) → \(swap.actual)").font(.mono)
                                Text(swap.note).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 8)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 6)
                    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
                }
                Text("When the class is done, return them together from Groups on Scan or from the group's page. Only this checkout's batteries are returned.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 20)
            .padding(.top, 36)
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onClose) {
                Text("Done").font(.headline).foregroundStyle(.white).frame(maxWidth: .infinity, minHeight: 42)
            }
            .primaryButton(Tone.checkout)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private var subtitle: String {
        var parts = ["Confirmed by server · \(Sydney.friendly(done.at))"]
        if done.continued > 0 { parts.append("\(done.continued) kept on your existing loan") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Replacement picker

/// Batteries in store that can stand in for a member: same recorded specs first, then the rest.
struct ReplacementPicker: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let member: BatteryRecord?
    let candidates: [BatteryRecord]
    let footnote: String
    var onPick: (BatteryRecord) -> Void
    @State private var search = ""

    var body: some View {
        let shown = candidates.filter(matches)
        let same = member.map { m in shown.filter { TeachingSpec.matches(m, $0) } } ?? []
        let others = shown.filter { c in !same.contains { $0.id == c.id } }
        NavigationStack {
            List {
                if let member {
                    Section {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("For \(member.id)").font(.subheadline.weight(.semibold))
                            Text(member.specLine).font(.footnote).foregroundStyle(.secondary)
                        }
                    } footer: { Text(footnote) }
                }
                if !same.isEmpty {
                    Section("Same model and specs") { ForEach(same) { row($0) } }
                }
                if !others.isEmpty {
                    Section(same.isEmpty ? "In store" : "Other batteries in store") { ForEach(others) { row($0) } }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if shown.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "Nothing in store to use" : "No matches", systemImage: "battery.0percent",
                                           description: Text(search.isEmpty ? "Every other battery is out, retired or already in this group." : "Try another ID or name."))
                }
            }
            .searchable(text: $search, prompt: "ID, name or model")
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func matches(_ b: BatteryRecord) -> Bool {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return true }
        return [b.id, b.name, b.model ?? "", b.chemistry ?? ""].contains { $0.lowercased().contains(q) }
    }

    private func row(_ battery: BatteryRecord) -> some View {
        Button {
            onPick(battery)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(battery.id).font(.mono)
                        Text(battery.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Text(battery.specLine).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    if let member, !TeachingSpec.matches(member, battery) {
                        Text(TeachingSpec.differences(member, battery)).font(.caption.weight(.semibold)).foregroundStyle(.orange)
                    }
                }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Return a group checkout

/// Returns all or part of one group checkout, using the loans recorded in it, read fresh from the server.
struct RunReturnView: View {
    @Environment(AppModel.self) private var app
    let runId: String
    var isRoot = false

    @State private var run: TeachingRun?
    @State private var loaded = false
    @State private var loading = false
    @State private var loadError: String?
    /// Loan IDs chosen to return.
    @State private var selected: Set<String> = []
    @State private var preselected = false
    @State private var requestId: String?
    @State private var message: String?
    @State private var isError = false
    @State private var done: ReturnDone?

    struct ReturnDone: Equatable {
        let title: String
        let at: String
        let remaining: Int?
    }

    private var isSending: Bool { requestId.map { app.writes.sending.contains($0) } ?? false }
    private var isPending: Bool { requestId.map { app.writes.entry(id: $0) != nil } ?? false }
    private var locked: Bool { isSending || isPending || loading }

    var body: some View {
        Group {
            if let done {
                returnDone(done)
            } else if let run {
                content(run)
            } else if !loaded {
                ProgressView("Loading this checkout…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView {
                    Label("Checkout not available", systemImage: "person.3")
                } description: {
                    Text(loadError ?? "It may belong to another inventory or account.")
                } actions: {
                    if loadError != nil { Button("Try again") { Task { await reload() } } }
                }
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(done == nil ? "Return group checkout" : "")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(isSending || isPending)
        .interactiveDismissDisabled(isSending || isPending)
        .toolbar {
            if isRoot && done == nil {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { app.groupFlow = nil }.disabled(isSending || isPending) }
            }
        }
        .task { await reload() }
    }

    @ViewBuilder
    private func content(_ run: TeachingRun) -> some View {
        let outstanding = run.outstanding
        let settled = run.allItems.filter { !$0.isOutstanding }
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(run.teachingGroup.name).font(.title2.weight(.bold))
                    Text("Started \(run.startedText)\(run.actorName.map { " by \($0)" } ?? "") · \(outstanding.count) of \(run.allItems.count) still out")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 4, trailing: 4))
            }
            if app.writes.hasPending && !isPending {
                Section { PendingWriteBanner() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let loadError {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Couldn't refresh this checkout", systemImage: "wifi.exclamationmark").font(.subheadline.weight(.semibold))
                        Text("\(loadError) Returning reads it again first, so nothing is sent from an old copy.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Try again") { Task { await reload() } }.font(.subheadline.weight(.semibold))
                    }
                }
            }
            if !outstanding.isEmpty {
                Section {
                    ForEach(outstanding) { item in itemRow(item, run: run) }
                } header: {
                    HStack {
                        Text("Still out · \(outstanding.count)")
                        Spacer()
                        Button(selected.count == outstanding.count ? "Select none" : "Select all") {
                            selected = selected.count == outstanding.count ? [] : Set(outstanding.map(\.id))
                            Haptics.tap()
                        }
                        .font(.footnote.weight(.semibold))
                        .textCase(nil)
                        .disabled(locked)
                    }
                } footer: {
                    Text("Untick any that haven't come back yet; they stay out on this checkout. Batteries borrowed by anyone else are never part of it.")
                }
            }
            if !settled.isEmpty {
                Section("Already settled · \(settled.count)") {
                    ForEach(settled) { item in itemRow(item, run: run) }
                }
            }
            if let message {
                Section {
                    Label(message, systemImage: isError ? "exclamationmark.circle" : "info.circle")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(isError ? Tone.failure : Color.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await reload() }
        .safeAreaInset(edge: .bottom, spacing: 0) { returnBar(run) }
    }

    @ViewBuilder
    private func itemRow(_ item: TeachingRunItem, run: TeachingRun) -> some View {
        let battery = app.inventory.battery(id: item.batteryId)
        let member = run.memberId(of: item)
        let isOn = selected.contains(item.id)
        HStack(spacing: 12) {
            if item.isOutstanding {
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isOn ? Tone.returnGlyph : Color.secondary.opacity(0.5))
            } else {
                Image(systemName: item.status == "returned" ? "arrow.uturn.backward.circle" : "minus.circle")
                    .font(.title3).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(item.batteryId).font(.mono)
                    Text(battery?.name ?? "Battery").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                if let member, member != item.batteryId {
                    Text("Stood in for \(member)").font(.footnote).foregroundStyle(.secondary)
                }
                if item.pendingReturn == true {
                    Text("Swapped out on the web · not handed back yet").font(.footnote).foregroundStyle(.secondary)
                }
                if !item.isOutstanding {
                    Text(settledText(item)).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard item.isOutstanding, !locked else { return }
            if isOn { selected.remove(item.id) } else { selected.insert(item.id) }
            Haptics.tap()
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(item.isOutstanding ? [.isButton] : [])
        .accessibilityValue(item.isOutstanding ? (isOn ? "Will be returned" : "Stays out") : "")
    }

    private func settledText(_ item: TeachingRunItem) -> String {
        switch item.status {
        case "returned": return "Back · \(Sydney.friendly(item.returnedAt))"
        case "cancelled": return "Check-out voided"
        default: return "No longer in this inventory"
        }
    }

    @ViewBuilder
    private func returnBar(_ run: TeachingRun) -> some View {
        let n = run.outstanding.filter { selected.contains($0.id) }.count
        VStack(spacing: 8) {
            if isPending && !isSending {
                VStack(alignment: .leading, spacing: 6) {
                    WriteStateView(requestId: requestId, message: nil, isError: true)
                    Button { Task { await retry() } } label: {
                        Text("Try again").font(.headline).frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .secondaryButton()
                }
            } else if !run.outstanding.isEmpty {
                Button { Task { await confirm() } } label: {
                    HStack(spacing: 10) {
                        if isSending { ProgressView().tint(Tone.returnInk) }
                        Text(isSending ? "Returning…" : (n == 0 ? "Choose batteries to return" : "Return \(n) \(n == 1 ? "battery" : "batteries")"))
                            .contentTransition(.numericText(value: Double(n)))
                    }
                    .font(.headline)
                    .foregroundStyle(n == 0 || app.writes.hasPending ? Color.secondary : Tone.returnInk)
                    .frame(maxWidth: .infinity, minHeight: 42)
                }
                .primaryButton(Tone.returning)
                .disabled(n == 0 || locked || app.writes.hasPending)
                .onChange(of: isSending) { _, sending in if sending { Haptics.press() } }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .background(.bar)
    }

    private func returnDone(_ done: ReturnDone) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(Tone.success)
            Text(done.title).font(.title2.weight(.bold)).multilineTextAlignment(.center)
            Text(doneSubtitle(done)).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Spacer()
            Button { app.groupFlow = nil } label: {
                Text("Done").font(.headline).foregroundStyle(Tone.returnInk).frame(maxWidth: .infinity, minHeight: 42)
            }
            .primaryButton(Tone.returning)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }

    private func doneSubtitle(_ done: ReturnDone) -> String {
        let base = "Confirmed by server · \(Sydney.friendly(done.at))"
        switch done.remaining {
        case .some(0): return base + " · this checkout is complete."
        case .some(let n): return base + " · \(n) still out on this checkout."
        case nil: return base
        }
    }

    // MARK: Actions

    private func reload() async {
        guard !(isSending || isPending) else { return }
        loading = true
        defer { loading = false; loaded = true }
        do {
            let latest = try await app.runs.latest(runId)
            guard let latest, latest.actorAccountId == app.user?.id else { run = nil; loadError = nil; return }
            run = latest
            loadError = nil
            let open = Set(latest.outstanding.map(\.id))
            if !preselected {
                selected = open
                preselected = true
            } else {
                selected.formIntersection(open)
            }
        } catch {
            loadError = (error as? APIFailure)?.message ?? "Couldn't load this checkout."
            app.handle(error)
        }
    }

    private func confirm() async {
        guard let shown = run, !locked, !app.writes.hasPending else { return }
        let chosen = Set(shown.outstanding.filter { selected.contains($0.id) }.map(\.id))
        guard !chosen.isEmpty else { return }
        guard chosen.count <= 100 else {
            message = "Return at most 100 batteries at a time."
            isError = true
            return
        }
        // Read the run again: only loans still out on it right now are sent.
        await reload()
        guard loadError == nil, let fresh = run else {
            message = "Couldn't read this checkout from the server just now, so nothing was sent. Check your connection and try again."
            isError = true
            return
        }
        let stillOut = fresh.outstanding.filter { chosen.contains($0.id) }
        guard stillOut.count == chosen.count else {
            let gone = chosen.count - stillOut.count
            message = "\(gone) of them came back another way meanwhile. The list is up to date — check it and confirm again."
            isError = true
            return
        }
        let items = stillOut.compactMap { item -> TeachingReturnItem? in
            guard let loan = item.loanId, let version = item.version else { return nil }
            return TeachingReturnItem(batteryId: item.batteryId, tagId: item.tagId, version: version, loanId: loan, source: TeachingSourceRef())
        }
        guard items.count == stillOut.count else {
            message = "Some of these records changed. Pull to refresh and try again."
            isError = true
            return
        }
        let id = RequestID.make()
        let payload = TeachingReturnPayload(requestId: id, runId: fresh.id, items: items)
        guard let body = WriteCenter.teachingBody(app.dataset, payload: payload) else { return }
        requestId = id
        message = nil
        let outcome = await app.writes.submit(action: "teaching_checkout", kind: "return",
                                              title: "Returning \(items.count) from “\(fresh.teachingGroup.name)”",
                                              batteryIds: items.map(\.batteryId), requestId: id, body: body,
                                              endpoint: "/api/teaching-checkouts")
        await handle(outcome)
    }

    private func retry() async {
        guard let id = requestId, let entry = app.writes.entry(id: id) else { return }
        await handle(await app.writes.retry(entry))
    }

    private func handle(_ outcome: WriteCenter.Outcome) async {
        switch outcome {
        case .confirmed(let result):
            requestId = nil
            let latest = try? await app.runs.latest(runId)
            withAnimation(.snappy) {
                done = ReturnDone(title: result.title, at: Sydney.timestamp(), remaining: latest.map { $0.outstanding.count })
            }
        case .rejected(let text), .notSent(let text):
            requestId = nil
            message = text + " Nothing was returned; the list now shows the latest records."
            isError = true
            await reload()
        case .uncertain(let text):
            message = text
            isError = true
        }
    }
}

// MARK: - Entry points

/// The Groups button on Scan, with how many group checkouts are out.
struct GroupsButton: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let open = app.runs.open.count
        Button { app.groupFlow = .hub } label: {
            HStack(spacing: 6) {
                Image(systemName: "person.3.fill").font(.footnote)
                // At the largest sizes the header keeps one line: the icon and count say enough.
                if typeSize < .xxLarge {
                    Text("Groups").font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                if open > 0 {
                    Text("\(open)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Tone.returnInk)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Tone.returning, in: .capsule)
                }
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .contentShape(Capsule())
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .buttonStyle(.plain)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .disabled(app.scan.phase == .submitting || app.scan.phase == .uncertain)
        .accessibilityLabel(open > 0 ? "Teaching groups, \(open) group \(open == 1 ? "checkout" : "checkouts") out" : "Teaching groups")
    }
}

/// On the done screen of an ordinary checkout: keep this set as a group for next time.
/// This checkout itself stays an ordinary one.
struct SaveAsGroupCard: View {
    @Environment(AppModel.self) private var app
    let summary: DoneSummary
    @State private var editing = false
    @State private var saved: TeachingGroup?

    var body: some View {
        let ids = summary.batteries.map(\.id)
        let offer = summary.kind == .checkout && ids.count >= 2 && ids.count <= 100
            && !app.inventory.groups.contains { Set($0.batteryIds) == Set(ids) }
        Group {
            if let saved {
                Label("Saved as “\(saved.name)”", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tone.success)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else if offer {
                Button { editing = true } label: {
                    Label("Save these \(ids.count) as a group", systemImage: "person.3")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .secondaryButton()
                .accessibilityHint("Next time, check out the whole set in one go. This checkout stays as it is.")
            }
        }
        .sheet(isPresented: $editing) {
            GroupEditorSheet(group: nil, presetMembers: ids, presetName: "Lab · \(Sydney.shortDay())") { group in
                saved = group
            }
        }
    }
}
