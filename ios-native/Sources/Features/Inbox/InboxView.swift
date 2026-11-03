import SwiftUI

struct InboxView: View {
    @Environment(AppModel.self) private var app
    @State private var completing: InboxMessage?
    @State private var reading: InboxMessage?

    var body: some View {
        NavigationStack {
            List {
                if !app.inbox.tasks.isEmpty {
                    Section("To do") {
                        ForEach(app.inbox.tasks) { message in
                            TaskRow(message: message) { completing = message }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    Button { completing = message } label: { Label("Done", systemImage: "checkmark") }
                                        .tint(Tone.success)
                                }
                        }
                    }
                }
                if !app.inbox.others.isEmpty {
                    Section("Messages") {
                        ForEach(app.inbox.others) { message in
                            Button { reading = message } label: { MessageRow(message: message) }
                                .buttonStyle(.plain)
                                .swipeActions(edge: .leading) {
                                    if message.isUnread {
                                        Button { Task { await app.inbox.markRead(message) } } label: {
                                            Label("Read", systemImage: "envelope.open")
                                        }
                                        .tint(Tone.checkout)
                                    }
                                }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if app.inbox.messages.isEmpty {
                    if app.inbox.loading || !app.inbox.loaded {
                        if let error = app.inbox.lastError, !app.inbox.loading {
                            ContentUnavailableView {
                                Label("Couldn't load the inbox", systemImage: "wifi.exclamationmark")
                            } description: {
                                Text(error)
                            } actions: {
                                Button("Try again") { Task { await app.inbox.refresh() } }.secondaryButton()
                            }
                        } else {
                            ProgressView()
                        }
                    } else {
                        ContentUnavailableView("No messages", systemImage: "tray",
                                               description: Text("Tasks and notices for this inventory appear here."))
                    }
                }
            }
            .navigationTitle("Inbox")
            .refreshable { await app.inbox.refresh() }
            .sheet(item: $completing) { message in
                CompleteTaskSheet(message: message)
                    .presentationDetents([.medium])
            }
            .sheet(item: $reading) { message in
                MessageDetail(message: message)
                    .presentationDetents([.medium, .large])
                    .task { await app.inbox.markRead(message) }
            }
        }
    }
}

struct TaskRow: View {
    let message: InboxMessage
    var onDone: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            DateBlock(ymd: message.dueOn ?? message.cycle?.dueOn)
            VStack(alignment: .leading, spacing: 4) {
                Text(message.cycle?.title ?? message.title).font(.body.weight(.semibold))
                if let body = message.body, !body.isEmpty {
                    Text(body).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
                Button(action: onDone) {
                    Text("Mark done")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 4)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(Tone.checkout)
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 4)
    }
}

struct DateBlock: View {
    let ymd: String?

    var body: some View {
        let parts = Sydney.day(ymd)
        let due = Sydney.due(ymd)
        VStack(spacing: 0) {
            Text(caption(parts?.month, due)).font(.caption2.weight(.bold)).tracking(0.6)
            Text(parts?.day ?? "").font(.title3.weight(.bold))
        }
        .foregroundStyle(tint(due))
        .frame(width: 52, height: 56)
        .background((due == nil || due == .upcoming ? Color.secondary : tint(due)).opacity(0.12),
                    in: .rect(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Sydney.dueText(ymd))
    }

    /// Overdue is the strongest state; today gets the accent; later dates stay neutral.
    private func tint(_ due: Sydney.Due?) -> Color {
        switch due {
        case .overdue: return Tone.failure
        case .today: return Tone.checkout
        default: return .primary
        }
    }

    private func caption(_ month: String?, _ due: Sydney.Due?) -> String {
        switch due {
        case .overdue: return "LATE"
        case .today: return "TODAY"
        default: return month ?? "—"
        }
    }
}

struct MessageRow: View {
    let message: InboxMessage

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(message.isUnread ? Tone.checkout : .clear).frame(width: 9, height: 9).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(message.title).font(.subheadline.weight(message.isUnread ? .bold : .semibold)).lineLimit(1)
                    Spacer()
                    Text(Sydney.friendly(message.createdAt)).font(.caption).foregroundStyle(.secondary)
                }
                if let body = message.body, !body.isEmpty {
                    Text(body).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
        .contentShape(Rectangle())
    }
}

struct MessageDetail: View {
    @Environment(\.dismiss) private var dismiss
    let message: InboxMessage

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(message.title).font(.title2.weight(.bold))
                    Text(Sydney.friendly(message.createdAt)).font(.footnote).foregroundStyle(.secondary)
                    Text(message.body ?? "").font(.body)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .navigationTitle("Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

private func isOverdue(_ ymd: String?) -> Bool {
    if case .overdue = Sydney.due(ymd) { return true }
    return false
}

struct CompleteTaskSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let message: InboxMessage
    @State private var notes = ""
    @State private var requestId = RequestID.make()
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(message.cycle?.title ?? message.title).font(.headline)
                    if let due = message.dueOn {
                        Text(Sydney.dueText(due))
                            .foregroundStyle(isOverdue(due) ? Tone.failure : Color.secondary)
                    }
                }
                Section("Notes (optional)") {
                    TextField("What did you find?", text: $notes, axis: .vertical).lineLimit(3...6)
                }
                if let error { Section { Text(error).foregroundStyle(Tone.failure) } }
            }
            .navigationTitle("Mark done")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Saving…" : "Done") {
                        Task {
                            working = true
                            defer { working = false }
                            do {
                                try await app.inbox.complete(message, notes: String(notes.prefix(2000)), requestId: requestId)
                                dismiss()
                            } catch {
                                // Keep the same request ID so trying again can't record it twice.
                                self.error = (error as? APIFailure)?.message ?? "Couldn't save. Try again."
                                app.handle(error)
                            }
                        }
                    }
                    .fontWeight(.semibold)
                    .disabled(working)
                }
            }
        }
    }
}
