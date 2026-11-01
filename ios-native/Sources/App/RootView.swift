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

    var body: some View {
        ZStack {
            switch app.session {
            case .checking:
                LaunchView().transition(.opacity)
            case .signedOut:
                SignInView().transition(.opacity)
            case .signedIn:
                MainTabs().transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .animation(.smooth(duration: 0.45), value: app.session)
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

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            InkView(tint: Tone.adaptiveInk(colorScheme))
                .frame(width: 140, height: 140)
        }
    }
}
