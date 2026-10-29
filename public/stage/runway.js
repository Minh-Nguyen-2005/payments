// Paints the runway behind the front page. The camera lies low on a glitter runway and looks down
// it to a lit stage at the far end: a row of small lights on the rig, their beams angled down
// through the haze onto the glitter, and the audience only as the dark beside the runway. One
// canvas or layer for each part of the picture that blends its own way; mountRunway() (at the end
// of this file) stacks them and stage.css blends them, back to front:
//
//   lit       everything the stage's colored light falls on, painted once in white light (the lum
//             canvas), with the drifting haze over it, all multiplied by the gel: the light's
//             color. The gel moves slowly, so the whole picture changes color without a repaint.
//   own       light that isn't the gel's: flakes catching the white light from the rig over the
//             runway, in their own colors, and the white-hot cores of the lights and of the
//             brightest glints, which clip to white whatever the gel
//   twinkle   the glints that come and go: the only canvas redrawn while the stage runs
//
// paintRunway() paints the still layers, once and again after a resize, and returns the function
// that draws one frame of the stage's life. compose() decides where everything stands. Some of
// the brushes are shared with the galaxy (tools.js); the rest are below. mountRunway() runs it all.
import {
  SPIKE_ANGLE,
  WHITE,
  css,
  glowAt,
  haze,
  mix,
  offscreen,
  rng,
  smooth,
  surface,
  tinted,
  grain,
} from './tools.js';

/**
 * Where the page's cards stand, in CSS pixels, measured as if the page were scrolled to the top:
 * the runway stays put while the cards scroll over it. mountRunway() measures them.
 * @typedef {object} CardLayout
 * @property {number} header the header's bottom edge (0 with no header)
 * @property {number} left the cards' left edge
 * @property {number} right the cards' right edge
 * @property {number} top the first card's top
 * @property {number} gap the middle of the gap between two cards (-1 for none)
 * @property {number} bottom the last card's bottom
 */

/**
 * The canvases and layers mountRunway() stacks, back to front (see the list above). hazeWrap
 * holds the haze, and the mask that shows it only where the light is.
 * @typedef {{ lum: HTMLCanvasElement, hazeWrap: HTMLElement, haze: HTMLCanvasElement,
 *   gel: HTMLElement, own: HTMLCanvasElement, twinkle: HTMLCanvasElement, grain: HTMLElement }}
 *   RunwayLayers
 */

// The seed for all of the runway's random numbers: the same seed, the same picture.
const SEED = 7;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));

// ------------------------------------------------------------------------------ brushes

// A pixel-for-pixel copy of a canvas.
function copyOf(src) {
  const [canvas, ctx] = offscreen(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

// A soft ellipse in one color, its stops [where, alpha] (tools.js glowAt, in one color).
function glow(ctx, x, y, rx, ry, color, stops) {
  if (rx <= 0 || ry <= 0) return;
  glowAt(
    ctx,
    x,
    y,
    rx,
    ry,
    stops.map(([at, alpha]) => [at, css(color, alpha)]),
  );
}

// Light in the air, falling off as light does (a Gaussian), with no edge where a gradient's stops
// would meet: alpha in the middle, next to nothing at rx by ry. A bigger k falls off faster.
function haloAt(ctx, x, y, rx, ry, color, alpha, k = 3.2) {
  const floor = Math.exp(-k);
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    stops.push([t, (alpha * (Math.exp(-k * t * t) - floor)) / (1 - floor)]);
  }
  glow(ctx, x, y, rx, ry, color, stops);
}

// The lens's aperture at angle a, for a radius of 1: an octagon (tools.js SPIKE_ANGLE: one camera
// for every light) whose blades curve a little, as real ones do, so a disc reads as a lens's and
// not as a drawn shape.
function apertureRadius(a) {
  const side = Math.PI / 4;
  const local = ((((a - SPIKE_ANGLE - Math.PI / 8) % side) + side) % side) - side / 2;
  const octagon = Math.cos(Math.PI / 8) / Math.cos(local);
  return lerp(octagon, 0.96, 0.4);
}

// An out-of-focus disc's sprite: the disc is DISC_R px across the middle, with DISC_PAD px of
// soft edge around it, so the disc fills DISC_FILL of the sprite's half-size.
const DISC_R = 48;
const DISC_PAD = 4;
const DISC_FILL = DISC_R / (DISC_R + DISC_PAD);

// An out-of-focus glint, worked out pixel by pixel: the aperture's octagon, evenly lit, its edge
// soft rather than cut out, and with rim the brighter rim a real lens gives some (it follows the
// octagon, not a circle). Made in white, then tinted() for each color.
function apertureSprite(rim) {
  const n = (DISC_R + DISC_PAD) * 2;
  const [sprite, ctx] = offscreen(n, n);
  const img = ctx.createImageData(n, n);
  const c = n / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = i + 0.5 - c;
      const dy = j + 0.5 - c;
      const d = Math.hypot(dx, dy) / (DISC_R * apertureRadius(Math.atan2(dy, dx)));
      if (d >= 1.07) continue;
      const edge = 1 - smooth(0.84, 1.07, d);
      const body = rim ? 0.4 + 0.5 * smooth(0.45, 0.93, d) : 0.9 - 0.18 * d * d;
      const k = (j * n + i) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * edge * body);
    }
  }
  ctx.putImageData(img, 0, 0);
  return sprite;
}

// An in-focus flake catching the light: a hot point with a fast, soft falloff. Soft, it's a flake
// just out of focus: a small even blur, too small to show the aperture's shape.
function pointSprite(color, soft = false) {
  const R = 16;
  const [sprite, ctx] = offscreen(R * 2, R * 2);
  const g = ctx.createRadialGradient(R, R, 0, R, R, R);
  const stops = soft
    ? [
        [0, 1],
        [0.45, 0.7],
        [0.8, 0.22],
        [1, 0],
      ]
    : [
        [0, 1],
        [0.16, 0.85],
        [0.42, 0.2],
        [1, 0],
      ];
  for (const [at, alpha] of stops) g.addColorStop(at, css(color, alpha));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, R * 2, R * 2);
  return sprite;
}

// The 8 spikes of a starburst, all the same length, fading out from the color at their root.
function spikes(ctx, x, y, length, width, color, alpha) {
  for (let k = 0; k < 8; k++) {
    const a = SPIKE_ANGLE + (k * Math.PI) / 4;
    const ex = x + Math.cos(a) * length;
    const ey = y + Math.sin(a) * length;
    const g = ctx.createLinearGradient(x, y, ex, ey);
    g.addColorStop(0, css(color, alpha));
    g.addColorStop(0.25, css(color, alpha * 0.35));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a + Math.PI / 2) * width, y + Math.sin(a + Math.PI / 2) * width);
    ctx.lineTo(ex, ey);
    ctx.lineTo(x + Math.cos(a - Math.PI / 2) * width, y + Math.sin(a - Math.PI / 2) * width);
    ctx.closePath();
    ctx.fill();
  }
}

// The camera's starburst, white hot: a core, a short halo and the spikes. It's a plain
// starburst without the colored halo, which the runway leaves to the lit layer and its gel.
function starburst(ctx, x, y, size, alpha) {
  glow(ctx, x, y, size, size, WHITE, [
    [0, alpha],
    [0.08, alpha * 0.85],
    [0.25, alpha * 0.25],
    [1, 0],
  ]);
  spikes(ctx, x, y, size * 2.4, Math.max(0.3, size * 0.03), WHITE, alpha * 0.9);
}

