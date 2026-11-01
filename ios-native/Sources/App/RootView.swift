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

    var body: some View {
        ZStack {
            switch app.session {
            case .checking:
                LaunchView().transition(.opacity)
            case .signedOut:
                SignInView().transition(.opacity)
            case .signedIn:
                MainTabs().transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 1.03)), removal: .opacity))
            }
        }
        .environment(\.heroNamespace, hero)
        .animation(.spring(response: 0.7, dampingFraction: 0.86), value: app.session)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await app.refreshAll() } }
        }
        .task(id: scenePhase) {
            // Gentle background refresh while the app is open.
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                guard !Task.isCancelled, app.scan.phase == .scanning, !app.scan.readerActive else { continue }
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
