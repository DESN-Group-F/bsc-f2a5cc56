import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var username = ""
    @State private var password = ""
    @State private var working = false
    @State private var error: String?
    @State private var reaction = 0
    @State private var mood: InkMood = .idle
    @FocusState private var focus: Field?
    @Environment(\.colorScheme) private var colorScheme

    enum Field { case username, password }

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            Circle().fill(Tone.checkout.opacity(0.16)).frame(width: 420).blur(radius: 70).offset(y: -220).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 28) {
                    InkView(tint: mood == .surprised ? Tone.failure : Tone.adaptiveInk(colorScheme), mood: mood, reaction: reaction,
                            gaze: focus == nil ? nil : CGPoint(x: 0, y: 0.9))
                        .frame(width: 150, height: 150)
                        .padding(.top, 70)
                    VStack(spacing: 6) {
                        Text("Battery Inventory").font(.largeTitle.weight(.bold))
                        Text("Sign in with your staff account.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    VStack(spacing: 0) {
                        TextField("Username", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focus, equals: .username)
                            .submitLabel(.next)
                            .onSubmit { focus = .password }
                            .padding(.horizontal, 16).frame(height: 54)
                        Divider().padding(.leading, 16)
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit { submit() }
                            .padding(.horizontal, 16).frame(height: 54)
                    }
                    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))

                    if let error {
                        Text(error).font(.footnote).foregroundStyle(Tone.failure).multilineTextAlignment(.center)
                            .transition(.opacity)
                    }

                    Button(action: submit) {
                        HStack {
                            if working { ProgressView().tint(.white) }
                            Text(working ? "Signing in…" : "Sign in")
                        }
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(Tone.checkout).interactive(), in: .capsule)
                    .disabled(working || username.isEmpty || password.isEmpty)
                    .opacity(username.isEmpty || password.isEmpty ? 0.6 : 1)

                    Text(app.service.client.origin.host ?? "")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 24)
                .animation(.snappy, value: error)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func submit() {
        guard !working, !username.isEmpty, !password.isEmpty else { return }
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                try await app.signIn(username: username, password: password)
                password = ""
            } catch let failure as APIFailure {
                error = failure.status == 401 ? "That username and password don't match." :
                    failure.status == 429 ? "Too many attempts. Wait a few minutes and try again." : failure.message
                mood = .surprised
                reaction += 1
                Haptics.refused()
                try? await Task.sleep(for: .seconds(1.4))
                mood = .idle
            } catch {
                self.error = "Couldn't sign in. Try again."
            }
        }
    }
}
