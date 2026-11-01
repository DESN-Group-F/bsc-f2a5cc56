import SwiftUI
import UIKit

/// How Ink feels about the last thing that happened.
enum InkMood: Equatable, Sendable {
    case idle
    case listening   // reader is open: eyes up toward the antenna
    case happy       // accepted tag or confirmed movement (colour turns green, eyes unchanged)
    case puzzled     // duplicate: no colour change, squint and tilt
    case surprised   // refused tag: wide eyes, red
}

/// The app's character: a flat 2D ink drop with white eyes.
/// Rendered every frame with Canvas; decorative motion pauses when `animated` is false.
struct InkView: View {
    var tint: Color
    var mood: InkMood = .idle
    /// Increment to play the squash-and-splash reaction.
    var reaction: Int = 0
    /// Unit vector (-1...1) the eyes should look toward, e.g. a tapped point.
    var gaze: CGPoint? = nil
    var animated: Bool = true
    var shadow: Bool = true

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: !animated)) { timeline in
            InkCanvas(time: timeline.date.timeIntervalSinceReferenceDate,
                      color: RGBA(tint), mood: mood, gaze: gaze, shadow: shadow)
        }
        .animation(.easeInOut(duration: 0.28), value: RGBA(tint))
        .keyframeAnimator(initialValue: InkPose(), trigger: reaction) { content, pose in
            content.scaleEffect(x: pose.sx, y: pose.sy, anchor: .bottom)
        } keyframes: { _ in
            KeyframeTrack(\.sx) {
                CubicKeyframe(1.13, duration: 0.09)
                SpringKeyframe(0.95, duration: 0.16, spring: .bouncy)
                SpringKeyframe(1.0, duration: 0.40, spring: .smooth)
            }
            KeyframeTrack(\.sy) {
                CubicKeyframe(0.87, duration: 0.09)
                SpringKeyframe(1.07, duration: 0.16, spring: .bouncy)
                SpringKeyframe(1.0, duration: 0.40, spring: .smooth)
            }
        }
        .accessibilityHidden(true)
    }
}

struct InkPose {
    var sx: CGFloat = 1
    var sy: CGFloat = 1
}

/// Animatable colour so tint changes crossfade inside Canvas.
struct RGBA: Equatable, VectorArithmetic {
    var r: Double, g: Double, b: Double, a: Double

    init(r: Double, g: Double, b: Double, a: Double) { self.r = r; self.g = g; self.b = b; self.a = a }
    init(_ color: Color) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        self.init(r: Double(r), g: Double(g), b: Double(b), a: Double(a))
    }

    var color: Color { Color(red: r, green: g, blue: b, opacity: a) }
    func mixed(with other: RGBA, _ amount: Double) -> RGBA {
        RGBA(r: r + (other.r - r) * amount, g: g + (other.g - g) * amount, b: b + (other.b - b) * amount, a: a)
    }

    static var zero: RGBA { RGBA(r: 0, g: 0, b: 0, a: 0) }
    static func + (l: RGBA, r: RGBA) -> RGBA { RGBA(r: l.r + r.r, g: l.g + r.g, b: l.b + r.b, a: l.a + r.a) }
    static func - (l: RGBA, r: RGBA) -> RGBA { RGBA(r: l.r - r.r, g: l.g - r.g, b: l.b - r.b, a: l.a - r.a) }
    mutating func scale(by rhs: Double) { r *= rhs; g *= rhs; b *= rhs; a *= rhs }
    var magnitudeSquared: Double { r * r + g * g + b * b + a * a }
}

private struct InkCanvas: View, Animatable {
    var time: TimeInterval
    var color: RGBA
    var mood: InkMood
    var gaze: CGPoint?
    var shadow: Bool

    var animatableData: RGBA {
        get { color }
        set { color = newValue }
    }

    var body: some View {
        Canvas { gc, size in
            draw(&gc, size: size)
        }
    }

    // MARK: Drawing

    private func draw(_ gc: inout GraphicsContext, size: CGSize) {
        let side = min(size.width, size.height)
        let radius = side * 0.39
        let center = CGPoint(x: size.width * 0.5, y: size.height * 0.53)
        let t = time

        let fill = GraphicsContext.Shading.color(color.color)

        let tilt: Double = mood == .puzzled ? -0.10 : 0
        if tilt != 0 {
            gc.translateBy(x: center.x, y: center.y)
            gc.rotate(by: .radians(tilt))
            gc.translateBy(x: -center.x, y: -center.y)
        }

        // Flat 2D ink: one solid colour, no highlights or shading.
        for drop in droplets(center: center, radius: radius, t: t) {
            gc.fill(Path(ellipseIn: drop), with: fill)
        }
        gc.fill(blobPath(center: center, radius: radius, t: t), with: fill)

        drawEyes(&gc, center: center, radius: radius, t: t)
        drawMarks(&gc, center: center, radius: radius)
    }

