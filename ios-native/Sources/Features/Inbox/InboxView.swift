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
                        }
                    }
                }
                Section("Messages") {
                    if app.inbox.others.isEmpty && app.inbox.tasks.isEmpty {
                        Text("Nothing here yet.").foregroundStyle(.secondary)
                    }
                    ForEach(app.inbox.others) { message in
                        Button { reading = message } label: { MessageRow(message: message) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.insetGrouped)
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
                        .foregroundStyle(Color(.systemBackground))
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Color.primary, in: .capsule)
                }
                .buttonStyle(.borderless)
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
        VStack(spacing: 0) {
            Text(parts?.isToday == true ? "TODAY" : (parts?.month ?? "—")).font(.caption2.weight(.bold)).tracking(0.6)
            Text(parts?.day ?? "").font(.title3.weight(.bold))
        }
        .foregroundStyle(parts?.isToday == true ? Tone.failure : Color.primary)
        .frame(width: 52, height: 56)
        .background((parts?.isToday == true ? Tone.failure : Color.secondary).opacity(0.12), in: .rect(cornerRadius: 14, style: .continuous))
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
    let message: InboxMessage

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(Sydney.friendly(message.createdAt)).font(.footnote).foregroundStyle(.secondary)
                    Text(message.body ?? "").font(.body)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .navigationTitle(message.title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
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
                    if let due = message.dueOn { Text("Due \(due)").foregroundStyle(.secondary) }
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
