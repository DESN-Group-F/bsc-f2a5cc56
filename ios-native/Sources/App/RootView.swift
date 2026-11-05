import SwiftUI

@main
struct BatteryInventoryApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .task { await app.start() }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The tag sheet, Control Center and alerts only make the scene inactive; refresh after real backgrounding.
    @State private var wasInBackground = false

    var body: some View {
        ZStack {
            if let screen = app.preview, screen.isStandalone {
                PreviewStandalone(screen: screen)
            } else {
                switch app.session {
                case .checking:
                    LaunchView().transition(.opacity)
                case .signedOut:
                    SignInView().transition(.opacity)
                case .signedIn:
                    MainTabs().transition(.opacity)
                }
            }
        }
        .overlay { TravellingInk() }
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.9), value: app.session)
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { wasInBackground = true }
            if phase == .active && wasInBackground {
                wasInBackground = false
                Task { await app.refreshAll() }
            }
        }
        .task(id: scenePhase) {
            // Gentle background refresh while the app is open.
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                app.inventory.clockTick += 1
                guard !Task.isCancelled, app.user != nil, app.scan.phase == .scanning, !app.scan.readerActive,
                      app.registration == nil else { continue }
                await app.inventory.refresh()
            }
        }
    }
}

/// The one Ink that moves between screens. Each screen reports where its own Ink sits (window
/// coordinates); during a hand-over this Ink flies between those places and the screens hide theirs.
struct TravellingInk: View {
    @Environment(AppModel.self) private var app
    @State private var origin: CGPoint = .zero

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            if let travel = app.travel {
                InkView(tint: travel.departed ? app.scan.tint : Tone.success, mood: travel.departed ? .idle : .happy)
                    .frame(width: travel.baseSide, height: travel.baseSide)
                    .scaleEffect(travel.frame.width / travel.baseSide)
                    .position(x: travel.frame.midX - origin.x, y: travel.frame.midY - origin.y)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .onGeometryChange(for: CGPoint.self) { $0.frame(in: .global).origin } action: { origin = $0 }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension View {
    /// Reports where this screen's Ink sits so the travelling Ink can land exactly on it.
    @MainActor
    func inkAnchor(_ stage: InkStage, in app: AppModel) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { app.inkAnchors[stage] = $0 }
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.tab) {
            Tab("Scan", systemImage: "viewfinder", value: AppTab.scan) {
                ScanView()
            }
            Tab("Inventory", systemImage: "square.stack.3d.up", value: AppTab.inventory) {
                InventoryView()
            }
            Tab("Inbox", systemImage: "tray", value: AppTab.inbox) {
                InboxView()
            }
            .badge(app.inbox.unreadCount)
            Tab("Me", systemImage: "person.crop.circle", value: AppTab.me) {
                MeView()
            }
        }
        .sheet(item: $app.registration) { request in
            RegisterBatteryView(request: request)
        }
        .sheet(item: $app.groupFlow) { flow in
            GroupFlowSheet(flow: flow)
        }
        .sheet(item: $app.lookup) { presentation in
            LookupSheet(presentation: presentation)
        }
        .fullScreenCover(item: $app.labelScan) { purpose in
            LabelScannerSheet(purpose: purpose)
        }
    }
}

/// Only seen when there is no saved session to open (first launch after an update, or the saved
/// copy is gone) while the server is asked. If the server can't be reached, it says so and offers
/// to try again rather than signing anyone out.
struct LaunchView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dropped = false
    @State private var retrying = false

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 22) {
                InkView(tint: Tone.adaptiveInk(colorScheme), mood: app.launchError == nil ? .idle : .puzzled,
                        reaction: dropped ? 1 : 0)
                    .frame(width: 150, height: 150)
                    .scaleEffect(dropped || reduceMotion ? 1 : 0.35)
                    .opacity(dropped ? 1 : 0)
                    .offset(y: dropped || reduceMotion ? 0 : -40)
                if let error = app.launchError {
                    VStack(spacing: 14) {
                        Text(error)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button {
                            retrying = true
                            Task {
                                await app.checkSession()
                                retrying = false
                            }
                        } label: {
                            HStack(spacing: 8) {
                                if retrying { ProgressView() }
                                Text(retrying ? "Trying…" : "Try again")
                            }
                            .font(.headline)
                            .padding(.horizontal, 22)
                            .frame(height: 48)
                        }
                        .buttonStyle(.glass)
                        .disabled(retrying)
                    }
                    .padding(.horizontal, 40)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .animation(.snappy, value: app.launchError)
        }
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.62)) { dropped = true }
        }
    }
}

