// The Strawberry Slip Dress: a Y2K runway slip dress. Sheer blush organza over a short, opaque
// pearl-pink satin slip, with tiny embroidered strawberries and a sprinkle of crystals. Drawn
// entirely in code like the stage itself. No image files, no libraries.
//
//   import { mountDress } from './product/dress.js';
//   const stop = mountDress(document.querySelector('#dress'));
//
// Give the canvas a CSS width and height (it paints at that size x devicePixelRatio). The
// background stays TRANSPARENT: the organza is genuinely sheer, so whatever sits behind the canvas
// (the glass card, the runway) shows through it.
//
// How it is painted (once, into an offscreen buffer):
//   1. The satin pieces (inner back, straps, slip) are shapes in a 1000 x 1160 design space with a
//      list of folds. Each gets a HEIGHT MAP (the shape blurred into a soft dome, plus blurred
//      ridge and valley strokes), and the surface normal is lit like a studio: diffuse key light
//      from the upper left and a broad, vertically stretched satin highlight.
//   2. The organza is one shape over the top. Its folds are a few sine waves across the width
//      (a fan: tight at the bodice, opening toward the hem). Sheer fabric looks denser where it
//      turns away from you or doubles over, so its ALPHA follows the fold slope, a few drawn
//      "doubled" folds, the side wrap and the rolled hem: about 0.15 on the flat, up to ~0.45.
//   3. Embroidered strawberries and small crystals on top.
// Then a cheap animation loop makes a few crystals glint.

const DW = 1000; // design space width
const DH = 1160; // design space height

// ---------------------------------------------------------------------------------------------
// Small tools (the same ones the hoodie uses)
// ---------------------------------------------------------------------------------------------

// Seeded random numbers (mulberry32): the same dress every time it's painted.
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

