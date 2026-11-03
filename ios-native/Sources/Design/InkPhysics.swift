import simd
import SwiftUI
import UIKit

/// Feel parameters for the ink character. Adjustable on the Ink playground page and saved on the phone.
struct InkTuning: Codable, Equatable {
    var stiffness = 62.0        // how firmly the outline returns to its shape
    var damping = 4.6           // how quickly wobbles die out
    var coupling = 150.0        // how much neighbouring parts of the outline pull together
    var pressure = 44.0         // volume keeping: squash one side and the others bulge
    var follow = 32.0           // how tightly the body follows a drag
    var followDamping = 6.0     // how much it overshoots when let go
    var inertia = 0.32          // how much it stretches behind fast movement
    var goo = 0.14              // how far droplets reach out to merge (× body radius)
    var liveliness = 1.0        // idle breathing, gurgles and glances
    var eyeSpeed = 1.0          // how quick the eyes are
    var shading = false         // a soft hint of depth, never a glossy highlight

    static let defaults = InkTuning()
    private static let key = "inkTuning.v1"

    @MainActor static var shared: InkTuning = load()

    static func load() -> InkTuning {
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONDecoder().decode(InkTuning.self, from: data) else { return InkTuning() }
        return saved
    }

    @MainActor static func save(_ tuning: InkTuning) {
        shared = tuning
        if let data = try? JSONEncoder().encode(tuning) { UserDefaults.standard.set(data, forKey: key) }
    }
}

/// Simple colour value that can be interpolated frame by frame.
struct RGBA: Equatable {
    var r: Double, g: Double, b: Double, a: Double

    init(r: Double, g: Double, b: Double, a: Double) { self.r = r; self.g = g; self.b = b; self.a = a }
    init(_ color: Color) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        self.init(r: Double(r), g: Double(g), b: Double(b), a: Double(a))
    }

    var color: Color { Color(red: r, green: g, blue: b, opacity: a) }
    func mixed(toward other: RGBA, _ t: Double) -> RGBA {
        RGBA(r: r + (other.r - r) * t, g: g + (other.g - g) * t, b: b + (other.b - b) * t, a: a + (other.a - a) * t)
    }
}

/// One rendered frame of the ink character, in points within the drawing canvas.
struct InkFrame {
    var center: CGPoint
    var radius: CGFloat
    var radii: [Float]
    var drops: [Float]          // x, y, r triples
    var tilt: Double
    var goo: CGFloat
    var color: Color
    var shading: Bool
    var eyes: [EyeShape]
    var mood: InkMood

    struct EyeShape {
        var center: CGPoint     // relative to the body centre, before tilt
        var size: CGSize
        var angle: Double       // stretch direction while moving
    }
}

/// Soft-body simulation of the ink character. The outline is a ring of springy points that keeps
/// its volume; the body follows a spring anchor (or a finger); droplets fly off and flow back;
/// the eyes move on their own springs with blinks and glances.
@MainActor
final class InkSimulation {
    static let count = 40

    private let angles: [Double]
    private let rest: [Double]
    private var u: [Double]
    private var v: [Double]

    private var center = SIMD2<Double>(0, 0)
    private var centerV = SIMD2<Double>(0, 0)
    private var centerA = SIMD2<Double>(0, 0)
    private var drag: SIMD2<Double>?
    private var finger: SIMD2<Double>?
    private var wasAirborne = false

    private var scale = 1.0, scaleV = 0.0
    private var tilt = 0.0, tiltV = 0.0
    private var breath = 1.0

    private struct Drop { var p: SIMD2<Double>; var v: SIMD2<Double>; var r: Double; var age: Double }
    private struct Satellite { var home: SIMD2<Double>; var p: SIMD2<Double>; var v: SIMD2<Double>; var r: Double; var phase: Double }
    private var drops: [Drop] = []
    private var satellites: [Satellite]