/// Write screens shown on their own for simulator screenshots (preview mode only).
struct PreviewStandalone: View {
    @Environment(AppModel.self) private var app
    let screen: PreviewScreen
    @State private var filter = InventoryFilter()

    var body: some View {
        switch screen {
        case .register:
            RegisterBatteryView(request: RegistrationRequest())
        case .registerReview:
            RegisterBatteryView(request: RegistrationRequest(), previewReview: true)
        case .registerStorage:
            RegisterBatteryView(request: RegistrationRequest(), previewBuilding: "E10")
        case .inspection:
            if let battery = app.inventory.battery(id: "BAT-00000012") { InspectionSheet(battery: battery) }
        case .retire:
            RetireSheet(batteryIds: ["BAT-00000009", "BAT-00000010"])
        case .groupEditor:
            GroupEditorSheet(group: app.inventory.groups.first)
        case .groupsHub:
            GroupFlowSheet(flow: .hub)
        case .groupCheckout, .groupCheckoutFilled:
            GroupFlowSheet(flow: .checkout(groupId: PreviewFixtures.groupId))
        case .groupCheckoutOpen:
            GroupFlowSheet(flow: .checkout(groupId: PreviewFixtures.roboticsId))
        case .groupReturn:
            GroupFlowSheet(flow: .returnRun(runId: PreviewFixtures.runId))
        case .lookup:
            LookupSheet(presentation: PreviewFixtures.lookupPresentation)
        case .labelScan:
            LabelScannerSheet(purpose: .lookUp)
        case .filter:
            InventoryFilterSheet(filter: $filter)
        case .inkPlayground:
            NavigationStack { InkPlaygroundView() }
        case .inkMotion:
            InkMotionDemo()
        case .newModel:
            NewModelSheet(prefill: {
                var details = RegistrationDetails()
                details.model = "R-Line 1550 4S"
                details.chemistry = "LiPo"
                details.capacity = 1550
                details.voltage = 14.8
                return details
            }()) { _ in }
        default:
            EmptyView()
        }
    }
}

/// Preview only: plays Ink's reactions on a fixed schedule so screenshots can capture the motion.
struct InkMotionDemo: View {
    @State private var mood: InkMood = .idle
    @State private var reaction = 0
    @State private var gaze: CGPoint?

    var body: some View {
        VStack(spacing: 24) {
            Text(caption).font(.headline).foregroundStyle(.secondary)
            InkView(tint: mood == .happy ? Tone.success : (mood == .surprised ? Tone.failure : Tone.checkout),
                    mood: mood, reaction: reaction, gaze: gaze)
                .frame(width: 240, height: 240)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .task {
            // t = 0.0 launch · 1.0 accepted (hop + splash) · 3.0 look left · 3.6 duplicate · 5.4 refused
            try? await Task.sleep(for: .seconds(1.0))
            mood = .happy; reaction += 1
            try? await Task.sleep(for: .seconds(1.2))
            mood = .idle
            try? await Task.sleep(for: .seconds(0.8))
            gaze = CGPoint(x: -0.9, y: 0.2)
            try? await Task.sleep(for: .seconds(0.6))
            gaze = nil
            mood = .puzzled; reaction += 1
            try? await Task.sleep(for: .seconds(1.8))
            mood = .surprised; reaction += 1
            try? await Task.sleep(for: .seconds(1.6))
            mood = .idle
        }
    }

    private var caption: String {
        switch mood {
        case .happy: return "Accepted"
        case .puzzled: return "Duplicate"
        case .surprised: return "Refused"
        default: return "Idle"
        }
    }
}
