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
    /// Retiring batteries: a calm graphite, distinct from the red used for refusals.
    static let retire = Color(red: 0.35, green: 0.38, blue: 0.45)
    /// Ink stays dark in light mode and lifts to a deep slate in dark mode so it never disappears.
    static func adaptiveInk(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.27, green: 0.30, blue: 0.40) : ink
    }
}

enum MovementKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case checkout
    case `return`
    /// First-time registration of tagged batteries; sent as `intake` writes (Demo).
    case register
    /// Scrap or permanently remove; sent as a `lifecycle` write, not a movement.
    case retire

    var id: String { rawValue }
    var title: String {
        switch self {
        case .checkout: return "Check out"
        case .return: return "Return"
        case .register: return "Register"
        case .retire: return "Retire"
        }
    }
    var tint: Color {
        switch self {
        case .checkout: return Tone.checkout
        case .return: return Tone.returning
        case .register: return Tone.register
        case .retire: return Tone.retire
        }
    }
    var onTint: Color { self == .return ? Tone.returnInk : .white }
    var progressTitle: String {
        switch self {
        case .checkout: return "Checking out…"
        case .return: return "Returning…"
        case .register: return "Registering…"
        case .retire: return "Saving…"
        }
    }
    var pastTense: String {
        switch self {
        case .checkout: return "checked out"
        case .return: return "returned"
        case .register: return "registered"
        case .retire: return "retired"
        }
    }

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

    // Kept alive and prepared so the first buzz lands with the event, not tens of milliseconds later.
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let notice = UINotificationFeedbackGenerator()
    private static let selection = UISelectionFeedbackGenerator()

    /// Call just before a moment that will need feedback, e.g. when the tag reader opens.
    static func prepare() {
        guard enabled else { return }
        medium.prepare(); soft.prepare(); notice.prepare(); selection.prepare()
    }

    static func accepted() { guard enabled else { return }; medium.impactOccurred(intensity: 0.9); medium.prepare() }
    static func duplicate() { guard enabled else { return }; soft.impactOccurred(intensity: 0.6); soft.prepare() }
    static func refused() { guard enabled else { return }; notice.notificationOccurred(.error); notice.prepare() }
    static func confirmed() { guard enabled else { return }; notice.notificationOccurred(.success) }
    static func tap() { guard enabled else { return }; selection.selectionChanged(); selection.prepare() }
    static func press() { guard enabled else { return }; medium.impactOccurred(intensity: 0.6) }
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
