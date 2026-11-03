import Foundation

/// What the app remembers between launches so a signed-in staff member lands straight on Scan:
/// the signed-in user and the last inventory snapshot for each account and inventory.
/// Read data only — every write still goes to the server under the exact-request rules.
/// Cleared on sign-out and whenever the server ends the session.
enum SessionCache {
    private static let userKey = "sessionCache.user"

    private static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("SnapshotCache", isDirectory: true)
    }

    private static func file(accountId: String, dataset: Dataset) -> URL {
        directory.appendingPathComponent("\(accountId)-\(dataset.rawValue).json")
    }

    // MARK: User

    static func saveUser(_ user: StaffUser) {
        guard let data = try? JSONEncoder().encode(user) else { return }
        UserDefaults.standard.set(data, forKey: userKey)
    }

    static func user() -> StaffUser? {
        guard let data = UserDefaults.standard.data(forKey: userKey) else { return nil }
        return try? JSONDecoder().decode(StaffUser.self, from: data)
    }

    // MARK: Snapshot

    /// Saves and clears run in order on one queue; a save that was asked for before a clear is dropped.
    private static let queue = DispatchQueue(label: "SessionCache", qos: .utility)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var generation = 0

    private static func currentGeneration() -> Int {
        lock.lock(); defer { lock.unlock() }
        return generation
    }

    /// Saves off the main thread; a failed save only means the next launch loads from the server.
    static func save(_ snapshot: InventorySnapshot) {
        let url = file(accountId: snapshot.user.id, dataset: snapshot.dataset)
        let folder = directory
        let asked = currentGeneration()
        queue.async {
            guard asked == currentGeneration(), let data = try? JSONEncoder().encode(snapshot) else { return }
            // Nothing changed since the last save: keep the file, only record that it is current.
            if let existing = try? Data(contentsOf: url), existing == data {
                try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
                return
            }
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                     attributes: [.protectionKey: FileProtectionType.complete])
            var excluded = folder
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? excluded.setResourceValues(values)
            try? data.write(to: url, options: [.atomic, .completeFileProtection])
        }
    }

    /// The saved snapshot and when it was saved, if it belongs to this account and inventory.
    static func snapshot(accountId: String, dataset: Dataset) -> (InventorySnapshot, Date)? {
        let url = file(accountId: accountId, dataset: dataset)
        guard let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(InventorySnapshot.self, from: data),
              snapshot.user.id == accountId, snapshot.dataset == dataset else { return nil }
        let saved = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
        return (snapshot, saved)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: userKey)
        lock.lock(); generation += 1; lock.unlock()
        let folder = directory
        // Remove now, and again behind any save already queued.
        try? FileManager.default.removeItem(at: folder)
        queue.async { try? FileManager.default.removeItem(at: folder) }
    }
}
