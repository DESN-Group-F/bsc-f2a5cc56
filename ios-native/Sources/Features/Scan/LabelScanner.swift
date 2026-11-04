import AVFoundation
import UIKit
import Vision
import SwiftUI
import VisionKit

/// What the camera is open for.
enum LabelScanPurpose: String, Identifiable {
    /// Read-only: cards open when the camera closes, like a tag look-up.
    case lookUp
    /// The scan station: each battery joins the current list as a hand-picked one.
    case addToList

    var id: String { rawValue }
}

/// Live QR scanning of battery labels (docs/qr-labels.md). Works in both inventories: it reads no tag hardware,
/// and a battery found by its label is treated like one picked from the list.
struct LabelScannerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let purpose: LabelScanPurpose

    @State private var access: Access = .checking
    @State private var reads: [LookupRead] = []
    @State private var added = 0
    @State private var status: Status?
    @State private var lastPayload: (text: String, at: Date)?
    @State private var working = false

    private enum Access { case checking, granted, denied, unsupported }

    struct Status: Equatable {
        let text: String
        let ok: Bool
        let token = UUID()
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                camera
                VStack {
                    Spacer()
                    hud
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(purpose == .lookUp && !reads.isEmpty ? "Close" : "Done") { dismiss() }
                }
                if purpose == .lookUp && !reads.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Show \(reads.count)") { finish() }.fontWeight(.semibold)
                    }
                }
            }
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationTitle(purpose == .lookUp ? "Look up by label" : "Scan labels")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await checkAccess() }
        .animation(.snappy, value: status)
    }

    // MARK: Camera

    @ViewBuilder
    private var camera: some View {
        switch access {
        case .granted:
            LabelCameraView { payload in handle(payload) }
                .ignoresSafeArea()
        case .checking:
            ProgressView().tint(.white)
        case .denied:
            unavailable(title: "Camera access is off",
                        message: "Allow camera access for Battery Inventory in Settings to scan battery labels.",
                        settings: true)
        case .unsupported:
            unavailable(title: app.preview == nil ? "Camera scanning isn't available" : "Camera preview",
                        message: app.preview == nil ? "This iPhone can't scan labels with the camera right now. Search for the battery's ID in Inventory instead."
                                                    : "Point the camera at a battery label.",
                        settings: false)
        }
    }

    private func unavailable(title: String, message: String, settings: Bool) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill").font(.largeTitle).foregroundStyle(.white.opacity(0.7))
            Text(title).font(.headline).foregroundStyle(.white)
            Text(message).font(.subheadline).foregroundStyle(.white.opacity(0.75)).multilineTextAlignment(.center)
            if settings, let url = URL(string: UIApplication.openSettingsURLString) {
                Button("Open Settings") { UIApplication.shared.open(url) }
                    .secondaryButton()
                    .padding(.top, 4)
            }
        }
        .padding(32)
    }

    private func checkAccess() async {
        if app.preview != nil {
            access = .unsupported
            if app.preview == .labelScan, let battery = app.inventory.battery(id: "BAT-00000012") {
                reads = [LookupRead(label: battery.id, batteryId: battery.id)]
                status = Status(text: ScanModel.lookupLine(battery, me: app.user?.id), ok: true)
            }
            return
        }
        guard DataScannerViewController.isSupported else { access = .unsupported; return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: access = .granted
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            access = granted ? .granted : .denied
        default: access = .denied
        }
        if access == .granted && !DataScannerViewController.isAvailable { access = .denied }
    }

    // MARK: Status

    private var hud: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let status {
                Label {
                    Text(status.text).lineLimit(3)
                } icon: {
                    Image(systemName: status.ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                        .foregroundStyle(status.ok ? Tone.success : Tone.failure)
                }
                .font(.subheadline.weight(.semibold))
                .id(status.token)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            Text(hint).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    private var hint: String {
        switch purpose {
        case .lookUp:
            return reads.isEmpty ? "Point at a battery label. Keep going for more; nothing changes."
                : "\(reads.count) scanned. Point at the next label, or tap Show \(reads.count)."
        case .addToList:
            return added == 0 ? "Point at a battery label to add it to the list for \(app.scan.mode.title.lowercased())."
                : "\(added) added. Point at the next label, or tap Done to review the list."
        }
    }

    // MARK: Reading

    private func handle(_ payload: String) {
        // The scanner reports a code again when it comes back into view; a quick repeat isn't a new scan.
        if let last = lastPayload, last.text == payload, Date().timeIntervalSince(last.at) < 2.5 { return }
        lastPayload = (payload, Date())
        guard !working else { return }
        working = true
        Task {
            defer { working = false }
            switch await app.scan.resolveLabel(payload) {
            case .notLabel:
                report("Not a battery label", ok: false)
            case .otherInventory(let dataset):
                report("This label is for the \(dataset.title). Switch inventory in Scan to use it.", ok: false)
            case .unknown(let id):
                if purpose == .lookUp { remember(LookupRead(label: id, batteryId: nil)) }
                report("No battery \(id) in this inventory", ok: false)
            case .found(let battery):
                switch purpose {
                case .lookUp:
                    remember(LookupRead(label: battery.id, batteryId: battery.id))
                    report(ScanModel.lookupLine(battery, me: app.user?.id), ok: true)
                case .addToList:
                    let result = app.scan.addFromLabel(battery)
                    if result.added { added += 1 }
                    report(result.text, ok: result.added)
                }
            }
        }
    }

    private func remember(_ read: LookupRead) {
        reads.removeAll { $0.id == read.id }
        reads.insert(read, at: 0)
    }

    private func report(_ text: String, ok: Bool) {
        status = Status(text: text, ok: ok)
        if ok { Haptics.accepted() } else { Haptics.refused() }
        if UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: text) }
    }

    /// Closes the camera, then shows the cards for what was scanned.
    private func finish() {
        let shown = reads
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            app.lookup = LookupPresentation(reads: shown, origin: .label)
        }
    }
}

/// VisionKit's live scanner, limited to QR codes.
struct LabelCameraView: UIViewControllerRepresentable {
    var onPayload: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPayload: onPayload) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
                                                qualityLevel: .balanced,
                                                recognizesMultipleItems: false,
                                                isHighFrameRateTrackingEnabled: false,
                                                isPinchToZoomEnabled: true,
                                                isGuidanceEnabled: true,
                                                isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.onPayload = onPayload
        if !scanner.isScanning { try? scanner.startScanning() }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onPayload: (String) -> Void

        init(onPayload: @escaping (String) -> Void) { self.onPayload = onPayload }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in addedItems { deliver(item) }
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            deliver(item)
        }

        private func deliver(_ item: RecognizedItem) {
            if case .barcode(let code) = item, let text = code.payloadStringValue { onPayload(text) }
        }
    }
}
