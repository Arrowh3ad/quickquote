// Photo → scale → outline overlay. Decoupled: call openMeasure(cb); cb gets a
// measurement record {label, sqft, photo, points, scalePoints, refMode, ...} or null on cancel.
//
// Two reference modes:
//  - rect: tap 4 corners of a known rectangle (paper, door). Solves a homography,
//    so angled photos measure correctly — for surfaces coplanar with the reference.
//  - line: tap 2 ends of a known length (tape measure). Straight-on photos only.
import { unitsPerPixel, realArea, rectHomography, realAreaHomography, ellipseFrom3 } from './geometry.js';

export function openMeasure(onDone) {
  const el = document.createElement('div');
  el.className = 'measure';
  el.innerHTML = `
    <div class="m-top" id="m-hint">Add a photo that shows a reference object (8.5×11 sheet, door, tape measure).</div>
    <div class="m-stage"><canvas id="m-cv"></canvas></div>
    <div class="m-panel" id="m-photo">
      <label class="button">📷 Take / choose photo<input id="m-file" type="file" accept="image/*" capture="environment" hidden></label>
    </div>
    <div class="m-panel m-col hidden" id="m-scale">
      <select id="m-mode">
        <option value="rect">Rectangle reference — angled photo OK (tap 4 corners)</option>
        <option value="line">Line reference — straight-on photo (tap 2 ends)</option>
      </select>
      <div class="row" id="m-rectrow">
        <select id="m-rref">
          <option value="11,8.5">Letter paper (11 × 8.5 in)</option>
          <option value="17,11">Tabloid paper (17 × 11 in)</option>
          <option value="80,36">Door slab (80 × 36 in)</option>
          <option value="custom">Custom rectangle…</option>
        </select>
        <input id="m-rl" class="hidden" type="number" step="any" min="0" placeholder="long side, in" inputmode="decimal">
        <input id="m-rs" class="hidden" type="number" step="any" min="0" placeholder="short side, in" inputmode="decimal">
      </div>
      <div class="row hidden" id="m-linerow">
        <select id="m-ref">
          <option value="0.916667">Letter paper — long edge (11 in)</option>
          <option value="0.708333">Letter paper — short edge (8.5 in)</option>
          <option value="6.666667">Standard door height (80 in)</option>
          <option value="3">Standard door width (36 in)</option>
          <option value="custom">Custom length…</option>
        </select>
        <input id="m-custom" class="hidden" type="number" step="any" min="0" placeholder="inches" inputmode="decimal">
      </div>
      <button id="m-setscale" disabled>Set scale</button>
    </div>
    <div class="m-panel m-col hidden" id="m-outline">
      <div class="row">
        <span id="m-area" class="m-readout"></span>
        <button id="m-cutpoly" class="ghost">+ ▢ cutout</button>
        <button id="m-cutellipse" class="ghost">+ ◯ cutout</button>
      </div>
      <div class="row">
        <input id="m-label" placeholder="Area name (e.g. Living room wall)">
        <button id="m-save" disabled>Save area</button>
      </div>
    </div>
    <div class="m-bottom">
      <button id="m-cancel">Cancel</button>
      <button id="m-undo">Undo point</button>
    </div>`;
  document.body.appendChild(el);

  const q = s => el.querySelector(s);
  const cv = q('#m-cv'), ctx = cv.getContext('2d');
  const hint = t => q('#m-hint').textContent = t;
  let img = null, photoBlob = null, phase = 'photo';
  let upp = 0, H = null;
  const scalePts = [], polyPts = [], cuts = []; // cuts: {kind:'poly'|'ellipse', pts:[]}, subtracted from the outline

  const cutSamples = c => c.kind === 'ellipse' ? ellipseFrom3(c.pts[0], c.pts[1], c.pts[2]) : c.pts;
  const cutComplete = c => c.pts.length >= 3 && (c.kind !== 'ellipse' || c.pts.length === 3);
  const shapeAreaFt = pts => H ? realAreaHomography(pts, H) : realArea(pts, upp);
  // ponytail: assumes cutouts lie inside the outline (no polygon clipping); that's how they're used
  const netAreaFt = () =>
    Math.max(0, shapeAreaFt(polyPts) - cuts.filter(cutComplete).reduce((t, c) => t + shapeAreaFt(cutSamples(c)), 0));

  const mode = () => q('#m-mode').value;
  const need = () => mode() === 'rect' ? 4 : 2;
  const scaleHint = () => hint(mode() === 'rect'
    ? `Tap the reference's 4 corners — the two ends of its LONG edge first, then around. (${scalePts.length}/4)`
    : `Tap the two ENDS of your reference. (${scalePts.length}/2)`);

  const refFeet = () => {
    const v = q('#m-ref').value;
    return v === 'custom' ? (+q('#m-custom').value || 0) / 12 : +v;
  };
  const rectDims = () => {
    const v = q('#m-rref').value;
    const [l, s] = v === 'custom' ? [+q('#m-rl').value || 0, +q('#m-rs').value || 0] : v.split(',').map(Number);
    return [l / 12, s / 12];
  };
  const updateScaleBtn = () => {
    const valid = mode() === 'rect' ? rectDims().every(d => d > 0) : refFeet() > 0;
    q('#m-setscale').disabled = !(scalePts.length === need() && valid);
  };

  q('#m-file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    img = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const MAX = 1600, k = Math.min(1, MAX / Math.max(img.width, img.height));
    cv.width = Math.round(img.width * k);
    cv.height = Math.round(img.height * k);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    photoBlob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    phase = 'scale';
    q('#m-photo').classList.add('hidden');
    q('#m-scale').classList.remove('hidden');
    scaleHint();
    draw();
  };

  q('#m-mode').onchange = () => {
    scalePts.length = 0;
    q('#m-rectrow').classList.toggle('hidden', mode() !== 'rect');
    q('#m-linerow').classList.toggle('hidden', mode() !== 'line');
    updateScaleBtn();
    scaleHint();
    draw();
  };
  q('#m-ref').onchange = () => {
    q('#m-custom').classList.toggle('hidden', q('#m-ref').value !== 'custom');
    updateScaleBtn();
  };
  q('#m-rref').onchange = () => {
    const c = q('#m-rref').value === 'custom';
    q('#m-rl').classList.toggle('hidden', !c);
    q('#m-rs').classList.toggle('hidden', !c);
    updateScaleBtn();
  };
  q('#m-custom').oninput = q('#m-rl').oninput = q('#m-rs').oninput = updateScaleBtn;

  cv.addEventListener('pointerdown', e => {
    if (!img) return;
    const r = cv.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
    if (phase === 'scale' && scalePts.length < need()) {
      scalePts.push(p);
      updateScaleBtn();
      scaleHint();
    } else if (phase === 'outline') {
      const cut = cuts[cuts.length - 1];
      if (cut && !(cut.kind === 'ellipse' && cut.pts.length === 3)) {
        cut.pts.push(p);
        if (cut.kind === 'ellipse' && cut.pts.length === 3) {
          try { cutSamples(cut); }
          catch { cut.pts.pop(); alert('Tap the rim away from the axis line.'); }
        }
      } else if (!cut) {
        polyPts.push(p);
      }
      updateOutline();
    }
    draw();
  });

  const addCut = kind => {
    if (polyPts.length < 3) return alert('Outline the surface first (3+ points).');
    const last = cuts[cuts.length - 1];
    if (last && !last.pts.length) last.kind = kind;
    else if (last && !cutComplete(last)) return alert('Finish the current cutout first (or Undo it).');
    else cuts.push({ kind, pts: [] });
    updateOutline();
  };
  q('#m-cutpoly').onclick = () => addCut('poly');
  q('#m-cutellipse').onclick = () => addCut('ellipse');

  q('#m-setscale').onclick = () => {
    if (mode() === 'rect') {
      const [L, S] = rectDims();
      try { H = rectHomography(scalePts, L, S); }
      catch { alert('Those corners look collinear — undo and retap them.'); return; }
    } else {
      upp = unitsPerPixel(scalePts[0], scalePts[1], refFeet());
    }
    phase = 'outline';
    q('#m-scale').classList.add('hidden');
    q('#m-outline').classList.remove('hidden');
    hint('Tap the corners of the surface (3+ points), then Save.');
    updateOutline();
    draw();
  };

  function updateOutline() {
    const cut = cuts[cuts.length - 1];
    if (polyPts.length < 3) hint('Tap the corners of the surface (3+ points), then Save.');
    else if (cut && !cutComplete(cut)) hint(cut.kind === 'ellipse'
      ? `Cutout: tap the 2 ends of its widest axis, then a point on the rim. (${cut.pts.length}/3)`
      : `Cutout: tap its corners (3+ points). (${cut.pts.length})`);
    else hint('Add a cutout for windows/doors/mirrors, or Save.');
    q('#m-area').textContent = polyPts.length >= 3
      ? netAreaFt().toFixed(1) + ' sq ft'
      : `${polyPts.length}/3 points`;
    q('#m-save').disabled = !(polyPts.length >= 3 && cuts.every(c => !c.pts.length || cutComplete(c)));
  }

  q('#m-save').onclick = () => {
    onDone({
      label: q('#m-label').value.trim() || 'Area',
      sqft: netAreaFt(),
      photo: photoBlob,
      points: polyPts,
      cuts: cuts.filter(c => c.pts.length).map(c => ({ kind: c.kind, pts: c.pts })),
      scalePoints: scalePts,
      refMode: mode(),
      ...(H ? { refDims: rectDims() } : { refFeet: refFeet() }),
    });
    el.remove();
  };

  q('#m-undo').onclick = () => {
    const cut = cuts[cuts.length - 1];
    if (phase === 'outline' && cut) {
      if (cut.pts.length) cut.pts.pop(); else cuts.pop();
      updateOutline();
    }
    else if (phase === 'outline' && polyPts.length) { polyPts.pop(); updateOutline(); }
    else if (phase === 'scale' && scalePts.length) {
      scalePts.pop();
      updateScaleBtn();
      scaleHint();
    }
    draw();
  };

  q('#m-cancel').onclick = () => { onDone(null); el.remove(); };

  function draw() {
    if (!img) return;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const R = Math.max(5, cv.width / 130);
    ctx.lineWidth = Math.max(2, cv.width / 400);
    const dot = (p, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, 7);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    if (scalePts.length >= 2) {
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath();
      ctx.moveTo(scalePts[0].x, scalePts[0].y);
      scalePts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      if (scalePts.length === 4) ctx.closePath();
      ctx.stroke();
    }
    scalePts.forEach(p => dot(p, '#3b82f6'));
    if (polyPts.length) {
      ctx.beginPath();
      ctx.moveTo(polyPts[0].x, polyPts[0].y);
      polyPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      if (polyPts.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(34,197,94,.28)';
        ctx.fill();
      }
      ctx.strokeStyle = '#22c55e';
      ctx.stroke();
    }
    polyPts.forEach(p => dot(p, '#22c55e'));
    for (const c of cuts) {
      let pts = c.pts;
      if (c.kind === 'ellipse' && c.pts.length === 3) pts = cutSamples(c);
      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        if (pts.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = 'rgba(239,68,68,.3)';
          ctx.fill();
        }
        ctx.strokeStyle = '#ef4444';
        ctx.stroke();
      }
      c.pts.forEach(p => dot(p, '#ef4444'));
    }
  }
}
