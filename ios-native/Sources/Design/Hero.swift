import SwiftUI

/// Shared namespace so Ink can travel between launch, sign-in and the Scan tab.
private struct HeroNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    var heroNamespace: Namespace.ID? {
        get { self[HeroNamespaceKey.self] }
        set { self[HeroNamespaceKey.self] = newValue }
    }
}

extension View {
    /// Marks the view as the travelling Ink. Only one is on screen at a time outside transitions.
    @ViewBuilder
    func heroInk(_ namespace: Namespace.ID?) -> some View {
        if let namespace {
            matchedGeometryEffect(id: "heroInk", in: namespace)
        } else {
            self
        }
    }
}