// A beam through the haze, from a light at (x, y) down to where it lands at (tx, ty), w0 wide at
// the light and w1 where it lands: a chain of soft halos along it, each a little wider than the
// last and overlapping the next, so the cone has a soft edge (light falls off across a beam, it
// doesn't stop) and no seams. Brightest by the light, thinning out with distance, and gone where
// it meets the floor, where the pool it makes takes over.
function beam(ctx, x, y, tx, ty, w0, w1, alpha) {
  const len = Math.hypot(tx - x, ty - y);
  const angle = Math.atan2(ty - y, tx - x);
  const steps = Math.max(8, Math.ceil(len / 14));
  const before = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const w = lerp(w0, w1, t);
    const fall = (0.5 + 0.5 * Math.exp(-t * 1.8)) * (1 - smooth(0.84, 1, t));
    ctx.save();
    ctx.translate(lerp(x, tx, t), lerp(y, ty, t));
    ctx.rotate(angle);
    haloAt(ctx, 0, 0, (len / steps) * 1.7, w, WHITE, alpha * fall * 0.42, 2.6);
    ctx.restore();
  }
  ctx.globalCompositeOperation = before;
}

// The lens's glare: every bright thing spills a little light around itself. A copy drawn small
// and stretched back up is a wide blur, added on top.
function bloom(canvas, ctx, W, H, near, wide) {
  const [a, ax] = offscreen(Math.ceil(W / 8), Math.ceil(H / 8));
  ax.imageSmoothingQuality = 'high';
  ax.drawImage(canvas, 0, 0, a.width, a.height);
  const [b, bx] = offscreen(Math.ceil(W / 32), Math.ceil(H / 32));
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(a, 0, 0, b.width, b.height);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = near;
  ctx.drawImage(a, 0, 0, W, H);
  ctx.globalAlpha = wide;
  ctx.drawImage(b, 0, 0, W, H);
  ctx.restore();
}

// The glitter's own colors, as filters on white light, every flake a tiny mirror: silver, gold,
// pink, lavender and ice blue, and how common each is. On the lit layer the gel multiplies them;
// on the own layer they keep their color.
const FLAKES = [
  [230, 236, 250],
  [255, 206, 128],
  [255, 160, 212],
  [206, 180, 255],
  [166, 212, 255],
];
const FLAKE_SHARE = [0.28, 0.2, 0.18, 0.18, 0.16];

// Which flake color a random number u (0 up to 1) picks, each as often as FLAKE_SHARE says: walk
// along the shares until u falls inside one.
function pickFlake(u) {
  let left = u;
  for (let i = 0; i < FLAKES.length - 1; i++) {
    left -= FLAKE_SHARE[i];
    if (left <= 0) return i;
  }
  return FLAKES.length - 1;
}

// ------------------------------------------------------------------------------ the scene

// Where everything stands, for a window this size. The camera lies low on the runway and looks
// down it to the stage. The runway's edges run from the vanishing point (cx, yh) out through the
// sides of the frame (steeper on a phone, whose frame is narrow, so the runway still reads as
// one going away from you); the floor at row y is f / (y - yh) camera heights away. The lens is
// focused just under the cards, where the beams land: the near glitter melts into big
// out-of-focus discs, and the far end goes soft.
function compose(W, H, cards) {
  const G = Math.sqrt(W * H); // the frame's size, for things that scale with it
  const p = 1 - smooth(0.8, 1.35, W / H); // 0 for a wide window, 1 for a phone standing up
  const cx = W / 2;
  const yh = H * lerp(0.47, 0.355, p); // eye level: where the runway's edges meet
  const ys = yh + Math.max(3, H * 0.007); // the stage's lip, where the runway ends
  const floorH = H - yh;
  // How steeply the edges run (y - yh = slope · |x - cx|): they leave through the sides of the
  // frame this share of the way down the floor.
  const slope = (lerp(0.4, 0.9, p) * 2 * floorH) / W;
  const f = floorH * 4; // 4 camera heights away at the bottom of the frame
  const under = cards.bottom > 0 ? cards.bottom : H * lerp(0.62, 0.8, p);
  const yFocus = clamp(under + H * lerp(0.07, 0.06, p), yh + floorH * 0.3, H - floorH * 0.1);
  const dFocus = f / (yFocus - yh);
  // The blur (the radius of a glint's disc): blurBottom at the bottom of the frame, nothing where
  // the lens is focused, and blurFar at the stage, which is held to less than a real lens would
  // give, so the far runway still reads as glitter.
  const blurBottom = G * lerp(0.03, 0.04, p);
  const blurFar = G * lerp(0.012, 0.005, p);
  const kNear = blurBottom / Math.max(0.01, 1 / 4 - 1 / dFocus);
  const kFar = blurFar / Math.max(0.01, 1 / dFocus - (ys - yh) / f);

  // The rig over the far stage: a row of small lights, none quite like the next. Where the page
  // lets it, the row hangs where it shows between the cards: on a wide window level with the gap
  // between them (the middle lights look through it), and on a phone, where the cards cover the
  // stage, in the dark between the header and the first card.
  let rigY = yh - H * lerp(0.165, 0.18, p);
  if (p < 0.5 && cards.gap > yh - H * 0.26 && cards.gap < yh - H * 0.08) rigY = cards.gap;
  if (p > 0.5 && cards.top - cards.header > 36) rigY = (cards.header + cards.top) / 2 + 3;
  // Each light: where it hangs across the frame (u), its size and strength, and where its beam is
  // aimed: aim is how far in toward the middle it lands (1 straight down, less than 1 inward), and
  // reach how near the lens (0 just under the cards, 1 nearer).
  const row =
    p < 0.5
      ? [
          { u: 0.07, size: 1.05, strength: 0.95, aim: 0.6, reach: 0.6 },
          { u: 0.215, size: 0.85, strength: 0.8, aim: 0.64, reach: 0.22 },
          { u: 0.365, size: 0.95, strength: 0.9, aim: 0.95, reach: 0 },
          { u: 0.635, size: 0.9, strength: 0.85, aim: 0.9, reach: 0.08 },
          { u: 0.785, size: 0.8, strength: 0.75, aim: 0.6, reach: 0.32 },
          { u: 0.93, size: 1, strength: 0.9, aim: 0.64, reach: 0.66 },
        ]
      : [
          { u: 0.1, size: 0.95, strength: 0.85, aim: 0.62, reach: 0.8 },
          { u: 0.31, size: 0.8, strength: 0.75, aim: 0.7, reach: 0.2 },
          { u: 0.69, size: 0.85, strength: 0.8, aim: 0.68, reach: 0.35 },
          { u: 0.9, size: 1, strength: 0.9, aim: 0.6, reach: 0.95 },
        ];
  const lightSize = G * lerp(0.0085, 0.011, p);
  const lights = row.map((l) => ({
    x: W * l.u,
    y: rigY,
    size: lightSize * l.size,
    strength: l.strength,
    aim: l.aim,
    reach: l.reach,
    // Its reflection: a glitter path under it, around where its mirror image would be.
    my: Math.min(H, 2 * yh - rigY),
    mh: floorH * 0.32,
  }));
  // Each light throws a beam down onto the runway. Where it lands it pools on the glitter: a flat
  // ellipse, in the perspective.
  const pools = [];
  const beams = lights.map((l) => {
    const tx = cx + (l.x - cx) * l.aim;
    const ty = clamp(
      yFocus + (l.reach - 0.2) * floorH * lerp(0.36, 0.18, p),
      yh + floorH * 0.2,
      H - 8,
    );
    const rx = G * lerp(0.055, 0.08, p) * (0.8 + 0.5 * l.reach);
    const ry = Math.max(6, ((rx * (ty - yh)) / f) * 3.2);
    pools.push({ x: tx, y: ty, rx, ry, a: 1.15 * l.strength });
    return {
      x: l.x,
      y: l.y,
      tx,
      ty,
      w0: l.size * 0.8,
      w1: rx * (0.75 + 0.2 * l.size),
      a: 0.75 * l.strength,
    };
  });
  // The hot light behind the runway's end, which the glitter path runs toward.
  const backlight = { x: cx, y: ys - H * 0.013, size: G * 0.014, strength: 1 };
  return {
    W,
    H,
    G,
    p,
    cx,
    yh,
    ys,
    floorH,
    slope,
    f,
    invFocus: 1 / dFocus,
    kNear,
    kFar,
    blurBottom,
    lights,
    beams,
    pools,
    backlight,
    pathW0: W * lerp(0.022, 0.06, p),
    pathW1: W * lerp(0.11, 0.2, p),
    mirrorW: W * lerp(0.03, 0.06, p),
    // The share of the glints that catch the white light from the rig over the runway, in their
    // own colors, rather than the gel's.
    ownShare: 0.42,
  };
}

