"""Render the app icons: Ink, the app's character, cropped large from the lower right, looking up at
droplets it just threw off. Light: white Ink on brand blue. Dark: bright blue Ink on deep navy.
Tinted: grayscale for iOS tinted icons. 1024x1024, no alpha, flat 2D (no highlights or shadow).
Usage: python3 render_icon.py <output-directory>"""
import math, os, sys
from PIL import Image, ImageDraw

S, SS = 1024, 4
W = S * SS
BLUE = (29, 99, 237)      # Tone.checkout, the brand blue
BRIGHT = (62, 128, 255)
NAVY = (11, 18, 38)
WHITE = (255, 255, 255)


def blob(cx, cy, r, squat=1.04, n=8, steps=1600):
    """Ink's outline: a soft, slightly asymmetric drop (same shape rules as InkView)."""
    pts = []
    for i in range(n):
        th = i / n * 2 * math.pi - math.pi / 2
        wobble = 0.018 * math.sin(i * 1.7) + 0.012 * math.sin(i * 2.9)
        bulge = 0.06 * max(0, math.cos(th + 0.8))
        settle = -0.03 * max(0, math.sin(th))
        rr = r * (1 + wobble + bulge + settle)
        pts.append((cx + math.cos(th) * rr * (1 + (squat - 1) * 0.5), cy + math.sin(th) * rr / squat))
    out = []
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        for k in range(steps // n):
            t = k / (steps // n)
            out.append(((1-t)**3*p1[0] + 3*(1-t)**2*t*c1[0] + 3*(1-t)*t**2*c2[0] + t**3*p2[0],
                        (1-t)**3*p1[1] + 3*(1-t)**2*t*c1[1] + 3*(1-t)*t**2*c2[1] + t**3*p2[1]))
    return out


def dot(d, x, y, rad, fill):
    d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=fill)


def render(bg, body, eye):
    img = Image.new("RGB", (W, W), bg)
    d = ImageDraw.Draw(img)
    cx, cy, r = W * 0.66, W * 0.75, W * 0.53
    d.polygon(blob(cx, cy, r), fill=body)
    # Droplets thrown up and to the left: the moment after a hop.
    dot(d, W * 0.205, W * 0.255, W * 0.052, body)
    dot(d, W * 0.325, W * 0.145, W * 0.023, body)
    dot(d, W * 0.125, W * 0.43, W * 0.016, body)
    # Large eyes, set toward the droplets.
    ex, ey = cx - r * 0.21, cy - r * 0.37
    sep, rx, ry = r * 0.1955, r * 0.124, r * 0.163
    for s in (-1, 1):
        d.ellipse([ex + s * sep - rx, ey - ry, ex + s * sep + rx, ey + ry], fill=eye)
    return img.resize((S, S), Image.LANCZOS)


out = sys.argv[1]
render(BLUE, WHITE, BLUE).save(os.path.join(out, "AppIcon-1024.png"), "PNG")
render(NAVY, BRIGHT, WHITE).save(os.path.join(out, "AppIcon-1024-dark.png"), "PNG")
render((0, 0, 0), (235, 235, 235), (0, 0, 0)).convert("L").convert("RGB").save(
    os.path.join(out, "AppIcon-1024-tinted.png"), "PNG")
print("ok")
