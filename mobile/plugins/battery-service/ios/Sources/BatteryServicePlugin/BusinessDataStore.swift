import CryptoKit
import Foundation

/** Fixed origin-scoped file; no JavaScript path, deletion or credential access. */
final class BusinessDataStore {
    static let maxBytes = 16 * 1024 * 1024
    private let file: URL
    init(scope: String) throws {
        do {
            let manager = FileManager.default
            let root = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let directory = root.appendingPathComponent("BatteryServiceBusiness", isDirectory: true)
            try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication.rawValue])
            try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication.rawValue], ofItemAtPath: directory.path)
            let digest = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
            file = directory.appendingPathComponent("battery-service-business-v1-" + digest + ".json", isDirectory: false)
        } catch { throw ServiceFailure(message: "Private business recovery storage is unavailable. Existing files were preserved.", code: "BUSINESS_STORAGE") }
    }
    func load() throws -> String? {
        var bytes = Data()
        do {
            let input = try FileHandle(forReadingFrom: file)
            defer { try? input.close() }
            while let chunk = try input.read(upToCount: 16384), !chunk.isEmpty {
                guard chunk.count <= Self.maxBytes - bytes.count else { throw ServiceFailure(message: "The saved business envelope exceeds 16 MiB. Its file was preserved; no partial data was loaded.", code: "BUSINESS_DATA_TOO_LARGE") }
                bytes.append(chunk)
            }
        }
        catch let failure as ServiceFailure { throw failure }
        catch let error as NSError {
            if error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return nil }
            throw ServiceFailure(message: "Business recovery data could not be read. Existing files were preserved; do not replace pending work.", code: "BUSINESS_STORAGE")
        }
        guard bytes.count <= Self.maxBytes else { throw ServiceFailure(message: "The saved business envelope exceeds 16 MiB. Its file was preserved; no partial data was loaded.", code: "BUSINESS_DATA_TOO_LARGE") }
        guard let value = String(data: bytes, encoding: .utf8) else { throw ServiceFailure(message: "The saved business envelope is not valid UTF-8. Its file was preserved.", code: "BUSINESS_DATA_CORRUPT") }
        return value
    }
    func save(_ data: String) throws {
        guard data.utf8.count <= Self.maxBytes else { throw ServiceFailure(message: "The complete business envelope exceeds 16 MiB. Existing data was preserved.", code: "BUSINESS_DATA_TOO_LARGE") }
        let bytes = Data(data.utf8)
        do {
            try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            guard try load() == data else { throw ServiceFailure(message: "The complete business envelope was not confirmed in durable storage.", code: "BUSINESS_STORAGE") }
        } catch { throw ServiceFailure(message: "Business recovery data was not confirmed saved. Existing files were not cleared; do not send a new mutation.", code: "BUSINESS_STORAGE") }
    }
}
