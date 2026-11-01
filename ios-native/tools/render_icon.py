"""Render the app icons: a white ink character on brand blue (light), blue on deep navy (dark),
and a grayscale version for iOS tinted icons. 1024x1024, no alpha.
Usage: python3 render_icon.py <output-directory>"""
import math, os, sys
from PIL import Image, ImageDraw

S = 1024
SS = 4
W = S * SS
BLUE = (29, 99, 237)      # Tone.checkout, the brand blue
NAVY = (14, 21, 40)
WHITE = (255, 255, 255)


def blob(cx, cy, r, n=8, steps=1600):
    """The ink character's outline: a soft, slightly asymmetric drop (same shape rules as InkView)."""
    pts = []
    for i in range(n):
        th = i / n * 2 * math.pi - math.pi / 2
        wobble = 0.018 * math.sin(i * 1.7) + 0.012 * math.sin(i * 2.9)
        bulge = 0.06 * max(0, math.cos(th + 0.8))
        settle = -0.03 * max(0, math.sin(th))
        rr = r * (1 + wobble + bulge + settle)
        pts.append((cx + math.cos(th) * rr, cy + math.sin(th) * rr))
    out = []
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        for k in range(steps // n):
            t = k / (steps // n)
            x = (1-t)**3*p1[0] + 3*(1-t)**2*t*c1[0] + 3*(1-t)*t**2*c2[0] + t**3*p2[0]
            y = (1-t)**3*p1[1] + 3*(1-t)**2*t*c1[1] + 3*(1-t)*t**2*c2[1] + t**3*p2[1]
            out.append((x, y))
    return out


def render(bg, body, eye):
    img = Image.new("RGB", (W, W), bg)
    d = ImageDraw.Draw(img)
    cx, cy, r = W * 0.5, W * 0.525, W * 0.29
    d.polygon(blob(cx, cy, r), fill=body)
    # One droplet, upper right: enough character without clutter.
    a, dist, s = -0.95, 1.25, 0.095
    x, y, rad = cx + math.cos(a) * r * dist, cy + math.sin(a) * r * dist, r * s
    d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=body)
    # Eyes, glancing slightly right, sized to stay readable at small icon sizes.
    ex, ey = cx + r * 0.14, cy
    for dx in (-r * 0.2, r * 0.2):
        rx, ry = r * 0.13, r * 0.185
        d.ellipse([ex + dx - rx, ey - ry, ex + dx + rx, ey + ry], fill=eye)
    return img.resize((S, S), Image.LANCZOS)


out = sys.argv[1]
render(BLUE, WHITE, BLUE).save(os.path.join(out, "AppIcon-1024.png"), "PNG")
render(NAVY, BLUE, WHITE).save(os.path.join(out, "AppIcon-1024-dark.png"), "PNG")
render((0, 0, 0), (235, 235, 235), (0, 0, 0)).convert("L").convert("RGB").save(os.path.join(out, "AppIcon-1024-tinted.png"), "PNG")
print("ok")
