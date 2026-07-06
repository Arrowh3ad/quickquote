import assert from 'node:assert';
import {
  dist, unitsPerPixel, polygonAreaPx, realArea,
  homographyFrom4, applyHomography, rectHomography, realAreaHomography, ellipseFrom3,
} from './geometry.js';

assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);

// 11in sheet spanning 100px → (11/12) ft per 100px
assert.equal(unitsPerPixel({ x: 0, y: 0 }, { x: 0, y: 100 }, 11 / 12), 11 / 12 / 100);
assert.throws(() => unitsPerPixel({ x: 1, y: 1 }, { x: 1, y: 1 }, 1));

// 10x10 px square
assert.equal(polygonAreaPx([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 100);
// concave L-shape, area 3
assert.equal(polygonAreaPx([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }]), 3);
// winding order doesn't matter
assert.equal(polygonAreaPx([{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 }]), 100);

// 100x100px square at 0.1 ft/px → 100 sq ft
assert.equal(realArea([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], 0.1), 100);

// --- homography (angled photo) ---
// ground-truth perspective camera: real feet → image px
const fwd = ({ x: X, y: Y }) => {
  const w = 0.04 * X + 0.01 * Y + 1;
  return { x: (240 * X + 20 * Y + 300) / w, y: (12 * X + 260 * Y + 200) / w };
};
const L = 11 / 12, S = 8.5 / 12; // letter paper in feet
const quad = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: S }, { x: 0, y: S }].map(fwd);
const H = rectHomography(quad, L, S);

// unprojecting a reference corner recovers its real position
const c1 = applyHomography(H, quad[1]);
assert.ok(Math.abs(c1.x - L) < 1e-9 && Math.abs(c1.y) < 1e-9);

// a 3×2 ft rectangle elsewhere on the same plane → exactly 6 sq ft
const poly = [{ x: 2, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 3 }, { x: 2, y: 3 }].map(fwd);
assert.ok(Math.abs(realAreaHomography(poly, H) - 6) < 1e-6);

// concave polygon survives the round trip too (L-shape, 3 sq ft)
const lShape = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }].map(fwd);
assert.ok(Math.abs(realAreaHomography(lShape, H) - 3) < 1e-6);

// collinear reference corners → throws instead of silently garbage
assert.throws(() => homographyFrom4(
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
));

// --- ellipse (3-tap: axis ends + rim point) ---
// circle r=10 → π·100 within the 64-gon tolerance
const circ = ellipseFrom3({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
assert.ok(Math.abs(polygonAreaPx(circ) - Math.PI * 100) < Math.PI * 100 * 0.005);

// rotated ellipse a=4 b=2 at 30°, rim point from the parametric form → π·8
const th = Math.PI / 6, c30 = Math.cos(th), s30 = Math.sin(th);
const P = (ex, ey) => ({ x: ex * c30 - ey * s30, y: ex * s30 + ey * c30 });
const ell = ellipseFrom3(P(-4, 0), P(4, 0), P(4 * Math.cos(1), 2 * Math.sin(1)));
assert.ok(Math.abs(polygonAreaPx(ell) - Math.PI * 8) < Math.PI * 8 * 0.005);

// sampled ellipse survives perspective unprojection: real 2×1 half-axes → π·2 sq ft
const realEll = ellipseFrom3({ x: 1, y: 2 }, { x: 5, y: 2 }, { x: 3, y: 3 });
assert.ok(Math.abs(realAreaHomography(realEll.map(fwd), H) - polygonAreaPx(realEll)) < 1e-6);

// rim point on the axis → throws
assert.throws(() => ellipseFrom3({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0 }));

console.log('geometry ok');
