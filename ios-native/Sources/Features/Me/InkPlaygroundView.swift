import SwiftUI
import UIKit

/// A place to play with Ink and tune how it feels. Changes apply everywhere in the app and stay on this iPhone.
struct InkPlaygroundView: View {
    @State private var tuning = InkTuning.shared
    @State private var mood: InkMood = .idle
    @State private var reaction = 0
    @State private var tone: Tone4 = .ink
    @State private var copied = false
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase

    private enum Tone4: String, CaseIterable, Identifiable {
        case ink, checkout, returning, register, retire
        var id: String { rawValue }
        var title: String {
            switch self {
            case .ink: return "Ink"
            case .checkout: return "Out"
            case .returning: return "Return"
            case .register: return "New"
            case .retire: return "Retire"
            }
        }
        func color(_ scheme: ColorScheme) -> Color {
            switch self {
            case .ink: return Tone.adaptiveInk(scheme)
            case .checkout: return Tone.checkout
            case .returning: return Tone.returning
            case .register: return Tone.register
            case .retire: return Tone.retire
            }
        }
    }

    var body: some View {
        List {
            Section {
                InkView(tint: tint, mood: mood, reaction: reaction, animated: scenePhase != .background, interactive: true) {
                    reaction += 1
                }
                .frame(width: 210, height: 210)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
                .listRowBackground(Color.clear)
            } footer: {
                Text("Press, drag and let go. Tap to make it hop.")
                    .frame(maxWidth: .infinity)
            }

            Section("Reactions") {
                HStack(spacing: 8) {
                    PlayButton(title: "Accepted", tint: Tone.success) { flash(.happy) }
                    PlayButton(title: "Duplicate", tint: .gray) { flash(.puzzled) }
                    PlayButton(title: "Refused", tint: Tone.failure) { flash(.surprised) }
                }
                Toggle("Listening for a tag", isOn: Binding(get: { mood == .listening }, set: { mood = $0 ? .listening : .idle }))
                Toggle("Eyes closed (password)", isOn: Binding(get: { mood == .shy }, set: { mood = $0 ? .shy : .idle }))
                Picker("Colour", selection: $tone) {
                    ForEach(Tone4.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }

            Section {
                Toggle("Soft shading", isOn: $tuning.shading)
            } footer: {
                Text("Off is the flat style. On adds a faint sense of depth — no glossy highlight.")
            }

            Section("Feel") {
                TuneSlider(title: "Bounciness", value: $tuning.stiffness, range: 20...140)
                TuneSlider(title: "Settles", value: $tuning.damping, range: 1...14, note: "low = wobbles longer")
                TuneSlider(title: "Smoothness", value: $tuning.coupling, range: 40...320)
                TuneSlider(title: "Volume keeping", value: $tuning.pressure, range: 0...120)
                TuneSlider(title: "Follows finger", value: $tuning.follow, range: 10...80)
                TuneSlider(title: "Spring-back", value: $tuning.followDamping, range: 2...16, note: "low = overshoots more")
                TuneSlider(title: "Stretch", value: $tuning.inertia, range: 0...0.9)
                TuneSlider(title: "Liquid merging", value: $tuning.goo, range: 0...0.6)
                TuneSlider(title: "Liveliness", value: $tuning.liveliness, range: 0...2)
                TuneSlider(title: "Eye speed", value: $tuning.eyeSpeed, range: 0.4...1.8)
            }

            Section {
                Button("Copy settings to send") {
                    if let data = try? JSONEncoder().encode(tuning), let text = String(data: data, encoding: .utf8) {
                        UIPasteboard.general.string = text
                        copied = true
                    }
                }
                Button("Back to defaults", role: .destructive) { tuning = InkTuning.defaults }
            } footer: {
                if copied { Text("Copied. Paste it in a message to share your favourite feel.") }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Ink playground")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: tuning) { _, new in InkTuning.save(new) }
    }

    private var tint: Color {
        switch mood {
        case .happy: return Tone.success
        case .surprised: return Tone.failure
        default: return tone.color(colorScheme)
        }
    }

    private func flash(_ newMood: InkMood) {
        mood = newMood
        reaction += 1
        switch newMood {
        case .happy: Haptics.accepted()
        case .puzzled: Haptics.duplicate()
        case .surprised: Haptics.refused()
        default: break
        }
        let token = reaction
        Task {
            try? await Task.sleep(for: .seconds(newMood == .happy ? 0.8 : 1.4))
            if token == reaction { mood = .idle }
        }
    }
}

private struct PlayButton: View {
    let title: String
    let tint: Color
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 38)
                .background(tint, in: .capsule)
        }
        .buttonStyle(.plain)
    }
}

private struct TuneSlider: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var note: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                if let note { Text(note).font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Text(value < 2 ? String(format: "%.2f", value) : String(format: "%.0f", value))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(value: $value, in: range)
        }
    }
}
