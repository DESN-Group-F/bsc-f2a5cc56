import simd
import SwiftUI

/// How Ink feels about the last thing that happened.
enum InkMood: Equatable, Sendable {
    case idle
    case listening   // reader is open: eyes up toward the antenna
    case happy       // accepted tag or confirmed movement (colour turns green, eyes unchanged)
    case puzzled     // duplicate: no colour change, squint and tilt
    case surprised   // refused tag: wide eyes, red
    case shy         // password entry: eyes closed
}

/// The app's character: a flat ink drop with white eyes, simulated as a soft liquid body.
/// Press, drag and let go when `interactive`; the drop, its droplets and its eyes all move on springs.
struct InkView: View {
    var tint: Color
    var mood: InkMood = .idle
    /// Increment to play the reaction for the current mood (hop and splash when happy).
    var reaction: Int = 0
    /// Unit vector (-1...1) the eyes should look toward, e.g. a tapped point.
    var gaze: CGPoint? = nil
    var animated: Bool = true
    /// Kept for source compatibility; the flat style draws no shadow.
    var shadow: Bool = true
    var interactive: Bool = false
    var onTap: (() -> Void)? = nil

    @State private var sim = InkSimulation()
    @State private var touchStart: Date?
    @State private var travelled: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let canvas = side * 1.8
            ZStack {
                TimelineView(.animation(minimumInterval: nil, paused: !animated)) { timeline in
                    let frame = prepare(at: timeline.date.timeIntervalSinceReferenceDate, side: side, canvas: canvas)
                    InkRender(frame: frame)
                        .frame(width: canvas, height: canvas)
                }
                .frame(width: canvas, height: canvas)
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
                .allowsHitTesting(false)

                if interactive {
                    Color.clear
                        .contentShape(Circle())
                        .frame(width: geo.size.width, height: geo.size.height)
                        .gesture(dragGesture(size: geo.size, side: side))
                }
            }
        }
        .onChange(of: reaction) { sim.react() }
        .onChange(of: mood) { _, new in sim.enter(new) }
        .accessibilityHidden(true)
    }

    private func prepare(at t: Double, side: CGFloat, canvas: CGFloat) -> InkFrame {
        sim.reduceMotion = reduceMotion
        sim.setTint(tint)
        if sim.mood != mood { sim.enter(mood) }
        sim.external = gaze.map { SIMD2(Double(max(-1, min(1, $0.x))), Double(max(-1, min(1, $0.y)))) }
        return sim.frame(at: t, side: side, canvas: canvas)
    }

    /// Converts a point in the view to body-radius units relative to the resting centre.
    private func bodyUnits(_ p: CGPoint, size: CGSize, side: CGFloat) -> SIMD2<Double> {
        let R = side * 0.39
        let c = CGPoint(x: size.width / 2, y: size.height / 2 + side * 0.03)
        return SIMD2(Double((p.x - c.x) / R), Double((p.y - c.y) / R))
    }

    private func dragGesture(size: CGSize, side: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let R = side * 0.39
                if touchStart == nil {
                    touchStart = Date()
                    travelled = 0
                    sim.press(at: bodyUnits(value.startLocation, size: size, side: side))
                }
                travelled = max(travelled, hypot(value.translation.width, value.translation.height))
                sim.move(offset: SIMD2(Double(value.translation.width / R), Double(value.translation.height / R)),
                         finger: bodyUnits(value.location, size: size, side: side))
            }
            .onEnded { _ in
                let quick = Date().timeIntervalSince(touchStart ?? Date()) < 0.45
                let tapped = travelled < 10 && quick
                if travelled > side * 0.25 { Haptics.tap() }
                sim.release()
                touchStart = nil
                if tapped { onTap?() }
            }
    }
}

/// Draws one frame: the liquid body on the GPU, the eyes on top.
struct InkRender: View {
    let frame: InkFrame

    var body: some View {
        ZStack {
            Rectangle()
                .fill(Color.black)
                .colorEffect(ShaderLibrary.inkBlob(
                    .float2(frame.center),
                    .float(Float(frame.tilt)),
                    .floatArray(frame.radii),
                    .floatArray(frame.drops.isEmpty ? [-9999, -9999, 0] : frame.drops),
                    .float(Float(frame.goo)),
                    .color(frame.color),
                    .float(Float(frame.shading ? 1 : 0))))
            Canvas { gc, _ in
                drawFace(&gc)
            }
        }
    }

    private func drawFace(_ gc: inout GraphicsContext) {
        gc.translateBy(x: frame.center.x, y: frame.center.y)
        gc.rotate(by: .radians(frame.tilt))
        let R = frame.radius
        for eye in frame.eyes {
            var g = gc
            g.translateBy(x: eye.center.x, y: eye.center.y)
            if eye.angle != 0 { g.rotate(by: .radians(eye.angle)) }
            let rect = CGRect(x: -eye.size.width / 2, y: -eye.size.height / 2, width: eye.size.width, height: max(eye.size.height, R * 0.02))
            g.fill(Path(ellipseIn: rect), with: .color(.white))
        }
        if frame.mood == .puzzled, let first = frame.eyes.first, let last = frame.eyes.last {
            var squiggle = Path()
            let y = first.center.y - R * 0.24
            let x0 = first.center.x - R * 0.06
            let w = (last.center.x - first.center.x) + R * 0.12
            squiggle.move(to: CGPoint(x: x0, y: y))
            squiggle.addQuadCurve(to: CGPoint(x: x0 + w / 3, y: y), control: CGPoint(x: x0 + w / 6, y: y - R * 0.09))
            squiggle.addQuadCurve(to: CGPoint(x: x0 + 2 * w / 3, y: y), control: CGPoint(x: x0 + w / 2, y: y + R * 0.09))
            squiggle.addQuadCurve(to: CGPoint(x: x0 + w, y: y), control: CGPoint(x: x0 + 5 * w / 6, y: y - R * 0.09))
            gc.stroke(squiggle, with: .color(.black.opacity(0.7)), style: StrokeStyle(lineWidth: R * 0.045, lineCap: .round))
        }
        if frame.mood == .surprised {
            var marks = Path()
            marks.move(to: CGPoint(x: R * 0.55, y: -R * 0.98))
            marks.addLine(to: CGPoint(x: R * 0.66, y: -R * 1.18))
            marks.move(to: CGPoint(x: R * 0.84, y: -R * 0.78))
            marks.addLine(to: CGPoint(x: R * 1.04, y: -R * 0.88))
            gc.stroke(marks, with: .color(.primary.opacity(0.75)), style: StrokeStyle(lineWidth: R * 0.05, lineCap: .round))
        }
    }
}
