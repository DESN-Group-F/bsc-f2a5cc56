#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Polynomial smooth minimum: joins shapes like liquid instead of overlapping them.
static float smoothUnion(float a, float b, float k) {
    if (k <= 0.0) { return min(a, b); }
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}

// The ink character's body and droplets as one liquid shape.
// radii: outline radius (points) at evenly spaced angles, starting at the top and going clockwise.
// drops: x, y, r triples (points). goo: how far shapes reach out to merge (points).
// shading: 0 = flat; 1 = a soft hint of depth (darker toward the lower edge, never a highlight).
[[ stitchable ]] half4 inkBlob(float2 position, half4 color,
                               float2 center, float tilt,
                               device const float *radii, int radiiCount,
                               device const float *drops, int dropsCount,
                               float goo, half4 tint, float shading) {
    float2 p = position - center;
    float c = cos(-tilt), s = sin(-tilt);
    float2 q = float2(c * p.x - s * p.y, s * p.x + c * p.y);
    float rho = length(q);
    float n = float(radiiCount);
    float f = (atan2(q.y, q.x) + M_PI_F * 0.5) / (2.0 * M_PI_F) * n;
    f = f - floor(f / n) * n;
    int i1 = int(floor(f)) % radiiCount;
    float t = f - floor(f);
    int i0 = (i1 - 1 + radiiCount) % radiiCount;
    int i2 = (i1 + 1) % radiiCount;
    int i3 = (i1 + 2) % radiiCount;
    float r0 = radii[i0], r1 = radii[i1], r2 = radii[i2], r3 = radii[i3];
    // Catmull-Rom through the outline points keeps the edge smooth.
    float r = 0.5 * ((2.0 * r1) + (-r0 + r2) * t + (2.0 * r0 - 5.0 * r1 + 4.0 * r2 - r3) * t * t
                     + (-r0 + 3.0 * r1 - 3.0 * r2 + r3) * t * t * t);
    float d = rho - r;
    for (int k = 0; k + 2 < dropsCount; k += 3) {
        float radius = drops[k + 2];
        if (radius <= 0.01) { continue; }
        float dd = length(position - float2(drops[k], drops[k + 1])) - radius;
        d = smoothUnion(d, dd, goo);
    }
    // About 0.7 pt of anti-aliasing: crisp but never jagged.
    float coverage = clamp(0.5 - d / 0.7, 0.0, 1.0);
    if (coverage <= 0.0) { return half4(0.0); }
    half3 rgb = tint.rgb;
    if (shading > 0.5) {
        // Gentle: a little lighter at the upper left, a little deeper toward the lower right and the rim.
        float rim = clamp(1.0 + d / max(r * 0.35, 1.0), 0.0, 1.0);
        float2 dir = normalize(p + float2(0.0001, 0.0));
        float side = dot(dir, normalize(float2(0.6, 0.8))) * min(rho / max(r, 1.0), 1.0);
        float shade = 1.0 - 0.10 * side - 0.10 * rim * rim;
        rgb = half3(clamp(float3(rgb) * shade, 0.0, 1.0));
    }
    return half4(rgb * half(coverage) * tint.a, tint.a * half(coverage));
}
