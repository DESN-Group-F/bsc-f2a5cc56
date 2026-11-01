import SwiftUI

struct BatteryDetailView: View {
    @Environment(AppModel.self) private var app
    let batteryId: String
    @State private var detail: BatteryDetail?
    @State private var loadError: String?

    private var battery: BatteryRecord? { app.inventory.battery(id: batteryId) ?? detail?.battery }

    var body: some View {
        ScrollView {
            if let battery {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(battery.id).font(.mono).foregroundStyle(.secondary)
                        Text(battery.name).font(.largeTitle.weight(.bold))
                    }
                    .padding(.horizontal, 4)

                    StatusCard(battery: battery, myAccountId: app.user?.id) {
                        app.scan.begin(with: battery)
                        app.tab = .scan
                    }

                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                        Fact(title: "Chemistry", value: nonEmpty(battery.chemistry) ?? "Not recorded")
                        Fact(title: "Capacity", value: battery.capacityMah.map { "\(Int($0.rounded())) mAh" } ?? "Not recorded")
                        Fact(title: "In service", value: serviceAge(battery))
                        Fact(title: "Times borrowed", value: detail?.usageSummary?.totalCheckouts.map { String($0) } ?? "—")
                    }

                    VStack(spacing: 0) {
                        InfoRow(title: "Responsible", value: battery.ownerName ?? "Not recorded")
                        Divider().padding(.leading, 16)
                        InfoRow(title: "Home", value: battery.homeLine, note: (battery.homeRoomIsPlaceholder ?? false) ? "placeholder" : nil)
                        if let model = nonEmpty(battery.model) {
                            Divider().padding(.leading, 16)
                            InfoRow(title: "Model", value: model)
                        }
                        if let observed = battery.observedRoom {
                            Divider().padding(.leading, 16)
                            InfoRow(title: "Last seen", value: "\(observed) · \(Sydney.friendly(battery.observedAt))")
                        }
                    }
                    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))

                    history
                }
                .padding(16)
            } else if let loadError {
                ContentUnavailableView("Couldn't load", systemImage: "wifi.exclamationmark", description: Text(loadError))
                    .padding(.top, 80)
            } else {
                ProgressView().padding(.top, 120)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: battery?.version) { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private var history: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("History").font(.title3.weight(.bold)).padding(.horizontal, 4)
            if let loans = detail?.loans, !loans.isEmpty {
                VStack(spacing: 0) {
                    ForEach(timeline(loans).prefix(8)) { entry in
                        HStack(alignment: .top, spacing: 12) {
                            Circle().fill(entry.tint).frame(width: 10, height: 10).padding(.top, 6)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(entry.title).font(.body.weight(.semibold))
                                Text(Sydney.friendly(entry.at)).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    }
                }
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
            } else if detail != nil {
                Text("No check-outs yet.").font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 4)
            }
        }
    }

    private struct TimelineEntry: Identifiable {
        let id: String
        let title: String
        let at: String
        let tint: Color
    }

    private func timeline(_ loans: [LoanRecord]) -> [TimelineEntry] {
        var entries: [TimelineEntry] = []
        for loan in loans where loan.cancelledAt == nil {
            entries.append(TimelineEntry(id: loan.id + "-out", title: "Checked out by \(loan.borrowerName ?? "someone")",
                                         at: loan.checkedOutAt, tint: Tone.checkout))
            if let returned = loan.returnedAt {
                entries.append(TimelineEntry(id: loan.id + "-in", title: "Returned by \(loan.returnActorName ?? "someone")",
                                             at: returned, tint: Tone.returning))
            }
        }
        return entries.sorted { (Sydney.date($0.at) ?? .distantPast) > (Sydney.date($1.at) ?? .distantPast) }
    }

    private func load() async {
        guard app.preview == nil else { return }
        do {
            detail = try await app.service.detail(app.dataset, batteryId: batteryId)
            loadError = nil
        } catch {
            loadError = (error as? APIFailure)?.message ?? "Please try again."
            app.handle(error)
        }
    }

    private func nonEmpty(_ s: String?) -> String? { (s?.isEmpty ?? true) ? nil : s }

    private func serviceAge(_ battery: BatteryRecord) -> String {
        guard let days = Sydney.days(since: battery.firstUsedOn) else { return "Not recorded" }
        if days < 1 { return "Today" }
        if days < 60 { return "\(days) day\(days == 1 ? "" : "s")" }
        let months = days / 30
        if months < 24 { return "\(months) months" }
        return "\(months / 12) years"
    }
}

struct StatusCard: View {
    let battery: BatteryRecord
    let myAccountId: String?
    var action: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(battery.statusTitle).font(.footnote.weight(.semibold)).opacity(0.85)
                Text(headline).font(.title3.weight(.bold))
            }
            Spacer()
            if battery.isActive {
                Button(action: action) {
                    Text(battery.isInUse ? "Return" : "Check out")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(battery.isInUse ? Tone.returnInk : Tone.checkout)
                        .padding(.horizontal, 16)
                        .frame(height: 40)
                        .background(battery.isInUse ? Tone.returning : Color.white, in: .capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .foregroundStyle(.white)
        .padding(16)
        .background(background, in: .rect(cornerRadius: 22, style: .continuous))
        .shadow(color: background.opacity(0.3), radius: 14, y: 8)
    }

    private var background: Color {
        if !battery.isActive { return Tone.failure }
        return battery.isInUse ? Tone.checkout : Color(red: 0.20, green: 0.22, blue: 0.27)
    }

    private var headline: String {
        if !battery.isActive { return "Can't be checked out" }
        guard battery.isInUse else { return "Ready to check out" }
        let who = (battery.borrowerAccountId != nil && battery.borrowerAccountId == myAccountId) ? "you" : (battery.borrowerName ?? "someone")
        return "With \(who) since \(Sydney.shortTime(battery.checkedOutAt))"
    }
}

struct Fact: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).tracking(0.5)
            Text(value).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16, style: .continuous))
    }
}

struct InfoRow: View {
    let title: String
    let value: String
    var note: String? = nil

    var body: some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.semibold).multilineTextAlignment(.trailing)
            if let note { Text(note).font(.caption.weight(.semibold)).foregroundStyle(.orange) }
        }
        .font(.subheadline)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
