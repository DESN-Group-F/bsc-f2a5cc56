import Foundation

/// A printed battery label: `BATINV:<LIVE|DEMO>:<battery ID>` (docs/qr-labels.md). The label only
/// identifies a battery in one inventory; everything shown about it comes from the server's records.
struct BatteryLabel: Equatable, Sendable {
    let dataset: Dataset
    let batteryId: String

    /// Parses a scanned code, ignoring case and surrounding whitespace. Anything else is not a battery label.
    init?(_ text: String) {
        let parts = text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            .split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "BATINV" else { return nil }
        switch parts[1] {
        case "LIVE": dataset = .live
        case "DEMO": dataset = .demo
        default: return nil
        }
        let id = String(parts[2])
        guard id.range(of: "^BAT-[0-9]{8,}$", options: .regularExpression) != nil else { return nil }
        batteryId = id
    }

    init(dataset: Dataset, batteryId: String) {
        self.dataset = dataset
        self.batteryId = batteryId
    }

    /// The exact text a label carries, upper case so the code stays in QR alphanumeric mode.
    var payload: String { "BATINV:\(dataset == .live ? "LIVE" : "DEMO"):\(batteryId)" }
}
