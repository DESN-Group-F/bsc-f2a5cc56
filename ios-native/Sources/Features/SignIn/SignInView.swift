import SwiftUI

/// Sign-in. Ink reads along while you type your username, closes its eyes for the password,
/// hops green when the server accepts you, then travels to the scan stage as the form sinks away.
struct SignInView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var username = ""
    @State private var password = ""
    @State private var working = false
    @State private var error: String?
    @State private var reaction = 0
    @State private var mood: InkMood = .idle
    @State private var appeared = false
    @State private var accepted = false
    @State private var inkFrame: CGRect?
    @State private var shake = 0
    @FocusState private var focus: Field?

    enum Field { case username, password }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                InkView(tint: inkTint, mood: inkMood, reaction: reaction, gaze: gaze, interactive: true)
                    .frame(width: 150, height: 150)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { inkFrame = $0 }
                    .scaleEffect(appeared || reduceMotion ? 1 : 0.4)
                    .opacity(app.travel == nil && appeared ? 1 : 0)
                    .padding(.top, 64)
                    .animation(.spring(response: 0.35, dampingFraction: 0.7), value: focus)

                VStack(spacing: 6) {
                    Text("Battery Inventory").font(.largeTitle.weight(.bold))
                    Text("Sign in with your staff account.").font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(.top, 26)
                .rise(appeared && !accepted, order: 0)

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
                .keyframeAnimator(initialValue: CGFloat(0), trigger: shake) { content, x in
                    content.offset(x: x)
                } keyframes: { _ in
                    KeyframeTrack(\.self) {
                        CubicKeyframe(-10, duration: 0.06)
                        CubicKeyframe(9, duration: 0.07)
                        CubicKeyframe(-6, duration: 0.07)
                        CubicKeyframe(3, duration: 0.07)
                        CubicKeyframe(0, duration: 0.08)
                    }
                }
                .padding(.top, 30)
                .rise(appeared && !accepted, order: 1)

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Tone.failure)
                        .multilineTextAlignment(.center)
                        .padding(.top, 14)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                Button(action: submit) {
                    HStack(spacing: 10) {
                        if accepted {
                            Image(systemName: "checkmark").fontWeight(.bold).transition(.scale.combined(with: .opacity))
                        } else if working {
                            ProgressView().tint(.white)
                        }
                        Text(accepted ? "Signed in" : (working ? "Signing in…" : "Sign in"))
                    }
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 42)
                }
                .primaryButton(accepted ? Tone.success : Tone.checkout)
                .disabled(!accepted && (username.isEmpty || password.isEmpty))
                .animation(.snappy, value: accepted)
                .animation(.easeOut(duration: 0.2), value: canSubmit)
                .padding(.top, 22)
                .rise(appeared && !accepted, order: 2)

                Text(app.service.client.origin.host ?? "")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 18)
                    .rise(appeared && !accepted, order: 3)
            }
            .padding(.horizontal, 24)
            .animation(.snappy, value: error)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .background {
            Color(.systemGroupedBackground)
                .overlay(alignment: .top) {
                    Circle()
                        .fill(Tone.checkout.opacity(0.14))
                        .frame(width: 420, height: 420)
                        .blur(radius: 70)
                        .offset(y: -200)
                        .allowsHitTesting(false)
                }
                .clipped()
                .ignoresSafeArea()
        }
        .onAppear {
            // Ink drops in, then the content rises beneath it.
            withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.62)) { appeared = true }
        }
    }

    // MARK: Ink behaviour

    private var canSubmit: Bool { !working && !username.isEmpty && !password.isEmpty }

    private var inkTint: Color {
        if accepted { return Tone.success }
        switch mood {
        case .surprised: return Tone.failure
        case .happy: return Tone.success
        default: return Tone.adaptiveInk(colorScheme)
        }
    }

    /// Eyes closed while the password field is active, unless something just happened.
    private var inkMood: InkMood {
        if mood != .idle { return mood }
        return focus == .password ? .shy : .idle
    }

    /// Follows the username as it grows, like reading along.
    private var gaze: CGPoint? {
        guard mood == .idle, focus == .username else { return nil }
        let progress = min(Double(username.count), 18) / 18
        return CGPoint(x: -0.7 + progress * 1.4, y: 0.85)
    }

    private func submit() {
        guard canSubmit else { return }
        focus = nil
        working = true
        error = nil
        Task {
            do {
                let user = try await app.signIn(username: username, password: password)
                password = ""
                // The success beat: Ink hops green and the button confirms, then the form sinks
                // away while Ink travels to the scan stage.
                accepted = true
                mood = .happy
                reaction += 1
                if !reduceMotion { try? await Task.sleep(for: .seconds(0.38)) }
                await app.enter(user, inkFrame: inkFrame)
            } catch let failure as APIFailure {
                working = false
                error = failure.status == 401 ? "That username and password don't match." :
                    failure.status == 429 ? "Too many attempts. Wait a few minutes and try again." : failure.message
                mood = .surprised
                reaction += 1
                if !reduceMotion { shake += 1 }
                Haptics.refused()
                try? await Task.sleep(for: .seconds(1.4))
                mood = .idle
            } catch {
                working = false
                self.error = "Couldn't sign in. Try again."
            }
        }
    }
}