    private var gaze = SIMD2<Double>(0, 0), gazeV = SIMD2<Double>(0, 0)
    private var glance = SIMD2<Double>(0, 0), nextGlance = 1.2
    private var blinkStart = -10.0, nextBlink = 2.4, pendingDouble = false
    private var shiverStart = -10.0, shiverUntil = -10.0
    private var nextGurgle = 1.8
    private var time: Double?

    private(set) var mood: InkMood = .idle
    private var color = RGBA(r: 0.07, g: 0.07, b: 0.09, a: 1)
    private var targetColor = RGBA(r: 0.07, g: 0.07, b: 0.09, a: 1)
    private var lastTint: Color?
    private var started = false
    var reduceMotion = false

    private var tuning: InkTuning { InkTuning.shared }
    private var live: Double { reduceMotion ? 0 : tuning.liveliness }

    init() {
        let n = Self.count
        angles = (0..<n).map { Double($0) / Double(n) * 2 * .pi - .pi / 2 }
        // Fuller upper right, slightly settled base: the owner's ink shape.
        rest = angles.map { th in 1 + 0.07 * max(0, cos(th + 0.8)) - 0.035 * max(0, sin(th)) }
        u = Array(repeating: 0, count: n)
        v = Array(repeating: 0, count: n)
        satellites = [
            Satellite(home: Self.polar(-0.92, 1.31), p: Self.polar(-0.92, 1.31), v: .zero, r: 0.095, phase: 0),
            Satellite(home: Self.polar(-0.50, 1.46), p: Self.polar(-0.50, 1.46), v: .zero, r: 0.05, phase: 1.7),
            Satellite(home: Self.polar(2.35, 1.24), p: Self.polar(2.35, 1.24), v: .zero, r: 0.06, phase: 3.1),
        ]
    }

    private static func polar(_ angle: Double, _ distance: Double) -> SIMD2<Double> {
        SIMD2(cos(angle) * distance, sin(angle) * distance)
    }

    // MARK: Inputs

    func setTint(_ tint: Color) {
        guard tint != lastTint else { return }
        lastTint = tint
        targetColor = RGBA(tint)
        if !started { color = targetColor }
    }

    func enter(_ newMood: InkMood) {
        let old = mood
        mood = newMood
        guard newMood != old, !reduceMotion else { return }
        switch newMood {
        case .puzzled: wobble()
        case .surprised: shiver()
        case .listening: inflate(0.5)
        case .shy: inflate(-0.6)
        default: break
        }
    }

    /// A reaction counter ticked: play the reaction for the current mood.
    func react() {
        guard !reduceMotion else { return }
        switch mood {
        case .puzzled: wobble()
        case .surprised: shiver()
        default: hop(splash: mood == .happy)
        }
    }

    /// Finger down at a point (body-radius units, relative to the resting centre).
    func press(at point: SIMD2<Double>) {
        finger = point
        let dir = simd_normalize(point - center + SIMD2(0.0001, 0))
        for i in 0..<Self.count {
            let n = SIMD2(cos(angles[i]), sin(angles[i]))
            let facing = simd_dot(n, dir)
            v[i] -= 2.6 * pow(max(0, facing), 2)
        }
        scaleV -= 0.9
        Haptics.tap()
    }

    /// Finger moved: the body follows on an elastic leash.
    func move(offset: SIMD2<Double>, finger point: SIMD2<Double>) {
        finger = point
        let m = simd_length(offset)
        drag = m < 0.0001 ? .zero : offset * (0.62 * tanh(m / 0.62) / m)
    }

    func release() {
        let wasDragged = (drag.map { simd_length($0) } ?? 0) > 0.12
        drag = nil
        finger = nil
        for i in 0..<Self.count { v[i] += wasDragged ? 0.4 : 1.1 }
        scaleV += 0.6
    }

    // MARK: Reactions

