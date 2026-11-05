import SwiftUI

struct ScanView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @Namespace private var segment
    @State private var gaze: CGPoint?
    @State private var gazeToken = 0
    @State private var inkFrame: CGRect = .zero
    /// A scanned battery is in several groups: which one to check out.
    @State private var groupChoice: [TeachingGroup] = []
    /// Where the next action's text comes in from: the side of the action picked or swiped to.
    @State private var modeEdge: Edge = .trailing
    /// The stage follows a horizontal swipe a little, so it feels like turning a page.
    @State private var swipeX: CGFloat = 0

    private var scan: ScanModel { app.scan }
    private var isDone: Bool { if case .done = scan.phase { return true } else { return false } }
    private var hasList: Bool { scan.hasList && !isDone }
    private var stageSpring: Animation { .spring(response: 0.55, dampingFraction: 0.82) }

    var body: some View {
        @Bindable var scan = app.scan
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .rise(app.stageShown, order: 0)
            modePicker
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .rise(app.stageShown, order: 1)
            if scan.mode == .register && !isDone {
                BatchDetailsCard()
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            stage
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background { backdrop }
        // Anywhere above the dock, including the empty backdrop: a sideways swipe changes action.
        .simultaneousGesture(modeSwipe, including: canSwipe ? .all : .subviews)
        .coordinateSpace(.named("scan"))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            dock.padding(.horizontal, 16).padding(.bottom, 8)
                .background(alignment: .top) { dockBackdrop }
        }
        .animation(stageSpring, value: scan.items.count)
        .animation(stageSpring, value: scan.intakeEntries.count)
        .animation(stageSpring, value: scan.mode)
        .animation(stageSpring, value: scan.phase)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: scan.notice)
        .sheet(isPresented: $scan.showChooser) {
            ChooseBatteriesView()
                .presentationDetents([.medium, .large])
                .presentationBackground(.regularMaterial)
        }
        .sheet(isPresented: $scan.showBatchDetails) {
            BatchDetailsSheet()
        }
        .confirmationDialog(switchTitle, isPresented: Binding(get: { scan.modeSwitch != nil }, set: { if !$0 { scan.modeSwitch = nil } }),
                            titleVisibility: .visible, presenting: scan.modeSwitch) { kind in
            let fit = scan.carryCount(to: kind)
            if fit > 0 {
                Button(fit == scan.items.count ? "Move \(fit) to \(kind.title)" : "Move the \(fit) that fit to \(kind.title)") {
                    withAnimation(stageSpring) { scan.switchMode(to: kind, keepingList: true) }
                }
            }
            Button("Clear the list and switch", role: .destructive) {
                withAnimation(stageSpring) { scan.switchMode(to: kind, keepingList: false) }
            }
        } message: { kind in
            Text(switchMessage(kind))
        }
        .confirmationDialog("Check out which group?", isPresented: Binding(get: { !groupChoice.isEmpty }, set: { if !$0 { groupChoice = [] } }),
                            titleVisibility: .visible) {
            ForEach(groupChoice) { group in
                Button(group.name) { openGroupCheckout(group.id) }
            }
        } message: {
            Text("This battery is in more than one of your groups. The list is cleared and the group's review opens; nothing is checked out until you confirm there.")
        }
        .task { await scan.reconcileUncertain() }

        .onChange(of: app.writes.pending.count) { Task { await scan.reconcileUncertain() } }
    }

    private var switchTitle: String {
        guard let kind = scan.modeSwitch else { return "" }
        return "Switch to \(kind.title)?"
    }

    private func switchMessage(_ kind: MovementKind) -> String {
        let n = scan.items.count, fit = scan.carryCount(to: kind)
        let list = "\(n) \(n == 1 ? "battery is" : "batteries are") in the list."
        if kind == .register {
            return list + " Registering new tags is a separate batch, so the list has to be cleared first."
        }
        if fit == 0 {
            switch kind {
            case .retire: return list + " Batteries on loan have to be returned before they can be retired."
            case .return: return list + " None of them is out, so there's nothing to return."
            default: return list + " None of them is in store."
            }
        }
        return fit == n ? list + " Nothing is sent until you confirm." : list + " \(fit) can move to \(kind.title); the rest can't."
    }

    /// A solid fade behind the dock, so list rows scrolling underneath never show through its controls.
    @ViewBuilder
    private var dockBackdrop: some View {
        if hasList || isDone || scan.phase == .uncertain {
            LinearGradient(stops: [.init(color: Color(.systemGroupedBackground).opacity(0), location: 0),
                                   .init(color: Color(.systemGroupedBackground), location: 0.22)],
                           startPoint: .top, endPoint: .bottom)
                .padding(.top, -28)
                .ignoresSafeArea(edges: .bottom)
                .allowsHitTesting(false)
        }
    }

    // MARK: Backdrop

    private var backdrop: some View {
        Color(.systemGroupedBackground)
            .overlay(alignment: .top) {
                Circle()
                    .fill(scan.tint.opacity(0.22))
                    .frame(width: 440, height: 440)
                    .blur(radius: 70)
                    .offset(y: hasList ? -120 : (isDone ? 20 : 0))
                    .animation(.easeInOut(duration: 0.5), value: scan.tint)
                    .allowsHitTesting(false)
            }
            .clipped()
            .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture(coordinateSpace: .named("scan")) { location in look(at: location) }
    }

    private func look(at location: CGPoint) {
        guard inkFrame.width > 0 else { return }
        let dx = (location.x - inkFrame.midX) / max(inkFrame.width, 1)
        let dy = (location.y - inkFrame.midY) / max(inkFrame.height, 1)
        gaze = CGPoint(x: max(-1, min(1, dx * 1.6)), y: max(-1, min(1, dy * 1.6)))
        gazeToken += 1
        let token = gazeToken
        Task {
            try? await Task.sleep(for: .seconds(1.3))
            if token == gazeToken { gaze = nil }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 10) {
            DatasetMenu()
            Spacer()
            if app.inventory.loading && app.inventory.snapshot == nil {
                ProgressView().controlSize(.small)
                    .frame(width: 40, height: 40)
            }
            if scan.mode == .checkout || scan.mode == .return {
                GroupsButton()
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
        }
        .animation(.snappy, value: scan.mode)
    }

    /// Takes the scan suggestion: the list is cleared and the group's own review opens.
    private func openGroupCheckout(_ id: String) {
        groupChoice = []
        scan.dismissNotice()
        scan.clear()
        app.groupFlow = .checkout(groupId: id)
    }

    private func takeNoticeAction(_ notice: ScanModel.Notice) {
        switch notice.action {
        case .register:
            scan.dismissNotice()
            scan.registerUnregisteredTag()
        case .groupCheckout(let ids):
            let groups = ids.compactMap { id in app.inventory.groups.first { $0.id == id } }
            if groups.count == 1 { openGroupCheckout(groups[0].id) } else if groups.count > 1 { groupChoice = groups } else { scan.dismissNotice() }
        case .returnRun(let id):
            scan.dismissNotice()
            scan.clear()
            app.groupFlow = .returnRun(runId: id)
        case nil:
            scan.dismissNotice()
        }
    }

    private var modePicker: some View {
        HStack(spacing: 0) {
            ForEach(MovementKind.allCases) { kind in
                let selected = scan.mode == kind
                Button {
                    pick(kind)
                } label: {
                    HStack(spacing: 5) {
                        Circle().fill(selected ? kind.onTint.opacity(0.85) : kind.tint).frame(width: 7, height: 7)
                        Text(kind.title).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .font(.footnote.weight(selected ? .bold : .semibold))
                    .foregroundStyle(selected ? kind.onTint : Color.secondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background {
                        // The chosen action is a solid pill in its own colour, so it stands out from
                        // the tinted backdrop and the glass around it.
                        if selected {
                            Capsule()
                                .fill(kind.tint)
                                .shadow(color: kind.tint.opacity(0.35), radius: 8, y: 3)
                                .matchedGeometryEffect(id: "selected", in: segment)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(scan.mode == kind ? .isSelected : [])
            }
        }
        .padding(3)
        .glassEffect(.regular, in: .capsule)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .animation(.spring(response: 0.38, dampingFraction: 0.78), value: scan.mode)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Action")
        .accessibilityHint("Swipe the screen left or right, or pick an action.")
        .disabled(scan.phase == .submitting || scan.phase == .uncertain)
    }

    // MARK: Stage

    @ViewBuilder
    private var stage: some View {
        let inkSize: CGFloat = isDone ? 150 : (hasList ? 96 : (typeSize.isAccessibilitySize ? 150 : 210))
        VStack(spacing: 0) {
            // The tag sheet makes the scene inactive while Ink is still visible above it, so only
            // pause in the background or on another tab. Ink is drawn at one size and scaled, so
            // the shader never sees a half-animated frame while the stage resizes.
            InkView(tint: scan.tint, mood: scan.mood, reaction: scan.reaction, gaze: gaze,
                    animated: scenePhase != .background && app.tab == .scan, interactive: true) {
                scan.tapInk()
            }
            .frame(width: 210, height: 210)
            .scaleEffect(inkSize / 210)
            .frame(width: inkSize, height: inkSize)
            .inkAnchor(.scan, in: app)
            .opacity(app.travel == nil ? 1 : 0)
            .overlay {
                if scan.readerActive { ListeningRings(tint: scan.mode.tint).allowsHitTesting(false) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(scan.readerActive ? "Reader is open" : (scan.mode == .register ? "Scan new battery tags" : "Scan a battery tag"))
            .accessibilityAction { scan.tapInk() }
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("scan")) } action: { inkFrame = $0 }
            .padding(.top, hasList ? 18 : (isDone ? 44 : 64))

            statusSlot
                .dynamicTypeSize(...DynamicTypeSize.accessibility2)
                .padding(.horizontal, 24)
                .padding(.top, hasList ? 10 : 22)
                .offset(x: swipeX)
                .rise(app.stageShown, order: 2)

            if isDone, case let .done(summary) = scan.phase {
                ScrollView {
                    DoneSummaryView(summary: summary)
                        .padding(.horizontal, 16)
                        .padding(.top, 20)
                        .padding(.bottom, 16)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollIndicators(.hidden)
                .transition(.asymmetric(insertion: .scale(scale: 0.96).combined(with: .opacity), removal: .opacity))
            } else if hasList {
                itemList
                    .transition(.opacity)
            } else {
                alternatives
                    .padding(.top, 26)
                    .offset(x: swipeX)
                    .rise(app.stageShown, order: 3)
                    .transition(.opacity)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Changing action

    /// Swiping between actions works while nothing is in progress: no list, reader closed, nothing sending.
    /// With a list, the picker still works and asks what to do with the list.
    private var canSwipe: Bool {
        !hasList && !scan.readerActive && (scan.phase == .scanning || isDone)
    }

    private var modeSwipe: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                let dx = value.translation.width, dy = value.translation.height
                guard abs(dx) > abs(dy) else { return }
                let index = MovementKind.allCases.firstIndex(of: scan.mode) ?? 0
                let atEdge = (dx > 0 && index == 0) || (dx < 0 && index == MovementKind.allCases.count - 1)
                swipeX = dx * (atEdge ? 0.12 : 0.3)
            }
            .onEnded { value in
                let dx = value.translation.width, dy = value.translation.height
                let flung = abs(value.predictedEndTranslation.width) > 180
                if abs(dx) > abs(dy) * 1.5 && (abs(dx) > 70 || flung) {
                    step(dx < 0 ? 1 : -1)
                }
                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { swipeX = 0 }
            }
    }

    /// The next (1) or previous (-1) action, in the picker's order.
    private func step(_ delta: Int) {
        let all = MovementKind.allCases
        guard let index = all.firstIndex(of: scan.mode) else { return }
        let next = index + delta
        guard all.indices.contains(next) else { return }
        pick(all[next])
    }

    private func pick(_ kind: MovementKind) {
        let all = MovementKind.allCases
        if let from = all.firstIndex(of: scan.mode), let to = all.firstIndex(of: kind) {
            modeEdge = to > from ? .trailing : .leading
        }
        scan.setMode(kind)
    }

    @ViewBuilder
    private var statusSlot: some View {
        VStack(spacing: 8) {
            if isDone {
                EmptyView()
            } else if hasList {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(countTitle)
                        .font(.title3.weight(.bold))
                        .contentTransition(.numericText(value: Double(scan.listCount)))
                    if scan.notice == nil, !typeSize.isAccessibilitySize, let latest = scan.latestId {
                        Text("Added \(latest)").font(.subheadline).foregroundStyle(.secondary)
                            .transition(.opacity)
                    }
                }
            } else {
                // Each action's words slide in from the side it was picked or swiped from.
                VStack(spacing: 8) {
                    Text(emptyTitle)
                        .font(.title.weight(.bold))
                    if scan.notice == nil {
                        Text(emptyMessage)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .transition(.opacity)
                    }
                }
                .id(scan.mode)
                .transition(.push(from: modeEdge))
            }
            if let notice = scan.notice {
                NoticeCapsule(notice: notice, tint: noticeTint(notice), onTint: notice.action.map(noticeOnTint) ?? .white) {
                    takeNoticeAction(notice)
                } onDismiss: {
                    scan.dismissNotice()
                }
                .id(notice.id)
                .transition(.scale(scale: 0.92).combined(with: .opacity))
            }
        }
        .frame(minHeight: 32)
    }

    private func noticeTint(_ notice: ScanModel.Notice) -> Color {
        switch notice.action {
        case .groupCheckout: return Tone.checkout
        case .returnRun: return Tone.returning
        default: return Tone.failure
        }
    }

    private func noticeOnTint(_ action: ScanModel.NoticeAction) -> Color {
        if case .returnRun = action { return Tone.returnInk }
        return .white
    }

    private var alternatives: some View {
        // At accessibility sizes the two choices stack instead of squeezing.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            Button {
                if scan.mode == .register { app.registration = RegistrationRequest() } else { scan.showChooser = true }
            } label: {
                Label(scan.mode == .register ? "One battery with the form" : "Choose from list",
                      systemImage: scan.mode == .register ? "square.and.pencil" : "list.bullet")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 6)
            }
            .secondaryButton()
            .controlSize(.regular)
            if scan.mode != .register && scan.canLookUp {
                Button { scan.startLookup() } label: {
                    Label("Look up", systemImage: "sensor.tag.radiowaves.forward")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 6)
                }
                .secondaryButton()
                .controlSize(.regular)
                .accessibilityHint("Scan tags to see batteries' details. Nothing changes.")
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }

    private var emptyTitle: String {
        let nfc = app.allowsNFC(scan.mode.nfcOperation)
        switch scan.mode {
        case .register: return nfc ? "Scan new batteries" : "Register a battery"
        case .retire: return nfc ? "Scan to retire" : "Pick from the list"
        default: return nfc ? "Tap me to scan" : "Pick from the list"
        }
    }

    private var emptyMessage: String {
        let nfc = app.allowsNFC(scan.mode.nfcOperation)
        switch scan.mode {
        case .register:
            return nfc ? "Set the batch details above, tap me, then hold your iPhone near each new tag. Nothing is registered until you confirm."
                : "Tag scanning isn't turned on for this inventory yet. Tap me to register one battery at a time with the form."
        case .retire:
            return nfc ? "Tap me, then hold your iPhone near each battery you're taking out of service. Nothing changes until you confirm."
                : "Tag scanning isn't turned on for this inventory yet. Choose batteries, then confirm."
        default:
            return nfc ? "Hold the top of your iPhone near a battery tag. Keep going — nothing is saved until you confirm."
                : "Tag scanning isn't turned on for this inventory yet. Choose batteries, then confirm."
        }
    }

    private var countTitle: String {
        let n = scan.listCount
        if scan.mode == .register { return "\(n) new \(n == 1 ? "tag" : "tags")" }
        return "\(n) \(n == 1 ? "battery" : "batteries")"
    }

    @ViewBuilder
    private var itemList: some View {
        if scan.mode == .register {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(scan.intakeEntries) { entry in
                        IntakeEntryCard(entry: entry, name: scan.intakeDetails.name.jsTrimmed,
                                        sending: scan.phase == .submitting) {
                            withAnimation(stageSpring) { scan.removeIntake(entry) }
                        }
                        .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity),
                                                removal: .scale(scale: 0.9).combined(with: .opacity)))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .mask(TopFadeMask())
        } else {
            movementList
        }
    }

    private var movementList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(scan.items) { item in
                    ScanItemCard(item: item, mode: scan.mode, myAccountId: app.user?.id) {
                        withAnimation(stageSpring) { scan.remove(item) }
                    }
                    .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity),
                                            removal: .scale(scale: 0.9).combined(with: .opacity)))
                    .scrollTransition(.interactive, axis: .vertical) { content, phase in
                        content
                            .scaleEffect(phase.isIdentity ? 1 : 0.96)
                            .opacity(phase.isIdentity ? 1 : 0.6)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .mask(TopFadeMask())
    }

    // MARK: Dock

    @ViewBuilder
    private var dock: some View {
        switch scan.phase {
        case .uncertain:
            UncertainCard()
        case .done(let summary):
            VStack(spacing: 4) {
                SaveAsGroupCard(summary: summary)
                    .id(summary.at)
                    .padding(.bottom, 4)
                Button { scan.scanMore() } label: {
                    Text("Scan more").font(.headline).foregroundStyle(scan.mode.onTint)
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .primaryButton(scan.mode.tint)
                Button { app.tab = .inventory } label: {
                    Text("View in Inventory").font(.body.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 44)
                }
                .buttonStyle(.plain)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .scanning, .submitting:
            if hasList {
                VStack(spacing: 8) {
                    if let error = scan.submissionError {
                        Text(error).font(.footnote).foregroundStyle(Tone.failure).multilineTextAlignment(.center)
                    }
                    if scan.mode == .return { ReturnRoomMenu() }
                    if scan.mode == .retire { RetireOptions() }
                    ConfirmButton()
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

// MARK: - Pieces

/// Rows fade in under the count line instead of being cut by a hard edge.
struct TopFadeMask: View {
    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 14)
            Color.black
        }
    }
}

struct InkPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// Soft rings that pulse while the system reader is open.
struct ListeningRings: View {
    let tint: Color
    @State private var expand = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion {
            Circle().stroke(tint.opacity(0.45), lineWidth: 2).scaleEffect(1.15).allowsHitTesting(false)
        } else {
            pulsing
        }
    }

    private var pulsing: some View {
        ZStack {
            ForEach(0..<2, id: \.self) { i in
                Circle()
                    .stroke(tint.opacity(0.5), lineWidth: 2)
                    .scaleEffect(expand ? 1.5 : 0.9)
                    .opacity(expand ? 0 : 0.6)
                    .animation(.easeOut(duration: 2.2).repeatForever(autoreverses: false).delay(Double(i) * 1.1), value: expand)
            }
        }
        .allowsHitTesting(false)
        .onAppear { expand = true }
    }
}

struct DatasetMenu: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dynamicTypeSize) private var typeSize
    /// Toolbars already supply glass; use false there.
    var glass = true

    var body: some View {
        Menu {
            Picker("Inventory", selection: Binding(get: { app.dataset }, set: { app.select($0) })) {
                ForEach(Dataset.allCases) { Text($0.title).tag($0) }
            }
            .disabled(app.hasUnsettledWork)
            if app.hasUnsettledWork {
                Text("Finish the open confirmation before switching.")
            }
        } label: {
            HStack(spacing: 6) {
                Circle().fill(app.dataset == .demo ? Color.purple : Tone.success).frame(width: 8, height: 8)
                Text(typeSize < .xxLarge ? app.dataset.title : app.dataset.shortTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.down").font(.caption.weight(.bold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, glass ? 14 : 4)
            .frame(minHeight: 38)
            .interactiveGlass(glass)
        }
        .tint(.primary)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityLabel("Inventory: \(app.dataset.title)")
    }
}

struct NoticeCapsule: View {
    let notice: ScanModel.Notice
    var tint: Color = Tone.failure
    var onTint: Color = .white
    var action: () -> Void
    var onDismiss: () -> Void = {}
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // At accessibility sizes the text keeps its own line and the buttons go underneath.
        let stacked = typeSize.isAccessibilitySize && notice.actionTitle != nil
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            HStack(spacing: 8) {
                Image(systemName: icon)
                Text(notice.text).lineLimit(stacked ? 4 : 2)
                    .fixedSize(horizontal: false, vertical: stacked)
            }
            if let title = notice.actionTitle {
                HStack(spacing: 8) {
                    Button(action: action) {
                        Text(title).font(.footnote.weight(.bold)).foregroundStyle(onTint).fixedSize()
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(tint)
                    .controlSize(.small)
                    Button(action: onDismiss) {
                        Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss")
                }
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(notice.kind == .refused ? Tone.failure : Color.primary)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(background, in: .rect(cornerRadius: stacked ? 22 : 40, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch notice.action {
        case .groupCheckout, .returnRun: return "person.3.fill"
        default: break
        }
        switch notice.kind {
        case .duplicate: return "questionmark.circle"
        case .refused: return "exclamationmark.circle"
        case .info: return "arrow.triangle.2.circlepath"
        case .greeting: return "hand.wave"
        }
    }

    private var background: Color {
        notice.kind == .refused ? Tone.failure.opacity(0.12) : Color(.tertiarySystemFill)
    }
}

struct ScanItemCard: View {
    let item: ScanModel.Item
    let mode: MovementKind
    let myAccountId: String?
    var onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            BatteryGlyph(tint: mode == .checkout ? Tone.checkout : (mode == .retire ? Tone.retire : Tone.returnGlyph))
            VStack(alignment: .leading, spacing: 2) {
                Text(item.battery.name).font(.body.weight(.semibold)).lineLimit(2)
                HStack(spacing: 6) {
                    Text(item.battery.id).font(.monoSmall).fixedSize()
                    if item.battery.hasSpecs {
                        Text(item.battery.specLine).font(.footnote).lineLimit(1)
                    }
                }
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Image(systemName: "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(Tone.success)
                .accessibilityLabel(readyText)
            Button(action: onRemove) {
                Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(item.battery.id) from the list")
        }
        .padding(.leading, 12)
        .padding(.trailing, 2)
        .padding(.vertical, 5)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.battery.name), \(item.battery.id), \(readyText)")
        .accessibilityAction(named: "Remove from the list", onRemove)
    }

    private var readyText: String {
        mode == .return ? (item.battery.borrowerAccountId == myAccountId ? "Yours" : "Ready") : "In store"
    }
}

struct ConfirmButton: View {
    @Environment(AppModel.self) private var app

    private var title: String {
        let scan = app.scan
        switch scan.mode {
        case .retire: return scan.retireConfirmTitle
        case .register:
            let n = scan.intakeDraftCount
            return n == 0 ? "Nothing to register" : "Register \(n) \(n == 1 ? "battery" : "batteries")"
        default: return scan.mode.confirmTitle(count: scan.items.count)
        }
    }

    private var progressTitle: String {
        let scan = app.scan
        if scan.mode == .register, let progress = scan.intakeProgress, progress.total > 1 {
            return "Registering \(progress.sent + 1) of \(progress.total)…"
        }
        return scan.mode.progressTitle
    }

    var body: some View {
        let scan = app.scan
        let submitting = scan.phase == .submitting
        Button {
            if scan.mode == .retire && scan.retireKind == "permanently_removed" {
                scan.confirmPermanent = true
            } else {
                Task { await scan.confirm() }
            }
        } label: {
            HStack(spacing: 10) {
                if submitting { ProgressView().tint(scan.mode.onTint) }
                Text(submitting ? progressTitle : title)
                    .contentTransition(.numericText(value: Double(scan.items.count)))
            }
            .font(.headline)
            .foregroundStyle(scan.mode.onTint)
            .frame(maxWidth: .infinity, minHeight: 42)
        }
        .primaryButton(scan.mode.tint)
        .disabled(submitting || (scan.mode == .register && scan.intakeDraftCount == 0))
        .onChange(of: submitting) { _, new in if new { Haptics.press() } }
        .confirmationDialog(scan.retireConfirmTitle + "?", isPresented: Bindable(scan).confirmPermanent, titleVisibility: .visible) {
            Button(scan.retireConfirmTitle, role: .destructive) { Task { await scan.confirm() } }
        } message: {
            Text("They leave the inventory for good. Their history stays, but this can't be undone in the app.")
        }
    }
}

/// Retire mode: one compact row (outcome and reason) so the list keeps its room; details open in a small sheet.
struct RetireOptions: View {
    @Environment(AppModel.self) private var app
    @State private var editing = false

    var body: some View {
        @Bindable var scan = app.scan
        HStack(spacing: 8) {
            Menu {
                Picker("Outcome", selection: $scan.retireKind) {
                    Label("Scrap", systemImage: "archivebox").tag("scrapped")
                    Label("Remove permanently", systemImage: "trash").tag("permanently_removed")
                }
            } label: {
                HStack(spacing: 6) {
                    Text(scan.retireKind == "scrapped" ? "Scrap" : "Remove permanently").fontWeight(.semibold)
                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
            }
            .tint(.primary)
            .glassEffect(.regular.interactive(), in: .capsule)

            Button { editing = true } label: {
                HStack(spacing: 8) {
                    Image(systemName: "text.bubble").foregroundStyle(.secondary)
                    Text(reasonLabel(scan)).lineLimit(1)
                        .foregroundStyle(scan.retireReason.jsTrimmed.isEmpty ? Color.secondary : Color.primary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .accessibilityLabel(scan.retireReason.jsTrimmed.isEmpty ? "Add a reason" : "Reason: \(scan.retireReason)")
        }
        .font(.subheadline)
        .disabled(scan.phase != .scanning)
        .sheet(isPresented: $editing) {
            RetireDetailsSheet()
                .presentationDetents([.medium])
        }
    }

    private func reasonLabel(_ scan: ScanModel) -> String {
        let reason = scan.retireReason.jsTrimmed
        return reason.isEmpty ? "Add a reason (optional)" : reason
    }
}

/// Outcome, reason and destination for a retire list.
struct RetireDetailsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var scan = app.scan
        NavigationStack {
            Form {
                Section {
                    Picker("Outcome", selection: $scan.retireKind) {
                        Text("Scrap").tag("scrapped")
                        Text("Remove permanently").tag("permanently_removed")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                } footer: {
                    Text(scan.retireKind == "scrapped"
                         ? "Scrapped batteries stay in the records and can be recovered later."
                         : "Permanently removed batteries leave the inventory for good. Their history is kept.")
                }
                Section("Reason (optional)") {
                    TextField(scan.retireKind == "scrapped" ? "e.g. swollen cells" : "e.g. end of life",
                              text: $scan.retireReason, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($focused)
                    if scan.retireKind == "permanently_removed" {
                        TextField("Destination (optional), e.g. recycling bin", text: $scan.retireDestination)
                    }
                }
            }
            .navigationTitle("Retire details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) }
            }
            .onAppear { focused = scan.retireReason.isEmpty }
        }
    }
}

struct ReturnRoomMenu: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let scan = app.scan
        let rooms = app.inventory.rooms(eligibleFor: app.dataset)
        Menu {
            Button("Room not specified") { scan.returnRoomId = nil }
            ForEach(rooms) { room in
                Button(room.label + ((room.isPlaceholder ?? false) ? " (placeholder)" : "")) { scan.returnRoomId = room.id }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "mappin.and.ellipse")
                Text("Put back in").foregroundStyle(.secondary)
                Text(rooms.first { $0.id == scan.returnRoomId }?.label ?? "Room not specified").fontWeight(.semibold)
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption)
            }
            .font(.subheadline)
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .frame(height: 46)
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 18))
        }
        .tint(.primary)
        .disabled(rooms.isEmpty)
    }
}

struct UncertainCard: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let scan = app.scan
        let entry = scan.pendingWrites.first
        let registering = entry == nil && scan.intakeHasUncertain
        let retiring = entry == nil && !registering && scan.retireIsPending
        VStack(alignment: .leading, spacing: 10) {
            Label("Not confirmed yet", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                .font(.headline)
            Text(registering ? "Registering a scanned tag may or may not have reached the server. Trying again sends the exact same request, so it can't be registered twice. The rest of the batch waits."
                 : (retiring ? retireDescription(scan.items.count) : description(entry)))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let error = scan.submissionError {
                Text(error).font(.footnote).foregroundStyle(.secondary)
            }
            Button {
                Task {
                    if registering { await scan.retryIntake() }
                    else if retiring { await scan.retryRetire() }
                    else { await scan.retryPending() }
                }
            } label: {
                HStack {
                    if scan.phase == .submitting { ProgressView() }
                    Text(scan.phase == .submitting ? "Checking…" : "Try again")
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 36)
            }
            .secondaryButton()
            .disabled(scan.phase == .submitting || app.user == nil)
        }
        .padding(18)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }

    private func retireDescription(_ n: Int) -> String {
        "Retiring \(n) \(n == 1 ? "battery" : "batteries") may or may not have reached the server. Trying again sends the exact same request, so it can't happen twice."
    }

    private func description(_ entry: PendingMovement?) -> String {
        guard let entry else { return "" }
        let n = entry.batteryIds.count
        let what = entry.kind == "checkout" ? "Check out" : "Return"
        return "\(what) \(n) \(n == 1 ? "battery" : "batteries") may or may not have reached the server. Trying again sends the exact same request, so it can't happen twice."
    }
}

struct DoneSummaryView: View {
    let summary: DoneSummary

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 6) {
                Text(summary.title).font(.title.weight(.bold)).multilineTextAlignment(.center)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            VStack(spacing: 0) {
                HStack {
                    Text("Confirmed by server").foregroundStyle(.secondary)
                    Spacer()
                    Text(Sydney.friendly(summary.at)).fontWeight(.semibold)
                }
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                Divider().padding(.leading, 16)
                ForEach(Array(summary.batteries.prefix(6))) { battery in
                    HStack(spacing: 12) {
                        Text(battery.id).font(.mono)
                        Text(battery.name).font(.subheadline).foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }
                if summary.batteries.count > 6 {
                    Text("and \(summary.batteries.count - 6) more").font(.footnote).foregroundStyle(.secondary).padding(.bottom, 10)
                }
            }
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
        }
    }

    private var subtitle: String {
        if summary.kind == .register {
            return (summary.note.map { "\($0) · " } ?? "") + "Each has its own permanent ID and is in store."
        }
        if summary.kind == .retire {
            let base = summary.verb == "scrapped"
                ? "Out of service, still in the records. Recover from a battery's page if needed."
                : "They've left the inventory. Their history is kept."
            return summary.note.map { "\($0) · " + base } ?? base
        }
        if summary.kind == .checkout { return "They're now listed as with you." }
        if let room = summary.roomLabel { return "Placed back in \(room)." }
        return "They're back in store."
    }
}

extension View {
    /// Interactive capsule glass, or nothing when the container already provides it.
    @ViewBuilder
    func interactiveGlass(_ enabled: Bool) -> some View {
        if enabled {
            glassEffect(.regular.interactive(), in: .capsule)
        } else {
            self
        }
    }
}


/// The shared details for a batch intake, with a quick way to change them.
struct BatchDetailsCard: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let scan = app.scan
        let details = scan.intakeDetails
        let problems = scan.intakeProblems
        Button { scan.showBatchDetails = true } label: {
            HStack(spacing: 12) {
                Image(systemName: problems.isEmpty ? "square.stack.3d.down.right" : "exclamationmark.circle")
                    .font(.headline)
                    .foregroundStyle(problems.isEmpty ? Tone.register : .orange)
                    .frame(width: 34, height: 34)
                    .background((problems.isEmpty ? Tone.register : Color.orange).opacity(0.13), in: .rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 1) {
                    Text(details.specSummary).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(problems.first ?? subtitle(details)).font(.caption).foregroundStyle(problems.isEmpty ? Color.secondary : Color.orange).lineLimit(1)
                }
                Spacer(minLength: 4)
                Text("Edit").font(.footnote.weight(.semibold)).foregroundStyle(Tone.register)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 18))
        .disabled(scan.phase != .scanning)
        .accessibilityLabel("Batch details: \(details.specSummary). Edit")
    }

    private func subtitle(_ details: RegistrationDetails) -> String {
        let owner = details.owner(in: app.inventory)?.name ?? "No owner"
        return "\(owner) · \(details.storageLine(in: app.inventory))"
    }
}

struct IntakeEntryCard: View {
    let entry: IntakeEntry
    let name: String
    /// While the batch is going out, the tag in flight shows progress rather than a question mark.
    var sending = false
    var onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            BatteryGlyph(tint: Tone.register)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold)).lineLimit(1)
                Text("Tag \(entry.uid)").font(.monoSmall).foregroundStyle(.secondary).lineLimit(1)
                if case let .failed(reason) = entry.status {
                    Text(reason).font(.caption).foregroundStyle(Tone.failure).lineLimit(2)
                }
            }
            Spacer(minLength: 4)
            statusIcon
            if entry.status != .uncertain {
                Button(action: onRemove) {
                    Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove tag \(entry.uid) from the batch")
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 2)
        .padding(.vertical, 5)
        .frame(minHeight: 58)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Remove from the batch") { if entry.status != .uncertain { onRemove() } }
    }

    private var title: String {
        if case let .registered(id) = entry.status { return "\(id) · \(name)" }
        return name.isEmpty ? "New battery" : name
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch entry.status {
        case .draft:
            Text("New").font(.caption2.weight(.bold)).foregroundStyle(Tone.register)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Tone.register.opacity(0.12), in: .capsule)
        case .registered:
            Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(Tone.success)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").font(.title3).foregroundStyle(Tone.failure)
        case .uncertain:
            if sending {
                ProgressView().controlSize(.small).frame(width: 24, height: 24)
            } else {
                Image(systemName: "questionmark.circle.fill").font(.title3).foregroundStyle(.orange)
            }
        }
    }
}

extension View {
    /// Staggered rise-in used when a screen arrives (sign-in, the scan stage after sign-in).
    /// The delay lives in the animation, so callers only flip `shown`.
    func rise(_ shown: Bool, order: Int) -> some View {
        modifier(RiseIn(shown: shown, order: order))
    }
}

private struct RiseIn: ViewModifier {
    let shown: Bool
    let order: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 16)
            .animation(reduceMotion ? .easeOut(duration: 0.2)
                       : .spring(response: 0.55, dampingFraction: 0.86).delay(0.07 * Double(order) + 0.1), value: shown)
    }
}
