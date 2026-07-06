// Pure geometry. No DOM, no storage — reusable core for any
// "mark points on an image + reference length → real-world measurement" tool.

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// realLength (any unit) per pixel, from two tapped points on a known-size object.
export function unitsPerPixel(p1, p2, realLength) {
  const px = dist(p1, p2);
  if (!px) throw new Error('reference points are identical');
  return realLength / px;
}

// Shoelace formula. Handles convex and concave simple polygons.
export function polygonAreaPx(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

// Area in real units² (e.g. sq ft if unitsPerPixel is ft/px).
export function realArea(pts, upp) {
  return polygonAreaPx(pts) * upp * upp;
}

// --- Perspective (homography) mode: measure from angled photos. ---
// A rectangle of known real size, tapped at its 4 corners, defines a projective
// map from image pixels to real coordinates on that plane. Only valid for
// surfaces coplanar with the reference.

// Solve the 3x3 homography mapping src[i] → dst[i] (4 point pairs, DLT).
// Returns [a,b,c,d,e,f,g,h,1]: X=(ax+by+c)/w, Y=(dx+ey+f)/w, w=gx+hy+1.
export function homographyFrom4(src, dst) {
  const M = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: X, y: Y } = dst[i];
    M.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
    M.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  // Gauss-Jordan with partial pivoting
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) throw new Error('degenerate reference points');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 9; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [...M.map((row, i) => row[8] / row[i]), 1];
}

export function applyHomography(H, p) {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

// Homography from a tapped image quad (perimeter order, long edge tapped first)
// to a real rectangle of longSide × shortSide.
export function rectHomography(quad, longSide, shortSide) {
  return homographyFrom4(quad, [
    { x: 0, y: 0 }, { x: longSide, y: 0 }, { x: longSide, y: shortSide }, { x: 0, y: shortSide },
  ]);
}

// Area of an image-space polygon, measured in the reference plane's real units².
export function realAreaHomography(pts, H) {
  return polygonAreaPx(pts.map(p => applyHomography(H, p)));
}

// Ellipse from 3 taps — two ends of one axis + a point on the rim — returned as
// an n-gon so every downstream path (shoelace, homography) just works.
// ponytail: 64-gon area error < 0.2%, far below tap precision.
export function ellipseFrom3(p1, p2, p3, n = 64) {
  const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
  const a = dist(p1, p2) / 2;
  const th = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const cos = Math.cos(th), sin = Math.sin(th);
  const dx = p3.x - cx, dy = p3.y - cy;
  const u = dx * cos + dy * sin, v = -dx * sin + dy * cos; // rim point in ellipse frame
  const t = 1 - (u * u) / (a * a);
  if (!a || t <= 1e-9 || !v) throw new Error('rim point must be off the tapped axis');
  const b = Math.abs(v) / Math.sqrt(t);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = 2 * Math.PI * i / n;
    const ex = a * Math.cos(ang), ey = b * Math.sin(ang);
    pts.push({ x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos });
  }
  return pts;
}