    private func hop(splash: Bool) {
        centerV.y -= 2.3
        for i in 0..<Self.count {
            v[i] += 1.6 * (abs(sin(angles[i])) - 0.55)
        }
        if splash {
            let count = Int.random(in: 1...2)
            for k in 0..<count {
                let a = -1.05 + Double.random(in: -0.35...0.35) + Double(k) * 0.5
                let dir = SIMD2(cos(a), sin(a))
                drops.append(Drop(p: center + dir * 0.95, v: dir * Double.random(in: 2.1...2.9) + SIMD2(0, -1.4),
                                  r: Double.random(in: 0.10...0.15), age: 0))
            }
        }
        for s in satellites.indices { satellites[s].v += SIMD2(Double.random(in: -1...1), -1.6) }
    }

    private func wobble() {
        for i in 0..<Self.count { v[i] += 1.2 * cos(2 * angles[i]) }
        tiltV -= 1.4
    }

    private func shiver() {
        let now = time ?? 0
        shiverStart = now
        shiverUntil = now + 0.55
        centerV.y -= 0.9
        scaleV -= 0.8
    }

    private func inflate(_ amount: Double) {
        for i in 0..<Self.count { v[i] += amount }
    }

    private func squash(_ strength: Double) {
        for i in 0..<Self.count {
            let s = sin(angles[i])
            v[i] -= strength * max(0, s) * 1.6
            v[i] += strength * abs(cos(angles[i])) * 0.5
        }
    }

    // MARK: Simulation

    func frame(at t: Double, side: CGFloat, canvas: CGFloat) -> InkFrame {
        advance(to: t)
        let R = side * 0.39
        let base = CGPoint(x: canvas / 2, y: canvas / 2 + side * 0.03)
        func point(_ p: SIMD2<Double>) -> CGPoint { CGPoint(x: base.x + CGFloat(p.x) * R, y: base.y + CGFloat(p.y) * R) }
        let c = point(center)
        let radii = (0..<Self.count).map { Float((rest[$0] * scale * breath + u[$0]) * Double(R)) }
        var dropValues: [Float] = []
        for s in satellites {
            let p = point(s.p)
            dropValues += [Float(p.x), Float(p.y), Float(s.r * Double(R))]
        }
        for d in drops {
            let p = point(d.p)
            dropValues += [Float(p.x), Float(p.y), Float(d.r * Double(R) * min(1, d.age * 8))]
        }
        return InkFrame(center: c, radius: R, radii: radii, drops: dropValues, tilt: tilt,
                        goo: CGFloat(tuning.goo) * R, color: color.color, shading: tuning.shading,
                        eyes: eyes(R: Double(R)), mood: mood)
    }

    private func advance(to t: Double) {
        guard let last = time else { time = t; started = true; return }
        let dt = min(max(t - last, 0), 1.0 / 15)
        time = t
        guard dt > 0 else { return }
        let h = 1.0 / 240
        var elapsed = 0.0
        while elapsed < dt - 1e-9 {
            let step = min(h, dt - elapsed)
            integrate(step, now: last + elapsed)
            elapsed += step
        }
        updateEyes(dt, now: t)
        color = color.mixed(toward: targetColor, 1 - exp(-dt / 0.12))
    }

