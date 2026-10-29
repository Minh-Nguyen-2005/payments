// The painter's tools: colors and how to mix them, a seeded random number generator, canvases to
// draw on, haze, a soft glow and a tile of film grain. Both scenes (runway.js and galaxy.js) draw
// with them. A color is an array of three channels, 0 to 255: [r, g, b].

export const WHITE = [255, 255, 255];

// A seeded random number generator (mulberry32). Each call returns a number from 0 up to 1, like
// Math.random(), but the same seed always gives the same numbers, so the stage is the same
// picture every time it's painted. How it scrambles the bits doesn't matter here.
export function rng(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Color a, moved the share t of the way to color b: 0 is a, 1 is b, 0.5 halfway.
export function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// A color for the canvas, as CSS: css(WHITE, 0.5) is 'rgba(255,255,255,0.5)'.
export function css(c, alpha = 1) {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

// 0 up to from, 1 from to on, and a gentle S-curve between: for fading things in and out.
export function smooth(from, to, x) {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

// Sizes a canvas for w × h CSS pixels at the given scale (2 on a retina screen, less for a soft
// layer that doesn't need the pixels), and returns its context, scaled so the drawing code works
// in CSS pixels either way. Resizing a canvas also clears it.
export function surface(canvas, w, h, scale) {
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser has no 2D canvas.');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}

// A canvas that isn't on the page, to draw a part on before using it.
export function offscreen(w, h, scale = 1) {
  const canvas = document.createElement('canvas');
  return [canvas, surface(canvas, w, h, scale)];
}

// A copy of a white drawing, in one color.
export function tinted(src, color) {
  const [canvas, ctx] = offscreen(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = css(color);
  ctx.fillRect(0, 0, src.width, src.height);
  return canvas;
}

// Haze: soft fractal noise ("value noise"), worked out pixel by pixel on a small canvas that the
// layers stretch over the stage. Treat it as a black box: it returns a w × h canvas of white with
// cloudy, drifting transparency, the same clouds for the same seed. Each haze is made once and
// kept: it depends only on its four numbers, and every caller only reads it, so every repaint and
// window size shares it.
const hazes = new Map();
export function haze(w, h, seed, contrast) {
  const key = `${w} ${h} ${seed} ${contrast}`;
  const made = hazes.get(key);
  if (made) return made;
  const [canvas, ctx] = offscreen(w, h);
  const img = ctx.createImageData(w, h);
  const r = rng(seed);
  const octaves = [];
  for (let o = 0; o < 5; o++) {
    const gw = 3 << o;
    const gh = 2 << o;
    octaves.push([gw, gh, new Float32Array((gw + 1) * (gh + 1)).map(() => r())]);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      let amp = 1;
      let total = 0;
      for (const [gw, gh, g] of octaves) {
        const fx = (x / w) * gw;
        const fy = (y / h) * gh;
        const ix = Math.min(gw - 1, Math.floor(fx));
        const iy = Math.min(gh - 1, Math.floor(fy));
        const sx = smooth(0, 1, fx - ix);
        const sy = smooth(0, 1, fy - iy);
        const row = gw + 1;
        const a = g[iy * row + ix];
        const b = g[iy * row + ix + 1];
        const c = g[(iy + 1) * row + ix];
        const d = g[(iy + 1) * row + ix + 1];
        v += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        total += amp;
        amp *= 0.55;
      }
      v = Math.max(0, (v / total - 0.36) / 0.64);
      const k = (y * w + x) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * Math.pow(v, contrast));
    }
  }
  ctx.putImageData(img, 0, 0);
  hazes.set(key, canvas);
  return canvas;
}

// A soft ellipse: a radial gradient (always a circle) squashed by the transform to rx by ry.
export function glowAt(ctx, x, y, rx, ry, stops) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

// One camera for every light: a starburst's spikes come from the 8 blades of the lens's
// aperture, so every light's 8 spikes point the same way, turned by this angle (in radians).
export const SPIKE_ANGLE = 0.21;

// A tile of film grain for the lens: 160 × 160 px of grey noise, as a data: URL for a CSS
// background-image.
export function grain() {
  const [canvas, ctx] = offscreen(160, 160);
  const img = ctx.createImageData(160, 160);
  const r = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    // Centred on mid-grey, so the grain darkens as much as it lightens.
    const v = Math.round(128 + (r() + r() - 1) * 80);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
