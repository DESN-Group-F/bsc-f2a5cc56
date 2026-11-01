"""Render the flat 2D app icon: a solid blue ink drop with white eyes on a light ground (1024x1024, no alpha)."""
import math, sys
from PIL import Image, ImageDraw

S = 1024
SS = 4
W = S * SS

def blob_points(cx, cy, r, n=8, steps=800):
    pts = []
    for i in range(n):
        th = i / n * 2 * math.pi - math.pi / 2
        wobble = 0.03 * math.sin(i * 1.7) + 0.02 * math.sin(i * 2.9)
        bulge = 0.075 * max(0, math.cos(th + 0.8))
        settle = -0.035 * max(0, math.sin(th))
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

ground = (242, 244, 248)
ink = (29, 99, 237)
img = Image.new("RGB", (W, W), ground)
d = ImageDraw.Draw(img)
cx, cy, r = W * 0.5, W * 0.53, W * 0.31
d.polygon(blob_points(cx, cy, r), fill=ink)
for (a, dist, s) in [(-0.92, 1.20, 0.09), (-0.52, 1.36, 0.048), (2.35, 1.17, 0.058)]:
    x = cx + math.cos(a) * r * dist; y = cy + math.sin(a) * r * dist; rad = r * s
    d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=ink)
ex, ey = cx + r * 0.17, cy + r * 0.02
for dx in (-r * 0.16, r * 0.16):
    rx, ry = r * 0.11, r * 0.155
    d.ellipse([ex + dx - rx, ey - ry, ex + dx + rx, ey + ry], fill=(255, 255, 255))
img = img.resize((S, S), Image.LANCZOS)
img.save(sys.argv[1], "PNG")
print("ok", img.size, img.mode)
