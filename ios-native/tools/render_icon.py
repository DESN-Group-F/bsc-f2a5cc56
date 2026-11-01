"""Render the app icon: a lit ink drop with white eyes on a deep night-blue ground (1024x1024, no alpha)."""
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 1024
SS = 2  # supersample
W = S * SS

def blob_points(cx, cy, r, n=8, steps=400):
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

# Background: deep blue-black with a soft light from upper left.
yy, xx = np.mgrid[0:W, 0:W].astype(np.float32) / W
top = np.array([27, 36, 74], np.float32); bottom = np.array([8, 10, 22], np.float32)
t = np.clip(0.55 * yy + 0.45 * xx, 0, 1)[..., None]
bg = top * (1 - t) + bottom * t
glow = np.exp(-(((xx - 0.42) ** 2 + (yy - 0.40) ** 2) / 0.09))[..., None]
bg = bg + glow * np.array([40, 70, 160], np.float32) * 0.55
img = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), "RGB")

cx, cy, r = W * 0.5, W * 0.53, W * 0.30
pts = blob_points(cx, cy, r)
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).polygon(pts, fill=255)
main_mask = mask.copy()
for (a, d, s) in [(-0.92, 1.20, 0.09), (-0.52, 1.36, 0.048), (2.35, 1.17, 0.058)]:
    x = cx + math.cos(a) * r * d; y = cy + math.sin(a) * r * d; rad = r * s
    ImageDraw.Draw(mask).ellipse([x - rad, y - rad, x + rad, y + rad], fill=255)

# Ink body: blue checkout tone with volume (light top-left, dark bottom-right).
base = np.array([29, 99, 237], np.float32)
light = base + (255 - base) * 0.30
dark = base * 0.55
g = np.clip(((xx * W - (cx - r)) + (yy * W - (cy - r))) / (4 * r), 0, 1)[..., None]
body = light * (1 - g) ** 1.2 + dark * g ** 0.9 + base * 0.0
body = np.clip(body, 0, 255)
# Inner rim shadow
m = np.array(mask, np.float32) / 255
mm = np.array(main_mask, np.float32) / 255
edge = np.array(main_mask.filter(ImageFilter.GaussianBlur(W * 0.03)), np.float32) / 255
rim = np.clip((1 - edge) * 1.6, 0, 1)[..., None] * mm[..., None]
body = body * (1 - 0.45 * rim)
ink = Image.fromarray(body.astype(np.uint8), "RGB")
# Shadow under the drop
sh = Image.new("L", (W, W), 0)
ImageDraw.Draw(sh).ellipse([cx - r * 0.75, cy + r * 0.92, cx + r * 0.75, cy + r * 1.16], fill=120)
sh = sh.filter(ImageFilter.GaussianBlur(W * 0.025))
img = Image.composite(Image.new("RGB", (W, W), (2, 4, 12)), img, sh)
img = Image.composite(ink, img, mask)
# Sheen + glint
sheen = Image.new("L", (W, W), 0)
d = ImageDraw.Draw(sheen)
d.ellipse([cx - r * 0.66, cy - r * 0.66, cx - r * 0.06, cy - r * 0.34], fill=140)
sheen = sheen.rotate(18, center=(cx - r * 0.36, cy - r * 0.5)).filter(ImageFilter.GaussianBlur(W * 0.02))
sheen = Image.fromarray((np.array(sheen, np.float32) * m).astype(np.uint8))
img = Image.composite(Image.new("RGB", (W, W), (255, 255, 255)), img, sheen)
d = ImageDraw.Draw(img)
gx, gy, gr = cx - r * 0.55, cy - r * 0.51, r * 0.05
d.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=(235, 242, 255))
# Eyes
ex, ey = cx + r * 0.17, cy + r * 0.02
for dx in (-r * 0.135, r * 0.135):
    rx, ry = r * 0.088, r * 0.125
    d.ellipse([ex + dx - rx, ey - ry, ex + dx + rx, ey + ry], fill=(255, 255, 255))

img = img.resize((S, S), Image.LANCZOS)
img.save(sys.argv[1], "PNG")
print("ok", img.size, img.mode)