    private func integrate(_ h: Double, now: Double) {
        let n = Self.count
        let k = tuning
        var anchor = SIMD2<Double>(0, 0)
        var scaleTarget = 1.0
        var tiltTarget = 0.0
        switch mood {
        case .listening: anchor.y = -0.05
        case .surprised: scaleTarget = 0.9
        case .shy: scaleTarget = 0.95; tiltTarget = 0.07; anchor.x = -0.03
        case .puzzled: tiltTarget = -0.13
        default: break
        }
        breath = 1 + live * (mood == .listening ? 0.022 * sin(now * 3.4) : 0.013 * sin(now * 1.6))

        // Body centre on a spring (or a finger's elastic leash).
        let target = drag ?? anchor
        let stiffness = drag == nil ? k.follow : k.follow * 1.7
        let a = (target - center) * stiffness - centerV * k.followDamping
        centerV += a * h
        center += centerV * h
        centerA = a
        if center.y < -0.08 { wasAirborne = true }
        else if wasAirborne && center.y > -0.01 && centerV.y > 0.5 {
            wasAirborne = false
            squash(min(centerV.y * 0.4, 1.3))
        }

        scaleV += (95 * (scaleTarget - scale) - 9 * scaleV) * h
        scale += scaleV * h
        tiltV += (60 * (tiltTarget - tilt) - 7 * tiltV) * h
        tilt += tiltV * h

        // Outline: springs + neighbour coupling + volume pressure + inertia.
        var area = 0.0, area0 = 0.0
        for i in 0..<n {
            let r0 = rest[i] * scale * breath
            let r = r0 + u[i]
            area += r * r
            area0 += r0 * r0
        }
        let pressure = k.pressure * (area0 - area) / area0
        let shiver = now < shiverUntil ? (1 - (now - shiverStart) / max(shiverUntil - shiverStart, 0.01)) : 0
        for i in 0..<n {
            let lap = u[(i + n - 1) % n] + u[(i + 1) % n] - 2 * u[i]
            let dir = SIMD2(cos(angles[i]), sin(angles[i]))
            var acc = -k.stiffness * u[i] - k.damping * v[i] + k.coupling * lap + pressure - k.inertia * simd_dot(a, dir)
            if shiver > 0 { acc += shiver * 95 * sin(now * 48 + Double(i) * 2.4) }
            v[i] += acc * h
        }
        for i in 0..<n { u[i] = min(max(u[i] + v[i] * h, -0.5), 0.75) }

        // Idle gurgles: small, irregular lumps that travel around the outline.
        if live > 0 && now > nextGurgle {
            let j = Int.random(in: 0..<n)
            let kick = Double.random(in: 0.5...0.95) * live * (Bool.random() ? 1 : -0.6)
            v[j] += kick
            v[(j + 1) % n] += kick * 0.6
            v[(j + n - 1) % n] += kick * 0.6
            nextGurgle = now + Double.random(in: 2.2...5.2)
        }

        // Thrown droplets: arc out, fall back and flow into the body.
        for index in drops.indices.reversed() {
            var d = drops[index]
            d.age += h
            d.v.y += 7.5 * h
            let toBody = center - d.p
            let dist = simd_length(toBody)
            if dist > 0.001 { d.v += toBody / dist * 3.5 * h }
            d.v *= (1 - 0.4 * h)
            d.p += d.v * h
            drops[index] = d
            if (d.age > 0.3 && dist < 0.82) || d.age > 3.5 {
                let angle = atan2(d.p.y - center.y, d.p.x - center.x)
                let idx = Int(((angle + .pi / 2) / (2 * .pi) * Double(n)).rounded())
                let j = ((idx % n) + n) % n
                v[j] += 1.4
                v[(j + 1) % n] += 0.8
                v[(j + n - 1) % n] += 0.8
                drops.remove(at: index)
            }
        }

        // Satellite droplets trail the body on their own springs and drift a little.
        for s in satellites.indices {
            var sat = satellites[s]
            let c = cos(tilt), sn = sin(tilt)
            let home = SIMD2(c * sat.home.x - sn * sat.home.y, sn * sat.home.x + c * sat.home.y) * scale
            let drift = SIMD2(sin(now * 0.9 + sat.phase), cos(now * 0.7 + sat.phase * 1.3)) * 0.035 * live
            let goal = center + home + drift
            sat.v += ((goal - sat.p) * 26 - sat.v * 3.4) * h
            sat.p += sat.v * h
            satellites[s] = sat
        }
    }

    // MARK: Eyes

