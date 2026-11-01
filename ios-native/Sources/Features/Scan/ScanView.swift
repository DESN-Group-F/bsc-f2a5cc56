import SwiftUI

struct ScanView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @Namespace private var segment
    @State private var gaze: CGPoint?
    @State private var gazeToken = 0
    @State private var inkFrame: CGRect = .zero

    private var scan: ScanModel { app.scan }
    private var isDone: Bool { if case .done = scan.phase { return true } else { return false } }
    private var hasList: Bool { !scan.items.isEmpty && !isDone }
    private var stageSpring: Animation { .spring(response: 0.55, dampingFraction: 0.82) }

    var body: some View {
        @Bindable var scan = app.scan
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 16)
                .padding(.top, 4)
            modePicker
                .padding(.horizontal, 16)
                .padding(.top, 14)
            stage
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background { backdrop }
        .coordinateSpace(.named("scan"))
        .safeAreaInset(edge: .bottom, spacing: 0) { dock.padding(.horizontal, 16).padding(.bottom, 8) }
        .animation(stageSpring, value: scan.items.count)
        .animation(stageSpring, value: scan.phase)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: scan.notice)
        .sheet(isPresented: $scan.showChooser) {
            ChooseBatteriesView()
                .presentationDetents([.medium, .large])
                .presentationBackground(.regularMaterial)
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
        HStack {
            DatasetMenu()
            Spacer()
            if app.inventory.loading {
                ProgressView().controlSize(.small)
                    .frame(width: 40, height: 40)
            }
        }
    }

    private var modePicker: some View {
        HStack(spacing: 0) {
            ForEach(MovementKind.allCases) { kind in
                Button {
                    scan.setMode(kind)
                } label: {
                    HStack(spacing: 8) {
                        Circle().fill(kind.tint).frame(width: 8, height: 8)
                        Text(kind.title)
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(scan.mode == kind ? Color.primary : Color.secondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 38)
                    .background {
                        if scan.mode == kind {
                            Capsule()
                                .fill(Color(.secondarySystemGroupedBackground))
                                .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
                                .matchedGeometryEffect(id: "selected", in: segment)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(scan.mode == kind ? .isSelected : [])
            }
        }
        .padding(4)
        .glassEffect(.regular, in: .capsule)
        .animation(.spring(response: 0.38, dampingFraction: 0.78), value: scan.mode)
        .disabled(scan.phase != .scanning)
    }

    // MARK: Stage

    @ViewBuilder
    private var stage: some View {
        let inkSize: CGFloat = isDone ? 150 : (hasList ? 96 : 210)
        VStack(spacing: 0) {
            Button {
                scan.tapInk()
            } label: {
                InkView(tint: scan.tint, mood: scan.mood, reaction: scan.reaction, gaze: gaze,
                        animated: scenePhase == .active)
                    .frame(width: inkSize, height: inkSize)
                    .overlay {
                        if scan.readerActive { ListeningRings(tint: scan.mode.tint) }
                    }
            }
            .buttonStyle(InkPressStyle())
            .accessibilityLabel(scan.readerActive ? "Reader is open" : "Scan a battery tag")
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("scan")) } action: { inkFrame = $0 }
            .padding(.top, hasList ? 18 : (isDone ? 44 : 64))

            statusSlot
                .padding(.horizontal, 24)
                .padding(.top, hasList ? 10 : 22)

            if isDone, case let .done(summary) = scan.phase {
                DoneSummaryView(summary: summary)
                    .padding(.horizontal, 16)
                    .padding(.top, 20)
                    .transition(.asymmetric(insertion: .scale(scale: 0.96).combined(with: .opacity), removal: .opacity))
            } else if hasList {
                itemList
                    .transition(.opacity)
            } else {
                alternatives
                    .padding(.top, 26)
                    .transition(.opacity)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var statusSlot: some View {
        ZStack {
            if let notice = scan.notice {
                NoticeCapsule(notice: notice) {
                    if notice.actionTitle == "Register" { app.tab = .inventory }
                }
                .id(notice.id)
                .transition(.scale(scale: 0.9).combined(with: .opacity))
            } else if isDone {
                EmptyView()
            } else if hasList {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(scan.items.count) \(scan.items.count == 1 ? "battery" : "batteries")")
                        .font(.title3.weight(.bold))
                        .contentTransition(.numericText(value: Double(scan.items.count)))
                    if let latest = scan.latestId {
                        Text("Added \(latest)").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .transition(.opacity)
            } else {
                VStack(spacing: 6) {
                    Text(app.dataset.allowsNFCWrites ? "Tap me to scan" : "Pick from the list")
                        .font(.title.weight(.bold))
                    Text(app.dataset.allowsNFCWrites
                         ? "Hold the top of your iPhone near a battery tag. Keep going — nothing is saved until you confirm."
                         : "Tag scanning is Demo-only for now. Choose batteries, then confirm.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .transition(.opacity)
            }
        }
        .frame(minHeight: 32)
    }

    private var alternatives: some View {
        HStack(spacing: 10) {
            Button { scan.showChooser = true } label: {
                Label("Choose from list", systemImage: "list.bullet")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16)
                    .frame(height: 40)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
    }

    private var itemList: some View {
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
    }

    // MARK: Dock

    @ViewBuilder
    private var dock: some View {
        switch scan.phase {
        case .uncertain:
            UncertainCard()
        case .done:
            VStack(spacing: 4) {
                Button { scan.scanMore() } label: {
                    Text("Scan more").font(.headline).frame(maxWidth: .infinity).frame(height: 54)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color(.systemBackground))
                .background(Color.primary, in: .capsule)
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
                    ConfirmButton()
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

// MARK: - Pieces

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

    var body: some View {
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
    /// Toolbars already supply glass; use false there.
    var glass = true

    var body: some View {
        Menu {
            Picker("Inventory", selection: Binding(get: { app.dataset }, set: { app.select($0) })) {
                ForEach(Dataset.allCases) { Text($0.title).tag($0) }
            }
            if app.scan.hasUnsettledWork {
                Text("Finish the open confirmation before switching.")
            }
        } label: {
            HStack(spacing: 6) {
                Circle().fill(app.dataset == .demo ? Color.purple : Tone.success).frame(width: 8, height: 8)
                Text(app.dataset.title).font(.subheadline.weight(.semibold))
                Image(systemName: "chevron.down").font(.caption.weight(.bold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, glass ? 14 : 4)
            .frame(height: 38)
            .interactiveGlass(glass)
        }
        .accessibilityLabel("Inventory: \(app.dataset.title)")
    }
}

struct NoticeCapsule: View {
    let notice: ScanModel.Notice
    var action: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
            Text(notice.text).lineLimit(2)
            if let title = notice.actionTitle {
                Button(title, action: action)
                    .font(.footnote.weight(.bold))
                    .buttonStyle(.borderedProminent)
                    .tint(Tone.failure)
                    .controlSize(.small)
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(notice.kind == .refused ? Tone.failure : Color.primary)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(background, in: .capsule)
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch notice.kind {
        case .duplicate: return "questionmark.circle"
        case .refused: return "exclamationmark.circle"
        case .info: return "arrow.triangle.2.circlepath"
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
            BatteryGlyph(tint: mode == .checkout ? Tone.checkout : Color(red: 0.54, green: 0.38, blue: 0))
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(item.battery.name).font(.body.weight(.semibold)).lineLimit(1)
                    Text(item.battery.id).font(.mono).foregroundStyle(.secondary)
                }
                Text(item.battery.specLine).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            Label(readyText, systemImage: "checkmark")
                .labelStyle(.titleAndIcon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Tone.success)
            Button(action: onRemove) {
                Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(item.battery.id) from the list")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
    }

    private var readyText: String {
        mode == .checkout ? "In store" : (item.battery.borrowerAccountId == myAccountId ? "Yours" : "Ready")
    }
}

struct ConfirmButton: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let scan = app.scan
        let submitting = scan.phase == .submitting
        Button {
            Task { await scan.confirm() }
        } label: {
            HStack(spacing: 10) {
                if submitting { ProgressView().tint(scan.mode.onTint) }
                Text(submitting ? scan.mode.progressTitle : scan.mode.confirmTitle(count: scan.items.count))
                    .contentTransition(.numericText(value: Double(scan.items.count)))
            }
            .font(.headline)
            .foregroundStyle(scan.mode.onTint)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(scan.mode.tint).interactive(), in: .capsule)
        .disabled(submitting)
        .sensoryFeedback(.impact(weight: .medium), trigger: submitting) { _, new in new }
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
        .disabled(rooms.isEmpty)
    }
}

struct UncertainCard: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let scan = app.scan
        let entry = scan.pendingWrites.first
        VStack(alignment: .leading, spacing: 10) {
            Label("Not confirmed yet", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                .font(.headline)
            Text(description(entry))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let error = scan.submissionError {
                Text(error).font(.footnote).foregroundStyle(.secondary)
            }
            Button {
                Task { await scan.retryPending() }
            } label: {
                HStack {
                    if scan.phase == .submitting { ProgressView() }
                    Text(scan.phase == .submitting ? "Checking…" : "Try again")
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(Color.primary.opacity(0.08)).interactive(), in: .capsule)
            .disabled(scan.phase == .submitting || app.user == nil)
        }
        .padding(18)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
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
