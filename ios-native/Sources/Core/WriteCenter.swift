import Observation
import SwiftUI

/// Sends registration, retirement, inspection and teaching-group writes with the same
/// exact-request rules as the scan station: save before sending, verify the receipt,
/// and keep anything unresolved until a retry settles it.
@MainActor
@Observable
final class WriteCenter {
    enum Outcome {
        case confirmed(WriteConfirmation)
        /// Definitely not recorded. The form can be corrected and sent as a new request.
        case rejected(String)
        /// May or may not have reached the server. Only "Try again" (same bytes) is allowed.
        case uncertain(String)
        /// Never left the phone.
        case notSent(String)
    }

    weak var app: AppModel?
    private(set) var pending: [PendingWrite] = []
    private(set) var sending: Set<String> = []
    private(set) var lastError: [String: String] = [:]

    var hasPending: Bool { !pending.isEmpty }

    func load() {
        guard let app, let user = app.user else { pending = []; return }
        pending = app.pending.all(accountId: user.id, dataset: app.dataset).filter { !$0.isMovement }
    }

    func reset() {
        pending = []
        lastError = [:]
    }

    /// Saves the exact body, then sends it once.
    func submit(action: String, kind: String, title: String, batteryIds: [String], requestId: String,
                body: Data, endpoint: String? = nil) async -> Outcome {
        guard let app, let user = app.user else { return .notSent("Sign in again first.") }
        guard pending.isEmpty else {
            return .notSent("Another request is waiting for confirmation. Try it again first.")
        }
        guard !app.scan.hasUnsettledWork else {
            return .notSent("Finish the open scan confirmation first.")
        }
        let entry = PendingWrite(id: requestId, accountId: user.id, dataset: app.dataset, kind: kind,
                                 batteryIds: batteryIds, body: body, createdAt: Date(), attempts: 0,
                                 action: action, endpoint: endpoint, title: title)
        do { try app.pending.save(entry) } catch {
            return .notSent("Couldn't save the request on this iPhone, so nothing was sent.")
        }
        pending.append(entry)
        return await send(entry, isRetry: false)
    }

    func retry(_ entry: PendingWrite) async -> Outcome {
        guard !sending.contains(entry.id) else { return .uncertain("Already checking…") }
        return await send(entry, isRetry: true)
    }

    func entry(id: String) -> PendingWrite? { pending.first { $0.id == id } }

    private func send(_ entry: PendingWrite, isRetry: Bool) async -> Outcome {
        guard let app else { return .notSent("") }
        sending.insert(entry.id)
        defer { sending.remove(entry.id) }
        var attempt = entry
        attempt.attempts += 1
        try? app.pending.save(attempt)
        if let index = pending.firstIndex(where: { $0.id == entry.id }) { pending[index] = attempt }
        do {
            let data = try await app.service.client.post(entry.path, body: entry.body)
            guard let confirmation = ReceiptCheck.verify(entry, response: data) else {
                let message = "The server's answer didn't match this request. It's kept on this iPhone so you can check it."
                lastError[entry.id] = message
                return .uncertain(message)
            }
            settle(entry)
            Haptics.confirmed()
            Task { await app.inventory.refresh() }
            return .confirmed(confirmation)
        } catch let failure as APIFailure {
            switch failure.kind {
            case .rejected where !isRetry || failure.isFinalRejection || Self.definitelyRejectedOnRetry(entry, failure):
                settle(entry)
                Haptics.refused()
                Task { await app.inventory.refresh() }
                return .rejected(isRetry ? "Not recorded: \(failure.message)" : failure.message)
            case .unauthorized where !isRetry:
                // Nothing ran on this attempt.
                settle(entry)
                app.handle(failure)
                return .rejected("Your sign-in ended, so nothing was saved. Sign in and send it again.")
            default:
                lastError[entry.id] = failure.message
                app.handle(failure)
                Haptics.refused()
                return .uncertain(failure.message)
            }
        } catch {
            let message = "Couldn't confirm with the server."
            lastError[entry.id] = message
            return .uncertain(message)
        }
    }

    /// Validation failures that happen before any reservation repeat identically for the same bytes,
    /// so they settle a retried request too (mirrors the web's *FailureStatus helpers per action).
    static func definitelyRejectedOnRetry(_ entry: PendingWrite, _ failure: APIFailure) -> Bool {
        guard let status = failure.status else { return false }
        switch entry.action {
        case "lifecycle", "retired_asset", "teaching_group": return status == 400 || status == 422
        case "intake": return status == 400 || status == 404 || status == 422 || status == 501
        default: return false
        }
    }

    private func settle(_ entry: PendingWrite) {
        app?.pending.remove(id: entry.id)
        pending.removeAll { $0.id == entry.id }
        lastError[entry.id] = nil
    }

    // MARK: Encoding helpers

    static func inventoryBody<P: Encodable>(_ dataset: Dataset, action: String, payload: P) -> Data? {
        try? JSONEncoder().encode(InventoryWrite(dataset: dataset, action: action, payload: payload))
    }

    static func groupBody(_ dataset: Dataset, payload: TeachingGroupRequest) -> Data? {
        try? JSONEncoder().encode(TeachingGroupWrite(dataset: dataset, payload: payload))
    }

    // MARK: Preview support

    func previewPending(_ entry: PendingWrite) {
        pending = [entry]
        lastError[entry.id] = "Couldn't reach the server. Check your connection and try again."
    }
}

/// Shows an unresolved write wherever the user is, with the only safe action: try the same request again.
struct PendingWriteBanner: View {
    @Environment(AppModel.self) private var app
    @State private var result: String?

    var body: some View {
        if let entry = app.writes.pending.first {
            let sending = app.writes.sending.contains(entry.id)
            VStack(alignment: .leading, spacing: 8) {
                Label("Not confirmed yet", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                    .font(.subheadline.weight(.bold))
                Text("\(entry.title ?? "A request") may or may not have reached the server. Trying again sends the exact same request, so it can't happen twice.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let message = result ?? app.writes.lastError[entry.id] {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
                Button {
                    Task {
                        switch await app.writes.retry(entry) {
                        case .confirmed(let c): result = c.title
                        case .rejected(let m), .uncertain(let m), .notSent(let m): result = m
                        }
                    }
                } label: {
                    HStack {
                        if sending { ProgressView().controlSize(.small) }
                        Text(sending ? "Checking…" : "Try again")
                    }
                    .font(.subheadline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.tint(Color.primary.opacity(0.06)).interactive(), in: .capsule)
                .disabled(sending)
            }
            .padding(14)
            .background(Color.orange.opacity(0.12), in: .rect(cornerRadius: 18, style: .continuous))
        }
    }
}

/// Shared footer for write sheets: shows the state of the request the sheet sent.
struct WriteStateView: View {
    @Environment(AppModel.self) private var app
    let requestId: String?
    let message: String?
    let isError: Bool

    var body: some View {
        if let requestId, let entry = app.writes.entry(id: requestId) {
            let sending = app.writes.sending.contains(entry.id)
            VStack(alignment: .leading, spacing: 6) {
                Label(sending ? "Sending…" : "Not confirmed yet", systemImage: sending ? "arrow.up.circle" : "exclamationmark.arrow.triangle.2.circlepath")
                    .font(.subheadline.weight(.bold))
                if !sending {
                    Text("It may or may not have reached the server. Try again sends the exact same request.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        } else if let message {
            Label(message, systemImage: isError ? "exclamationmark.circle" : "checkmark.circle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isError ? Tone.failure : Tone.success)
        }
    }
}
