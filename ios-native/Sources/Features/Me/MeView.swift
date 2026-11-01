import SwiftUI

struct MeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var haptics = Haptics.enabled
    @State private var confirmSignOut = false

    var body: some View {
        let me = app.user
        let withMe = app.inventory.mine(me?.id)
        let responsible = app.inventory.responsible(me?.id)
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        InkView(tint: Tone.ink, animated: scenePhase == .active, shadow: false)
                            .frame(width: 64, height: 64)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(me?.displayName ?? "").font(.title2.weight(.bold))
                            Text("\(me?.roleTitle ?? "") · \(app.dataset.shortTitle)").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 8, trailing: 0))

                    HStack(spacing: 8) {
                        StatTile(value: withMe.count, title: "With me now",
                                 detail: withMe.isEmpty ? "Nothing checked out" : "Oldest \(oldest(withMe))", tint: Tone.checkout, filled: true)
                        StatTile(value: responsible.count, title: "I'm responsible for",
                                 detail: "\(responsible.filter(\.isInUse).count) out right now", tint: .primary, filled: false)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                if !withMe.isEmpty {
                    Section("With me") {
                        ForEach(withMe) { battery in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(battery.name).font(.body.weight(.semibold))
                                    Text(battery.id).font(.monoSmall).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Return") {
                                    app.scan.begin(with: battery)
                                    app.tab = .scan
                                }
                                .buttonStyle(.bordered)
                                .tint(Tone.returning)
                                .foregroundStyle(Tone.returnInk)
                            }
                        }
                    }
                }

                Section("Settings") {
                    Picker("Inventory", selection: Binding(get: { app.dataset }, set: { app.select($0) })) {
                        ForEach(Dataset.allCases) { Text($0.title).tag($0) }
                    }
                    Toggle("Haptics", isOn: $haptics)
                        .onChange(of: haptics) { Haptics.enabled = haptics }
                    LabeledContent("Server", value: app.service.client.origin.host ?? "")
                    LabeledContent("Version", value: Bundle.main.versionLabel)
                }

                Section {
                    Button("Sign out", role: .destructive) { confirmSignOut = true }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Me")
            .toolbarTitleDisplayMode(.inline)
            .confirmationDialog("Sign out of Battery Inventory?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
            } message: {
                if app.scan.hasUnsettledWork {
                    Text("An unconfirmed request stays on this iPhone and can be retried after you sign in again.")
                }
            }
        }
    }

    private func oldest(_ batteries: [BatteryRecord]) -> String {
        let dates = batteries.compactMap { Sydney.date($0.checkedOutAt) }
        guard let first = dates.min() else { return "—" }
        return Sydney.friendly(Sydney.timestamp(first)).replacingOccurrences(of: "Today, ", with: "since ")
    }
}

struct StatTile: View {
    let value: Int
    let title: String
    let detail: String
    let tint: Color
    let filled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)").font(.system(size: 40, weight: .bold, design: .rounded))
                .contentTransition(.numericText(value: Double(value)))
            Text(title).font(.subheadline.weight(.semibold))
            Text(detail).font(.caption).opacity(0.8).lineLimit(1)
        }
        .foregroundStyle(filled ? Color.white : Color.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(filled ? tint : Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
        .shadow(color: filled ? tint.opacity(0.28) : .clear, radius: 14, y: 8)
    }
}

extension Bundle {
    var versionLabel: String {
        let version = object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(version) (\(build))"
    }
}
