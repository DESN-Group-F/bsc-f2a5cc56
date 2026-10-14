import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = String.raw`
import Foundation
class CAPPluginCall {
    let options: [String: Any]
    var resolved = false
    var rejected = false
    init(_ options: [String: Any]) { self.options = options }
    func getString(_ key: String) -> String? { options[key] as? String }
    func resolve() { resolved = true }
    func reject(_ message: String, _ code: String) { rejected = true }
}
class UIApplication {
    enum State { case active, inactive, background }
    static let shared = UIApplication()
    var applicationState: State = .active
}
class UIImpactFeedbackGenerator {
    enum FeedbackStyle { case light, medium }
    static var requests: [FeedbackStyle] = []
    static var allOnMain = true
    let style: FeedbackStyle
    init(style: FeedbackStyle) { self.style = style; Self.allOnMain = Self.allOnMain && Thread.isMainThread }
    func prepare() { Self.allOnMain = Self.allOnMain && Thread.isMainThread }
    func impactOccurred() { Self.allOnMain = Self.allOnMain && Thread.isMainThread; Self.requests.append(style) }
}
`;
const harness = String.raw`
@main struct HapticHarness {
    static func check(_ value: Bool, _ label: String) {
        if !value { fputs(label + "\n", stderr); exit(1) }
    }
    static func pump() { RunLoop.main.run(until: Date().addingTimeInterval(0.04)) }
    static func main() {
        let plugin = ControlledHapticPlugin()
        let light = CAPPluginCall(["strength": "light"])
        plugin.haptic(light)
        check(UIImpactFeedbackGenerator.requests.isEmpty, "Feedback must be dispatched onto the main queue")
        pump()
        check(light.resolved && UIImpactFeedbackGenerator.requests == [.light], "Light feedback")
        let medium = CAPPluginCall(["strength": "medium"])
        plugin.haptic(medium); pump()
        check(medium.resolved && UIImpactFeedbackGenerator.requests == [.light, .medium], "Medium feedback")
        for state in [UIApplication.State.inactive, .background] {
            let call = CAPPluginCall(["strength": "light"])
            plugin.haptic(call)
            UIApplication.shared.applicationState = state
            pump()
            check(call.resolved && UIImpactFeedbackGenerator.requests.count == 2, "Non-foreground feedback is skipped at execution time")
            UIApplication.shared.applicationState = .active
            pump()
            check(UIImpactFeedbackGenerator.requests.count == 2, "Skipped feedback is not replayed on return")
        }
        for value in ["heavy", "", 12] as [Any] {
            let invalid = CAPPluginCall(["strength": value]); plugin.haptic(invalid); pump()
            check(invalid.rejected && !invalid.resolved, "Invalid strength rejected")
        }
        let missing = CAPPluginCall([:]); plugin.haptic(missing); pump()
        check(missing.rejected, "Missing strength rejected")
        check(UIImpactFeedbackGenerator.allOnMain && UIImpactFeedbackGenerator.requests.count == 2, "All generator work remains on the main thread")
        print("Passed controlled iOS haptic assertions")
    }
}
`;

test('production iOS haptic method honors main queue, foreground and semantic strength', { timeout: 45_000 }, async context => {
  if (process.platform !== 'darwin') return context.skip('Requires macOS Swift; UIKit compilation and hardware feedback remain unverified.');
  const source = await readFile(path.join(root, 'ios/Sources/BatteryServicePlugin/BatteryServicePlugin.swift'), 'utf8');
  const start = source.indexOf('@objc public func haptic(');
  assert.ok(start >= 0);
  let depth = 0, end = start;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  assert.ok(end > start);
  const method = source.slice(start, end).replace('@objc public ', '');
  const work = path.join(root, 'work');
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(path.join(work, 'ios-haptic-'));
  const swift = path.join(directory, 'HapticHarness.swift'), binary = path.join(directory, 'haptic-harness');
  await writeFile(swift, `${fixtures}\nclass ControlledHapticPlugin {\n${method}\n}\n${harness}`);
  const compilation = spawnSync('xcrun', ['swiftc', '-swift-version', '5', '-parse-as-library', swift, '-o', binary], { encoding: 'utf8', timeout: 25_000 });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.error?.message);
  const execution = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
  assert.match(execution.stdout, /Passed controlled iOS haptic assertions/);
  context.diagnostic(execution.stdout.trim());
});