/** Everything compose() works out, for one window. @typedef {ReturnType<typeof compose>} Scene */

// How far away the floor at row y is, in camera heights; how far its runway reaches to each side
// of the middle; and how big the lens's blur makes a glint there.
const depthAt = (s, y) => s.f / Math.max(0.5, y - s.yh);
const halfAt = (s, y) => Math.max(0, y - s.yh) / s.slope;
function blurAt(s, y) {
  const inv = 1 / depthAt(s, y);
  return inv > s.invFocus ? s.kNear * (inv - s.invFocus) : s.kFar * (s.invFocus - inv);
}

// The gel's light falling on the floor, row by row, in white (the gel colors it later). k is 0 at
// the stage and 1 at the bottom of the frame:
//   ambient  a little everywhere
//   front    the stage's own light, pooled on the glitter just in front of it
//   sheen    the backdrop, mirrored at a grazing angle in the far end of the floor
//   path     the glitter path down the middle: every flake there can mirror the hot light at the
//            runway's end into the lens, the way the sun glitters in a path across the sea; it
//            widens toward the lens
//   mirror   a fainter path under each light on the rig, around its mirror image
//   pool     where each beam lands
function lightRow(s, y) {
  const k = (y - s.ys) / (s.H - s.ys);
  const half = halfAt(s, y);
  return {
    half,
    ambient: 0.025 + 0.02 * k,
    front: 0.55 * Math.exp(-k / 0.1),
    frontW: s.W * 0.1 + half * 0.4,
    sheen: 0.75 * Math.exp(-k / 0.035),
    sheenW: s.W * 0.05 + half * 0.25,
    path: 1.6 * (0.55 + 0.45 * Math.exp(-k / 0.35)),
    pathW: s.pathW0 + s.pathW1 * k,
    mirror: s.lights.map((l) => 0.32 * l.strength * Math.exp(-(((y - l.my) / l.mh) ** 2))),
    pool: s.pools.map((q) => q.a * Math.exp(-(((y - q.y) / q.ry) ** 2))),
  };
}

// How much of the glitter path's light reaches across the row L to x: 1 down the middle.
const pathIn = (s, L, x) => Math.exp(-(((x - s.cx) / L.pathW) ** 2));

// The light at x along the row L: the row's light, spread across it.
function lightIn(s, L, x) {
  const dx = x - s.cx;
  const qf = dx / L.frontW;
  const qs = dx / L.sheenW;
  let E =
    L.ambient +
    L.front / (1 + 2 * qf * qf) +
    L.sheen / (1 + 3 * qs * qs) +
    L.path * pathIn(s, L, x);
  for (let i = 0; i < s.lights.length; i++) {
    E += L.mirror[i] * Math.exp(-(((x - s.lights[i].x) / s.mirrorW) ** 2));
  }
  for (let i = 0; i < s.pools.length; i++) {
    E += L.pool[i] * Math.exp(-(((x - s.pools[i].x) / s.pools[i].rx) ** 2));
  }
  return E;
}

// The light at one point of the floor.
const lightAt = (s, x, y) => lightIn(s, lightRow(s, y), x);

// The white light from the rig over the runway (out of the frame, above), which the own layer's
// flakes catch: strongest down the middle of the runway and toward the lens, falling off to its
// sides, and only a little at the far end.
function whiteAt(s, x, y) {
  const k = clamp((y - s.ys) / (s.H - s.ys), 0, 1);
  const spread = s.W * lerp(0.2, 0.3, s.p) + halfAt(s, y) * 0.25;
  return (0.08 + 0.42 * smooth(0, 0.6, k)) * (0.3 + 0.7 * Math.exp(-(((x - s.cx) / spread) ** 2)));
}

// Thicker and thinner glitter, laid on the floor in perspective: smooth noise across the runway
// and along the log of the depth, so the patches shrink and flatten toward the stage. Returns a
// function of where on the floor (patchU, patchV), from 0.78 to 1.22.
function patches(seed) {
  const N = 64;
  const grid = new Float32Array(N * N).map(rng(seed));
  return (u, v) => {
    const u0 = Math.floor(u);
    const v0 = Math.floor(v);
    const tu = u - u0;
    const tv = smooth(0, 1, v - v0);
    const a0 = grid[(v0 & 63) * N + (u0 & 63)];
    const a1 = grid[(v0 & 63) * N + ((u0 + 1) & 63)];
    const b0 = grid[((v0 + 1) & 63) * N + (u0 & 63)];
    const b1 = grid[((v0 + 1) & 63) * N + ((u0 + 1) & 63)];
    const top = a0 + (a1 - a0) * tu;
    return 0.78 + 0.44 * (top + (b0 + (b1 - b0) * tu - top) * tv);
  };
}
const patchU = (s, x, y) => ((x - s.cx) / Math.max(0.5, halfAt(s, y))) * 7 + 64;
const patchV = (s, y) => Math.log(depthAt(s, y)) * 5.5;

// The runway's outline, from its far end at the stage to past the bottom of the frame.
function runwayPath(ctx, s) {
  const bottom = s.H + 40;
  const far = halfAt(s, s.ys);
  const near = halfAt(s, bottom);
  ctx.beginPath();
  ctx.moveTo(s.cx - far, s.ys);
  ctx.lineTo(s.cx + far, s.ys);
  ctx.lineTo(s.cx + near, bottom);
  ctx.lineTo(s.cx - near, bottom);
  ctx.closePath();
}

// ------------------------------------------------------------------------------ the still layers

/**
 * The sprites the flakes are drawn with, in each flake color: points in focus, soft points just
 * out of it, paler points for the own layer, a white-hot core, and the out-of-focus discs (even
 * and rimmed, and a pearl one for the overexposed). Each is a small canvas.
 * @typedef {{ point: HTMLCanvasElement[], soft: HTMLCanvasElement[], white: HTMLCanvasElement[],
 *   core: HTMLCanvasElement, aperture: HTMLCanvasElement[][], pearl: HTMLCanvasElement }}
 *   FlakeSprites
 */