    private func blobPath(center: CGPoint, radius: CGFloat, t: Double) -> Path {
        let count = 8
        let lively = mood == .listening ? 1.6 : 1.0
        var points: [CGPoint] = []
        for i in 0..<count {
            let theta = Double(i) / Double(count) * 2 * .pi - .pi / 2
            let fi = Double(i)
            var wobble = 0.042 * sin(t * 0.9 * lively + fi * 1.7)
            wobble += 0.028 * sin(t * 1.6 * lively + fi * 2.9)
            wobble += 0.018 * sin(t * 2.4 * lively + fi * 0.7)
            let bulge = 0.075 * max(0, cos(theta + 0.8))            // fuller upper right
            let settle = -0.035 * max(0, sin(theta))                 // slightly flatter base
            let r = radius * CGFloat(1 + wobble + bulge + settle)
            points.append(CGPoint(x: center.x + CGFloat(cos(theta)) * r, y: center.y + CGFloat(sin(theta)) * r))
        }
        var path = Path()
        path.move(to: points[0])
        for i in 0..<count {
            let p0 = points[(i - 1 + count) % count]
            let p1 = points[i]
            let p2 = points[(i + 1) % count]
            let p3 = points[(i + 2) % count]
            let c1 = CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6)
            let c2 = CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
            path.addCurve(to: p2, control1: c1, control2: c2)
        }
        path.closeSubpath()
        return path
    }

    private func droplets(center: CGPoint, radius: CGFloat, t: Double) -> [CGRect] {
        let specs: [(angle: Double, distance: CGFloat, size: CGFloat, phase: Double)] = [
            (-0.92, 1.20, 0.090, 0.0), (-0.52, 1.36, 0.048, 1.4), (2.35, 1.17, 0.058, 2.7)
        ]
        return specs.map { s in
            let drift = CGFloat(sin(t * 1.2 + s.phase)) * radius * 0.04
            let x = center.x + CGFloat(cos(s.angle)) * radius * s.distance
            let y = center.y + CGFloat(sin(s.angle)) * radius * s.distance + drift
            let d = radius * s.size * 2
            return CGRect(x: x - d / 2, y: y - d / 2, width: d, height: d)
        }
    }

    private func drawEyes(_ gc: inout GraphicsContext, center: CGPoint, radius: CGFloat, t: Double) {
        var rx = radius * 0.088
        var ry = radius * 0.125
        switch mood {
        case .puzzled: ry *= 0.42
        case .surprised: rx *= 1.3; ry *= 1.3
        default: break
        }
        let look = lookVector(t: t)
        let blink = blinkScale(t: t)
        let anchor = CGPoint(x: center.x + radius * 0.17 + look.x * radius * 0.10,
                             y: center.y + radius * 0.02 + look.y * radius * 0.09)
        let spacing = radius * 0.27
        for dx in [-spacing / 2, spacing / 2] {
            let h = ry * 2 * (mood == .surprised ? 1 : blink)
            let rect = CGRect(x: anchor.x + dx - rx, y: anchor.y - h / 2, width: rx * 2, height: h)
            gc.fill(Path(ellipseIn: rect), with: .color(.white))
        }
        if mood == .puzzled {
            var squiggle = Path()
            let y = anchor.y - radius * 0.24
            let x0 = anchor.x - spacing * 0.75
            squiggle.move(to: CGPoint(x: x0, y: y))
            squiggle.addQuadCurve(to: CGPoint(x: x0 + spacing * 0.5, y: y), control: CGPoint(x: x0 + spacing * 0.25, y: y - radius * 0.09))
            squiggle.addQuadCurve(to: CGPoint(x: x0 + spacing, y: y), control: CGPoint(x: x0 + spacing * 0.75, y: y + radius * 0.09))
            squiggle.addQuadCurve(to: CGPoint(x: x0 + spacing * 1.5, y: y), control: CGPoint(x: x0 + spacing * 1.25, y: y - radius * 0.09))
            gc.stroke(squiggle, with: .color(.black.opacity(0.7)), style: StrokeStyle(lineWidth: radius * 0.045, lineCap: .round))
        }
    }

    private func drawMarks(_ gc: inout GraphicsContext, center: CGPoint, radius: CGFloat) {
        guard mood == .surprised else { return }
        var marks = Path()
        marks.move(to: CGPoint(x: center.x + radius * 0.55, y: center.y - radius * 0.98))
        marks.addLine(to: CGPoint(x: center.x + radius * 0.66, y: center.y - radius * 1.18))
        marks.move(to: CGPoint(x: center.x + radius * 0.84, y: center.y - radius * 0.78))
        marks.addLine(to: CGPoint(x: center.x + radius * 1.04, y: center.y - radius * 0.88))
        gc.stroke(marks, with: .color(.primary.opacity(0.75)), style: StrokeStyle(lineWidth: radius * 0.05, lineCap: .round))
    }

    // MARK: Gaze and blink

    private func lookVector(t: Double) -> CGPoint {
        if let gaze { return CGPoint(x: max(-1, min(1, gaze.x)), y: max(-1, min(1, gaze.y))) }
        switch mood {
        case .listening: return CGPoint(x: 0.15, y: -0.9)
        case .puzzled: return CGPoint(x: -0.5, y: 0.2)
        case .surprised: return .zero
        default: break
        }
        // Occasional small glances, eased between pseudo-random targets.
        let period = 2.6
        let segment = floor(t / period)
        let progress = min(1, (t - segment * period) / 0.35)
        let eased = progress * progress * (3 - 2 * progress)
        let from = glance(Int(segment) - 1)
        let to = glance(Int(segment))
        return CGPoint(x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased)
    }

    private func glance(_ segment: Int) -> CGPoint {
        let a = noise(segment, 1), b = noise(segment, 2), c = noise(segment, 3)
        if c < 0.45 { return .zero }  // often look straight ahead
        return CGPoint(x: (a * 2 - 1) * 0.8, y: (b * 2 - 1) * 0.5)
    }

    private func noise(_ n: Int, _ salt: Int) -> Double {
        let v = sin(Double(n) * 12.9898 + Double(salt) * 78.233) * 43758.5453
        return v - floor(v)
    }

    private func blinkScale(t: Double) -> CGFloat {
        let phase = t.truncatingRemainder(dividingBy: 4.7)
        guard phase < 0.14 else { return 1 }
        let x = phase / 0.14
        return CGFloat(max(0.1, abs(1 - 2 * x)))
    }
}