// Box blur, three passes (close to a Gaussian with sigma ~ r), in place on a Float32Array.
function blur(a, w, h, r, passes = 3) {
  r = Math.max(1, Math.round(r));
  const t = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    boxH(a, t, w, h, r);
    boxV(t, a, w, h, r);
  }
  return a;
}
function boxH(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[o + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * inv;
      acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
}
function boxV(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[clamp(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * inv;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}

// Every coordinate pair in an SVG path string -> a bounding box (a safe over-estimate).
function bboxOf(d) {
  const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i + 1 < n.length; i += 2) {
    x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
    y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
  }
  return [x0, y0, x1, y1];
}

// A smooth curve through points (Catmull-Rom), sampled densely: [[x, y], ...].
function spline(pts, steps = 10) {
  const P = [];
  for (let i = 0; i < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t +
        (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

// A fold stroke as a filled, tapered ribbon (thin at both ends, full width in the middle).
function ribbon(ctx, pts, width) {
  const s = spline(pts);
  const n = s.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = s[Math.max(0, i - 1)], b = s[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const t = i / (n - 1);
    const hw = (width / 2) * Math.pow(Math.sin(Math.PI * t), 0.7) + 0.3;
    L.push([s[i][0] - dy * hw, s[i][1] + dx * hw]);
    R.push([s[i][0] + dy * hw, s[i][1] - dx * hw]);
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fill();
}

function readChannel(data, ch, n) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = data[i * 4 + ch] / 255;
  return a;
}

// ---------------------------------------------------------------------------------------------
// The pattern pieces (design space: 1000 x 1160, y down)
// ---------------------------------------------------------------------------------------------

// The organza hem: a row of shallow scallops, a touch lower in the middle (bias-cut drop).
function scallopHem(xr, xl, n) {
  let d = '';
  const y = (x) => 1040 + 16 * Math.cos(((x - 500) / 230) * Math.PI * 0.5);
  for (let i = 0; i < n; i++) {
    const xa = xr - ((xr - xl) * i) / n, xb = xr - ((xr - xl) * (i + 1)) / n;
    const xm = (xa + xb) / 2;
    d += ` Q ${xm.toFixed(1)} ${(y(xm) + 26).toFixed(1)} ${xb.toFixed(1)} ${y(xb).toFixed(1)}`;
  }
  return d;
}

// Folds: p = points along the fold; w = width; a = height (+ ridge, - valley).
const SLIP_FOLDS = [
  // The cowl: soft U-shaped drapes under the neckline, deepest at the center.
  { p: [380, 318, 440, 372, 500, 394, 560, 372, 620, 318], w: 26, a: 0.9 },
  { p: [376, 338, 438, 400, 500, 424, 562, 400, 624, 338], w: 16, a: -0.8 },
  { p: [372, 356, 436, 428, 500, 456, 564, 428, 628, 356], w: 30, a: 0.7 },
  { p: [374, 380, 438, 454, 500, 482, 562, 454, 626, 380], w: 18, a: -0.5 },
  // Bias-cut drape: long soft verticals that open toward the hem.
  { p: [430, 520, 420, 700, 400, 900], w: 40, a: 0.5 },
  { p: [470, 540, 466, 720, 458, 905], w: 24, a: -0.45 },
  { p: [540, 530, 548, 720, 560, 908], w: 44, a: 0.55 },
  { p: [590, 540, 606, 720, 626, 900], w: 26, a: -0.4 },
  { p: [372, 600, 352, 760, 336, 896], w: 30, a: 0.35 },
  { p: [636, 610, 654, 760, 668, 894], w: 24, a: 0.3 },
  { p: [500, 560, 504, 740, 506, 910], w: 30, a: 0.3 },
];

const P = {
  // The inside of the back, seen over the cowl (ghost mannequin).
  back: {
    d: 'M 384 270 Q 500 258 616 270 L 630 304 C 580 334 540 380 500 384 C 460 380 420 334 370 304 Z',
    dome: 30, amp: -20, tone: 0.66, inner: 1, folds: [],
  },
  slip: {
    d: 'M 372 300 C 420 332 460 378 500 384 C 540 378 580 332 628 300 C 644 400 634 460 634 520 C 638 620 668 750 684 880 Q 500 904 316 880 C 332 750 362 620 366 520 C 366 460 356 400 372 300 Z',
    dome: 46, amp: 40, tone: 1, form: 120, formAmp: 160, folds: SLIP_FOLDS,
  },
};

const ORGANZA = 'M 364 296 C 416 330 458 374 500 378 C 542 374 584 330 636 296 C 652 400 642 462 644 520 C 664 690 720 870 740 1040' +
  scallopHem(740, 260, 12) + ' C 280 870 336 690 356 520 C 358 462 348 400 364 296 Z';

// Where the organza doubles over itself: narrow, denser lines in the fan of folds.
const DOUBLED = [
  [404, 560, 380, 800, 330, 1036],
  [452, 600, 436, 830, 414, 1056],
  [548, 590, 568, 830, 596, 1056],
  [606, 560, 636, 800, 680, 1036],
  [498, 640, 500, 850, 506, 1060],
];

// Straps: thin satin cords. The back half goes behind the slip, the front half over it.
const STRAPS = [
  { d: 'M 386 272 C 394 190 404 118 413 70', back: 1 },
  { d: 'M 614 272 C 606 190 596 118 587 70', back: 1 },
  { d: 'M 372 304 C 384 220 398 128 413 70' },
  { d: 'M 628 304 C 616 220 602 128 587 70' },
];

// ---------------------------------------------------------------------------------------------
// Painting the satin
// ---------------------------------------------------------------------------------------------

// Light from the upper left, a little in front; the half vector for the satin highlight.
const LX = -0.45, LY = -0.6, LZ = 0.66;
const LN = Math.hypot(LX, LY, LZ);
const lx = LX / LN, ly = LY / LN, lz = LZ / LN;
const HN = Math.hypot(lx, ly, lz + 1);
const hx = lx / HN, hy = ly / HN, hz = (lz + 1) / HN;

// Paint one satin piece: returns { canvas, sil, x, y } in buffer pixels, or null if off-screen.
function paintSatin(env, L) {
  const { s, ox, oy, W, H } = env;
  const box = bboxOf(L.d);
  const pad = 24;
  const x0 = clamp(Math.floor((box[0] - pad) * s + ox), 0, W);
  const y0 = clamp(Math.floor((box[1] - pad) * s + oy), 0, H);
  const x1 = clamp(Math.ceil((box[2] + pad) * s + ox), 0, W);
  const y1 = clamp(Math.ceil((box[3] + pad) * s + oy), 0, H);
  const w = x1 - x0, h = y1 - y0, n = w * h;
  if (w < 2 || h < 2) return null;

  const cv = makeCanvas(w, h);
  const c = cv.getContext('2d', { willReadFrequently: true });
  const toDesign = () => c.setTransform(s, 0, 0, s, ox - x0, oy - y0);
  const path = new Path2D(L.d);

  // 1. The shape, and the folds (red = ridge, green = valley), in one pass.
  toDesign();
  c.fillStyle = '#fff'; c.fill(path);
  const mask = readChannel(c.getImageData(0, 0, w, h).data, 3, n);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'lighter';
  toDesign();
  for (const f of L.folds) {
    c.fillStyle = f.a > 0 ? `rgba(255,0,0,${Math.min(1, f.a)})` : `rgba(0,255,0,${Math.min(1, -f.a)})`;
    ribbon(c, f.p, f.w);
  }
  const d = c.getImageData(0, 0, w, h).data;
  const fold = new Float32Array(n);
  for (let i = 0; i < n; i++) fold[i] = (d[i * 4] - d[i * 4 + 1]) / 255;
  blur(fold, w, h, 7 * s);

  // 2. Height: the dome + the wide body form + the folds.
  const dome = blur(Float32Array.from(mask), w, h, L.dome * s);
  const form = L.form ? blur(Float32Array.from(mask), w, h, L.form * s) : null;
  const hgt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hgt[i] = L.amp * s * Math.sqrt(Math.max(0, dome[i])) + (form ? L.formAmp * s * form[i] : 0) + fold[i] * 22 * s;
  }

  // 3. Light it: soft diffuse, plus a broad satin highlight stretched along the folds (the
  // highlight ignores most of the vertical slope, so it runs down each fold like real satin).
  const img = c.createImageData(w, h);
  const out = img.data;
  for (let y = 0; y < h; y++) {
    const yd = (y + y0 - oy) / s;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mask[i];
      if (m < 0.004) continue;
      const xl = x > 0 ? i - 1 : i, xr = x < w - 1 ? i + 1 : i;
      const yu = y > 0 ? i - w : i, yb = y < h - 1 ? i + w : i;
      let nx = -(hgt[xr] - hgt[xl]) * 0.5, ny = -(hgt[yb] - hgt[yu]) * 0.5, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const ndl = nx * lx + ny * ly + nz * lz;
      const ai = 1 / Math.hypot(nx, ny * 0.3, nz);
      const ndh = Math.max(0, (nx * hx + ny * 0.3 * hy + nz * hz) * ai);
      const sheen = ndh ** 18 * 0.55 + ndh ** 90 * 0.5;
      let v = 0.42 + 0.5 * (ndl > 0 ? ndl : ndl * 0.3) + 0.06 * nz;
      v *= L.tone * (1.06 - 0.16 * (yd / DH));
      if (L.inner) v *= 1.0 - 0.6 * clamp((yd - 266) / 110, 0, 1); // the inside falls into shade
      // Pearl pink: shadows stay a warm mauve (never gray), and the sheen leans a little lavender
      // (that's what makes it look pearly).
      const o = i * 4;
      const k = clamp((v - 0.3) / 0.75, -0.6, 1);
      out[o] = clamp(178 + 70 * k + 40 * sheen, 0, 255);
      out[o + 1] = clamp(122 + 100 * k + 60 * sheen, 0, 255);
      out[o + 2] = clamp(144 + 86 * k + 70 * sheen, 0, 255);
      out[o + 3] = m * 255;
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, w, h);
  c.putImageData(img, 0, 0);
  const sil = makeCanvas(w, h);
  const sc = sil.getContext('2d');
  sc.setTransform(s, 0, 0, s, ox - x0, oy - y0);
  sc.fillStyle = '#000'; sc.fill(path);
  return { canvas: cv, sil, x: x0, y: y0 };
}

// Draw a piece onto the buffer, first darkening what's already there with its soft shadow.
function stackLayer(ctx, env, lay, castBlur = 14, castAlpha = 0.35) {
  const { s } = env;
  const FAR = 10000;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.shadowColor = `rgba(90, 30, 56, ${castAlpha})`;
  ctx.shadowBlur = castBlur * s;
  ctx.shadowOffsetX = FAR + 2 * s;
  ctx.shadowOffsetY = 5 * s;
  ctx.drawImage(lay.sil, lay.x - FAR, lay.y);
  ctx.restore();
  ctx.drawImage(lay.canvas, lay.x, lay.y);
}

// A thin satin strap: a dark edge, a pearly body and a bright line toward the light.
function paintStrap(ctx, env, d, back) {
  const { s, ox, oy } = env;
  const p = new Path2D(d);
  ctx.save();
  ctx.setTransform(s, 0, 0, s, ox, oy);
  ctx.lineCap = 'round';
  if (!back) {
    ctx.save();
    ctx.shadowColor = 'rgba(90, 30, 56, 0.35)'; ctx.shadowBlur = 4 * s; ctx.shadowOffsetX = 2 * s; ctx.shadowOffsetY = 3 * s;
    ctx.lineWidth = 9; ctx.strokeStyle = '#c9a3ae'; ctx.stroke(p);
    ctx.restore();
  }
  ctx.lineWidth = 9; ctx.strokeStyle = back ? '#a98390' : '#d9b4bf'; ctx.stroke(p);
  ctx.lineWidth = 5.5; ctx.strokeStyle = back ? '#c59fab' : '#f1d9df'; ctx.stroke(p);
  ctx.translate(-1.4, 0);
  ctx.lineWidth = 2; ctx.strokeStyle = back ? 'rgba(240,220,228,0.5)' : '#fff7fa'; ctx.stroke(p);
  ctx.restore();
}

// The cowl's rolled edge: a soft shadow just inside it, and a bright line where it turns over.
function paintCowlEdge(ctx, env) {
  const { s, ox, oy } = env;
  const p = new Path2D('M 374 302 C 420 334 460 378 500 383 C 540 378 580 334 626 302');
  ctx.save();
  ctx.setTransform(s, 0, 0, s, ox, oy);
  ctx.lineCap = 'round';
  ctx.save(); ctx.translate(0, -4); ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(90, 30, 56, 0.28)'; ctx.filter = `blur(${2 * s}px)`; ctx.stroke(p); ctx.restore();
  ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(255, 246, 250, 0.75)'; ctx.stroke(p);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Painting the organza
// ---------------------------------------------------------------------------------------------

function paintOrganza(env, rand) {
  const { s, ox, oy, W, H } = env;
  const box = bboxOf(ORGANZA);
  const x0 = clamp(Math.floor((box[0] - 10) * s + ox), 0, W);
  const y0 = clamp(Math.floor((box[1] - 10) * s + oy), 0, H);
  const x1 = clamp(Math.ceil((box[2] + 10) * s + ox), 0, W);
  const y1 = clamp(Math.ceil((box[3] + 10) * s + oy), 0, H);
  const w = x1 - x0, h = y1 - y0, n = w * h;
  const cv = makeCanvas(w, h);
  const c = cv.getContext('2d', { willReadFrequently: true });
  const toDesign = () => c.setTransform(s, 0, 0, s, ox - x0, oy - y0);
  const path = new Path2D(ORGANZA);

  // Red = the shape, green = the rolled edge, blue = the doubled-over folds.
  toDesign();
  c.fillStyle = '#f00'; c.fill(path);
  c.globalCompositeOperation = 'lighter';
  c.lineWidth = 5; c.lineJoin = 'round'; c.strokeStyle = '#0f0';
  c.save(); c.clip(path); c.stroke(path); c.restore();
  c.fillStyle = 'rgba(0,0,255,0.8)';
  for (const p of DOUBLED) ribbon(c, p, 14);
  const d = c.getImageData(0, 0, w, h).data;
  const mask = readChannel(d, 0, n), edge = readChannel(d, 1, n), dbl = readChannel(d, 2, n);
  blur(edge, w, h, Math.max(1, 1.2 * s), 1);
  blur(dbl, w, h, Math.max(1, 4 * s));

  // The width of the skirt on each row, so the folds can fan out with it.
  const rowL = new Float32Array(h), rowR = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x] > 0.5) { if (a < 0) a = x; b = x; }
    rowL[y] = a; rowR[y] = b;
  }

  const img = c.createImageData(w, h);
  const out = img.data;
  const TAU = Math.PI * 2;
  for (let y = 0; y < h; y++) {
    if (rowL[y] < 0) continue;
    const yd = (y + y0 - oy) / s;
    const t = clamp((yd - 330) / 700, 0, 1); // 0 at the bodice, 1 at the hem
    const mid = (rowL[y] + rowR[y]) / 2, half = Math.max(1, (rowR[y] - rowL[y]) / 2);
    const amp = 0.25 + 0.95 * t; // the folds open up toward the hem
    const p1 = 0.7 + 0.6 * Math.sin(yd * 0.006), p2 = 1.9 + yd * 0.004, p3 = 0.4 + 0.3 * Math.sin(yd * 0.01);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mask[i];
      if (m < 0.004) continue;
      const u = (x - mid) / half; // -1 .. 1 across the skirt
      // The fold surface z(u): three waves. Only its slope matters.
      const slope = amp * (0.16 * 3.5 * TAU * Math.cos(3.5 * TAU * u + p1) +
        0.07 * 6.3 * TAU * Math.cos(6.3 * TAU * u + p2) +
        0.25 * 1.4 * TAU * Math.cos(1.4 * TAU * u + p3)) * 0.5;
      // Seen at a slant, a sheer layer covers more: alpha grows with the slope (1 / cos).
      const dens = Math.min(2.6, Math.sqrt(1 + slope * slope));
      const wrap = smooth(0.78, 1.0, Math.abs(u)); // the sides turn away: more layers in view
      let nx = -slope * 0.5, nz = 1;
      const inv = 1 / Math.hypot(nx, nz); nx *= inv; nz *= inv;
      const ndl = nx * lx + nz * lz;
      const ndh = Math.max(0, nx * hx + nz * hz);
      const sheen = ndh ** 26;
      let a = 0.1 * dens + 0.16 * wrap + 0.28 * dbl[i] + 0.32 * edge[i] + 0.16 * sheen + (rand() - 0.5) * 0.02;
      a = clamp(a, 0.1, 0.62) * m;
      const v = 0.78 + 0.32 * ndl - 0.1 * dbl[i];
      const o = i * 4;
      // Sheer fabric scatters light, so it reads as a milky blush haze, even over the satin.
      out[o] = clamp(255 * v + 40 * sheen, 0, 255);
      out[o + 1] = clamp(196 * v + 70 * sheen + 20 * edge[i], 0, 255);
      out[o + 2] = clamp(216 * v + 60 * sheen + 10 * edge[i], 0, 255);
      out[o + 3] = a * 255;
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, w, h);
  c.putImageData(img, 0, 0);
  return { canvas: cv, x: x0, y: y0, path };
}

// ---------------------------------------------------------------------------------------------
// Embroidered strawberries, crystals and glints
// ---------------------------------------------------------------------------------------------

// Scatter points over the organza (design units), keeping them apart and off the edges.
function scatter(rand, count, minGap, avoid, test) {
  const pts = [];
  for (let tries = 0; pts.length < count && tries < count * 60; tries++) {
    const x = 270 + rand() * 460, y = 330 + rand() * 720;
    if (!test(x, y)) continue;
    if (pts.concat(avoid).some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minGap * minGap)) continue;
    pts.push({ x, y });
  }
  return pts;
}

// One tiny strawberry in satin stitch: red body, yellow seed knots, a green leaf cap.
function paintStrawberry(ctx, x, y, size, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(size / 20, size / 20); // drawn in a 20-unit box
  const body = new Path2D('M 0 -6 C 6 -9 11 -4 9 2 C 7 8 3 11 0 12 C -3 11 -7 8 -9 2 C -11 -4 -6 -9 0 -6 Z');
  ctx.save();
  ctx.shadowColor = 'rgba(80, 10, 30, 0.35)'; ctx.shadowBlur = 1.5 * size / 20; ctx.shadowOffsetX = 0.8; ctx.shadowOffsetY = 1.2;
  const g = ctx.createRadialGradient(-3, -3, 1, 0, 1, 12);
  g.addColorStop(0, '#f2485e'); g.addColorStop(0.6, '#d61d3a'); g.addColorStop(1, '#a3122c');
  ctx.fillStyle = g; ctx.fill(body);
  ctx.restore();
  // Satin-stitch threads: fine diagonal lines across the body.
  ctx.save();
  ctx.clip(body);
  ctx.lineWidth = 0.7;
  for (let k = -14; k < 14; k += 2.2) {
    ctx.strokeStyle = k % 4.4 < 2.2 ? 'rgba(255,190,200,0.28)' : 'rgba(110,0,20,0.2)';
    ctx.beginPath(); ctx.moveTo(k - 6, -10); ctx.lineTo(k + 6, 13); ctx.stroke();
  }
  ctx.restore();
  // Seeds: tiny French knots.
  ctx.fillStyle = '#ffe36a';
  for (const [sx, sy] of [[-4, -1], [1, -2], [5, 0], [-2, 4], [3, 5], [0, 9], [-6, 3]]) {
    ctx.beginPath(); ctx.arc(sx, sy, 0.95, 0, Math.PI * 2); ctx.fill();
  }
  // The leaf cap: five little leaves and a stem.
  ctx.fillStyle = '#2f9a45';
  for (let k = 0; k < 5; k++) {
    ctx.save();
    ctx.translate(0, -6.5);
    ctx.rotate(-Math.PI / 2 + (k - 2) * 0.62);
    ctx.beginPath(); ctx.ellipse(3.4, 0, 3.6, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#6fd07f';
  ctx.beginPath(); ctx.ellipse(-1.2, -7.6, 2, 0.8, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#246f34'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.quadraticCurveTo(0.5, -10, 2, -11.5); ctx.stroke();
  ctx.restore();
}

// One small crystal: a silvery-pink dome with a crisp highlight and a little fire.
function paintCrystal(ctx, st) {
  const { x, y, r, hue } = st;
  ctx.save();
  ctx.translate(x, y);
  let g = ctx.createRadialGradient(r * 0.3, r * 0.4, 0, r * 0.3, r * 0.4, r * 1.5);
  g.addColorStop(0, 'rgba(90, 30, 56, 0.35)'); g.addColorStop(1, 'rgba(90, 30, 56, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(r * 0.3, r * 0.4, r * 1.5, 0, Math.PI * 2); ctx.fill();
  g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#f4e9f1'); g.addColorStop(0.85, '#b9a2b4'); g.addColorStop(1, '#7d6476');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  const fires = ['rgba(120,220,255,0.7)', 'rgba(255,120,200,0.65)', 'rgba(255,236,140,0.6)'];
  ctx.fillStyle = fires[Math.floor(hue * fires.length)];
  ctx.beginPath(); ctx.arc(r * 0.35, r * 0.25, r * 0.28, 0, Math.PI * 2); ctx.fill();
  // Facet lines: a faint cross, so it reads as a cut stone rather than a pearl.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(0.4, r * 0.12);
  ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0); ctx.moveTo(0, -r * 0.8); ctx.lineTo(0, r * 0.8); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.34, Math.max(0.5, r * 0.24), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// A small, realistic glint: a tight glow and thin rays (4 long, plus 4 faint diagonals if `eight`).
function paintGlint(ctx, x, y, size, k, eight = true) {
  if (k <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(x, y);
  ctx.rotate(0.2);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.28);
  glow.addColorStop(0, `rgba(255,255,255,${0.85 * k})`);
  glow.addColorStop(0.4, `rgba(255,230,242,${0.25 * k})`);
  glow.addColorStop(1, 'rgba(255,220,236,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < (eight ? 8 : 4); i++) {
    const diag = eight && i % 2;
    const len = (diag ? 0.35 : 1) * size * (0.4 + 0.6 * k);
    const wid = (diag ? 0.025 : 0.04) * size;
    ctx.save();
    ctx.rotate((i * Math.PI) / (eight ? 4 : 2));
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * k})`);
    g.addColorStop(1, 'rgba(255,235,245,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -wid); ctx.lineTo(len, 0); ctx.lineTo(0, wid); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The whole picture
// ---------------------------------------------------------------------------------------------

/**
 * Paint the dress into a new canvas of W x H device pixels, transparent background.
 * opts.shadow: 0..1, a faint drop shadow under the garment (default 0.2).
 * opts.glints: how many crystals to glint permanently (for the still photo; default 0).
 * Returns { canvas, stones } where stones are the crystals in canvas pixels (for the twinkle).
 */
export async function renderDress(W, H, opts = {}) {
  W = Math.round(W); H = Math.round(H);
  const s = Math.min(W / DW, H / DH);
  const env = { W, H, s, ox: (W - DW * s) / 2, oy: (H - DH * s) / 2 };
  const rand = rng(20021114);

  const garment = makeCanvas(W, H);
  const gc = garment.getContext('2d');
  // Back to front: inner back, back straps, slip, front straps, organza.
  const back = paintSatin(env, P.back);
  if (back) {
    gc.drawImage(back.canvas, back.x, back.y);
    // The inside of the back falls into shade under the cowl.
    gc.save();
    gc.globalCompositeOperation = 'source-atop';
    const g = gc.createLinearGradient(0, 270 * s + env.oy, 0, 340 * s + env.oy);
    g.addColorStop(0, 'rgba(90, 30, 56, 0)'); g.addColorStop(1, 'rgba(90, 30, 56, 0.5)');
    gc.fillStyle = g; gc.fillRect(0, 0, W, H);
    gc.restore();
  }
  for (const st of STRAPS) if (st.back) paintStrap(gc, env, st.d, true);
  await yieldToPage();
  const slip = paintSatin(env, P.slip);
  if (slip) stackLayer(gc, env, slip, 14, 0.4);
  paintCowlEdge(gc, env);
  for (const st of STRAPS) if (!st.back) paintStrap(gc, env, st.d, false);
  await yieldToPage();
  const org = paintOrganza(env, rand);
  gc.drawImage(org.canvas, org.x, org.y);

  // Embroidery and crystals, placed inside the organza (and away from its edge).
  const probe = makeCanvas(1, 1).getContext('2d');
  const inside = (x, y) => probe.isPointInPath(org.path, x, y) && probe.isPointInPath(org.path, x - 22, y) &&
    probe.isPointInPath(org.path, x + 22, y) && probe.isPointInPath(org.path, x, y + 26) && y > 400;
  const berries = scatter(rand, 16, 90, [], inside);
  const crystalsD = scatter(rand, 40, 34, berries.map((b) => ({ x: b.x, y: b.y })), (x, y) => inside(x, y) || (y > 340 && probe.isPointInPath(org.path, x, y)));
  gc.save();
  gc.setTransform(s, 0, 0, s, env.ox, env.oy);
  for (const b of berries) paintStrawberry(gc, b.x, b.y, 16 + rand() * 4, (rand() - 0.5) * 0.9);
  gc.restore();
  const stones = crystalsD.map((p) => ({ x: p.x * s + env.ox, y: p.y * s + env.oy, r: (3 + rand() * 1.6) * s, hue: rand() }));
  for (const st of stones) paintCrystal(gc, st);

  // Final picture: optional soft shadow beneath, then the garment.
  const out = makeCanvas(W, H);
  const oc = out.getContext('2d');
  const sh = opts.shadow ?? 0.2;
  if (sh > 0) {
    oc.save();
    oc.shadowColor = `rgba(40, 0, 20, ${sh})`;
    oc.shadowBlur = 20 * s;
    oc.shadowOffsetY = 10 * s;
    oc.drawImage(garment, 0, 0);
    oc.restore();
  }
  oc.drawImage(garment, 0, 0);
  if (opts.glints) {
    const r = rng(5);
    for (let i = 0; i < opts.glints; i++) {
      const st = stones[Math.floor(r() * stones.length)];
      paintGlint(oc, st.x - st.r * 0.3, st.y - st.r * 0.35, st.r * 7, 0.8, i % 2 === 0);
    }
  }
  return { canvas: out, stones };
}

/**
 * Mount the dress on a <canvas>. Paints once (at CSS size x devicePixelRatio), then lets a few
 * crystals glint. Returns stop(), which ends the animation and the listeners.
 */
export function mountDress(canvas, opts = {}) {
  let stopped = false, failed = false, raf = 0, resizeTimer = 0, paintId = 0;
  let buffer = null, stones = [];
  const glints = [];
  let lastFrame = 0, nextSpawn = 0;
  const ctx = canvas.getContext('2d');
  const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const still = () => !!(motion && motion.matches);
  const rand = rng(Date.now() & 0xffff);

  canvas.setAttribute('role', 'img');
  if (!canvas.getAttribute('aria-label')) {
    canvas.setAttribute('aria-label', opts.label ||
      'The Strawberry Slip Dress: a sheer blush-pink organza dress over a short pearl-pink satin slip, with thin straps, a cowl neckline, a scalloped hem, tiny embroidered strawberries and a sprinkle of crystals.');
  }

  const fail = (err) => {
    if (failed) return;
    failed = true;
    console.warn('[dress] could not paint the product, leaving the canvas blank:', err);
    cancelAnimationFrame(raf);
    try { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); } catch { /* ignore */ }
  };

  const drawFrame = (t) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!buffer) return;
    ctx.drawImage(buffer, 0, 0);
    if (still()) return;
    for (const g of glints) {
      const k = Math.sin(clamp((t - g.t0) / g.dur, 0, 1) * Math.PI) ** 2;
      paintGlint(ctx, g.st.x - g.st.r * 0.3, g.st.y - g.st.r * 0.35, g.st.r * g.size, k, g.eight);
    }
  };

  const loop = (t) => {
    raf = 0;
    if (stopped || failed) return;
    try {
      if (document.hidden || still() || !buffer) return; // resumed by the listeners below
      raf = requestAnimationFrame(loop);
      if (t - lastFrame < 1000 / 30) return; // 30 fps is plenty for a sparkle
      lastFrame = t;
      for (let i = glints.length - 1; i >= 0; i--) if (t > glints[i].t0 + glints[i].dur) glints.splice(i, 1);
      if (t > nextSpawn && glints.length < 3 && stones.length) {
        glints.push({ st: stones[Math.floor(rand() * stones.length)], t0: t, dur: 700 + rand() * 600, size: 5 + rand() * 3, eight: rand() < 0.5 });
        nextSpawn = t + 200 + rand() * 450;
      }
      drawFrame(t);
    } catch (err) { fail(err); }
  };
  const start = () => { if (!raf && !stopped && !failed && buffer && !document.hidden && !still()) raf = requestAnimationFrame(loop); };

  const paint = async () => {
    const id = ++paintId;
    try {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      // Capped, so an unstyled canvas (whose CSS size follows its pixel size) can't grow forever.
      const W = Math.min(2400, Math.round(rect.width * dpr)), H = Math.min(2800, Math.round(rect.height * dpr));
      const res = await renderDress(W, H, { shadow: opts.shadow ?? 0.2 });
      if (id !== paintId || stopped || failed) return;
      canvas.width = W; canvas.height = H;
      buffer = res.canvas; stones = res.stones;
      glints.length = 0;
      drawFrame(performance.now());
      start();
    } catch (err) { fail(err); }
  };

  const onVisibility = () => { if (!document.hidden) start(); };
  const onMotion = () => { glints.length = 0; drawFrame(performance.now()); start(); };
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (Math.round(rect.width * dpr) !== canvas.width || Math.round(rect.height * dpr) !== canvas.height) paint();
    }, 220);
  };
  document.addEventListener('visibilitychange', onVisibility);
  motion && (motion.addEventListener ? motion.addEventListener('change', onMotion) : motion.addListener(onMotion));
  const ro = window.ResizeObserver ? new ResizeObserver(onResize) : null;
  ro ? ro.observe(canvas) : window.addEventListener('resize', onResize);

  paint();

  return function stop() {
    stopped = true;
    paintId++;
    cancelAnimationFrame(raf);
    clearTimeout(resizeTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    motion && (motion.removeEventListener ? motion.removeEventListener('change', onMotion) : motion.removeListener(onMotion));
    ro ? ro.disconnect() : window.removeEventListener('resize', onResize);
  };
}