// The glitter bed, pixel by pixel: the dark body of the glitter between its sparkles. Where the
// lens is focused it's fine, contrasty, colored noise with a scatter of one-pixel glints; where
// it blurs, the noise averages away into the light's smooth wash. Beside the runway there's no
// floor to see from down here, only the dark. Like tools.js haze(), treat the inner loop as a
// black box: it's lightIn() for every pixel, sped up, times a flake picked by a hash of where the
// pixel is.
function paintFloorBed(ctx, s, scale, seed, patch) {
  const Wd = ctx.canvas.width;
  const j0 = Math.max(0, Math.floor(s.ys * scale));
  const rows = ctx.canvas.height - j0;
  if (rows <= 0) return;
  const img = ctx.createImageData(Wd, rows);
  const data = img.data;
  const inv = 1 / scale;
  // Across the frame, column by column: how far each light's mirror path and each pool reach
  // (they only depend on x, and each row scales them).
  const nl = s.lights.length;
  const np = s.pools.length;
  const mirrorX = new Float32Array(nl * Wd);
  const poolX = new Float32Array(np * Wd);
  for (let i = 0; i < Wd; i++) {
    const x = (i + 0.5) * inv;
    for (let k = 0; k < nl; k++) {
      mirrorX[k * Wd + i] = Math.exp(-(((x - s.lights[k].x) / s.mirrorW) ** 2));
    }
    for (let k = 0; k < np; k++) {
      poolX[k * Wd + i] = Math.exp(-(((x - s.pools[k].x) / s.pools[k].rx) ** 2));
    }
  }
  const tints = FLAKES.map((c) => c.map((v) => v / 255));
  const seedA = Math.imul(seed, 0x45d9f3b) | 0;
  // The floor comes out of the haze at the far end, with no hard edge.
  const farBlur = Math.max(2, blurAt(s, s.ys + 1));
  for (let j = 0; j < rows; j++) {
    const y = (j0 + j + 0.5) * inv;
    const blur = blurAt(s, y);
    const emerge = smooth(s.ys, s.ys + farBlur * 1.5, y);
    const amp = 1 / Math.max(1, blur * scale * 0.55); // how much of the fine noise survives
    const L = lightRow(s, y);
    const half = Math.max(0.5, L.half);
    const edgeSoft = Math.max(0.7, blur) / half;
    const trimW = Math.max(0.5, blur * 0.85);
    const trimA = Math.min(1, 0.7 / trimW) * 0.8;
    const pv = patchV(s, y);
    const ta = amp * 0.9;
    const pw = 1 / (L.pathW * L.pathW);
    const mrow = L.mirror;
    const prow = L.pool;
    let p = j * Wd * 4;
    for (let i = 0; i < Wd; i++, p += 4) {
      const x = (i + 0.5) * inv;
      const dx = x - s.cx;
      const au = Math.abs(dx) / half;
      const qf = dx / L.frontW;
      const qs = dx / L.sheenW;
      let E =
        L.ambient +
        L.front / (1 + 2 * qf * qf) +
        L.sheen / (1 + 3 * qs * qs) +
        L.path * Math.exp(-dx * dx * pw);
      for (let k = 0; k < nl; k++) E += mrow[k] * mirrorX[k * Wd + i];
      for (let k = 0; k < np; k++) E += prow[k] * poolX[k * Wd + i];
      const on = au <= 1 - edgeSoft ? 1 : au >= 1 + edgeSoft ? 0 : 0.5 + (1 - au) / (2 * edgeSoft);
      // The flake under this pixel: a hash of where it is.
      let h = (Math.imul(i, 0x9e3779b1) ^ Math.imul(j0 + j, 0x85ebca77) ^ seedA) | 0;
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      h ^= h >>> 12;
      h = Math.imul(h, 0x297a2d39);
      h ^= h >>> 15;
      const n = (h & 1023) / 1023;
      const n2 = ((h >>> 10) & 1023) / 1023;
      const t = tints[(h >>> 20) % 5];
      const n4 = n * n * n * n;
      const spark = n2 > 0.982 ? ((n2 - 0.982) / 0.018) * 1.5 * amp : 0;
      const flake = 0.07 + amp * (0.42 * n4 + spark) + (1 - amp) * 0.13;
      let v = E * flake * on * emerge * patch((dx / half) * 7 + 64, pv);
      // The runway's trim catches the light: a hairline where the camera is focused, going soft
      // toward the lens.
      const te = Math.abs(Math.abs(dx) - half) / trimW;
      if (te < 3) v += trimA * Math.exp(-te * te) * (0.12 + E * 0.5) * emerge;
      data[p] = 255 * v * (1 - ta + ta * t[0]);
      data[p + 1] = 255 * v * (1 - ta + ta * t[1]);
      data[p + 2] = 255 * v * (1 - ta + ta * t[2]);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, j0);
}

// One out-of-focus glint: a disc sprite, squeezed into a cat's eye toward the corners of the
// frame, as a lens does. (Not a round disc.)
function disc(ctx, s, sprite, x, y, radius, alpha) {
  const midY = s.H * 0.55;
  const dx = (x - s.cx) / (s.W / 2);
  const dy = (y - midY) / (s.H / 2);
  const off = Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);
  const toward = Math.atan2(y - midY, x - s.cx);
  const size = radius / DISC_FILL;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(toward);
  ctx.scale(1 - 0.3 * off * off, 1);
  ctx.rotate(-toward);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, -size, -size, size * 2, size * 2);
  ctx.restore();
}