    private func updateEyes(_ dt: Double, now: Double) {
        let target: SIMD2<Double>
        if let finger {
            let d = finger - center
            let m = simd_length(d)
            target = m < 0.001 ? .zero : d / m * min(1, m * 0.9)
        } else if let external {
            target = external
        } else {
            switch mood {
            case .listening: target = SIMD2(0.15, -0.9)
            case .shy: target = SIMD2(-0.2, 0.6)
            case .puzzled: target = SIMD2(-0.5, 0.2)
            case .surprised: target = .zero
            default:
                if live > 0 && now > nextGlance {
                    glance = Double.random(in: 0...1) < 0.42 ? .zero
                        : SIMD2(Double.random(in: -0.85...0.85), Double.random(in: -0.55...0.5))
                    nextGlance = now + Double.random(in: 1.3...3.8)
                }
                target = glance
            }
        }
        // Quick, slightly springy saccades.
        let stiffness = 260 * tuning.eyeSpeed * tuning.eyeSpeed
        let damping = 2 * sqrt(stiffness) * 0.72
        var t = 0.0
        while t < dt {
            let h = min(1.0 / 240, dt - t)
            gazeV += ((target - gaze) * stiffness - gazeV * damping) * h
            gaze += gazeV * h
            t += h
        }
        if mood != .surprised && mood != .shy && now > nextBlink {
            blinkStart = now
            if pendingDouble {
                pendingDouble = false
                nextBlink = now + Double.random(in: 2.4...5.8)
            } else if Double.random(in: 0...1) < 0.22 {
                pendingDouble = true
                nextBlink = now + 0.26
            } else {
                nextBlink = now + Double.random(in: 2.4...5.8)
            }
        }
    }

    /// Set by the parent view, e.g. where the user tapped nearby. Unit vector space.
    var external: SIMD2<Double>?

    private func openness(now: Double) -> Double {
        if mood == .shy { return 0.14 }
        let x = (now - blinkStart) / 0.15
        guard x >= 0 && x < 1 else { return 1 }
        // Quick close, slightly slower open with a tiny overshoot.
        if x < 0.4 { return 1 - 0.9 * (x / 0.4) }
        let y = (x - 0.4) / 0.6
        return 0.1 + 0.95 * y - 0.05 * sin(y * .pi)
    }

    private func eyes(R: Double) -> [InkFrame.EyeShape] {
        let now = time ?? 0
        // Larger eyes, set a little lower: the same face as the app icon.
        var rx = 0.1, ry = 0.142
        switch mood {
        case .puzzled: ry *= 0.42
        case .surprised: rx *= 1.3; ry *= 1.3
        default: break
        }
        // Eyes squash with the body: compare width with height of the outline.
        let n = Self.count
        func r(_ i: Int) -> Double { rest[i] * scale * breath + u[i] }
        let width = r(n / 4) + r(3 * n / 4)
        let height = r(0) + r(n / 2)
        let squash = min(max(width / max(height, 0.01), 0.7), 1.4)
        rx *= pow(squash, 0.6)
        ry /= pow(squash, 0.6)
        // While moving fast, eyes stretch along their motion: the "silky" part.
        let speed = simd_length(gazeV)
        let stretch = min(speed * 0.06, 0.35)
        let angle = speed > 0.01 ? atan2(gazeV.y, gazeV.x) : 0
        let open = mood == .surprised ? 1 : openness(now: now)
        let anchor = SIMD2(0.15 + gaze.x * 0.11, 0.07 + gaze.y * 0.10)
        // Follow the local bulge of the outline in the eyes' direction.
        let ea = atan2(anchor.y, anchor.x)
        let idx = (Int(((ea + .pi / 2) / (2 * .pi) * Double(n)).rounded()) % n + n) % n
        let local = 1 + u[idx] * 0.6
        let spacing = 0.29 * (1 + (squash - 1) * 0.5)
        return [-1.0, 1.0].map { side in
            let p = SIMD2(anchor.x * local + side * spacing / 2, anchor.y * local)
            return InkFrame.EyeShape(center: CGPoint(x: p.x * R, y: p.y * R),
                                     size: CGSize(width: rx * 2 * R * (1 + stretch * 0.5), height: ry * 2 * R * open * (1 - stretch * 0.15)),
                                     angle: stretch > 0.02 ? angle : 0)
        }
    }
}
