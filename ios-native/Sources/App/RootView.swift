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
    @Namespace private var hero
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
                    MainTabs().transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 1.03)), removal: .opacity))
                }
            }
        }
        .environment(\.heroNamespace, hero)
        .animation(.spring(response: 0.7, dampingFraction: 0.86), value: app.session)
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
                guard !Task.isCancelled, app.scan.phase == .scanning, !app.scan.readerActive, app.registration == nil else { continue }
                await app.inventory.refresh()
            }
        }
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
    }
}

struct LaunchView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.heroNamespace) private var hero
    @State private var dropped = false

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            InkView(tint: Tone.adaptiveInk(colorScheme), reaction: dropped ? 1 : 0)
                .frame(width: 150, height: 150)
                .heroInk(hero)
                .scaleEffect(dropped ? 1 : 0.35)
                .opacity(dropped ? 1 : 0)
                .offset(y: dropped ? 0 : -40)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.62)) { dropped = true }
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
        case .inspection:
            if let battery = app.inventory.battery(id: "BAT-00000012") { InspectionSheet(battery: battery) }
        case .retire:
            RetireSheet(batteryIds: ["BAT-00000009", "BAT-00000010"])
        case .groupEditor:
            GroupEditorSheet(group: app.inventory.groups.first)
        case .filter:
            InventoryFilterSheet(filter: $filter)
        case .inkPlayground:
            NavigationStack { InkPlaygroundView() }
        case .inkMotion:
            InkMotionDemo()
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
