// Paints the galaxy: mountGalaxy() (at the end of this file) stacks the canvases and stage.css
// blends them.
// Deep blue-violet space with a galaxy's gas and dust; glitter hanging in it at three depths
// (fine dust far off, sharp flakes catching the light, near flakes blurred into the lens's
// octagons); and a pink planet below, its edge lit from two sides by two suns, one warm and one
// pale, as a real planet's (TOI-1338 b's) are. One canvas for each layer, back to front:
//
//   sky      the night, the galaxy's band of light across it, and its glowing gas and dust
//   orbit    the stars, the planet (its air, its face, the rim of light on its edge), the suns
//   veil     thin haze in front of the stars, which drifts
//   glitter  the glitter's still parts
//   glints   the glitter's moving parts: the only layer drawn again, every frame (frame())
//   lens     the lens's vignetting, a little darker toward the corners
//
// The veil, the glitter and the glints are added with mix-blend-mode: screen, which adds light the
// way light adds up: a layer can only brighten what's under it.
//
// The sky and the planet are worked out pixel by pixel, from noise, which takes a while: about a
// third of a second on a laptop, more on a phone. So paintGalaxy() paints a piece at a time. It's
// a generator function (function*): calling it runs none of it yet, and each call of its next()
// runs it on to its next yield, where it waits, with all its variables, until next() is called
// again. yield* hands the waiting on to another generator: the caller's next() runs that one until
// it's done. mountGalaxy() calls next() for a few ms each frame, so the page never freezes.
import { SPIKE_ANGLE, WHITE, css, mix, offscreen, rng, smooth, surface } from './tools.js';

/**
 * A paint in pieces: a generator that yields between pieces and returns a T when it's done.
 * @template T
 * @typedef {Generator<void, T, void>} Job
 */

/**
 * A box on the page, in CSS px. Bright stars and glitter keep off the boxes the words are in.
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 */

/**
 * The canvases mountGalaxy() stacks, back to front (see the list above).
 * @typedef {{ sky: HTMLCanvasElement, orbit: HTMLCanvasElement, veil: HTMLCanvasElement,
 *   glitter: HTMLCanvasElement, glints: HTMLCanvasElement, lens: HTMLCanvasElement }}
 *   GalaxyCanvases
 */

const TAU = Math.PI * 2;
// The same seed, the same picture, every time it's painted.
const SEED = 1338;
// The moment the twinkle holds still at when motion is reduced, in ms.
export const STILL = 8600;

// ---- Tools ----

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// The direction (x, y, z), made 1 long.
function norm3(x, y, z) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

// Picks an index at random, each as likely as its weight.
function pick(r, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let x = r() * total;
  for (let k = 0; k < weights.length; k++) {
    x -= weights[k];
    if (x < 0) return k;
  }
  return weights.length - 1;
}

// 2D simplex noise (Stefan Gustavson's), seeded: smooth hills and valleys from about -1 to 1,
// about one across each unit. Treat it as a black box, like haze() in tools.js.
function simplex(seed) {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float64Array(8);
  const gy = new Float64Array(8);
  for (let k = 0; k < 8; k++) {
    gx[k] = Math.cos((k * Math.PI) / 4 + 0.3);
    gy[k] = Math.sin((k * Math.PI) / 4 + 0.3);
  }
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - i + t;
    const y0 = y - j + t;
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let a = 0.5 - x0 * x0 - y0 * y0;
    if (a > 0) {
      const g = perm[ii + perm[jj]] & 7;
      a *= a;
      n += a * a * (gx[g] * x0 + gy[g] * y0);
    }
    a = 0.5 - x1 * x1 - y1 * y1;
    if (a > 0) {
      const g = perm[ii + i1 + perm[jj + j1]] & 7;
      a *= a;
      n += a * a * (gx[g] * x1 + gy[g] * y1);
    }
    a = 0.5 - x2 * x2 - y2 * y2;
    if (a > 0) {
      const g = perm[ii + 1 + perm[jj + 1]] & 7;
      a *= a;
      n += a * a * (gx[g] * x2 + gy[g] * y2);
    }
    return 70 * n;
  };
}

// Fractal noise: octaves of noise, each twice as fine and half as strong, each turned against
// the last so their grids never line up.
function fbm(noise, x, y, octaves) {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y);
    total += amp;
    const nx = 1.6 * x + 1.2 * y + 17.1;
    y = -1.2 * x + 1.6 * y + 3.7;
    x = nx;
    amp *= 0.5;
  }
  return sum / total;
}

// Where a field's values fall: its value at each share ps (0.5 is the median), from a sample.
// Thresholds set this way give the same mix of gas, glow and dust for any window size.
function percentiles(field, ps) {
  const n = Math.min(5000, field.length);
  const sample = new Float32Array(n);
  const step = field.length / n;
  for (let i = 0; i < n; i++) sample[i] = field[Math.floor(i * step)];
  sample.sort();
  return ps.map((p) => sample[Math.min(n - 1, Math.floor(p * n))]);
}

// Light (linear, 0 and up) to an sRGB value from 0 to 255: film's soft shoulder (1 - e^-x), so
// bright gas and air roll off instead of clipping, then the screen's gamma. A table indexed by
// the light's square root keeps the dark end, most of the sky, precise.
const ENC = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) {
  const x = (i / 4096) ** 2 * 8;
  const t = 1 - Math.exp(-x);
  ENC[i] = 255 * (t <= 0.0031308 ? 12.92 * t : 1.055 * t ** (1 / 2.4) - 0.055);
}
function enc(x) {
  return x <= 0 ? 0 : ENC[Math.min(4096, (Math.sqrt(x * 0.125) * 4096) | 0)];
}

// A light's glow as a lens records it: falling off like 1 / (1 + (r / core)²), the way light
// spreads in haze and glass, eased to nothing at radius.
function bloom(ctx, x, y, radius, core, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const end = 1 / (1 + (radius / core) ** 2);
  for (let k = 0; k <= 12; k++) {
    const t = (k / 12) ** 2;
    const v = (1 / (1 + ((t * radius) / core) ** 2) - end) / (1 - end);
    g.addColorStop(t, css(color, alpha * v));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

// The camera's starburst, with a softer halo and spikes reach times its
// size: a hot core, the halo, and 8 hairline spikes that fade as they go, white near the light
// and its color further out.
function starburst(ctx, x, y, size, color, alpha, reach = 2.8) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, size);
  halo.addColorStop(0, css(WHITE, alpha));
  halo.addColorStop(0.05, css(WHITE, alpha * 0.85));
  halo.addColorStop(0.15, css(mix(WHITE, color, 0.5), alpha * 0.32));
  halo.addColorStop(0.45, css(color, alpha * 0.07));
  halo.addColorStop(1, css(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, TAU);
  ctx.fill();
  const len = size * reach;
  const w = Math.max(0.28, size * 0.02);
  for (let k = 0; k < 8; k++) {
    const a = SPIKE_ANGLE + (k * Math.PI) / 4;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const g = ctx.createLinearGradient(x, y, ex, ey);
    g.addColorStop(0, css(WHITE, alpha * 0.9));
    g.addColorStop(0.25, css(mix(WHITE, color, 0.45), alpha * 0.32));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a + Math.PI / 2) * w, y + Math.sin(a + Math.PI / 2) * w);
    ctx.lineTo(ex, ey);
    ctx.lineTo(x - Math.cos(a + Math.PI / 2) * w, y - Math.sin(a + Math.PI / 2) * w);
    ctx.closePath();
    ctx.fill();
  }
}

// ---- The scene: where everything stands, for a window this size ----

function compose(W, H, keepOut, seed) {
  const land = smooth(0.6, 1.5, W / H); // 0 for a phone standing up … 1 for a laptop
  const S = Math.min(W, H);
  const zoom = Math.min(1.35, Math.max(0.7, Math.sqrt(W * H) / 1100));
  // The planet, far bigger than the frame, its middle below it: its edge is a long low arc, a
  // little more curved in a narrow frame, so the curve still shows on a phone.
  const R = W * (1.4 + 0.05 * land);
  const cap = H * (0.235 - 0.015 * land); // how far up the frame its top reaches
  const cx = W * (0.58 - 0.02 * land);
  const cy = H - cap + R;
  // The two suns are both beyond the planet, so they light its edge from two sides (directions:
  // x right, y down, z toward the camera). The pale one is off the frame to the right: only its
  // glare reaches the lens. The warm one sits low at the frame's left edge, just over the
  // planet's edge, and the camera sees it: its flare is in the picture.
  const sx = W * (0.065 + 0.035 * (1 - land));
  const sy = cy - Math.sqrt(R * R - (sx - cx) ** 2) - S * 0.014;
  // The glitter hangs in a long, loose drift across the frame: rising gently from the warm sun,
  // between the card and the planet, and on up past the card's right, as if it were blowing off
  // the planet's air.
  const ex = W * 1.02;
  const ey = H * (0.42 + 0.1 * (1 - land));
  const sl = Math.hypot(ex - sx, ey - sy);
  return {
    width: W,
    height: H,
    S,
    zoom,
    planet: { cx, cy, R, air: Math.max(9, S * 0.03) },
    warm: { x: sx, y: sy, size: S * 0.03, dir: norm3(-0.75, -0.2, -0.63), color: [255, 196, 140] },
    pale: { x: W * 1.08, y: H * 0.6, dir: norm3(0.85, -0.3, -0.5), color: [206, 216, 255] },
    stream: { x0: sx, y0: sy, nx: -(ey - sy) / sl, ny: (ex - sx) / sl, width: S * 0.22 },
    // The galaxy's band, a river of light across the frame, under the card, over the planet.
    band: {
      x0: -0.1 * W,
      y0: H * (0.5 - 0.1 * land),
      x1: 1.1 * W,
      y1: H * (0.64 + 0.02 * land),
      width: H * (0.1 + 0.06 * land),
    },
    keepOut,
    seed,
  };
}

// Whether (x, y) is in any of the boxes, grown by pad.
function covered(boxes, x, y, pad) {
  for (const b of boxes) {
    if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return true;
  }
  return false;
}

