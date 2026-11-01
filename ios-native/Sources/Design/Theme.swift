import SwiftUI
import UIKit

/// Operation colours. They carry meaning, so each is used for exactly one thing.
enum Tone {
    static let checkout = Color(red: 0.114, green: 0.388, blue: 0.929)   // #1D63ED
    static let returning = Color(red: 0.941, green: 0.706, blue: 0.161)  // #F0B429, same as web
    static let returnInk = Color(red: 0.247, green: 0.188, blue: 0.047)  // dark text on yellow
    static let register = Color(red: 0.451, green: 0.314, blue: 0.949)   // #7350F2
    static let success = Color(red: 0.071, green: 0.600, blue: 0.373)    // #12995F
    static let failure = Color(red: 0.878, green: 0.263, blue: 0.290)    // #E0434A
    static let ink = Color(red: 0.07, green: 0.07, blue: 0.09)
}

enum MovementKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case checkout
    case `return`

    var id: String { rawValue }
    var title: String { self == .checkout ? "Check out" : "Return" }
    var tint: Color { self == .checkout ? Tone.checkout : Tone.returning }
    var onTint: Color { self == .checkout ? .white : Tone.returnInk }
    var progressTitle: String { self == .checkout ? "Checking out…" : "Returning…" }
    var pastTense: String { self == .checkout ? "checked out" : "returned" }

    func confirmTitle(count: Int) -> String {
        "\(title) \(count) \(count == 1 ? "battery" : "batteries")"
    }
}

extension Font {
    static let mono = Font.system(.footnote, design: .monospaced).weight(.medium)
    static let monoSmall = Font.system(.caption, design: .monospaced).weight(.medium)
}

/// Small, consistent haptic vocabulary. Respects the user's setting.
@MainActor
enum Haptics {
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "hapticsEnabled") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "hapticsEnabled") }
    }

    static func accepted() { guard enabled else { return }; UIImpactFeedbackGenerator(style: .medium).impactOccurred(intensity: 0.9) }
    static func duplicate() { guard enabled else { return }; UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.6) }
    static func refused() { guard enabled else { return }; UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func confirmed() { guard enabled else { return }; UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func tap() { guard enabled else { return }; UISelectionFeedbackGenerator().selectionChanged() }
}

/// A quiet status pill used in lists and headers.
struct StatusPill: View {
    let battery: BatteryRecord
    var myAccountId: String?

    var body: some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .foregroundStyle(foreground)
            .background(background, in: .capsule)
    }

    private var isMine: Bool { battery.borrowerAccountId != nil && battery.borrowerAccountId == myAccountId }

    private var label: String {
        if !battery.isActive { return battery.statusTitle }
        if battery.isInUse {
            if isMine { return "With you" }
            return "With \(Self.shortName(battery.borrowerName))"
        }
        return "In store"
    }

    private var foreground: Color {
        if !battery.isActive { return Tone.failure }
        return battery.isInUse ? (isMine ? Tone.checkout : .primary) : .secondary
    }

    private var background: Color {
        if !battery.isActive { return Tone.failure.opacity(0.12) }
        return battery.isInUse ? Tone.checkout.opacity(isMine ? 0.14 : 0.07) : Color.secondary.opacity(0.12)
    }

    /// "Jordan Chen" → "J. Chen". Keeps rows compact without losing who it is.
    static func shortName(_ name: String?) -> String {
        guard let name, !name.isEmpty else { return "someone" }
        let parts = name.split(separator: " ")
        guard parts.count > 1, let first = parts.first?.first else { return name }
        return "\(first). \(parts.dropFirst().joined(separator: " "))"
    }
}

struct BatteryGlyph: View {
    var tint: Color
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: "battery.75percent")
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.13), in: .rect(cornerRadius: size * 0.3, style: .continuous))
    }
}
