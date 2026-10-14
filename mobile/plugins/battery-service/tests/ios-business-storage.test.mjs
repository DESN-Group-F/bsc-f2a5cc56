import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const harness = String.raw`
import CryptoKit
import Darwin
import Foundation

struct HarnessFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

@main
struct BusinessStorageHarness {
    static let manager = FileManager.default
    static var assertions = 0
    static var phase = "fixture setup"
    static func check(_ value: Bool, _ label: String) throws {
        if !value { throw HarnessFailure(phase + ": " + label) }
        assertions += 1
    }
    static func fails(_ expected: String, _ label: String, _ action: () throws -> Void) throws {
        do { try action(); throw HarnessFailure(label + ": expected " + expected + ", but the operation succeeded") }
        catch let failure as ServiceFailure {
            try check(failure.code == expected, label + ": expected " + expected + ", received " + failure.code)
            print("Confirmed \(label): \(failure.code)")
        }
    }
    static func file(for scope: String) throws -> URL {
        let root = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        let digest = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent("BatteryServiceBusiness", isDirectory: true)
            .appendingPathComponent("battery-service-business-v1-" + digest + ".json", isDirectory: false)
    }
    static func run() throws {
        // Never clear the shared support directory: cleanup is restricted to
        // these fresh, test-owned UUID scopes and their exact derived paths.
        let prefix = "ios-business-storage-regression:" + UUID().uuidString + ":"
        var fixtures: [(BusinessDataStore, URL)] = []
        var ownedPaths: [URL] = []
        defer {
            for file in ownedPaths {
                try? manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
                try? manager.removeItem(at: file)
            }
        }
        for suffix in ["first", "other", "invalid", "large", "directory", "denied"] {
            let scope = prefix + suffix
            let store = try BusinessDataStore(scope: scope)
            let target = try file(for: scope)
            do {
                _ = try manager.attributesOfItem(atPath: target.path)
                throw HarnessFailure("Refusing to use an existing fixture path")
            } catch let error as NSError {
                guard error.domain == NSCocoaErrorDomain && (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError)
                    || error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT) else { throw error }
            }
            ownedPaths.append(target)
            fixtures.append((store, target))
        }
        let (first, firstFile) = fixtures[0]
        phase = "first launch"
        do {
            let unexpected = try FileHandle(forReadingFrom: firstFile)
            try unexpected.close()
            throw HarnessFailure("Expected the fresh-scope file to be absent")
        } catch let error as NSError {
            let legacyRecognized = error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError
            print("Fresh FileHandle open: domain=\(error.domain), code=\(error.code), legacyMissingFileClassifier=\(legacyRecognized)")
            try check(error.domain == NSCocoaErrorDomain && (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError)
                || error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT), "Actual absent-file error is recognized")
        }
        try check(try first.load() == nil, "First launch returns an empty store without creating a file")
        try check(!manager.fileExists(atPath: firstFile.path), "Missing-file load does not create or replace data")
        phase = "exact saved bytes and restart"
        let envelope = #"{"schemaVersion":1,"entries":{"request":"Exact request é 中文 😀 with \"escaped\" bytes"}}"# + "\n"
        let expectedBytes = Data(envelope.utf8)
        try first.save(envelope)
        try check(try Data(contentsOf: firstFile) == expectedBytes, "Save keeps exact UTF-8 bytes")
        try check(try first.load() == envelope, "Same instance reads the exact envelope")
        let restarted = try BusinessDataStore(scope: prefix + "first")
        try check(try restarted.load() == envelope, "A recreated store reads retained bytes")
        phase = "origin scope isolation"
        let (other, otherFile) = fixtures[1]
        try check(try other.load() == nil, "A new origin scope starts empty")
        try other.save("separate scope")
        try check(try Data(contentsOf: firstFile) == expectedBytes && Data(contentsOf: otherFile) == Data("separate scope".utf8), "Scopes do not overwrite each other")
        phase = "invalid UTF-8 retention"
        let (invalid, invalidFile) = fixtures[2]
        let invalidBytes = Data([0xff, 0xfe, 0x80])
        try invalidBytes.write(to: invalidFile)
        try fails("BUSINESS_DATA_CORRUPT", "invalid UTF-8 load") { _ = try invalid.load() }
        try check(try Data(contentsOf: invalidFile) == invalidBytes, "Invalid UTF-8 remains byte-identical")
        phase = "oversized file retention"
        let (large, largeFile) = fixtures[3]
        let oversizedBytes = Data(repeating: 0x61, count: BusinessDataStore.maxBytes + 1)
        try oversizedBytes.write(to: largeFile)
        try fails("BUSINESS_DATA_TOO_LARGE", "oversized saved file load") { _ = try large.load() }
        try check(try Data(contentsOf: largeFile) == oversizedBytes, "Oversized saved bytes are retained")
        try fails("BUSINESS_DATA_TOO_LARGE", "oversized new save") { try first.save(String(repeating: "a", count: BusinessDataStore.maxBytes + 1)) }
        try check(try Data(contentsOf: firstFile) == expectedBytes, "Rejected oversized save preserves the original")
        phase = "directory rejection"
        let (directory, directoryFile) = fixtures[4]
        try manager.createDirectory(at: directoryFile, withIntermediateDirectories: false)
        do {
            let probe = try FileHandle(forReadingFrom: directoryFile)
            defer { try? probe.close() }
            let bytes = try probe.read(upToCount: 16)
            print("Foundation directory read: returned \(bytes?.count ?? 0) bytes; the store must reject non-regular files independently")
        } catch let error as NSError {
            print("Foundation directory read: domain=\(error.domain), code=\(error.code)")
        }
        try fails("BUSINESS_STORAGE", "directory used as a saved file") { _ = try directory.load() }
        let attributes = try manager.attributesOfItem(atPath: directoryFile.path)
        try check(attributes[.type] as? FileAttributeType == .typeDirectory, "A read error is not mistaken for an empty store")
        phase = "permission failure retention"
        let (denied, deniedFile) = fixtures[5]
        try check(geteuid() != 0, "Run as an ordinary user so the permission failure is meaningful")
        try expectedBytes.write(to: deniedFile)
        try manager.setAttributes([.posixPermissions: 0], ofItemAtPath: deniedFile.path)
        do {
            let unexpected = try FileHandle(forReadingFrom: deniedFile)
            try unexpected.close()
            throw HarnessFailure("Permission fixture remained readable after chmod 000")
        } catch let error as NSError {
            try check(error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoPermissionError
                || error.domain == NSPOSIXErrorDomain && (error.code == Int(EACCES) || error.code == Int(EPERM)),
                "Permission fixture must produce a real access-denied error; observed " + error.domain + "/" + String(error.code))
            print("Permission FileHandle open: domain=\(error.domain), code=\(error.code)")
        }
        try fails("BUSINESS_STORAGE", "permission-denied saved file") { _ = try denied.load() }
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: deniedFile.path)
        try check(try Data(contentsOf: deniedFile) == expectedBytes, "An unreadable file remains byte-identical")
        print("Passed \(assertions) assertions against production Swift BusinessDataStore using native macOS Foundation. This is not iPhone runtime or NFC acceptance.")
    }
    static func main() {
        do { try run() }
        catch { fputs("Business storage regression failed during \(phase): \(error)\n", stderr); exit(1) }
    }
}
`;

test('production Swift business storage distinguishes first launch from unreadable retained work', { timeout: 120000 }, async context => {
  if (process.platform !== 'darwin') return context.skip('Native macOS Foundation is required; iOS storage execution was not performed on this host.');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const work = await mkdtemp(path.join(root, 'work/ios-business-storage-'));
  const source = path.join(work, 'BusinessStorageHarness.swift');
  const binary = path.join(work, 'business-storage-harness');
  await writeFile(source, harness);
  const production = ['BusinessDataStore.swift', 'ServicePolicy.swift'].map(name => path.join(root, 'ios/Sources/BatteryServicePlugin', name));
  const compile = spawnSync('xcrun', ['swiftc', ...production, source, '-o', binary], { encoding: 'utf8', timeout: 90000 });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr || compile.error?.message);
  const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 20000 });
  assert.equal(run.status, 0, run.stdout + run.stderr || run.error?.message);
  context.diagnostic(run.stdout.trim());
});