// How far (x, y) is above the planet's edge, in px (negative inside it).
function aboveLimb(scene, x, y) {
  const P = scene.planet;
  return Math.hypot(x - P.cx, y - P.cy) - P.R;
}

// ---- The still layers, back to front ----

/**
 * What the sky worked out that the stars follow: where the dust lies and where the band is, each
 * a field of numbers from 0 to 1 on the sky's small canvas (w × h, s of its pixels to a CSS px).
 * @typedef {{ w: number, h: number, s: number, dust: Float32Array, band: Float32Array }} Sky
 */

// A field the sky worked out, at (x, y) in CSS px.
function sampleField(field, f, x, y) {
  const i = Math.min(f.w - 1, Math.max(0, (x * f.s) | 0));
  const j = Math.min(f.h - 1, Math.max(0, (y * f.s) | 0));
  return field[j * f.w + i];
}

// Smooth fields that change slowly across the frame, worked out on a coarse grid (every step-th
// pixel) and read back in between: most of the time saved, none of the look lost.
function coarse(w, h, step, fn) {
  const cw = Math.ceil(w / step) + 2;
  const ch = Math.ceil(h / step) + 2;
  const grid = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) grid[j * cw + i] = fn(i * step, j * step);
  }
  return (x, y) => {
    const fx = x / step;
    const fy = y / step;
    const i = Math.min(cw - 2, fx | 0);
    const j = Math.min(ch - 2, fy | 0);
    const tx = fx - i;
    const ty = fy - j;
    const k = j * cw + i;
    const a = grid[k];
    const b = grid[k + 1];
    const c = grid[k + cw];
    const d = grid[k + cw + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// Deep space, in layers, as a long exposure sees it. The night itself is navy, darkest at the
// top. Far off, broad cobalt glows break it up, so it's never a flat gradient. Across it runs a
// galaxy's band of light. Nearer, clouds of glowing gas lie mostly in the band and in a few big
// masses: fractal noise read through gently bent space, cobalt where it's thin, lavender where
// it's thick, with bright filaments along their ridges. Purple in places, magenta low down where
// the planet's light reaches, gold near the warm sun. Dust lies across the band, dark only where
// there's glowing gas behind it to see it against. The gas keeps clear of the top of the frame,
// behind the header. Gas is soft, so it's worked out on a small canvas that CSS stretches over
// the window. Returns the canvas, and the dust and the band, so the stars can follow them.
function* paintSky(scene) {
  const { width: W, height: H, band, planet: P, pale, warm, S, seed } = scene;
  const s = Math.min(0.5, Math.sqrt(170000 / (W * H)));
  const w = Math.max(2, Math.round(W * s));
  const h = Math.max(2, Math.round(H * s));
  const [canvas, ctx] = offscreen(w, h);
  const n = w * h;
  const nA = simplex(seed);
  const nB = simplex(seed + 11);
  const nC = simplex(seed + 23);
  const nD = simplex(seed + 37);
  // Noise cells per pixel of this canvas: about 1.7 across the window's long side.
  const F = 1.7 / Math.max(W, H) / s;
  // The slow fields, on a coarse grid: how space bends, where the big masses of gas are, and the
  // broad far glows.
  const wxAt = coarse(w, h, 4, (i, j) => fbm(nA, i * F * 1.3 + 3.1, j * F * 1.3 + 7.7, 3));
  yield;
  const wyAt = coarse(w, h, 4, (i, j) => fbm(nA, i * F * 1.3 + 8.3, j * F * 1.3 + 9.0, 3));
  yield;
  const massAt = coarse(w, h, 6, (i, j) => fbm(nB, i * F * 0.55 - 2.2, j * F * 0.55 + 6.1, 3));
  yield;
  const farAt = coarse(w, h, 6, (i, j) => fbm(nB, i * F * 0.8 + 11.4, j * F * 0.8 - 5.3, 4));
  yield;
  const gasF = new Float32Array(n);
  const ridgeF = new Float32Array(n);
  const fineF = new Float32Array(n);
  const laneF = new Float32Array(n);
  const massF = new Float32Array(n);
  const farF = new Float32Array(n);
  const hueF = new Float32Array(n);
  for (let j = 0, k = 0; j < h; j++) {
    for (let i = 0; i < w; i++, k++) {
      const wx = wxAt(i, j);
      const wy = wyAt(i, j);
      const u = i * F + 3.1 + 0.35 * wx;
      const v = j * F + 7.7 + 0.35 * wy;
      gasF[k] = fbm(nC, u, v, 6);
      ridgeF[k] = 1 - Math.abs(fbm(nD, u * 1.9 + 0.4, v * 1.9 + 2.2, 4));
      fineF[k] = fbm(nD, u * 4.3 + 1.7, v * 4.3 - 4.2, 2);
      laneF[k] = fbm(nA, u * 1.6 + 5.3, v * 1.6 - 3.1, 5);
      massF[k] = massAt(i, j);
      farF[k] = farAt(i, j);
      hueF[k] = wx;
    }
    yield;
  }
  const [g50, g995] = percentiles(gasF, [0.5, 0.995]);
  const [r86, r995] = percentiles(ridgeF, [0.86, 0.995]);
  const [l70, l92] = percentiles(laneF, [0.7, 0.92]);
  const [m35, m92] = percentiles(massF, [0.35, 0.92]);
  const [f30, f97] = percentiles(farF, [0.3, 0.97]);
  yield;

  // Then the color, in linear light.
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const dither = rng(seed + 5);
  const dust = new Float32Array(n);
  const inBand = new Float32Array(n);
  const bdx = band.x1 - band.x0;
  const bdy = band.y1 - band.y0;
  const bl = Math.hypot(bdx, bdy);
  const bnx = -bdy / bl;
  const bny = bdx / bl;
  const L1 = pale.dir;
  const L2 = warm.dir;
  const l1n = Math.hypot(L1[0], L1[1]);
  const l2n = Math.hypot(L2[0], L2[1]);
  for (let j = 0, k = 0; j < h; j++) {
    const Y = (j + 0.5) / s;
    const low = Y / H;
    const clear = smooth(0.06, 0.32, low); // the gas keeps clear of the header
    for (let i = 0; i < w; i++, k++) {
      const X = (i + 0.5) / s;
      // How near the band's wavering middle line.
      const off = (X - band.x0) * bnx + (Y - band.y0) * bny + band.width * 0.5 * hueF[k];
      const b = Math.exp(-(off * off) / (band.width * band.width));
      // The night: navy, darkest at the top, a little lighter and more violet low down.
      let R = 0.0009 + 0.0018 * low;
      let G = 0.0015 + 0.0007 * low;
      let B = 0.0082 + 0.0035 * low;
      // The broad far glows, cobalt.
      const far = smooth(f30, f97, farF[k]);
      R += 0.004 * far;
      G += 0.01 * far;
      B += 0.06 * far;
      // The band's glow, from stars too many and too faint to see one by one.
      R += 0.004 * b;
      G += 0.007 * b;
      B += 0.038 * b;
      // The gas: in the band and the big masses.
      const mass = smooth(m35, m92, massF[k]);
      const where = clamp01(0.1 + 0.55 * mass + 0.75 * b) * clear;
      const g = clamp01((gasF[k] - g50) / (g995 - g50));
      const d = g ** 1.5 * where * (0.75 + 0.5 * (fineF[k] * 0.5 + 0.5));
      const d2 = d * d;
      const d4 = d2 * d2;
      R += 0.01 * d + 0.05 * d2 + 0.12 * d4;
      G += 0.025 * d + 0.05 * d2 + 0.16 * d4;
      B += 0.15 * d + 0.17 * d2 + 0.26 * d4;
      // Bright filaments along the ridges of the gas, lavender-white.
      const fil = smooth(r86, r995, ridgeF[k]) * smooth(0.12, 0.55, d);
      R += 0.05 * fil;
      G += 0.055 * fil;
      B += 0.13 * fil;
      // Purple in places.
      const hue = smooth(-0.15, 0.35, hueF[k]);
      R += 0.05 * d * hue;
      B += 0.03 * d * hue;
      // Magenta low down, where the planet's light reaches the gas.
      const pdx = X - P.cx;
      const pdy = Y - P.cy;
      const pd = Math.sqrt(pdx * pdx + pdy * pdy);
      const above = pd - P.R;
      const near = Math.exp(-Math.max(0, above) / (H * 0.22));
      R += 0.1 * d * near;
      G += 0.004 * d * near;
      B += 0.03 * d * near;
      // Gold near the warm sun: its light on the gas, and the glow of the air around it.
      const sun = Math.exp(-Math.hypot(X - warm.x, Y - warm.y) / (S * 0.28));
      R += sun * (0.006 + 0.07 * d);
      G += sun * (0.0025 + 0.028 * d);
      B += sun * (0.001 + 0.01 * d);
      // Dust across the band, seen only against the glowing gas behind it.
      const dd = smooth(l70, l92, laneF[k]) * clamp01(0.2 + 0.9 * b) * smooth(0.03, 0.3, d + fil);
      const keep = 1 - 0.82 * dd;
      R *= keep;
      G *= keep;
      B *= keep;
      // The planet's light on the haze just above it, strongest toward each sun.
      if (above > 0) {
        const t1 = (pdx * L1[0] + pdy * L1[1]) / (pd * l1n);
        const t2 = (pdx * L2[0] + pdy * L2[1]) / (pd * l2n);
        const wash =
          Math.exp(-above / (H * 0.1)) *
          (0.15 + 0.6 * smooth(-0.4, 0.8, t1) + 0.5 * smooth(-0.4, 0.8, t2));
        R += wash * 0.035;
        G += wash * 0.004;
        B += wash * 0.022;
      }
      // Dithered, so the dark gradients don't band.
      px[k * 4] = enc(R) + dither() + dither() - 1;
      px[k * 4 + 1] = enc(G) + dither() + dither() - 1;
      px[k * 4 + 2] = enc(B) + dither() + dither() - 1;
      px[k * 4 + 3] = 255;
      dust[k] = dd;
      inBand[k] = b;
    }
    yield;
  }
  ctx.putImageData(img, 0, 0);
  return [canvas, { w, h, s, dust, band: inBand }];
}

// Star colors, by temperature: blue-white, white, yellow-white, gold, orange.
const STAR_COLORS = [
  [168, 188, 255],
  [206, 216, 255],
  [244, 244, 255],
  [255, 240, 226],
  [255, 216, 172],
  [255, 186, 128],
];
const STAR_WEIGHTS = [0.14, 0.22, 0.24, 0.2, 0.13, 0.07];

// A star as the lens sees it: a hot point, its light spread a little around it.
function starSprite(color) {
  const [canvas, ctx] = offscreen(32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, css(mix(color, WHITE, 0.7)));
  g.addColorStop(0.09, css(mix(color, WHITE, 0.35), 0.92));
  g.addColorStop(0.22, css(color, 0.36));
  g.addColorStop(0.5, css(color, 0.07));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return canvas;
}

// The stars, behind everything: thousands, most of them faint, a few bright, more of them in the
// band and fewer where dust lies in front. dot is one screen pixel, in CSS px.
function* paintStars(ctx, scene, sky, dot) {
  const { width: W, height: H, seed, keepOut, zoom, warm, S } = scene;
  const r = rng(seed + 101);
  const sprites = STAR_COLORS.map((color) => starSprite(color));
  const star = () => pick(r, STAR_WEIGHTS);
  // The band's grain: stars too faint to pick out, so many they give it its texture.
  const grainCount = Math.round((W * H) / 90);
  for (let i = 0; i < grainCount; i++) {
    if (i % 1000 === 0) yield;
    const x = r() * W;
    const y = r() * H;
    const roll = r();
    const c = star();
    const a = 0.05 + 0.12 * r();
    const band = sampleField(sky.band, sky, x, y);
    if (roll > band * band * (1 - 0.9 * sampleField(sky.dust, sky, x, y))) continue;
    ctx.fillStyle = css(STAR_COLORS[c], a);
    ctx.fillRect(x, y, dot, dot);
  }
  const count = Math.round((W * H) / 260);
  for (let i = 0; i < count; i++) {
    if (i % 500 === 0) yield;
    const x = r() * W;
    const y = r() * H;
    const roll = r();
    const b = r() ** 8; // brightness: most stars faint, a few bright
    const c = star();
    const seen =
      (0.2 + 0.8 * sampleField(sky.band, sky, x, y)) *
      (1 - 0.85 * sampleField(sky.dust, sky, x, y));
    if (roll > seen) continue;
    if (b < 0.05) {
      // Too faint to spread: one pixel of the screen.
      ctx.fillStyle = css(STAR_COLORS[c], 0.16 + b * 12);
      ctx.fillRect(x, y, dot, dot);
    } else {
      const d = 2.2 + 8 * Math.sqrt(b);
      ctx.globalAlpha = 0.35 + 0.6 * b;
      ctx.drawImage(sprites[c], x - d / 2, y - d / 2, d, d);
      ctx.globalAlpha = 1;
    }
  }
  // A few bright stars with fine spikes, apart from each other, clear of the words, the planet
  // and the warm sun (whose glare would drown them).
  const bright = [];
  for (let tries = 0; bright.length < 4 && tries < 500; tries++) {
    const x = 24 + r() * (W - 48);
    const y = 24 + r() * (H - 48);
    if (covered(keepOut, x, y, 40)) continue;
    if (aboveLimb(scene, x, y) < 90) continue;
    if (Math.hypot(x - warm.x, y - warm.y) < S * 0.4) continue;
    if (bright.some(([bx, by]) => Math.hypot(bx - x, by - y) < S * 0.26)) continue;
    bright.push([x, y]);
  }
  const tints = [2, 1, 4, 3];
  bright.forEach(([x, y], i) => {
    const size = (i === 0 ? 12 : 5 + r() * 5) * zoom;
    starburst(ctx, x, y, size, STAR_COLORS[tints[i % 4]], i === 0 ? 0.9 : 0.75);
  });
}

// A layer worked out pixel by pixel on a small canvas (scale of its pixels to a CSS px), a row
// at a time, then drawn over the part of the frame from y = top down. shade(X, Y, out) fills out
// with [r, g, b, a] in 0–255 for the point (X, Y), in CSS px.
function* shadeRegion(ctx, W, H, top, scale, seed, shade) {
  const w = Math.max(2, Math.round(W * scale));
  const h = Math.max(2, Math.round((H - top) * scale));
  const [canvas, octx] = offscreen(w, h);
  const img = octx.createImageData(w, h);
  const px = img.data;
  const dither = rng(seed);
  const out = [0, 0, 0, 0];
  for (let j = 0, k = 0; j < h; j++) {
    const Y = top + ((j + 0.5) * (H - top)) / h;
    for (let i = 0; i < w; i++, k += 4) {
      out[3] = 0;
      shade(((i + 0.5) * W) / w, Y, out);
      if (out[3] <= 0) continue;
      px[k] = out[0] + dither() - 0.5;
      px[k + 1] = out[1] + dither() - 0.5;
      px[k + 2] = out[2] + dither() - 0.5;
      px[k + 3] = out[3];
    }
    yield;
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, top, W, H - top);
}

// The planet: a pink world much bigger than the frame, so only its top shows. First its air
// (paintAir), then its face over it, then the rim of light along its edge (paintRim).
//
// Its face is worked out on a sphere, pixel by pixel, as a photograph from orbit sees it: dusty
// rose ground with soft, low-contrast cloud over it (fractal noise in gently bent space) and, in
// the open ground between, fine dunes combed by the wind (ridged noise). Mapped onto the sphere,
// all of it crowds together toward the edge, as the ground does there. Both suns are beyond the
// planet: the pale one lights its right side, the warm one its left, and between them is a soft
// line from day into a plum night, the light reddening as it crosses more air to reach the
// ground. Toward the edge we look through more and more of its air, so the face goes into a rose
// haze, glowing where a sun lights it.
function* paintPlanet(ctx, scene) {
  const { width: W, height: H, planet: P, pale, warm, S, seed } = scene;
  const { cx, cy, R } = P;
  const L1 = pale.dir;
  const L2 = warm.dir;
  yield* paintAir(ctx, scene);
  const top = Math.max(0, Math.floor(cy - R - 2));
  if (top >= H) return;
  const nCloud = simplex(seed + 51);
  const nWarp = simplex(seed + 63);
  const nDune = simplex(seed + 75);
  const nSand = simplex(seed + 87);
  const EXPOSURE = 1.3;
  const scale = Math.min(1, Math.sqrt(200000 / (W * (H - top))));
  const px = 1 / scale; // one pixel of the small canvas, in CSS px
  // The wind's direction on the ground: the dunes' crests lie across it.
  const WX = 0.94;
  const WY = 0.34;
  yield* shadeRegion(ctx, W, H, top, scale, seed + 9, (X, Y, out) => {
    const dx = (X - cx) / R;
    const dy = (Y - cy) / R;
    const rr = dx * dx + dy * dy;
    // How much of this pixel the planet covers: its edge, smoothed.
    const cover = clamp01(((1 - Math.sqrt(rr)) * R) / px + 0.5);
    if (cover <= 0) return;
    const nz = Math.sqrt(Math.max(0, 1 - rr));
    // Where on the ground, as a map seen from straight above the planet's top: across the frame
    // (u) and away from us (v), in noise cells (about four across the frame). Seen at a slant, v
    // crowds together toward the edge; it's squashed a little here, so the clouds there read as
    // foreshortened masses, not as stripes.
    const u = dx * 6;
    const v = nz * 3.7;
    // The clouds: soft masses, bent a little by working them out in gently bent space.
    const qx = fbm(nWarp, u * 0.6 + 1.7, v * 0.6 + 9.2, 3);
    const qy = fbm(nWarp, u * 0.6 + 8.3, v * 0.6 + 2.8, 3);
    const cloud = smooth(-0.05, 0.6, fbm(nCloud, u + 0.6 * qx, v + 0.6 * qy, 7));
    // The ground: rose, toward coral in some regions and toward magenta in others.
    const sand = smooth(-0.4, 0.4, fbm(nSand, u * 0.45 + 4.1, v * 0.45 - 2.6, 4));
    // The dunes: ridges close together along the wind, long across it, a little bent.
    const along = u * WX + v * WY;
    const across = v * WX - u * WY;
    const ridge = 1 - Math.abs(fbm(nDune, along * 7 + 1.2 * qx, across * 2.2, 4));
    const dune = 1 + (ridge - 0.55) * 0.45 * (1 - cloud) * smooth(0.04, 0.2, nz);
    let ar = (0.72 + 0.14 * sand) * dune;
    let ag = (0.15 + 0.11 * sand) * dune;
    let ab = (0.4 - 0.13 * sand) * dune;
    // The cloud over it: pale blush, never thick enough to hide the ground altogether.
    const cv = cloud * 0.72;
    ar += (1.0 - ar) * cv;
    ag += (0.5 - ag) * cv;
    ab += (0.68 - ab) * cv;
    // Its two suns, each fading softly into night: near that line, the light has crossed more
    // of the pink air and come out deeper (magenta-rose for the pale sun, coral for the warm
    // one). The night is a dark plum.
    const l1 = dx * L1[0] + dy * L1[1] + nz * L1[2];
    const l2 = dx * L2[0] + dy * L2[1] + nz * L2[2];
    const s1 = smooth(-0.16, 0.62, l1);
    const s2 = smooth(0.1, 0.75, l2) * 0.5;
    const t1 = smooth(-0.06, 0.42, l1);
    const t2 = smooth(-0.06, 0.42, l2);
    let r = ar * (s1 + s2) + 0.007;
    let g = ag * (s1 * (0.36 + 0.6 * t1) + s2 * (0.5 + 0.3 * t2)) + 0.0011;
    let b = ab * (s1 * (0.76 + 0.24 * t1) + s2 * (0.42 + 0.3 * t2)) + 0.012;
    // The air over the face, thicker toward the edge: a rose haze, lit by the suns, and glowing
    // most around the warm one, whose light comes through it toward us.
    const thick = 1 - Math.exp(-0.05 / Math.max(nz, 0.006));
    const wd = Math.hypot(X - warm.x, Y - warm.y) / S;
    const lit1 = 0.03 + 0.97 * smooth(-0.3, 0.6, l1);
    const lit2 = smooth(-0.3, 0.6, l2) * (0.25 + 1.8 * Math.exp(-((wd / 0.16) ** 2)));
    r = r * (1 - thick) + thick * (0.95 * lit1 + 1.2 * lit2);
    g = g * (1 - thick) + thick * (0.36 * lit1 + 0.55 * lit2);
    b = b * (1 - thick) + thick * (0.6 * lit1 + 0.46 * lit2);
    out[0] = enc(r * EXPOSURE);
    out[1] = enc(g * EXPOSURE);
    out[2] = enc(b * EXPOSURE);
    out[3] = cover * 255;
  });
  paintRim(ctx, scene);
}

// The planet's air above its edge, seen edge-on: a dense low layer, rose-white (gold-orange where
// the warm sun's light comes through it), then pink, magenta and violet, each fainter and taller
// than the last, fading out into space. Each sun lights the air on its side of the planet, a
// little past where its day ends, since the air is high; the warm one, just behind the edge,
// makes it glow most around it. Two faint, thin layers of haze float in it, bending a little
// along the edge. Drawn as light added over the stars: its alpha is its brightest channel, so it
// also dims the stars behind it a little, as air does. Smooth, so it's worked out small.
function* paintAir(ctx, scene) {
  const { width: W, height: H, planet: P, pale, warm, S, seed } = scene;
  const { cx, cy, R, air } = P;
  const reach = air * 9;
  const top = Math.max(0, Math.floor(cy - R - reach));
  if (top >= H) return;
  const nA = simplex(seed + 77);
  const L1 = pale.dir;
  const L2 = warm.dir;
  const l1n = Math.hypot(L1[0], L1[1]);
  const l2n = Math.hypot(L2[0], L2[1]);
  const EXPOSURE = 0.6;
  const scale = Math.min(0.5, Math.sqrt(60000 / (W * (H - top))));
  yield* shadeRegion(ctx, W, H, top, scale, seed + 19, (X, Y, out) => {
    const dx = (X - cx) / R;
    const dy = (Y - cy) / R;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hgt = Math.max(0, dist - 1) * R;
    if (hgt >= reach) return;
    const mx = dx / dist;
    const my = dy / dist;
    const lit1 = smooth(-0.45, 0.75, (mx * L1[0] + my * L1[1]) / l1n);
    const wd = Math.hypot(X - warm.x, Y - warm.y) / S;
    const through = 2.2 * Math.exp(-((wd / 0.16) ** 2)) + 0.6 * Math.exp(-wd / 0.45);
    const lit2 = smooth(-0.4, 0.7, (mx * L2[0] + my * L2[1]) / l2n) * (0.35 + through);
    const wob = fbm(nA, mx * 7 + 2.3, 1.7, 2);
    const hh = hgt / air;
    const low = Math.exp(-hh / 0.35);
    const pink = Math.exp(-hh / 1.1);
    const mag = Math.exp(-hh / 2.8);
    const vio = Math.exp(-hh / 6);
    const strata =
      0.07 * Math.exp(-(((hh - 1.6 - 0.3 * wob) / 0.18) ** 2)) +
      0.035 * Math.exp(-(((hh - 2.9 - 0.4 * wob) / 0.26) ** 2));
    const fade = (1 - smooth(reach * 0.45, reach, hgt)) * EXPOSURE;
    const a1 = lit1 * fade;
    const a2 = lit2 * fade;
    const r =
      a1 * (low * 1.3 + pink * 0.9 + mag * 0.42 + vio * 0.07 + strata * 0.8) +
      a2 * (low * 1.7 + pink * 0.95 + mag * 0.32 + vio * 0.05 + strata * 0.9);
    const g =
      a1 * (low * 0.62 + pink * 0.2 + mag * 0.03 + vio * 0.012 + strata * 0.35) +
      a2 * (low * 0.95 + pink * 0.3 + mag * 0.03 + vio * 0.01 + strata * 0.4);
    const b =
      a1 * (low * 0.85 + pink * 0.48 + mag * 0.3 + vio * 0.11 + strata * 0.6) +
      a2 * (low * 0.45 + pink * 0.3 + mag * 0.2 + vio * 0.07 + strata * 0.4);
    const tr = enc(r) / 255;
    const tg = enc(g) / 255;
    const tb = enc(b) / 255;
    const a = Math.max(tr, tg, tb);
    if (a < 0.002) return;
    out[0] = (tr / a) * 255;
    out[1] = (tg / a) * 255;
    out[2] = (tb / a) * 255;
    out[3] = a * 255;
  });
}

// The planet's edge itself: a thin, bright rim, the densest of the air seen edge-on with a sun
// behind it. One arc, its brightness along the frame set by a gradient (a fine line over soft
// blooms): bright on both sides, where the suns are, dim between them, and burning toward white
// around the warm sun, which is just behind it.
function paintRim(ctx, scene) {
  const { width: W, planet: P, pale, warm, S, zoom } = scene;
  const { cx, cy, R } = P;
  const L1 = pale.dir;
  const L2 = warm.dir;
  const l1n = Math.hypot(L1[0], L1[1]);
  const l2n = Math.hypot(L2[0], L2[1]);
  const at = (x) => {
    const nx = Math.max(-1, Math.min(1, (x - cx) / R));
    const ny = -Math.sqrt(1 - nx * nx);
    const wd = Math.hypot(x - warm.x, cy + ny * R - warm.y) / S;
    const s1 = smooth(-0.3, 0.8, (nx * L1[0] + ny * L1[1]) / l1n) ** 1.4;
    const s2 =
      smooth(-0.3, 0.7, (nx * L2[0] + ny * L2[1]) / l2n) *
      (0.3 + 2.4 * Math.exp(-((wd / 0.14) ** 2)) + 0.5 * Math.exp(-wd / 0.4));
    return [s1, s2];
  };
  // [width, alpha, clipped to outside the planet]: the blooms only spread up into the air.
  const passes = [
    [7, 0.07, true],
    [3, 0.18, true],
    [0.9, 0.85, false],
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [width, alpha, outside] of passes) {
    ctx.save();
    if (outside) {
      ctx.beginPath();
      ctx.rect(0, 0, W, cy);
      ctx.moveTo(cx + R, cy);
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.clip('evenodd');
    }
    const g = ctx.createLinearGradient(0, 0, W, 0);
    for (let k = 0; k <= 24; k++) {
      const [s1, s2] = at((k / 24) * W);
      const tot = s1 + s2;
      const hue = mix([255, 222, 238], [255, 206, 156], s2 / (tot + 1e-6));
      g.addColorStop(
        k / 24,
        css(mix(hue, WHITE, smooth(1.2, 2.4, tot) * 0.6), Math.min(1, alpha * tot)),
      );
    }
    ctx.strokeStyle = g;
    ctx.lineWidth = width * Math.max(0.7, zoom);
    ctx.beginPath();
    ctx.arc(cx, cy, R + 0.4, Math.PI, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// The two suns as the lens records them. The pale one is out of the frame to the right: only its
// glare reaches the lens, a faint cool veil from that side. The warm one is in the picture, low
// at the left edge, just over the planet: a wide veil of glare, the glow of the air around it,
// the camera's starburst, and a core too bright for the film to hold.
function paintSuns(ctx, scene) {
  const { warm, pale, S } = scene;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  bloom(ctx, pale.x, pale.y, S * 0.9, S * 0.12, pale.color, 0.08);
  const { x, y, size } = warm;
  bloom(ctx, x, y, S * 1.0, S * 0.05, [255, 140, 70], 0.28);
  bloom(ctx, x, y, size * 8, size * 0.45, [255, 190, 130], 0.8);
  starburst(ctx, x, y, size * 1.2, warm.color, 1, 3.6);
  bloom(ctx, x, y, size * 0.9, size * 0.22, [255, 250, 240], 1);
  ctx.restore();
}

// A veil of thin haze in front of the stars: long sideways wisps, most of them low, just above
// the planet, rose where its light falls on them, gold near the warm sun and violet higher up,
// and thinner over the planet's face, so its colors stay clear. Soft, so it's worked out tiny;
// frame() lets it drift.
function* paintVeil(scene) {
  const { width: W, height: H, warm, S, seed } = scene;
  // The veil is 40 px bigger than the window all round (see stage.css), so it can drift.
  const VW = W + 80;
  const VH = H + 80;
  const s = Math.min(0.2, Math.sqrt(30000 / (VW * VH)));
  const w = Math.max(2, Math.round(VW * s));
  const h = Math.max(2, Math.round(VH * s));
  const [canvas, ctx] = offscreen(w, h);
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const nA = simplex(seed + 71);
  const nB = simplex(seed + 83);
  const F = 2.2 / Math.max(W, H);
  const dither = rng(seed + 13);
  for (let j = 0, k = 0; j < h; j++) {
    const Y = ((j + 0.5) * VH) / h - 40;
    const low = Y / H;
    for (let i = 0; i < w; i++, k += 4) {
      const X = ((i + 0.5) * VW) / w - 40;
      const u = X * F;
      const v = Y * F;
      const q = fbm(nA, u, v, 2);
      const wisp = smooth(-0.12, 0.55, fbm(nB, u * 0.6 + 0.7 * q, v * 2.6, 4));
      const above = aboveLimb(scene, X, Y);
      const near = Math.exp(-Math.abs(above) / (H * 0.1));
      const face = above < 0 ? 0.35 : 1;
      const amount = wisp * wisp * (0.1 + 0.9 * near) * face * (0.3 + 0.7 * smooth(0.3, 0.9, low));
      const sun = Math.exp(-Math.hypot(X - warm.x, Y - warm.y) / (S * 0.3)) * wisp;
      px[k] = enc(amount * (0.018 + 0.045 * near) + sun * 0.05) + dither() - 0.5;
      px[k + 1] = enc(amount * (0.016 - 0.006 * near) + sun * 0.022) + dither() - 0.5;
      px[k + 2] = enc(amount * (0.055 - 0.012 * near) + sun * 0.006) + dither() - 0.5;
      px[k + 3] = 255;
    }
    yield;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// The lens's vignetting: a little darker toward the corners, but not where the warm sun's glare
// floods its corner (a light that bright fills the lens, vignetting or not). Smooth, so it's a
// small canvas the CSS stretches over the window.
function paintLens(scene) {
  const { width: W, height: H, warm, S } = scene;
  const w = Math.max(2, Math.round(W / 8));
  const h = Math.max(2, Math.round(H / 8));
  const [canvas, ctx] = offscreen(w, h);
  ctx.setTransform(w / W, 0, 0, h / H, 0, 0);
  ctx.save();
  ctx.translate(W * 0.5, H * 0.45);
  ctx.scale(W, H * 0.95);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,8,0)');
  g.addColorStop(0.52, 'rgba(0,0,8,0)');
  g.addColorStop(0.78, 'rgba(0,0,8,0.24)');
  g.addColorStop(1, 'rgba(0,0,8,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-out';
  const lift = ctx.createRadialGradient(warm.x, warm.y, 0, warm.x, warm.y, S * 0.5);
  lift.addColorStop(0, 'rgba(0,0,0,1)');
  lift.addColorStop(0.4, 'rgba(0,0,0,0.6)');
  lift.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lift;
  ctx.fillRect(warm.x - S * 0.5, warm.y - S * 0.5, S, S);
  return canvas;
}

// ---- The glitter, at three depths ----
// Fine dust far off; flakes at mid-depth, in focus, each a tiny flat facet that catches the
// light as it turns; and flakes so near the lens they're blurred into its octagons.

// The foils, in the glitter's own colors: mostly blue, violet and silver.
const FOILS = [
  [104, 140, 255], // sapphire
  [168, 210, 255], // ice blue
  [150, 118, 255], // violet
  [204, 184, 255], // lavender
  [226, 232, 248], // silver
  [255, 146, 206], // pink
  [238, 102, 212], // magenta
  [255, 222, 174], // champagne
];
// How likely each foil is in each of the three lights: out in space (the pale sun and the
// starlight), in the planet's pink glow, and in the warm sun's light.
const FOIL_MIX = [
  [0.28, 0.12, 0.26, 0.1, 0.16, 0.06, 0.02, 0],
  [0.07, 0.05, 0.13, 0.17, 0.16, 0.27, 0.13, 0.02],
  [0.06, 0.04, 0.06, 0.1, 0.22, 0.17, 0.05, 0.3],
];
// The light itself, in those three places, which a flake's flash takes on a little of.
const LIGHTS = [
  [214, 222, 255],
  [255, 156, 210],
  [255, 214, 160],
];
// Out of focus, a flake shows the light it catches more than its foil: deeper colors, since a
// pale color this faint goes grey on the dark. Out in space mostly violet, which glows on the
// navy and on the purple both (a blue disc on the purple goes slate); peach and rose by the warm
// sun (gold on the purple goes tan).
const BOKEH = [
  [
    [120, 150, 255],
    [150, 118, 255],
    [186, 160, 255],
    [206, 140, 255],
  ],
  [
    [255, 88, 178],
    [218, 96, 255],
    [255, 136, 200],
    [186, 124, 255],
  ],
  [
    [255, 176, 146],
    [255, 136, 150],
    [255, 112, 178],
  ],
];
// The color of the drift's glow out in space: the glitter's blues and silver, together.
const DRIFT = [150, 168, 255];

// How much light there is at (x, y) for glitter to catch, from 0 to 1: most in the planet's glow
// and around the warm sun, some toward the pale sun's side, a little everywhere.
function lightAt(scene, x, y) {
  const { width: W, height: H, warm, S } = scene;
  const glow = Math.exp(-Math.max(0, aboveLimb(scene, x, y)) / (H * 0.18));
  const sun = Math.exp(-Math.hypot(x - warm.x, y - warm.y) / (S * 0.45));
  const pale = smooth(0.2, 1.05, x / W) * (0.5 + 0.5 * smooth(0.05, 0.5, y / H)) * 0.4;
  return clamp01(0.22 + 0.42 * glow + 0.6 * sun + pale);
}

// Which light a flake at (x, y) is in (0 space, 1 the planet's glow, 2 the warm sun's), picked at
// random by how near each it is, so the colors blend rather than meet at a line.
function zoneAt(scene, x, y, r) {
  const glow = 1.6 * Math.exp(-Math.max(0, aboveLimb(scene, x, y)) / (scene.height * 0.085));
  const sun = 2.2 * Math.exp(-Math.hypot(x - scene.warm.x, y - scene.warm.y) / (scene.S * 0.3));
  return pick(r, [1, glow, sun]);
}

// How thick the glitter hangs at (x, y), from 0 to 1: mostly in the drift, which meanders and
// thins as it goes, in clumps with gaps between them, thickest where there's light to catch, thin
// up behind the header.
function glitterAt(scene, clump, x, y) {
  const { stream: st, width: W, height: H, S } = scene;
  const F = 2.6 / Math.max(W, H);
  const along = ((x - st.x0) * st.ny - (y - st.y0) * st.nx) / S;
  const across =
    (x - st.x0) * st.nx + (y - st.y0) * st.ny + st.width * 0.5 * fbm(clump, along * 1.3, 3.3, 2);
  const width = st.width * (1.15 - 0.3 * smooth(0, 1.6, along));
  const inStream = Math.exp(-((across / width) ** 2));
  const drift = smooth(-0.35, 0.35, fbm(clump, x * F, y * F, 3));
  const fine = smooth(-0.4, 0.6, fbm(clump, x * F * 3.1 + 7.3, y * F * 3.1 - 1.9, 2));
  const head = 0.3 + 0.7 * smooth(H * 0.06, H * 0.2, y);
  return clamp01(
    (0.06 + 0.85 * inStream + 0.3 * lightAt(scene, x, y)) *
      (0.45 + 0.55 * drift) *
      (0.65 + 0.35 * fine) *
      head,
  );
}

// One out-of-focus flake, worked out pixel by pixel, as this camera sees it: the aperture's
// octagon (the 8 blades that give every light its 8 spikes), cut into a cat's eye by the lens
// barrel toward the frame's edges (off: 0 in the middle … 1 in a corner; toward: the angle from
// the middle out to it). A flake this near is softer at its edge and a little brighter in its
// middle, with the faintest ripple, a violet fringe at its rim, and on a few (ring) the brighter
// rim some lenses give. Drawn at one pixel per CSS px: it's soft anyway.
function bokehSprite(radius, color, off, toward, ring) {
  const size = Math.ceil(radius * 2 + 6);
  const [canvas, ctx] = offscreen(size, size);
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const c = size / 2;
  const apothem = radius * Math.cos(Math.PI / 8);
  const NX = [];
  const NY = [];
  for (let q = 0; q < 4; q++) {
    NX.push(Math.cos(SPIKE_ANGLE + (q * Math.PI) / 4));
    NY.push(Math.sin(SPIKE_ANGLE + (q * Math.PI) / 4));
  }
  // The barrel's circle, shifted back toward the frame's middle: it clips the outer side.
  const shift = radius * 0.6 * off * off;
  const bx = -Math.cos(toward) * shift;
  const by = -Math.sin(toward) * shift;
  const br = radius * 1.04;
  const soft = 1 + radius * 0.1;
  const FRINGE = [190, 120, 255];
  for (let j = 0; j < size; j++) {
    const y = j + 0.5 - c;
    for (let i = 0; i < size; i++) {
      const x = i + 0.5 - c;
      let d = 0;
      for (let q = 0; q < 4; q++) d = Math.max(d, Math.abs(x * NX[q] + y * NY[q]));
      // The blades are curved a little: between an octagon and a circle.
      const blade = 0.7 * (d - apothem) + 0.3 * (Math.hypot(x, y) - radius * 0.97);
      const e = Math.max(blade, Math.hypot(x - bx, y - by) - br);
      const cover = 1 - smooth(-soft, soft, e);
      if (cover <= 0) continue;
      const rho = clamp01(1 + e / apothem); // 0 in the middle … 1 at the edge
      let lum = 0.66 + 0.34 * (1 - rho * rho) + 0.012 * Math.sin(rho * 19 + radius);
      if (ring) lum += 0.18 * Math.exp(-((((1 - rho) * apothem) / 2.6) ** 2));
      const f = smooth(0.78, 1, rho) * 0.5;
      const k = (j * size + i) * 4;
      px[k] = color[0] + (FRINGE[0] - color[0]) * f;
      px[k + 1] = color[1] + (FRINGE[1] - color[1]) * f;
      px[k + 2] = color[2] + (FRINGE[2] - color[2]) * f;
      px[k + 3] = 255 * cover * Math.min(1, lum);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// A flake's facet: a tiny hexagon or square, turned, and tipped away from us so it's
// foreshortened. Its corners, as one flat list (x0, y0, x1, y1, …) in CSS px.
function facet(x, y, size, r) {
  const sides = r() < 0.7 ? 6 : 4;
  const turn = r() * TAU;
  const tip = 0.35 + 0.65 * r(); // how much of its face we see
  const axis = r() * TAU;
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const pts = new Float32Array(sides * 2);
  for (let k = 0; k < sides; k++) {
    const a = turn + (k * TAU) / sides;
    // Corner on the flake, then squashed along its tip axis.
    const px = Math.cos(a) * size * 0.5;
    const py = Math.sin(a) * size * 0.5;
    const along = px * ca + py * sa;
    const perp = (-px * sa + py * ca) * tip;
    pts[k * 2] = x + along * ca - perp * sa;
    pts[k * 2 + 1] = y + along * sa + perp * ca;
  }
  return pts;
}

function facetPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
  ctx.closePath();
}

// What twinkles, made by paintGlitter() and drawn by frame():
//   motes   specks of the far dust that catch the light now and then, as pinpricks
//   flakes  flakes at mid-depth, in focus: tiny mirrors that flash when they turn to face the light
//   near    flakes so near the lens they're out of focus, that swell into the light and fade out

// The drift's own glow: glitter too fine and too many to see one by one, the light it scatters
// spread into a haze, in the colors of the light it's in. Soft, so it's worked out tiny and
// stretched over the window.
function* paintDriftGlow(ctx, scene, clump) {
  const { width: W, height: H } = scene;
  const gs = Math.min(0.12, Math.sqrt(20000 / (W * H)));
  const gw = Math.max(2, Math.round(W * gs));
  const gh = Math.max(2, Math.round(H * gs));
  const [canvas, gctx] = offscreen(gw, gh);
  const img = gctx.createImageData(gw, gh);
  for (let j = 0, k = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++, k += 4) {
      const X = ((i + 0.5) * W) / gw;
      const Y = ((j + 0.5) * H) / gh;
      // Pink in the planet's glow; thinner by the warm sun, whose own glare is there.
      const glow = 1.6 * Math.exp(-Math.max(0, aboveLimb(scene, X, Y)) / (H * 0.085));
      const sun = Math.exp(-Math.hypot(X - scene.warm.x, Y - scene.warm.y) / (scene.S * 0.3));
      const amount = glitterAt(scene, clump, X, Y) ** 2 * lightAt(scene, X, Y) * (1 - 0.6 * sun);
      for (let c = 0; c < 3; c++) img.data[k + c] = (DRIFT[c] + LIGHTS[1][c] * glow) / (1 + glow);
      img.data[k + 3] = 255 * Math.min(1, amount * 0.26);
    }
    yield;
  }
  gctx.putImageData(img, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, W, H);
}

// The glitter's still parts, and the lists of what moves. The drift's own glow. Far dust, in
// clumps, in the colors of the light it's in. Each mid-depth flake's facet as it rests, turned
// mostly away from the light, showing a glint of its foil (the few turned partly toward it glow a
// little). And the near flakes, blurred into octagons, mostly toward the frame's edges and where
// the light is, never over the words. Some of the dust and all the mid flakes twinkle, and some
// near flakes swell and fade, in frame(). Over the planet's face it keeps to the bigger flakes:
// fine specks there would read as stars in front of it.
function* paintGlitter(ctx, scene, dot, sprites) {
  const { width: W, height: H, seed, keepOut, zoom } = scene;
  const r = rng(seed + 202);
  const clump = simplex(seed + 91);
  ctx.globalCompositeOperation = 'lighter';
  yield* paintDriftGlow(ctx, scene, clump);

  // Far off: fine dust, a screen pixel or two each.
  const motes = [];
  const dustCount = Math.round((W * H) / 70);
  for (let i = 0; i < dustCount; i++) {
    if (i % 500 === 0) yield;
    const x = r() * W;
    const y = r() * H;
    const roll = r();
    const b = r() ** 3;
    if (roll > glitterAt(scene, clump, x, y) ** 0.8) continue;
    if (covered(keepOut, x, y, 2) && r() < 0.85) continue;
    // Specks this fine over the planet's face would read as stars in front of it.
    const face = aboveLimb(scene, x, y) < 0;
    if (face && r() < 0.92) continue;
    const zone = zoneAt(scene, x, y, r);
    const color = mix(FOILS[pick(r, FOIL_MIX[zone])], LIGHTS[zone], 0.25);
    const light = lightAt(scene, x, y);
    const size = dot * (b > 0.7 ? 2 : 1);
    ctx.fillStyle = css(color, (0.16 + 0.74 * b) * (0.35 + 0.65 * light));
    ctx.fillRect(x, y, size, size);
    // One in twenty catches the light now and then, as a pinprick.
    if (r() < 0.05 && !face && !covered(keepOut, x, y, 6)) {
      motes.push({
        x,
        y,
        size,
        color: css(mix(color, WHITE, 0.5)),
        peak: 0.4 + 0.6 * light,
        phase: r() * TAU,
        speed: (r() < 0.5 ? 1 : -1) * (0.3 + 0.9 * r()),
      });
    }
  }

  // At mid-depth, in focus: flakes, each a tiny mirror. Most only shimmer as they turn; one in
  // eight, bigger and flatter, is a glinter that flares with the camera's spikes.
  const flakes = [];
  const count = Math.round((W * H) / 520);
  for (let tries = 0; flakes.length < count && tries < count * 10; tries++) {
    if (tries % 250 === 0) yield;
    const x = r() * W;
    const y = r() * H;
    if (r() > 1.2 * glitterAt(scene, clump, x, y)) continue;
    if (covered(keepOut, x, y, 14)) continue;
    const zone = zoneAt(scene, x, y, r);
    const foil = pick(r, FOIL_MIX[zone]);
    const sprite = foil * 3 + zone;
    const light = lightAt(scene, x, y);
    const glinter = r() < 0.12;
    const size = (glinter ? 2 + 2.6 * r() : 1.2 + 2.6 * r() ** 2) * Math.max(0.85, zoom);
    // Over the planet's face only the bigger flakes, plainly near, and fewer of them: small ones
    // there would read as stars in front of it.
    if (aboveLimb(scene, x, y) < 0 && (size < 2.6 || r() < 0.7)) continue;
    const pts = facet(x, y, size, r);
    // At rest it faces away from the light: a dim glint of its foil. Some are turned partly
    // toward it and glow in their color; in the planet's broad glow, more of them catch some of
    // it, and a few shine.
    const rest = (0.15 + 0.85 * r() ** 2) * (0.35 + 0.65 * light);
    ctx.globalAlpha = rest;
    ctx.fillStyle = css(FOILS[foil]);
    if (size < 1.5) ctx.fillRect(x - size / 2, y - size / 2, size, size);
    else {
      facetPath(ctx, pts);
      ctx.fill();
    }
    if (rest > 0.3) {
      const c = 2 + size * 2;
      ctx.globalAlpha = Math.min(1, (rest - 0.18) * 1.1);
      ctx.drawImage(sprites.tints[sprite], x - c / 2, y - c / 2, c, c);
    }
    if (r() < [0.04, 0.14, 0.14][zone]) {
      const c = 3 + size * 2.4;
      ctx.globalAlpha = 0.5 + 0.5 * r();
      ctx.drawImage(sprites.cores[sprite], x - c / 2, y - c / 2, c, c);
    }
    // Holographic foil shifts color as it turns: it flashes in its own and a neighbor's.
    const holo = r() < 0.3;
    const other = holo ? (foil + (r() < 0.5 ? 1 : FOILS.length - 1)) % FOILS.length : foil;
    const flash = mix(FOILS[foil], LIGHTS[zone], 0.2);
    flakes.push({
      x,
      y,
      size,
      pts: size < 1.5 ? null : pts,
      sprite,
      sprite2: other * 3 + zone,
      holo,
      glinter,
      hot: css(mix(flash, WHITE, 0.55)),
      // How bright its flash gets: most flakes never face the light square on.
      peak: glinter
        ? (0.6 + 0.4 * r()) * (0.6 + 0.4 * light)
        : (0.12 + 0.36 * r()) * (0.5 + 0.5 * light),
      // It turns slowly about one axis and wobbles slowly about another: the first sets when it
      // flashes, the second how bright each flash is.
      phase: r() * TAU,
      speed: (r() < 0.5 ? 1 : -1) * (glinter ? 0.25 + 0.5 * r() : 0.3 + 0.8 * r()),
      wobble: r() * TAU,
      wobbleSpeed: 0.05 + 0.25 * r(),
    });
  }
  ctx.globalAlpha = 1;

  // Near the lens: blurred into octagons.
  const near = [];
  const nearCount = Math.round(10 + 16 * Math.min(1.5, (W * H) / (1440 * 900)));
  for (let tries = 0, placed = 0; placed < nearCount && tries < nearCount * 14; tries++) {
    const x = r() * W;
    const y = r() * H;
    const edge = Math.max(Math.abs(x / W - 0.5), Math.abs(y / H - 0.5)) * 2;
    let radius = (9 + 50 * r() ** 2.4) * zoom;
    // Some lenses give out-of-focus light a brighter rim; the bigger the disc, the likelier.
    const ring = r() < 0.1 + 0.3 * smooth(15, 45, radius / zoom);
    // A near flake shows only while it catches the light: few out in the dark, and only the
    // well-lit ones big (a big disc spreads its light thin).
    const light = lightAt(scene, x, y);
    if (light < 0.55) radius = Math.min(radius, 30 * zoom);
    const want =
      (0.1 + 0.8 * smooth(0.3, 0.95, edge)) *
      (0.25 + 0.75 * glitterAt(scene, clump, x, y)) *
      light ** 1.5;
    if (r() > want * 2) continue;
    if (covered(keepOut, x, y, radius + 14)) continue;
    // Over the planet's bright face and air a near flake barely shows: only a few there.
    if (aboveLimb(scene, x, y) < H * 0.05 && r() < 0.88) continue;
    // In the warm sun's colors only near it: far off, a gold disc on the night reads as mud.
    let zone = zoneAt(scene, x, y, r);
    if (zone === 2 && Math.hypot(x - scene.warm.x, y - scene.warm.y) > scene.S * 0.45) zone = 0;
    const choices = BOKEH[zone];
    const color = choices[(r() * choices.length) | 0];
    // As bright as the light it catches (most in the warm sun's); the bigger its disc, the more
    // that light is spread. One too faint to glow would only read as a smudge: skip it.
    const spread = Math.min(1, Math.max(0.45, (18 / (radius / zoom)) ** 0.7));
    const alpha = (0.45 + 0.4 * r()) * (0.55 + 0.45 * light) * spread * (zone === 2 ? 1.25 : 1);
    if (alpha < 0.24) continue;
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const off = Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);
    const sprite = bokehSprite(radius, color, off, Math.atan2(y - H / 2, x - W / 2), ring);
    yield;
    const half = sprite.width / 2;
    placed++;
    if (near.length < 10 && r() < 0.4) {
      // This one turns: it swells into the light and fades out of it, and drifts a little.
      near.push({
        x,
        y,
        half,
        sprite,
        alpha: Math.min(0.9, alpha * 1.3),
        phase: r() * TAU,
        speed: (r() < 0.5 ? 1 : -1) * (0.18 + 0.32 * r()),
        dx: (2 + 5 * r()) * zoom,
        dy: (1.5 + 3 * r()) * zoom,
      });
    } else {
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - half, y - half, half * 2, half * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return { motes, flakes, near };
}

// ---- The moving parts: sprites drawn once, then frame() each time ----

// A flash's spikes and a faint halo, no core: the camera's 8 spikes, the 4 along the blades' main
// lines longer than the 4 between them, so a small flash reads as a 4-point star and a big one as
// an 8-point one.
function spikesAt(ctx, x, y, len, color, alpha) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, len * 0.3);
  halo.addColorStop(0, css(mix(WHITE, color, 0.5), alpha * 0.3));
  halo.addColorStop(0.35, css(color, alpha * 0.08));
  halo.addColorStop(1, css(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, len * 0.3, 0, TAU);
  ctx.fill();
  const w = 0.45;
  for (let k = 0; k < 8; k++) {
    const a = SPIKE_ANGLE + (k * Math.PI) / 4;
    const l = len * (k % 2 ? 0.55 : 1);
    const ex = x + Math.cos(a) * l;
    const ey = y + Math.sin(a) * l;
    const g = ctx.createLinearGradient(x, y, ex, ey);
    g.addColorStop(0, css(WHITE, alpha));
    g.addColorStop(0.3, css(mix(WHITE, color, 0.5), alpha * 0.45));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a + Math.PI / 2) * w, y + Math.sin(a + Math.PI / 2) * w);
    ctx.lineTo(ex, ey);
    ctx.lineTo(x - Math.cos(a + Math.PI / 2) * w, y - Math.sin(a + Math.PI / 2) * w);
    ctx.closePath();
    ctx.fill();
  }
}

// A flash is the facet lit up, a white-hot core in a glow of the flake's color and, when it's
// bright, the camera's spikes: one set for each foil in each light (24), the spikes at two sizes
// so their hairlines stay crisp. A tint is the softer glow of a flake turned only partly toward
// the light, in its foil's own color. sharp is the canvases' pixels per CSS px.
function* glintSprites(sharp) {
  const cores = [];
  const tints = [];
  const small = [];
  const large = [];
  for (let foil = 0; foil < FOILS.length; foil++) {
    for (let zone = 0; zone < LIGHTS.length; zone++) {
      const color = mix(FOILS[foil], LIGHTS[zone], 0.3);
      const [core, cctx] = offscreen(10, 10, sharp);
      const g = cctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      g.addColorStop(0, css(WHITE, 1));
      g.addColorStop(0.12, css(mix(WHITE, color, 0.5), 0.9));
      g.addColorStop(0.3, css(color, 0.5));
      g.addColorStop(0.6, css(color, 0.14));
      g.addColorStop(1, css(color, 0));
      cctx.fillStyle = g;
      cctx.fillRect(0, 0, 10, 10);
      cores.push(core);
      const [tint, tctx] = offscreen(10, 10, sharp);
      const h = tctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      h.addColorStop(0, css(FOILS[foil], 0.9));
      h.addColorStop(0.35, css(FOILS[foil], 0.4));
      h.addColorStop(1, css(FOILS[foil], 0));
      tctx.fillStyle = h;
      tctx.fillRect(0, 0, 10, 10);
      tints.push(tint);
      const sizes = [
        [28, small],
        [64, large],
      ];
      for (const [S, list] of sizes) {
        const [canvas, ctx] = offscreen(S, S, sharp);
        ctx.globalCompositeOperation = 'lighter';
        spikesAt(ctx, S / 2, S / 2, S * 0.48, color, 1);
        list.push(canvas);
      }
    }
    yield;
  }
  return { cores, tints, small, large };
}

/**
 * What frame() needs: the glints canvas to draw on, the veil to drift, and what twinkles. dirty
 * holds the boxes the last frame drew (x, y, w, h in CSS px), so the next clears only those, not
 * the whole window; a dirtyCount of -1 means clear it all.
 * @typedef {{ width: number, height: number, glints: CanvasRenderingContext2D,
 *   veil: HTMLCanvasElement, motes: object[], flakes: object[], near: object[], sprites: object,
 *   dirty: Float32Array, dirtyCount: number }} Galaxy
 */

// Puts a finished layer on the page: sizes the page's canvas like it (which clears it) and copies
// the picture over in the same moment, so the browser never shows it empty, then marks it shown,
// which fades it in the first time (stage.css).
function place(target, source) {
  surface(target, source.width, source.height, 1).drawImage(source, 0, 0);
  target.dataset.shown = '';
}

// Paints every still layer for a window W × H, a piece at a time, and returns what frame() needs.
// keepOut is the boxes the words are in. Each layer is painted on a canvas off the page, then put
// on the page whole. On the first paint (oneByOne) each goes on as soon as it's finished, so the
// galaxy fades in a layer at a time (the sky waits for the planet: its glow is the planet's light,
// and alone it would show a dark disc where the planet goes). On a repaint they all go on together
// at the end, so the new sky never shows behind the old planet.
export function* paintGalaxy(page, W, H, keepOut, oneByOne) {
  // How many canvas pixels to a CSS pixel: the screen's own for the sharp layers (stars, glitter),
  // up to 2, and less on a huge screen; the soft layers work at their own small size.
  const sharp = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(9e6 / (W * H)));
  const scene = compose(W, H, keepOut, SEED);
  const finished = [];
  const finish = (target, source) => {
    if (oneByOne) place(target, source);
    else finished.push([target, source]);
  };
  finish(page.lens, paintLens(scene));
  yield;
  const [skyCanvas, sky] = yield* paintSky(scene);
  yield;
  const [orbitCanvas, orbit] = offscreen(W, H, sharp);
  yield* paintStars(orbit, scene, sky, 1 / sharp);
  yield* paintPlanet(orbit, scene);
  paintSuns(orbit, scene);
  finish(page.sky, skyCanvas);
  finish(page.orbit, orbitCanvas);
  yield;
  finish(page.veil, yield* paintVeil(scene));
  const sprites = yield* glintSprites(sharp);
  const [glitterCanvas, glitter] = offscreen(W, H, sharp);
  const moving = yield* paintGlitter(glitter, scene, 1 / sharp, sprites);
  finish(page.glitter, glitterCanvas);
  for (const [target, source] of finished) place(target, source);
  const glints = surface(page.glints, W, H, sharp);
  page.glints.dataset.shown = '';
  return {
    width: W,
    height: H,
    glints,
    veil: page.veil,
    ...moving,
    sprites,
    dirty: new Float32Array(4 * 1024),
    dirtyCount: -1,
  };
}

// One frame of the glitter's life, at time t (ms). Each mid flake turns slowly, and flashes when
// its face lines up with the light: cos^24 of its turn is a short, bright swell once a turn
// (cos^48 for a glinter, which flares with the camera's spikes), a slower wobble makes some turns
// brighter than others, and holographic foil shifts color as it goes. A few specks of the far
// dust catch the light as pinpricks. A few near flakes swell and fade as they turn, drifting a
// little. The veil of haze drifts. Only the glints canvas is drawn, and only where something was
// or is (the boxes in galaxy.dirty); the veil just moves.
export function frame(galaxy, t) {
  const { glints: ctx, flakes, motes, near, sprites, width: W, height: H, veil, dirty } = galaxy;
  const s = t / 1000;
  if (galaxy.dirtyCount < 0) ctx.clearRect(0, 0, W, H);
  else {
    for (let i = 0; i < galaxy.dirtyCount * 4; i += 4) {
      ctx.clearRect(dirty[i], dirty[i + 1], dirty[i + 2], dirty[i + 3]);
    }
  }
  let n = 0;
  const mark = (x, y, size) => {
    if (n < 1024) {
      dirty[n * 4] = x - size / 2 - 1;
      dirty[n * 4 + 1] = y - size / 2 - 1;
      dirty[n * 4 + 2] = size + 2;
      dirty[n * 4 + 3] = size + 2;
    }
    n++;
  };
  ctx.globalCompositeOperation = 'lighter';
  for (const b of near) {
    // Dark most of each turn; it swells into the light and out again.
    const c = Math.cos(b.phase + s * b.speed);
    if (c <= 0.4) continue;
    const k = ((c - 0.4) / 0.6) ** 2;
    const x = b.x + b.dx * Math.sin(s * 0.061 + b.phase);
    const y = b.y + b.dy * Math.sin(s * 0.043 + b.phase * 1.7);
    ctx.globalAlpha = b.alpha * k;
    ctx.drawImage(b.sprite, x - b.half, y - b.half, b.half * 2, b.half * 2);
    mark(x, y, b.half * 2);
  }
  for (const m of motes) {
    const c = Math.cos(m.phase + s * m.speed);
    if (c < 0.93) continue;
    const c4 = c * c * c * c;
    const k = c4 * c4 * c4 * c4 * c4 * c4 * c4 * c4 * c4 * c4 * m.peak; // c^40
    if (k < 0.05) continue;
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.fillStyle = m.color;
    ctx.fillRect(m.x, m.y, m.size, m.size);
    const g = 2 + 4 * k;
    ctx.globalAlpha = k * 0.6;
    ctx.drawImage(sprites.cores[1], m.x + m.size / 2 - g / 2, m.y + m.size / 2 - g / 2, g, g);
    mark(m.x, m.y, g + 2);
  }
  for (const f of flakes) {
    const turn = Math.cos(f.phase + s * f.speed);
    if (turn < 0.86) continue;
    const t2 = turn * turn;
    const t8 = t2 * t2 * t2 * t2;
    const t24 = t8 * t8 * t8;
    const swell = 0.5 + 0.5 * Math.cos(f.wobble + s * f.wobbleSpeed);
    // A glinter is flatter, a truer mirror: its flash is shorter and sharper (turn^48).
    const k = (f.glinter ? t24 * t24 : t24) * (0.4 + 0.6 * swell) * f.peak;
    if (k < 0.03) continue;
    // The facet itself, lit.
    if (f.pts) {
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillStyle = f.hot;
      facetPath(ctx, f.pts);
      ctx.fill();
    }
    // Its glow, in its color (and, on holographic foil, its neighbor's as it turns).
    const c = 2 + f.size * (1.2 + 2.4 * k);
    if (f.holo) {
      const m = 0.5 + 0.5 * Math.sin(f.phase * 0.5 + s * f.speed * 0.5);
      ctx.globalAlpha = Math.min(1, k) * (1 - m);
      ctx.drawImage(sprites.cores[f.sprite], f.x - c / 2, f.y - c / 2, c, c);
      ctx.globalAlpha = Math.min(1, k) * m;
      ctx.drawImage(sprites.cores[f.sprite2], f.x - c / 2, f.y - c / 2, c, c);
    } else {
      ctx.globalAlpha = Math.min(1, k);
      ctx.drawImage(sprites.cores[f.sprite], f.x - c / 2, f.y - c / 2, c, c);
    }
    let box = c;
    // The camera's spikes, when a glinter is bright enough to flare.
    if (f.glinter && k > 0.3) {
      const d = (10 + 14 * f.size) * (k - 0.1);
      ctx.globalAlpha = Math.min(1, (k - 0.2) * 1.4);
      const spikes = d < 32 ? sprites.small : sprites.large;
      ctx.drawImage(spikes[f.sprite], f.x - d / 2, f.y - d / 2, d, d);
      box = Math.max(box, d);
    }
    mark(f.x, f.y, box);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  galaxy.dirtyCount = n <= 1024 ? n : -1;
  // The veil drifts on a long, uneven loop: a few px a second at most.
  const dx = Math.sin(s * 0.071 + 1.3) * 16 + Math.sin(s * 0.023) * 8;
  const dy = Math.sin(s * 0.053) * 7;
  veil.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
}

// A tile of film grain for the lens, centred on mid-grey, with a little color in it.
export function grain() {
  const [canvas, ctx] = offscreen(160, 160);
  const img = ctx.createImageData(160, 160);
  const r = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (r() + r() - 1) * 80;
    img.data[i] = 128 + v + (r() - 0.5) * 14;
    img.data[i + 1] = 128 + v + (r() - 0.5) * 14;
    img.data[i + 2] = 128 + v + (r() - 0.5) * 14;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// ---- Mounting: the layers on the page, painted a piece at a time, then the twinkle ----

// How long each frame may spend painting, in ms: long enough that the paint is done in well under
// a second on a laptop, short enough that the page still answers a key or a click at once.
const BUDGET = 8;

/**
 * Puts the galaxy behind the page: builds its stacked layers inside host, paints them a piece at
 * a time (at most BUDGET ms a frame, so the page never freezes), then lets the glitter twinkle at
 * most 30 times a second. Its own background is the night's gradient (stage.css), which shows at
 * once, while the canvases are still being painted. It holds still for someone who asks their
 * system for less motion, stops while the tab is hidden, and repaints 150 ms after the window (or
 * the words it keeps clear of) stops changing size. It's only a picture: screen readers skip it
 * and every click goes through it. If the browser can't paint it, it says so once in the console
 * and the plain night stays.
 * @param {HTMLElement} host an empty element; stage.css fixes the layers to the window behind
 *   everything
 * @param {{ keepOut?: Element | Element[] }} [opts] keepOut: the card (or any words) the bright
 *   stars and glitter keep clear of, so they stay easy to read
 * @returns {() => void} stop(): stops painting, twinkling and listening (the last picture stays)
 */
export function mountGalaxy(host, opts = {}) {
  const space = document.createElement('div');
  space.className = 'galaxy';
  space.setAttribute('aria-hidden', 'true');
  const layer = (className) => {
    const canvas = document.createElement('canvas');
    if (className) canvas.className = className;
    space.append(canvas);
    return canvas;
  };
  // Back to front (see the list at the top of this file, and stage.css).
  const canvases = {
    sky: layer(''),
    orbit: layer(''),
    veil: layer('veil'),
    glitter: layer('glitter'),
    glints: layer('glints'),
    lens: layer(''),
  };
  const grainLayer = document.createElement('div');
  grainLayer.className = 'grain';
  space.append(grainLayer);
  host.append(space);

  // The words the glitter keeps clear of.
  const words = (Array.isArray(opts.keepOut) ? opts.keepOut : [opts.keepOut]).filter(
    (el) => el instanceof Element,
  );
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let gone = false; // set by stop()
  let warned = false;
  let job = null; // the paint in progress, if there is one
  let galaxy = null; // the finished paint, which every frame draws from
  let shown = false; // whether a paint has finished, so every layer is on the page
  let paintedFor = ''; // the window and words it was last painted (or is painting) for
  let paintFrame = 0; // the frame asked for to paint the next pieces (0: none)
  let twinkleFrame = 0; // the frame asked for to twinkle (0: none)
  let last = 0; // when the twinkle last drew, in ms
  let timer = 0; // a repaint waiting for a resize to settle

  // Where the words are now, in CSS px.
  function keepOut() {
    return words.map((word) => {
      const r = word.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  }

  // Start painting for the window as it is now, in pieces (work, below).
  function repaint() {
    if (gone) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (W < 1 || H < 1) return; // no window to paint (a minimized one): wait for a resize
    const boxes = keepOut();
    // The same window and words as last time make the same picture, so skip it. (The words'
    // observer below calls once as soon as it starts watching, and a resize can call both.)
    const sizes = boxes.map((b) => [b.x, b.y, b.w, b.h].map(Math.round).join(','));
    const size = `${W} ${H} ${window.devicePixelRatio} ${sizes.join(' ')}`;
    if (size === paintedFor) return;
    paintedFor = size;
    // A paint still in progress is for the old size: drop it (a generator only runs when it's
    // asked to, so one that's dropped just stops), and stop the twinkle until the new one is done.
    stopTwinkle();
    cancelAnimationFrame(paintFrame);
    galaxy = null;
    job = paintGalaxy(canvases, W, H, boxes, !shown);
    paintFrame = requestAnimationFrame(work);
  }

  // Paint the next pieces for up to BUDGET ms, then let the browser show the page and answer the
  // user, and go on in the next frame. When the last piece is done, show the twinkle as it is now
  // (or the still moment), and start it.
  function work() {
    paintFrame = 0;
    if (!job) return;
    try {
      const until = performance.now() + BUDGET;
      let step = job.next();
      while (!step.done && performance.now() < until) step = job.next();
      if (!step.done) {
        paintFrame = requestAnimationFrame(work);
        return;
      }
      job = null;
      galaxy = step.value;
      shown = true;
    } catch (error) {
      fail(error);
      return;
    }
    showAt(motion.matches ? STILL : performance.now());
    startTwinkle();
  }

  // Draw the twinkle as it is at time t, in ms.
  function showAt(t) {
    if (!galaxy) return;
    try {
      frame(galaxy, t);
    } catch (error) {
      fail(error);
    }
  }

  // One frame of the twinkle. A screen asks for 60 frames a second or more, so most are skipped:
  // it draws at most 30.
  function twinkle(now) {
    twinkleFrame = requestAnimationFrame(twinkle);
    if (now - last < 1000 / 30 - 2) return;
    last = now;
    showAt(now);
  }

  function startTwinkle() {
    if (gone || twinkleFrame || !galaxy || motion.matches || document.hidden) return;
    last = 0;
    twinkleFrame = requestAnimationFrame(twinkle);
  }

  function stopTwinkle() {
    cancelAnimationFrame(twinkleFrame);
    twinkleFrame = 0;
  }

  // A browser short on memory can refuse to make a canvas, even partway through. Clear every
  // layer (a canvas 0 pixels wide shows nothing), so the galaxy's plain night shows instead of
  // half a picture, and forget the size, so the next resize tries again. The page works without
  // the galaxy.
  function fail(error) {
    stopTwinkle();
    job = null;
    galaxy = null;
    paintedFor = '';
    for (const canvas of Object.values(canvases)) canvas.width = 0;
    if (!warned) console.warn('The galaxy could not be painted.', error);
    warned = true;
  }

  function repaintSoon() {
    window.clearTimeout(timer);
    timer = window.setTimeout(repaint, 150);
  }

  // Hidden, the tab stops twinkling; shown again, it carries on from the time it is now.
  function changeVisibility() {
    if (document.hidden) stopTwinkle();
    else startTwinkle();
  }

  // Motion reduced (or welcome again) while the page is open: show the still moment, then
  // twinkle only if motion is welcome.
  function changeMotion() {
    stopTwinkle();
    showAt(STILL);
    startTwinkle();
  }

  try {
    space.style.setProperty('--galaxy-grain', `url(${grain()})`);
  } catch (error) {
    // Without it the lens has no grain: stage.css falls back to none.
    console.warn('The grain could not be drawn.', error);
  }
  repaint();

  // Repaint when the window changes size, and when the words do (when the web fonts arrive, say).
  // A ResizeObserver calls back whenever an element it watches changes size.
  window.addEventListener('resize', repaintSoon);
  const wordSizes = typeof ResizeObserver === 'function' ? new ResizeObserver(repaintSoon) : null;
  for (const word of words) wordSizes?.observe(word);
  document.addEventListener('visibilitychange', changeVisibility);
  motion.addEventListener('change', changeMotion);

  return function stop() {
    gone = true;
    job = null;
    cancelAnimationFrame(paintFrame);
    stopTwinkle();
    window.clearTimeout(timer);
    window.removeEventListener('resize', repaintSoon);
    wordSizes?.disconnect();
    document.removeEventListener('visibilitychange', changeVisibility);
    motion.removeEventListener('change', changeMotion);
  };
}