// The far end: the air over the stage, lit where the light goes and textured by haze; the
// backdrop, out of focus, washed in the gel and hottest behind the runway's end; a low bank of fog
// where the runway meets the stage; the audience, only as darkness beside the runway; a few dim
// lights far off in the house; and the beams.
function paintFarEnd(ctx, s, scale, airHaze, r, sprites) {
  const { W, H, cx, ys, yh, G, p } = s;
  ctx.globalCompositeOperation = 'lighter';
  const [washCanvas, wash] = offscreen(W, H, scale / 2);
  // The wash: the stage's light filling the haze over it, widest and brightest just over the
  // stage floor and fading up into the dark of the rig.
  haloAt(wash, cx, ys - H * 0.11, W * 0.9, H * 0.3, WHITE, 0.34);
  haloAt(wash, cx, ys - H * 0.05, Math.max(W * 0.62, H * 0.34), H * 0.17, WHITE, 0.42);
  for (const l of s.lights) {
    haloAt(wash, l.x, l.y, l.size * 22, l.size * 17, WHITE, 0.46 * l.strength);
  }
  wash.globalCompositeOperation = 'destination-in';
  wash.drawImage(airHaze, 0, 0, W, H);
  ctx.drawImage(washCanvas, 0, 0, W, H);

  // The backdrop, out of focus: a broad soft panel of light, hot behind the runway's end.
  haloAt(ctx, cx, ys - H * 0.055, Math.max(W * 0.58, H * 0.32), H * 0.12, WHITE, 0.2);
  haloAt(ctx, cx, ys - H * 0.024, Math.max(W * 0.16, H * 0.12), H * 0.06, WHITE, 0.55);
  // Low fog where the runway meets the stage, lying over the line between them.
  haloAt(ctx, cx, ys + H * 0.006, W * 0.42, H * 0.022, WHITE, 0.09);
  haloAt(ctx, cx, ys + 1, Math.max(W * 0.3, H * 0.2), Math.max(4, H * 0.012), WHITE, 0.2);

  // The audience: no one, only the dark where they sit on either side of the runway, which hides
  // the bottom of the stage's light there. It rises a little toward the lens, and is drawn small
  // and stretched back, so it has no edge.
  ctx.globalCompositeOperation = 'source-over';
  const [crowdCanvas, crowd] = offscreen(W, H, 1 / 16);
  const rise = H * lerp(0.06, 0.045, p); // how far over the floor the dark reaches
  const dark = crowd.createLinearGradient(0, yh - rise, 0, yh + H * 0.01);
  dark.addColorStop(0, 'rgba(0,0,0,0)');
  dark.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  dark.addColorStop(1, 'rgba(0,0,0,1)');
  crowd.fillStyle = dark;
  const far = halfAt(s, ys) + W * 0.03;
  const exit = Math.min(H, yh + s.slope * (W / 2));
  for (const side of [-1, 1]) {
    const edge = side < 0 ? -W * 0.05 : W * 1.05;
    crowd.beginPath();
    crowd.moveTo(cx + side * far, yh - rise * 0.4);
    crowd.lineTo(edge, yh - rise);
    crowd.lineTo(edge, exit + H * 0.02);
    crowd.lineTo(cx + side * (W / 2), exit);
    crowd.lineTo(cx + side * halfAt(s, ys + 2), ys + 2);
    crowd.closePath();
    crowd.fill();
  }
  ctx.globalAlpha = 0.8;
  ctx.drawImage(crowdCanvas, 0, 0, W, H);
  ctx.globalAlpha = 1;

  // Far lights in the house beyond the stage's sides, a phone screen or an exit sign: dim, and
  // well out of focus.
  ctx.globalCompositeOperation = 'lighter';
  const n = Math.round(lerp(6, 3, p));
  for (let i = 0; i < n; i++) {
    const left = i % 2 === 0;
    const x = left ? W * (0.02 + 0.2 * r()) : W * (0.78 + 0.2 * r());
    const y = yh - H * (0.012 + 0.05 * r() ** 1.5);
    const radius = G * (0.005 + 0.004 * r());
    const sprite = sprites.aperture[(r() * FLAKES.length) | 0][1];
    disc(ctx, s, sprite, x, y, radius, 0.05 + 0.07 * r());
  }

  // The beams, textured by the haze they pass through, over a faint smooth copy of themselves.
  // They're drawn at a quarter of the size and stretched back up, which softens them further and
  // costs little.
  const [beamCanvas, beams] = offscreen(W, H, scale / 4);
  for (const b of s.beams) beam(beams, b.x, b.y, b.tx, b.ty, b.w0, b.w1, b.a);
  const smoothBeams = copyOf(beamCanvas);
  beams.globalCompositeOperation = 'destination-in';
  beams.drawImage(haze(170, 130, 9, 1.1), 0, 0, W, H);
  ctx.globalAlpha = 0.3;
  ctx.drawImage(smoothBeams, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.drawImage(beamCanvas, 0, 0, W, H);
  // Dust floating in the beams, too faint to flare.
  ctx.fillStyle = '#fff';
  for (const b of s.beams) {
    for (let i = 0; i < 26; i++) {
      const t = 0.08 + r() * 0.7;
      const spread = lerp(b.w0, b.w1, t) * 0.6;
      const alongX = b.tx - b.x;
      const alongY = b.ty - b.y;
      const len = Math.hypot(alongX, alongY);
      const off = (r() * 2 - 1) * spread;
      const x = b.x + alongX * t - (alongY / len) * off;
      const y = b.y + alongY * t + (alongX / len) * off;
      const bright = r() ** 2.4;
      ctx.globalAlpha = (0.1 + bright * 0.45) * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(x, y, 0.4 + bright * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// The lights: their glow in the air and their color (in white light here; the gel tints it), the
// outer part of their spikes, and on the own layer the white-hot core and spikes of the
// starburst. Then, on the runway only, the light they leave on the glitter: each beam's pool, and
// the hot light's reflection running down the middle.
function paintLights(lum, own, s) {
  lum.globalCompositeOperation = 'lighter';
  own.globalCompositeOperation = 'lighter';
  for (const l of [...s.lights, s.backlight]) {
    glow(lum, l.x, l.y, l.size * 7, l.size * 7, WHITE, [
      [0, 0.2 * l.strength],
      [0.3, 0.07 * l.strength],
      [1, 0],
    ]);
    glow(lum, l.x, l.y, l.size * 1.8, l.size * 1.8, WHITE, [
      [0, 0.9 * l.strength],
      [0.5, 0.3 * l.strength],
      [1, 0],
    ]);
    spikes(lum, l.x, l.y, l.size * 3.4, Math.max(0.4, l.size * 0.05), WHITE, 0.32 * l.strength);
    starburst(own, l.x, l.y, l.size, Math.min(1, 0.45 + 0.55 * l.strength));
  }
  lum.save();
  runwayPath(lum, s);
  lum.clip();
  for (const q of s.pools) {
    haloAt(lum, q.x, q.y, q.rx * 1.3, q.ry * 1.8, WHITE, 0.16 * q.a);
  }
  // The glitter path's sheen: so many flakes there mirror the hot light that, out of focus, they
  // add up to a glow running down the middle toward the lens.
  const b = s.backlight;
  glow(lum, b.x, s.ys + s.floorH * 0.06, b.size * 1.6, s.floorH * 0.1, WHITE, [
    [0, 0.2],
    [1, 0],
  ]);
  glow(lum, s.cx, s.ys + s.floorH * 0.45, s.pathW0 + s.pathW1 * 0.5, s.floorH * 0.6, WHITE, [
    [0, 0.07],
    [0.6, 0.03],
    [1, 0],
  ]);
  lum.restore();
  lum.globalCompositeOperation = 'source-over';
  own.globalCompositeOperation = 'source-over';
}

// The flakes bright enough to count, row by row from the stage to just past the bottom of the
// frame. Most catch the gel's light (on the lit layer); some, in their own colors, the white light
// from the rig over the runway (on the own layer). Where the lens is focused they're points, wider
// than tall (flat flakes seen almost edge-on, flatter the farther they are), dense, most dim and a
// few blazing; the blazing ones clip to white on the own layer, and a few of those flare.
// Everywhere else they're discs the size of the blur, fainter the bigger they are, so the near
// floor becomes a mottled glow of big soft octagons.
function paintFlakes(lum, own, s, r, sprites, patch) {
  lum.globalCompositeOperation = 'lighter';
  own.globalCompositeOperation = 'lighter';
  const stars = [];
  const maxStars = Math.round(lerp(18, 8, s.p));
  const end = s.H + s.blurBottom * 1.2;
  for (let y = s.ys + 0.5; y < end; y += 1) {
    const b = blurAt(s, y);
    const radius = Math.max(0.55, b);
    const half = halfAt(s, y);
    const reach = Math.min(half + radius * 0.4, s.W / 2 + radius);
    const focused = b < 2.4;
    const density = focused ? 1 / 10 : Math.min(1 / 10, 4.4 / (Math.PI * radius * radius));
    const count = density * reach * 2;
    const n = Math.floor(count) + (r() < count % 1 ? 1 : 0);
    const k = (y - s.ys) / (s.H - s.ys);
    const flat = 1.3 + 2.6 * Math.max(0, 1 - k) ** 3;
    const pv = patchV(s, Math.min(y, s.H));
    const L = lightRow(s, Math.min(y, s.H));
    for (let i = 0; i < n; i++) {
      const x = s.cx + (r() * 2 - 1) * reach;
      const yj = y + r() - 0.5;
      const yl = Math.min(yj, s.H);
      const onOwn = r() < s.ownShare;
      const E = (onOwn ? whiteAt(s, x, yl) : lightIn(s, L, x)) * patch(patchU(s, x, yl), pv);
      // On the glitter path the flakes mirror the hot light itself: more of them clip.
      const onPath = onOwn ? 0 : pathIn(s, L, x);
      const ctx = onOwn ? own : lum;
      // Most flakes are dim and a few blaze; out of focus only the brightest still show as discs
      // of their own, and the rest melt into the glow.
      const B = focused ? 0.08 + 2.2 * r() ** 5 : 0.04 + 2.4 * r() ** 5.5;
      const tint = pickFlake(r());
      if (focused) {
        const a = Math.min(1, E * B * 1.25);
        if (a < 0.015) continue;
        const w = 0.4 + r() * 0.6;
        ctx.globalAlpha = a;
        ctx.drawImage(sprites.point[tint], x - w * flat * 2.5, yj - w * 2.5, w * flat * 5, w * 5);
        if (B > 1.5 - 0.5 * onPath) {
          own.globalAlpha = Math.min(1, (B - 1.4 + 0.5 * onPath) * 0.6 * Math.min(1, E * 1.3));
          own.drawImage(sprites.core, x - w * flat * 1.6, yj - w * 1.6, w * flat * 3.2, w * 3.2);
          if (
            B > 1.9 &&
            E > 0.35 &&
            !onOwn &&
            stars.length < maxStars &&
            r() < 0.12 + 0.6 * onPath
          ) {
            stars.push([x, yj, 2.5 + r() * 3.5]);
          }
        } else if (!onOwn && r() < 0.16 + 0.45 * onPath) {
          own.globalAlpha = Math.min(1, B * 0.35 * Math.min(1, 0.3 + E));
          own.drawImage(sprites.white[tint], x - w * flat * 2, yj - w * 2, w * flat * 4, w * 4);
        }
      } else if (b < 4.5) {
        // Just out of focus: a small even blur, a little wider than tall.
        const a = E * B * 1.6 * (2.4 / b);
        if (a < 0.03) continue;
        const w = b * (0.8 + 0.4 * r());
        ctx.globalAlpha = Math.min(0.7, a);
        ctx.drawImage(sprites.soft[tint], x - w * 1.25, yj - w, w * 2.5, w * 2);
      } else {
        const a = E * B * 1.35 * Math.sqrt(2.4 / radius);
        if (a < 0.035) continue;
        const sprite = sprites.aperture[tint][r() < 0.3 ? 1 : 0];
        // Flakes a little nearer or farther than their row: the blur varies with them.
        const size = radius * (0.55 + r() * 0.85);
        disc(ctx, s, sprite, x, yj, size, Math.min(0.5, a));
        // The brightest are overexposed: they go a little white, whatever the light, and more
        // readily on the path, where they mirror the hot light.
        const over = a + 0.12 * onPath - 0.3;
        if (over > 0.02) disc(own, s, sprites.pearl, x, yj, size, Math.min(0.12, over * 0.3));
      }
    }
  }
  lum.globalAlpha = 1;
  own.globalAlpha = 1;
  // The brightest glints on the path flare: the gel's color in the halo, the camera's spikes
  // white hot.
  for (const [x, y, size] of stars) {
    glow(lum, x, y, size * 1.4, size * 1.4, WHITE, [
      [0, 0.5],
      [1, 0],
    ]);
    starburst(own, x, y, size, 0.75);
  }
  lum.globalCompositeOperation = 'source-over';
  own.globalCompositeOperation = 'source-over';
}

// The haze that drifts: cloudy noise, wider than tall like layers of haze, shown only where the
// light is (the wash over the stage, and the beams) by a mask that stays put while the haze moves
// under it. The mask is painted small, and the CSS stretches it over the window.
function paintHaze(canvas, wrap, s) {
  const ctx = surface(canvas, 240, 120, 1);
  ctx.drawImage(haze(240, 120, SEED + 5, 1.5), 0, 0);
  const { W, H, cx, ys } = s;
  const [mask, m] = offscreen(Math.ceil(W / 8), Math.ceil(H / 8));
  m.scale(mask.width / W, mask.height / H);
  m.globalCompositeOperation = 'lighter';
  haloAt(m, cx, ys - H * 0.08, Math.max(W * 0.55, H * 0.36), H * 0.26, WHITE, 0.9, 2.4);
  haloAt(m, cx, ys + H * 0.03, W * 0.75, H * 0.1, WHITE, 0.6, 2.4);
  for (const b of s.beams) beam(m, b.x, b.y, b.tx, b.ty, b.w0 * 2, b.w1 * 1.2, 1.6);
  wrap.style.maskImage = `url(${mask.toDataURL()})`;
}

// ------------------------------------------------------------------------------ the light's gel

// The light moves through four gels, as in the clips: a short hold, then a long crossfade, once
// round in 36 s.
const GELS = [
  [255, 96, 196], // magenta
  [132, 194, 255], // ice blue
  [186, 158, 255], // lavender
  [246, 208, 150], // champagne
];
const HOLD = 3.5;
const FADE = 5.5;

// The gel at this moment of the cycle, mixed as light mixes (roughly in linear light, by the
// squares of the channels), so it never dips grey between two colors.
function gelAt(seconds) {
  const seg = HOLD + FADE;
  const total = seg * GELS.length;
  const u = ((seconds % total) + total) % total;
  const i = Math.floor(u / seg);
  const w = smooth(HOLD, seg, u - i * seg);
  const a = GELS[i];
  const b = GELS[(i + 1) % GELS.length];
  const channel = (c) => Math.sqrt(lerp(a[c] * a[c], b[c] * b[c], w));
  return [channel(0), channel(1), channel(2)];
}

// How far apart two gels are: their biggest difference in any one channel.
function apart(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// ------------------------------------------------------------------------------ the twinkling

// A flake in the light that flashes as it turns and catches it: it swells and fades once in a
// while, on its own beat (period and phase, in seconds), quickly for most and slowly for some
// (width). A glint, a star that flares with the camera's spikes, or out of focus a big soft disc.
// own: it catches the white light, in its own color (tint), rather than the gel.
/**
 * @typedef {{ x: number, y: number, kind: 'glint' | 'star' | 'disc', own: boolean, tint: number,
 *   size: number, period: number, phase: number, width: number, peak: number }} Twinkle
 */

// The flakes that twinkle, spread over the floor as the light falls on it. None are put behind
// the cards, where they wouldn't show.
function makeTwinkles(s, r, cards) {
  const list = [];
  const want = Math.round(lerp(300, 150, s.p) * clamp(s.W / 1440, 0.6, 1.3));
  const wantDiscs = Math.round(lerp(28, 14, s.p));
  let discs = 0;
  const hidden = (x, y) =>
    x > cards.left + 6 &&
    x < cards.right - 6 &&
    y > cards.top + 6 &&
    y < cards.bottom - 6 &&
    Math.abs(y - cards.gap) > 8;
  for (let guard = 0; list.length < want && guard < want * 200; guard++) {
    const y = lerp(s.ys + 2, s.H, r());
    const b = blurAt(s, y);
    const half = Math.min(halfAt(s, y), s.W / 2);
    const x = s.cx + (r() * 2 - 1) * half;
    if (hidden(x, y)) continue;
    const own = r() < 0.4;
    const E = own ? whiteAt(s, x, y) * 1.4 : lightAt(s, x, y);
    if (r() > E * 0.8) continue;
    const period = 2.5 + r() * 5.5;
    const phase = r() * period;
    if (b < 2.6) {
      const star = !own && r() < 0.14;
      const slow = r() < 0.3;
      list.push({
        x,
        y,
        kind: star ? 'star' : 'glint',
        own,
        tint: pickFlake(r()),
        size: star ? 7 + r() * 7 : 3 + r() * 3.5,
        period,
        phase,
        width: slow ? 0.3 + r() * 0.25 : 0.11 + r() * 0.12,
        peak: 0.6 + 0.4 * r(),
      });
    } else if (b > 6 && discs < wantDiscs && r() < 0.35) {
      discs++;
      list.push({
        x,
        y,
        kind: 'disc',
        own,
        tint: pickFlake(r()),
        size: b * (0.8 + r() * 0.5),
        period: 4 + r() * 6,
        phase,
        width: 0.45 + r() * 0.5,
        peak: 0.22 + 0.22 * r(),
      });
    }
  }
  return list;
}

// A glint: a halo of the light's (or the flake's) color round a white-hot core.
function glintSprite(halo, scale) {
  const R = 12;
  const [canvas, ctx] = offscreen(R * 2, R * 2, scale);
  glow(ctx, R, R, R, R, halo, [
    [0, 0.55],
    [0.3, 0.16],
    [1, 0],
  ]);
  glow(ctx, R, R, R * 0.22, R * 0.22, WHITE, [
    [0, 1],
    [0.5, 0.7],
    [1, 0],
  ]);
  return canvas;
}

// A glint that flares: its halo, the camera's spikes in the halo's color and in white, and the
// core.
function starSprite(halo, scale) {
  const R = 24;
  const [canvas, ctx] = offscreen(R * 2, R * 2, scale);
  glow(ctx, R, R, R * 0.5, R * 0.5, halo, [
    [0, 0.6],
    [0.35, 0.14],
    [1, 0],
  ]);
  spikes(ctx, R, R, R, 0.45, halo, 0.55);
  spikes(ctx, R, R, R * 0.55, 0.35, WHITE, 0.8);
  glow(ctx, R, R, R * 0.1, R * 0.1, WHITE, [
    [0, 1],
    [1, 0],
  ]);
  return canvas;
}

// The sprites for the gel's glints, in its color at one moment, kept with that color. They're
// made again as the gel moves on, so they're quick to make: the disc is a tinted copy.
// Returns { glint, star, disc, gel }: three sprites and the gel color they were made in.
function gelSprites(gel, scale, whiteDisc) {
  const halo = mix(WHITE, gel, 0.85);
  return {
    glint: glintSprite(halo, scale),
    star: starSprite(halo, scale),
    disc: tinted(whiteDisc, mix(WHITE, gel, 0.7)),
    gel,
  };
}

// The sprites for the white light's glints, one in each flake color. They never change.
function ownSprites(scale, whiteDisc) {
  return {
    glint: FLAKES.map((c) => glintSprite(c, scale)),
    star: FLAKES.map((c) => starSprite(c, scale)),
    disc: FLAKES.map((c) => tinted(whiteDisc, c)),
  };
}

// ------------------------------------------------------------------------------ painting

// The film grain, drawn the first time it's needed (tools.js grain()).
let grainImage = '';

// Paints every still layer for a window this size, with the cards where they stand, and returns
// the function that draws one frame of the stage's life at a moment (in ms of it). Nothing else
// is drawn until the next paint.
export function paintRunway(layers, width, height, cards) {
  if (!grainImage) grainImage = `url(${grain()})`;
  layers.grain.style.backgroundImage = grainImage;
  const s = compose(width, height, cards);
  // How many canvas pixels to a CSS pixel: the screen's own, up to 2 on a retina screen. Only past
  // about 9 million pixels a canvas (more than a 4K screen at 2×) does it come down, to save
  // memory and paint time.
  const scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(9e6 / (width * height)));
  const r = rng(SEED);
  const patch = patches(SEED + 17);
  const lum = surface(layers.lum, width, height, scale);
  lum.fillStyle = '#000';
  lum.fillRect(0, 0, width, height);
  const own = surface(layers.own, width, height, scale);
  const evenDisc = apertureSprite(false);
  const whiteDisc = apertureSprite(true);
  const flakeSprites = {
    point: FLAKES.map((c) => pointSprite(c)),
    soft: FLAKES.map((c) => pointSprite(c, true)),
    white: FLAKES.map((c) => pointSprite(mix(c, WHITE, 0.3))),
    core: pointSprite(WHITE),
    aperture: FLAKES.map((c) => [tinted(evenDisc, c), tinted(whiteDisc, c)]),
    pearl: tinted(whiteDisc, [255, 246, 238]),
  };
  paintFloorBed(lum, s, scale, SEED, patch);
  paintFarEnd(lum, s, scale, haze(200, 130, SEED + 3, 0.9), r, flakeSprites);
  paintLights(lum, own, s);
  paintFlakes(lum, own, s, r, flakeSprites, patch);
  bloom(layers.lum, lum, width, height, 0.14, 0.18);
  bloom(layers.own, own, width, height, 0.22, 0.16);
  paintHaze(layers.haze, layers.hazeWrap, s);

  // The twinkling layer, the one redrawn while the stage runs, covers only the band of floor the
  // twinkles are in.
  const twinkles = makeTwinkles(s, r, cards);
  let top = height;
  let bottom = 0;
  for (const tw of twinkles) {
    const reach = tw.kind === 'disc' ? tw.size / DISC_FILL : tw.size;
    top = Math.min(top, tw.y - reach);
    bottom = Math.max(bottom, tw.y + reach);
  }
  const twinkleTop = Math.max(0, Math.floor(top) - 2);
  const twinkleHeight = Math.max(1, Math.min(height, Math.ceil(bottom) + 2) - twinkleTop);
  layers.twinkle.style.height = `${twinkleHeight}px`;
  // Moved down to the band with a transform rather than top: a transform leaves the canvas's box
  // where it is, so the browser doesn't count the move as the page's layout shifting.
  layers.twinkle.style.transform = `translateY(${twinkleTop}px)`;
  const twinkle = surface(layers.twinkle, width, twinkleHeight, scale);
  const white = ownSprites(scale, whiteDisc);
  let colored = null; // the gel's sprites, for the gel they were made in
  let gelShown = ''; // the gel color on the page, as 'r g b'

  // One frame of the stage's life: the gel moves on, the haze drifts, and the twinkling layer is
  // cleared and redrawn. Nothing else is touched.
  return (ms) => {
    const seconds = ms / 1000;
    const gel = gelAt(seconds);
    const shown = gel.map((v) => Math.round(v)).join(' ');
    if (shown !== gelShown) {
      layers.gel.style.backgroundColor = `rgb(${shown})`;
      gelShown = shown;
    }
    // The gel's sprites are made again once it has moved on enough to see.
    if (!colored || apart(gel, colored.gel) > 6) colored = gelSprites(gel, scale, whiteDisc);
    const hx = Math.sin(seconds / 23) * 56 + Math.sin(seconds / 9.7) * 7;
    const hy = Math.sin(seconds / 31 + 1.3) * 18;
    layers.haze.style.transform = `translate3d(${hx.toFixed(2)}px, ${hy.toFixed(2)}px, 0)`;

    twinkle.setTransform(1, 0, 0, 1, 0, 0);
    twinkle.clearRect(0, 0, twinkle.canvas.width, twinkle.canvas.height);
    twinkle.setTransform(scale, 0, 0, scale, 0, -twinkleTop * scale);
    twinkle.globalCompositeOperation = 'lighter';
    for (const tw of twinkles) {
      // Where the flake is in its turn: dt is the time to the moment it faces the light, and its
      // light swells and fades around that moment (a bell, not a blink).
      const dt = ((seconds + tw.phase) % tw.period) - tw.period / 2;
      const e = Math.exp(-((dt / tw.width) ** 2));
      if (e < 0.02) continue;
      const sprite = tw.own ? white[tw.kind][tw.tint] : colored[tw.kind];
      const size = tw.kind === 'disc' ? tw.size / DISC_FILL : tw.size * (0.55 + 0.45 * e);
      twinkle.globalAlpha = Math.min(1, e * tw.peak);
      twinkle.drawImage(sprite, tw.x - size, tw.y - size, size * 2, size * 2);
    }
    twinkle.globalAlpha = 1;
    twinkle.globalCompositeOperation = 'source-over';
  };
}

// ------------------------------------------------------------------------------ mounting

// How far into the light's cycle the stage starts, in ms: a moment while it holds on magenta. For
// someone who asks their system for less motion, it stays there.
const START_MS = 1700;
// At most 30 frames a second: the light moves slowly, and the twinkles are brief.
const FRAME_MS = 1000 / 30;

// The elements in opts.keepOut (one, a list, or none), skipping any that aren't there.
function elementsOf(keepOut) {
  return (Array.isArray(keepOut) ? keepOut : [keepOut]).filter((el) => el instanceof Element);
}

// Where the cards stand (see CardLayout), measured as if the page were scrolled to the top, since
// the runway stays put while they scroll over it. The first element is the main card; if there's
// a second (the list under it), the rig of lights can hang in the gap between them, as it did
// between the original page's two cards. header is how far down the page's own header reaches: a
// number of px, or an element whose bottom edge it is.
function measureCards(keepOut, header) {
  const scrolled = window.scrollY;
  const rects = elementsOf(keepOut).map((el) => el.getBoundingClientRect());
  const headerBottom =
    header instanceof Element ? header.getBoundingClientRect().bottom + scrolled : header || 0;
  if (rects.length === 0) {
    // No cards: the lights hang at their own height, and the lens focuses where it likes.
    return { header: headerBottom, left: 0, right: 0, top: 0, gap: -1, bottom: 0 };
  }
  return {
    header: headerBottom,
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)) + scrolled,
    gap: rects.length > 1 ? (rects[0].bottom + rects[1].top) / 2 + scrolled : -1,
    bottom: Math.max(...rects.map((r) => r.bottom)) + scrolled,
  };
}

/**
 * Puts the runway behind the page: builds its stacked layers inside host, paints them around the
 * cards, and runs the stage's life (the light moving through its colors, the haze drifting, the
 * glitter twinkling) at most 30 times a second. It holds still for someone who asks their system
 * for less motion, stops while the tab is hidden, and repaints 150 ms after the window (or a card)
 * stops changing size. It's only a picture: screen readers skip it and every click goes through
 * it. If the browser can't paint it, it says so once in the console and leaves the page's own
 * background showing.
 * @param {HTMLElement} host an empty element; stage.css fixes the layers to the window behind
 *   everything
 * @param {{ keepOut?: Element | Element[], header?: number | Element }} [opts] keepOut: the card
 *   (and the list under it) the picture is composed around; header: how far down a header reaches
 * @returns {() => void} stop(): stops the stage and its listeners (the last picture stays)
 */
export function mountRunway(host, opts = {}) {
  // The layers, back to front (see the list at the top of this file, and stage.css).
  const make = (tag, className, parent) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    parent.append(el);
    return el;
  };
  const root = document.createElement('div');
  root.className = 'runway';
  root.setAttribute('aria-hidden', 'true');
  const lit = make('div', 'layer lit', root);
  const lum = make('canvas', '', lit);
  const hazeWrap = make('div', 'layer haze-wrap', lit);
  const layers = {
    lum,
    hazeWrap,
    haze: make('canvas', 'haze', hazeWrap),
    gel: make('div', 'layer light-gel', lit),
    own: make('canvas', 'own', root),
    twinkle: make('canvas', 'twinkle', root),
  };
  make('div', 'layer vignette', root);
  layers.grain = make('div', 'layer grain', root);
  host.append(root);

  const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cardsWatcher =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => repaintSoon()) : null;
  let drawFrame = null; // the function the last paint returned to draw one frame (null: none)
  let clock = START_MS; // how far into the light's cycle the stage has got (it stops when hidden)
  let paintedFor = ''; // the window and cards it was last painted for ('' until it's painted)
  let warned = false;
  let timer = 0; // a repaint waiting for a resize to settle
  let frame = 0; // the animation frame asked for, to cancel it
  let last = 0; // when the last frame came, or 0 for none since starting
  let lastDrawn = -Infinity; // when one was last drawn

  function warn(message, error) {
    if (warned) return;
    warned = true;
    console.warn(message, error);
  }

  // Paint the still layers for the window and cards as they are now, unless that's what's there.
  function paint() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width < 1 || height < 1) return; // no window to paint (a minimized one): wait for a resize
    const cards = measureCards(opts.keepOut, opts.header);
    // The same window and cards make the same picture, so skip it.
    const size = `${width} ${height} ${window.devicePixelRatio} ${Object.values(cards)
      .map(Math.round)
      .join(',')}`;
    if (size === paintedFor) return;
    paintedFor = size;
    try {
      drawFrame = paintRunway(layers, width, height, cards);
      // The first frame, right away: the light's color and the twinkles. (With less motion asked
      // for, it's the only one.)
      drawFrame(clock);
    } catch (error) {
      // A browser short on memory can refuse to make a canvas, even partway through. Clear the
      // canvases (one 0 pixels wide shows nothing), so the page's plain dark shows instead of
      // half a picture, stop drawing frames, and forget the size, so the next resize tries
      // again. The page works without the runway.
      for (const canvas of [layers.lum, layers.haze, layers.own, layers.twinkle]) {
        canvas.width = 0;
      }
      drawFrame = null;
      paintedFor = '';
      warn('The runway could not be painted.', error);
    }
  }

  // A paint takes a moment, so a repaint waits until things have stopped changing for 150 ms.
  function repaintSoon() {
    window.clearTimeout(timer);
    timer = window.setTimeout(paint, 150);
  }

  // One frame at the moment the stage has got to. If a frame can't be drawn (no memory for its
  // sprites), the picture stays as it is.
  function draw() {
    try {
      drawFrame?.(clock);
    } catch (error) {
      drawFrame = null;
      warn('The runway stopped moving.', error);
    }
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    // The clock moves only while the stage runs, and at most 100 ms a frame, so a frame that
    // comes late doesn't make the light jump.
    clock += last ? Math.min(100, now - last) : 0;
    last = now;
    // The screen may want 60 or 120 frames a second: skip the ones in between. (Frames come a
    // little early or late, so 1 ms early is near enough.)
    if (now - lastDrawn < FRAME_MS - 1) return;
    lastDrawn = now;
    draw();
  }

  // Run, or with less motion asked for, hold still on the moment the stage has got to.
  function start() {
    cancelAnimationFrame(frame);
    if (document.hidden) return;
    if (lessMotion.matches) {
      draw();
      return;
    }
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  // Hidden, it stops; shown again, it carries on from the same moment.
  function handleVisibility() {
    if (document.hidden) cancelAnimationFrame(frame);
    else start();
  }

  // The first paint can't wait.
  paint();
  start();
  window.addEventListener('resize', repaintSoon);
  // The cards change size too: when the fonts arrive, or the list under the card grows.
  for (const el of elementsOf(opts.keepOut)) cardsWatcher?.observe(el);
  document.addEventListener('visibilitychange', handleVisibility);
  // Less motion asked for (or no longer) while the page is open.
  lessMotion.addEventListener('change', start);

  return function stop() {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.removeEventListener('resize', repaintSoon);
    cardsWatcher?.disconnect();
    document.removeEventListener('visibilitychange', handleVisibility);
    lessMotion.removeEventListener('change', start);
  };
}
