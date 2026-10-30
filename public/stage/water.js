// The cards are panes of water. This draws each one with WebGL (the graphics chip's own pixel
// shading, which is what makes water smooth): the scene behind the card seen through slow swells
// and raindrop rings, glinting where a wave catches bright light; on the shop, the dress hanging
// just above the water with its reflection rippling below it, drops swelling at its hem and
// falling, now and then a bead running down it, light catching it here and there, rain falling past
// and now and then a flash of lightning; and the card's words, rippling with the water. The name
// field and the button stay crisp on top, and the words stay in the page (invisible) for screen
// readers.
// Decoration only. At most 30 frames a second, asleep while the tab is hidden, and one still frame
// (no rain, nothing falling) for anyone who asks their system for less motion. Without WebGL, the
// card stays glass, with the dress's picture on it.

const MAX_BEADS = 16 // how many drops the shader draws at once
const DRIP_RATE = 0.65 // drops falling from the hem each second, on average, however many drip points

const VERT = `attribute vec2 p;
varying vec2 v;
void main() {
  v = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // 0,0 at the card's top left
  gl_Position = vec4(p, 0.0, 1.0);
}`

const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D uScene, uArt, uText, uTitle;
uniform vec2 uSize;      // the card, in CSS px
uniform float uPx;       // one of the canvas's own pixels, in CSS px (for smooth edges)
uniform float uTime;     // seconds
uniform float uFlash;    // lightning, 0 to 1
uniform float uRain;     // 1 on the shop, 0 elsewhere
uniform float uHasArt;   // 1 if the dress hangs over the water
uniform vec4 uBox;       // where the dress's picture is: x, y, width, height (CSS px)
uniform float uWater;    // the waterline, a little below the hem (CSS px from the card's top)
uniform vec3 uLight;     // the scene's light (the rig's gel, or the planet's pink), 0 to 1
uniform vec4 uDrops[10]; // rings on the water: x, y (CSS px), when they began (s), 1 for a drip's
uniform vec4 uTitleBox;  // where the title is: x, y, width, height (CSS px); width 0 for none
uniform vec4 uBeads[${MAX_BEADS}]; // drops of water: x, y (CSS px in the picture), half width, half height
uniform vec4 uTrail[6];  // the wet trail behind a running bead: x, y (the same), wetness, width
uniform vec4 uGlints[3]; // light catching the dress: x, y (the same), size (CSS px), brightness

// The key light, up and a little to the right (the rig over the runway), as a direction on the
// screen, and halfway between it and the eye (where a curved surface shows its highlight).
const vec2 KEY = vec2(0.44, -0.9);
const vec3 HALF = vec3(0.2, -0.42, 0.885);
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash(float n) { return fract(sin(n) * 43758.5453); }

// The water's height at p: three long, slow swells.
float swell(vec2 p) {
  float t = uTime;
  return sin(p.x * 0.031 + t * 0.70)
       + sin(p.y * 0.052 - t * 0.95 + p.x * 0.012) * 0.7
       + sin((p.x * 0.6 - p.y) * 0.041 + t * 0.53) * 0.6;
}

// How far the water bends what's behind it at p, in CSS px: its slope, plus the rings. A raindrop's
// ring spreads round across the pane; a drip's lies flat on the water under the dress (seen from
// the side, so squashed), smaller and slower, and only below the waterline.
vec2 bend(vec2 p) {
  vec2 b = vec2(swell(p + vec2(1.0, 0.0)) - swell(p - vec2(1.0, 0.0)),
                swell(p + vec2(0.0, 1.0)) - swell(p - vec2(0.0, 1.0))) * 2.6;
  for (int i = 0; i < 10; i++) {
    vec4 drop = uDrops[i];
    float age = uTime - drop.z;
    if (age < 0.0 || age > 1.6) continue;
    vec2 q = (p - drop.xy) * vec2(1.0, 1.0 + 2.4 * drop.w);
    float d = length(q);
    float z = (d - age * mix(46.0, 24.0, drop.w)) / mix(5.0, 3.0, drop.w); // distance from the ring as it spreads
    float k = exp(-z * z) * (1.0 - age / 1.6) * sin(z * 4.5) * mix(3.2, 2.2, drop.w);
    if (drop.w > 0.5) k *= smoothstep(uWater, uWater + 3.0, p.y);
    b += q / (d + 0.001) * k;
  }
  return b;
}

// The liquid wobble words and the dress get, like type seen in moving water: each line of pixels
// shifted sideways by slow waves running down it, and lifted a little by waves running across.
// k is how strongly: the title most, the small words least.
vec2 liquid(vec2 p, float k) {
  float t = uTime;
  float dx = sin(p.y * 0.11 + t * 1.3) * 3.0 + sin(p.y * 0.047 - t * 0.8 + p.x * 0.01) * 2.0;
  float dy = sin(p.x * 0.035 + t * 0.9) * 2.2 + sin(p.x * 0.09 - t * 1.6) * 0.8;
  return vec2(dx, dy) * k;
}

// Caustics: the moving net of light that rippling water makes (after David Hoskins's well-known
// tileable water caustic). Bright thin lines, slowly reshaping; 0 to 1.
float caustic(vec2 uv) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float t = uTime * 0.3 * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / 0.005), p.y / (cos(i.y + t) / 0.005)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 8.0);
}

// Thin streaks of rain at a slight slant, at two depths.
float rain(vec2 p) {
  float r = 0.0;
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float w = 7.0 + fl * 6.0; // the width of a column of rain
    vec2 q = vec2(p.x + p.y * 0.16, p.y);
    float col = floor(q.x / w);
    if (hash(col * 7.7 + fl * 31.0) < 0.78) continue; // only some columns have a drop in them
    float len = 18.0 + 26.0 * hash(col * 3.1 + fl);
    float y = mod(q.y - uTime * (560.0 + fl * 300.0) - hash(col + fl * 17.0) * 700.0, 700.0);
    float streak = (1.0 - smoothstep(0.0, len, y)) * smoothstep(0.0, 3.0, y);
    float x = abs(fract(q.x / w) - 0.5) * w;
    r += streak * (1.0 - smoothstep(0.0, 0.9, x)) * (0.35 + 0.4 * fl);
  }
  return r;
}

// The dress's picture at a (CSS px from its top left): its color already multiplied by its opacity,
// so a sheer edge blends into the water without a dark fringe, and its opacity.
vec4 picture(vec2 a) {
  vec2 t = a / uBox.zw;
  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
  return texture2D(uArt, t);
}

// The dress in the stage's light (premultiplied color in and out): a touch of the gel's color, its
// brightest highlights breathing very slightly as if the lights above moved, and lightning on it.
vec3 shade(vec4 d, vec2 a) {
  if (d.a < 0.004) return d.rgb;
  vec3 c = min(d.rgb / d.a, 1.0);
  c *= mix(vec3(1.0), uLight / max(dot(uLight, LUMA), 0.25), 0.08);
  float breathe = (0.5 + 0.5 * sin(uTime * 0.37 + a.x * 0.023 - a.y * 0.017)) * (0.6 + 0.4 * sin(uTime * 0.23 + 1.9));
  c += smoothstep(0.6, 0.97, dot(c, LUMA)) * breathe * 0.07 * mix(vec3(1.0), uLight, 0.5);
  c = 1.0 - (1.0 - c) * (1.0 - uFlash * vec3(0.62, 0.66, 0.72)); // lightning fills it with cool light, short of white
  return c * d.a;
}

// What a drop at a sees behind it: the scene through the water, and the dress.
vec3 behind(vec2 a) {
  vec3 scene = texture2D(uScene, clamp((a + uBox.xy) / uSize, 0.0, 1.0)).rgb * 0.82 + uLight * 0.035;
  vec4 d = picture(a);
  return scene * (1.0 - d.a) + shade(d, a);
}

// The dress and the water on it at a (CSS px in the picture), as premultiplied color and opacity:
// the picture; the wet trail behind a running bead; light catching it here and there; and, if
// drops is 1, the drops, each a little lens: what's behind it upside down and magnified, a dark
// rim, a crisp highlight toward the light and a bright caustic on the far side.
vec4 layer(vec2 a, float drops) {
  vec4 d = picture(a);
  vec3 c = shade(d, a);
  if (uTrail[0].w > 0.0) {
    // The trail: soaked cloth a little darker, with a gloss down its middle, both drying away.
    float wet = 0.0;
    float gloss = 0.0;
    for (int i = 0; i < 5; i++) {
      vec4 s0 = uTrail[i];
      vec4 s1 = uTrail[i + 1];
      if (s1.w <= 0.0) continue;
      vec2 pa = a - s0.xy;
      vec2 ba = s1.xy - s0.xy;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
      float dist = length(pa - ba * h);
      float w = mix(s0.w, s1.w, h) * 0.5;
      float k = mix(s0.z, s1.z, h);
      wet = max(wet, k * (1.0 - smoothstep(w - uPx, w + uPx, dist)));
      gloss = max(gloss, k * exp(-dist * dist / (w * w * 0.16 + 0.02)));
    }
    float cloth = smoothstep(0.02, 0.25, d.a);
    c = c * (1.0 - 0.16 * wet * cloth) + gloss * cloth * 0.2 * mix(vec3(1.0), uLight, 0.35) * (1.0 + 2.0 * uFlash);
  }
  for (int i = 0; i < 3; i++) {
    vec4 g = uGlints[i];
    if (g.w <= 0.0) continue;
    vec2 q = (a - g.xy) / g.z;
    float d2 = dot(q, q);
    c += g.w * (exp(-d2) * 1.6 + exp(-d2 * 0.08) * 0.2 * uLight); // a white-hot point, a breath of color
  }
  vec4 all = vec4(c, d.a);
  if (drops < 0.5) return all;
  for (int i = 0; i < ${MAX_BEADS}; i++) {
    vec4 bead = uBeads[i];
    if (bead.z <= 0.0) continue;
    vec2 q = (a - bead.xy) / bead.zw;
    float e = length(q);
    float r = min(bead.z, bead.w);
    float aa = uPx / r; // one pixel, in the drop's own size
    if (e > 1.0 + aa) continue;
    float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, e);
    float lit = 1.0 + 2.5 * uFlash;
    // Through it: what's behind, upside down and magnified (more so toward its edge), the color of
    // cloth a little deeper under water, and dark at the rim, where it bends the light away.
    vec3 col = behind(bead.xy - q * bead.zw * (0.42 + 0.3 * e * e)) * 0.94 + uLight * 0.04 * lit;
    col *= 1.0 - 0.45 * smoothstep(0.74, 1.0, e);
    // Its round body catching the light softly, the key light's crisp white-hot highlight, and
    // opposite, the light it gathers, bright in the gel's color. They stay a pixel or two across,
    // and dim on the smallest drops, which only glint.
    vec3 n = vec3(q, sqrt(max(1.0 - e * e, 0.0)));
    float big = smoothstep(0.8, 3.0, r);
    col += pow(max(dot(n, HALF), 0.0), 10.0) * 0.08 * lit * mix(vec3(1.0), uLight, 0.4);
    vec2 spot = (q - HALF.xy) * bead.zw / max(0.13 * r, 0.9 * uPx);
    col += exp(-0.5 * dot(spot, spot)) * mix(0.5, 2.2, big) * lit * mix(vec3(1.0), uLight, 0.1);
    vec2 glow = (q + KEY * 0.52) * bead.zw / max(0.24 * r, uPx);
    col += exp(-0.5 * dot(glow, glow)) * 0.6 * big * lit * mix(vec3(1.0), uLight, 0.55);
    all = all * (1.0 - cover) + vec4(col, 1.0) * cover;
  }
  return all;
}

void main() {
  vec2 p = v * uSize;
  vec2 b = bend(p);
  // The scene behind, seen through the water: bent, a little darker, tinted by its own light.
  vec3 scene = texture2D(uScene, clamp((p + b) / uSize, 0.0, 1.0)).rgb;
  vec3 col = scene * 0.82 + uLight * 0.035;
  // A wave tipped toward the light, with something bright behind it, glints.
  vec3 n = normalize(vec3(-b * 0.12, 1.0));
  float spec = pow(max(dot(n, normalize(vec3(0.35, -0.45, 1.0))), 0.0), 90.0);
  float lum = dot(scene, LUMA);
  col += spec * (0.25 + lum * 1.6) * mix(vec3(1.0), uLight, 0.25);
  col += caustic(p / 260.0 + b * 0.004) * 0.09 * mix(vec3(1.0), uLight, 0.5); // the water's own light

  if (uHasArt > 0.5) {
    if (p.y <= uWater) {
      // The dress, hanging over the water, swaying gently with it, and the water on it.
      vec2 a = p - uBox.xy + liquid(p, 0.45) + b * 0.2;
      if (a.x > -12.0 && a.x < uBox.z + 12.0 && a.y > -12.0) {
        vec4 dress = layer(a, 1.0);
        col = col * (1.0 - dress.a) + dress.rgb;
      }
    } else {
      // Its reflection: upside down under the waterline, broken up by the water (a little less
      // where it meets the waterline), fading with depth.
      float depth = p.y - uWater;
      float near = smoothstep(uBox.x - 40.0, uBox.x + 30.0, p.x) * (1.0 - smoothstep(uBox.x + uBox.z - 30.0, uBox.x + uBox.z + 40.0, p.x));
      col *= 1.0 - 0.18 * near; // the water under the dress
      float fade = 0.55 * exp(-depth / 60.0);
      vec2 m = vec2(p.x, uWater - depth) + (b * 1.6 + liquid(p, 1.4)) * mix(0.35, 1.0, smoothstep(0.0, 24.0, depth)) - uBox.xy;
      if (fade > 0.01 && m.x > -12.0 && m.x < uBox.z + 12.0) {
        vec4 dress = layer(m, step(depth, uBox.w * 0.3));
        col = col * (1.0 - dress.a * fade) + dress.rgb * 0.8 * fade;
      }
      // Where a drip landed, its ring spreads on the water, the stage's light along its crests.
      for (int i = 8; i < 10; i++) {
        vec4 drop = uDrops[i];
        float age = uTime - drop.z;
        if (age < 0.0 || age > 1.6) continue;
        float z = (length((p - drop.xy) * vec2(1.0, 3.4)) - age * 24.0) / 3.0;
        col += max(sin(z * 4.5), 0.0) * exp(-z * z) * (1.0 - age / 1.6) * 0.1 * (1.0 + 2.0 * uFlash) * mix(vec3(1.0), uLight, 0.6);
      }
    }
  }

  // The small words ripple with the water, gently enough to read.
  vec4 text = texture2D(uText, clamp((p + liquid(p, 0.3) + b * 0.2) / uSize, 0.0, 1.0));
  col = col * (1.0 - text.a) + text.rgb;

  // The title, like liquid type: it stands on the water with its reflection beneath it, upside
  // down, broken up and fading, and its letters glitter a little, like wet ink.
  if (uTitleBox.z > 0.0) {
    float axis = uTitleBox.y + uTitleBox.w * 0.86; // where the letters stand
    if (p.y > axis && p.y - axis < 34.0) { // one line's worth, so a wrapped title's first line isn't mirrored
      float depth = p.y - axis;
      vec2 m = vec2(p.x, axis - depth * 1.15) + liquid(p, 2.4) + b * 0.5;
      vec4 r = texture2D(uTitle, clamp(m / uSize, 0.0, 1.0));
      float k = 0.4 * exp(-depth / 16.0);
      col = col * (1.0 - r.a * k) + r.rgb * 0.85 * k;
    }
    vec4 title = texture2D(uTitle, clamp((p + liquid(p, 1.0) + b * 0.25) / uSize, 0.0, 1.0));
    float speck = step(0.993, hash(floor(p.x) * 17.0 + floor(p.y) * 131.0 + floor(uTime * 6.0)));
    col = col * (1.0 - title.a) + title.rgb + speck * 0.5 * title.a;
  }

  // Rain, and now and then lightning lighting up the water.
  col += rain(p) * uRain * 0.38 * mix(vec3(1.0), uLight, 0.2);
  col += uFlash * (scene * 0.6 + vec3(0.10, 0.11, 0.14));
  gl_FragColor = vec4(col, 1.0);
}`

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Each element's words, split into letters the page lays out, so we can draw each where it stands.
// Letters sit in unbreakable words, so a line never breaks inside one.
function letters(el) {
  const spans = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  for (const node of nodes) {
    const pieces = document.createDocumentFragment()
    for (const part of node.data.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        pieces.append(part)
        continue
      }
      const word = document.createElement('span')
      word.className = 'ripple-word'
      for (const ch of part) {
        const span = document.createElement('span')
        span.textContent = ch
        word.append(span)
        spans.push(span)
      }
      pieces.append(word)
    }
    node.replaceWith(pieces)
  }
  return spans
}

// The dress's notes (product/strawberry-slip-look.json), every position a fraction of its picture:
// hem, the lowest edge of the cloth; drips, the points drops hang from (x, y, and r, a grown drop's
// radius); runs, the lines beads run down; glints, the spots light catches (x, y, and s, their
// size). r and s are fractions of the picture's width. Anything missing is left out.
function readNotes(meta) {
  const ok = (...values) => values.every(Number.isFinite)
  return {
    hem: ok(meta?.hem) ? meta.hem : 0.9,
    drips: (meta?.drips || []).filter((d) => ok(d?.x, d?.y, d?.r)),
    runs: (meta?.runs || []).filter((run) => Array.isArray(run) && run.length > 1 && run.every((pt) => ok(pt?.[0], pt?.[1]))),
    glints: (meta?.glints || []).filter((g) => ok(g?.x, g?.y, g?.s)),
  }
}

// A bead's way down a run, as fractions of the run: it gathers, slides a little, sticks a moment,
// slides on. length is the run's length in picture widths.
function plan(length) {
  const steps = []
  let t = 0.6
  let f = 0
  while (f < 1) {
    const df = Math.min(1 - f, (0.014 + Math.random() * 0.043) / length) // a slide of 4 to 16 px on a desktop
    const dt = 0.3 + (df * length) / (0.06 + Math.random() * 0.035) // slowly
    steps.push([t, t + dt, f, f + df])
    f += df
    t += dt + 0.35 + Math.random() * 1.2 // and it sticks
  }
  return { steps, end: steps.at(-1)[1] + 0.6 }
}

// How far down its run a bead is at time s (0 to 1), and when it passed f.
function along({ steps }, s) {
  let f = 0
  for (const [t0, t1, f0, f1] of steps) {
    if (s >= t1) f = f1
    else {
      if (s > t0) f = f0 + (f1 - f0) * smooth(0, 1, (s - t0) / (t1 - t0))
      break
    }
  }
  return f
}
function passed({ steps }, f) {
  for (const [t0, t1, f0, f1] of steps) if (f <= f1) return t0 + ((t1 - t0) * Math.max(0, f - f0)) / (f1 - f0 || 1)
  return steps.at(-1)[1]
}

export function mountWater(card, { stage, art = null, meta = null, texts = [], rain = false, light = [255, 96, 196] }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'water-gl'
  canvas.setAttribute('aria-hidden', 'true')
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false })
  if (!gl) return () => {} // no WebGL: the card stays frosted glass

  const program = gl.createProgram()
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, FRAG],
  ]) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('water: WebGL program failed, keeping the glass', gl.getProgramInfoLog(program))
    return () => {}
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const where = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(where)
  gl.vertexAttribPointer(where, 2, gl.FLOAT, false, 0, 0)
  const u = {}
  for (const name of ['uScene', 'uArt', 'uText', 'uTitle', 'uTitleBox', 'uSize', 'uPx', 'uTime', 'uFlash', 'uRain', 'uHasArt', 'uBox', 'uWater', 'uLight', 'uDrops', 'uBeads', 'uTrail', 'uGlints']) {
    u[name] = gl.getUniformLocation(program, name)
  }
  const textures = [0, 1, 2, 3].map((unit) => {
    const t = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    for (const [k, value] of [
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    ]) {
      gl.texParameteri(gl.TEXTURE_2D, k, value)
    }
    return t
  })
  // Pictures go up with their colors already multiplied by their opacity, and the shader blends
  // them that way, so smoothing between a pixel and its see-through neighbor can't darken an edge.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  const upload = (unit, source) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, textures[unit])
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }
  gl.uniform1i(u.uScene, 0)
  gl.uniform1i(u.uArt, 1)
  gl.uniform1i(u.uText, 2)
  gl.uniform1i(u.uTitle, 3)

  // The words: remember how each letter looks before the page makes them invisible.
  const spans = texts.flatMap(letters)
  const fontOf = (s) => `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
  const looks = new Map(
    spans.map((span) => {
      const s = getComputedStyle(span)
      const glow = s.textShadow !== 'none'
      return [span, { font: fontOf(s), color: s.color, case: s.textTransform, glow }]
    }),
  )
  // The name field, the buttons and the status line ripple too: the water draws them, while the
  // real ones stay in place, invisible, so typing, clicking and the keyboard work as always.
  const controls = [...card.querySelectorAll('.input, .pearl-button')]
  const status = card.querySelector('[role=status]')
  const statusLook = status && getComputedStyle(status)
  const statusFont = statusLook && `${statusLook.fontWeight} ${statusLook.fontSize} ${statusLook.fontFamily}`
  const statusColor = statusLook?.color
  card.prepend(canvas)
  card.classList.add('water-on')

  const still = matchMedia('(prefers-reduced-motion: reduce)')
  const scene = document.createElement('canvas') // the scene behind the card, put together each frame
  const sctx = scene.getContext('2d')
  const words = document.createElement('canvas') // the small words, drawn where the page laid them out
  const wctx = words.getContext('2d')
  const titled = document.createElement('canvas') // the title, on its own: it gets a reflection
  const tctx = titled.getContext('2d')
  const heading = texts.find((el) => el.matches('h1'))
  const drops = new Float32Array(40).fill(-99) // the rings: 8 for rain, then 2 for the dress's drips
  let nextDrop = 0
  let dripRing = 0
  let flashAt = -99
  let nextFlash = performance.now() / 1000 + 12 + Math.random() * 20
  let frame = 0
  let last = 0
  let box = card.getBoundingClientRect()

  // ---- The dress (on the shop): a still picture, and its notes.
  const notes = readNotes(art ? meta : null)
  const picture = document.createElement('canvas') // the picture, at the size it's shown
  const pctx = picture.getContext('2d')
  let pic = { x: 0, y: 0, w: 0, h: 0 } // where it's shown, CSS px from the card's top left
  let waterline = 0 // CSS px from the picture's top
  const dropSize = (d) => Math.max(1.6, d.r * pic.w) // a grown drop's radius, CSS px

  // Where the picture stands, as the page lays out the <img> (object-fit: contain). It's drawn once
  // at the size it's shown, so the graphics chip never has to shrink it (which would shimmer as it
  // ripples), and sent up once; again only if that size changes.
  function placeArt(dpr) {
    const r = art.getBoundingClientRect()
    const iw = art.naturalWidth || 840
    const ih = art.naturalHeight || 980
    const k = Math.min(r.width / iw, r.height / ih)
    pic = { x: r.left - box.left + (r.width - iw * k) / 2, y: r.top - box.top + (r.height - ih * k) / 2, w: iw * k, h: ih * k }
    const w = Math.round(pic.w * dpr)
    const h = Math.round(pic.h * dpr)
    if (w > 0 && h > 0 && (picture.width !== w || picture.height !== h)) {
      picture.width = w
      picture.height = h
      pctx.imageSmoothingQuality = 'high'
      pctx.drawImage(art, 0, 0, w, h)
      upload(1, picture)
    }
    // The waterline: below the hem and its lowest grown drop, by enough that a drop falls a way
    // anyone can see (20 px or so on a desktop, 14 on a phone).
    let low = notes.hem * pic.h
    for (const d of notes.drips) low = Math.max(low, d.y * pic.h + 2.4 * dropSize(d))
    waterline = low + Math.min(24, Math.max(14, pic.w * 0.075))
    gl.uniform4f(u.uBox, pic.x, pic.y, pic.w, pic.h)
    gl.uniform1f(u.uWater, pic.y + waterline)
  }

  // ---- The water on the dress, worked out each frame, in CSS px from the picture's top left.
  // Every drop asks for a place, with how much it matters (falling and running drops most, what's
  // left at the hem least); the shader has room for MAX_BEADS.
  const beads = new Float32Array(MAX_BEADS * 4)
  const trail = new Float32Array(6 * 4)
  const sparks = new Float32Array(3 * 4)
  let wanted = []
  const bead = (x, y, rx, ry, matters) => {
    if (rx > 0.1 && ry > 0.1) wanted.push([x, y, rx, ry, matters, wanted.length])
  }
  // A drop hanging from the cloth's edge at x, edge: a little long, its top tucked into the cloth
  // by a short neck, sagging as it gets heavy (sag 0 to 1) until the neck is all that holds it.
  const hang = (x, edge, size, sag = 0, matters = 2) => {
    const stretch = 1.1 + 0.2 * sag
    const rx = size / Math.sqrt(stretch)
    const ry = size * Math.sqrt(stretch)
    bead(x, edge + ry * (0.62 + 0.45 * sag), rx, ry, matters)
    if (size > 1.2) bead(x, edge + ry * (0.18 + 0.1 * sag), rx * (0.42 - 0.14 * sag), ry * (0.36 + 0.12 * sag), 1)
  }

  // Each drip point's drop: it gathers and swells for a few seconds, lets go, falls slowly (it's a
  // commercial), wobbling a little, and lands in the water with a ring and a tiny splash. Then a new
  // one gathers. Times are seconds on the page's clock.
  const drips = notes.drips.map((d) => ({ ...d, landed: -99, splash: [0, 0] }))
  const rest = () => Math.max(0.8, drips.length / DRIP_RATE - 6) * (0.4 + Math.random() * 1.2)
  function gather(drip, from) {
    drip.born = from
    drip.falls = from + 3.5 + Math.random() * 3.5
    drip.lands = drip.falls + 0.65 + Math.random() * 0.2
  }
  const mounted = performance.now() / 1000
  for (const drip of drips) gather(drip, mounted + rest() * Math.random() - Math.random() * 6) // each somewhere in its life

  function dripping(now, t) {
    for (const drip of drips) {
      if (now - drip.lands > 20) gather(drip, now + Math.random() * 3) // the tab slept: start again
      while (now >= drip.lands) {
        if (now - drip.lands < 0.3) {
          // It lands: a ring on the water, and a droplet bounced back up.
          const i = 4 * (8 + (dripRing++ % 2))
          drops.set([pic.x + drip.x * pic.w, pic.y + waterline, t - (now - drip.lands), 1], i)
          drip.landed = drip.lands
          drip.splash = [(Math.random() - 0.5) * 0.02, 0.01 + Math.random() * 0.008]
        }
        gather(drip, drip.lands + rest())
      }
      const size = dropSize(drip)
      const x = drip.x * pic.w
      const edge = drip.y * pic.h
      const since = now - drip.falls
      if (now < drip.born) hang(x, edge, 0.3 * size, 0, 0) // what's left after the last one
      else if (now < drip.falls) {
        const g = (now - drip.born) / (drip.falls - drip.born)
        hang(x, edge, size * Math.cbrt(0.027 + 0.973 * g), smooth(0.8, 1, g)) // its water arrives steadily
      }
      if (since >= 0 && now < drip.lands) {
        // Falling: from where it let go to the waterline, slightly stretched, wobbling as it goes.
        const T = drip.lands - drip.falls
        const ry0 = size * Math.sqrt(1.3)
        const y0 = edge + 1.07 * ry0
        const pull = (2 * Math.max(1, waterline - y0 - ry0)) / (T * T)
        const wobble = 1 + 0.28 * Math.cos((2 * Math.PI * since) / 0.34) * Math.exp(-since * 4.5) + 0.08 * (since / T)
        bead(x, y0 + 0.5 * pull * since * since, size / Math.sqrt(wobble), size * Math.sqrt(wobble), 3)
        hang(x, edge, 0.3 * size, 0, 0)
      }
      const s = now - drip.landed
      if (s < 0.5) {
        // The splash, in slow motion: the droplet goes up and comes back down into the water.
        const [vx, height] = drip.splash
        const up = (2 * height * pic.w) / 0.22
        const y = waterline - 1 - (up * s - (0.5 * up * s * s) / 0.22)
        if (y < waterline) bead(x + vx * pic.w * s, y, 0.34 * size, 0.38 * size, 1.5)
      }
    }
  }

  // Now and then a bead runs down one of the runs, stop-and-go, leaving a short wet trail.
  let runner = null
  let nextRun = mounted + 2 + Math.random() * 3
  let lastRun = -1
  function running(now) {
    trail.fill(0)
    if (!runner && notes.runs.length && now > nextRun) {
      let i = Math.floor(Math.random() * notes.runs.length)
      if (i === lastRun && notes.runs.length > 1) i = (i + 1) % notes.runs.length
      lastRun = i
      const run = notes.runs[i]
      let length = 0 // in picture widths
      for (let j = 1; j < run.length; j++) length += Math.hypot(run[j][0] - run[j - 1][0], ((run[j][1] - run[j - 1][1]) * pic.h) / pic.w)
      runner = { run, start: now, plan: plan(Math.max(length, 0.05)) }
    }
    if (!runner) return
    const s = now - runner.start
    if (s > runner.plan.end || s < 0) {
      runner = null
      nextRun = now + 3 + Math.random() * 6
      return
    }
    // The run in CSS px, and where a fraction f of the way down it is.
    const pts = runner.run.map(([x, y]) => [x * pic.w, y * pic.h])
    const lengths = [0]
    for (let j = 1; j < pts.length; j++) lengths.push(lengths[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]))
    const total = lengths.at(-1) || 1
    const at = (f) => {
      const d = Math.min(1, Math.max(0, f)) * total
      let j = 1
      while (j < pts.length - 1 && lengths[j] < d) j++
      const k = (d - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1)
      return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * k, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * k]
    }
    const f = along(runner.plan, s)
    const moving = Math.abs(along(runner.plan, s + 0.05) - f) > 0.0005 ? 1 : 0
    const mean = drips.length ? drips.reduce((sum, d) => sum + dropSize(d), 0) / drips.length : 0.0125 * pic.w
    // It gathers, slides a little longer while moving, gives some of itself to the trail, and at
    // the end soaks into the cloth.
    const size = Math.max(1.4, 0.72 * mean) * smooth(0, 0.6, s) * (1 - 0.2 * f) * (1 - smooth(runner.plan.end - 0.6, runner.plan.end, s))
    const [x, y] = at(f)
    bead(x, y, size / (1 + 0.06 * moving), size * (1 + 0.14 * moving), 3)
    const behind = (0.1 * pic.w) / total // the trail's length, as a fraction of the run
    for (let k = 0; k < 6; k++) {
      const fk = Math.max(0, f - (k * behind) / 5)
      const [tx, ty] = at(fk)
      const wet = Math.exp(-Math.max(0, s - passed(runner.plan, fk)) / 2.2) * (1 - 0.15 * k) * (fk < f || k === 0 ? 1 : 0)
      trail.set([tx, ty, wet, size * (2 - 0.28 * k)], 4 * k)
    }
  }

  // Light catching the dress: rare, brief, tiny white-hot flashes on its glint points.
  const flashes = []
  let nextGlint = mounted + 1.5 + Math.random() * 2
  function glinting(now) {
    sparks.fill(0)
    if (notes.glints.length && now > nextGlint && flashes.length < 3) {
      flashes.push({ glint: notes.glints[Math.floor(Math.random() * notes.glints.length)], start: now, length: 0.18 + Math.random() * 0.17, peak: 0.6 + Math.random() * 0.4 })
      nextGlint = now + 1.8 + Math.random() * 3.5
    }
    for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].start > flashes[i].length) flashes.splice(i, 1)
    flashes.forEach(({ glint, start, length, peak }, i) => {
      const s = (now - start) / length
      const bright = peak * (s < 0.25 ? s / 0.25 : 1 - (s - 0.25) / 0.75) ** 2
      sparks.set([glint.x * pic.w, glint.y * pic.h, Math.min(2.2, Math.max(0.55, glint.s * pic.w * 0.6)), bright], 4 * i)
    })
  }

  // Everything on the dress for this frame. Held still: each drop hanging part-grown, nothing else.
  function wetDress(now, t) {
    wanted = []
    if (still.matches) {
      drips.forEach((drip, i) => hang(drip.x * pic.w, drip.y * pic.h, dropSize(drip) * (0.55 + 0.35 * ((i * 0.618) % 1))))
      trail.fill(0)
      sparks.fill(0)
    } else {
      dripping(now, t)
      running(now)
      glinting(now)
    }
    // The ones that matter most, drawn in the order they were made, so a drop and its neck always
    // overlap the same way.
    const kept = wanted.sort((a, b) => b[4] - a[4] || a[5] - b[5]).slice(0, MAX_BEADS).sort((a, b) => a[5] - b[5])
    beads.fill(0)
    kept.forEach(([x, y, rx, ry], i) => beads.set([x, y, rx, ry], 4 * i))
    gl.uniform4fv(u.uBeads, beads)
    gl.uniform4fv(u.uTrail, trail)
    gl.uniform4fv(u.uGlints, sparks)
  }

  function measure() {
    box = card.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio || 1, 2)
    for (const [span, look] of looks) look.font = fontOf(getComputedStyle(span)) // a phone's sizes differ
    canvas.width = words.width = titled.width = Math.round(box.width * dpr)
    canvas.height = words.height = titled.height = Math.round(box.height * dpr)
    scene.width = Math.round(box.width)
    scene.height = Math.round(box.height)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(u.uSize, box.width, box.height)
    gl.uniform1f(u.uPx, 1 / dpr)
    paint()
    const h = heading?.getBoundingClientRect()
    gl.uniform4f(u.uTitleBox, h ? h.left - box.left : 0, h ? h.top - box.top : 0, h ? h.width : 0, h ? h.height : 0)
    gl.uniform1f(u.uRain, rain ? 1 : 0)
    gl.uniform1f(u.uHasArt, art ? 1 : 0)
    if (art) placeArt(dpr)
  }

  // A field or a button, drawn where the page laid it out.
  function drawControl(ctx, el, dpr) {
    const r = el.getBoundingClientRect()
    const [x, y, w, h] = [r.left - box.left, r.top - box.top, r.width, r.height]
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 10)
    if (el.matches('.pearl-button')) {
      // The pearl satin button, glowing a little; dimmed while it waits.
      ctx.globalAlpha = el.disabled ? 0.6 : 1
      ctx.shadowColor = 'rgb(255 214 234 / 0.35)'
      ctx.shadowBlur = 18 * dpr
      const pearl = ctx.createLinearGradient(0, y, 0, y + h)
      pearl.addColorStop(0, '#fffaf7')
      pearl.addColorStop(0.55, '#f3e9ee')
      pearl.addColorStop(1, '#e4d3dc')
      ctx.fillStyle = pearl
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.strokeStyle = 'rgb(255 255 255 / 0.75)'
      ctx.stroke()
    } else {
      // The name field: its frame (gold while it has the keyboard), and what's typed, or its hint.
      const focused = document.activeElement === el
      ctx.fillStyle = 'rgb(255 255 255 / 0.06)'
      ctx.fill()
      ctx.strokeStyle = focused ? 'rgb(232 203 142 / 0.85)' : 'rgb(255 255 255 / 0.42)'
      ctx.stroke()
      if (focused) {
        ctx.beginPath()
        ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 12)
        ctx.strokeStyle = 'rgb(232 203 142 / 0.6)'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      const look = getComputedStyle(el)
      const pad = parseFloat(look.paddingLeft)
      ctx.font = `${look.fontWeight} ${look.fontSize} ${look.fontFamily}`
      ctx.fillStyle = el.value ? '#fff' : 'rgb(255 255 255 / 0.62)'
      ctx.textBaseline = 'middle'
      ctx.fillText(el.value || el.placeholder, x + pad, y + h / 2, w - 2 * pad)
    }
    ctx.restore()
  }

  // Draw everything on the card that ripples: the fields and buttons, the words, the status line.
  function paint() {
    box = card.getBoundingClientRect() // where the card is now (the page may have scrolled)
    const dpr = Math.min(devicePixelRatio || 1, 2)
    for (const ctx of [wctx, tctx]) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, box.width, box.height)
      ctx.textBaseline = 'middle'
    }
    for (const el of controls) drawControl(wctx, el, dpr)
    for (const span of spans) {
      const ctx = heading?.contains(span) ? tctx : wctx
      const r = span.getBoundingClientRect()
      const look = looks.get(span)
      const ch = look.case === 'uppercase' ? span.textContent.toUpperCase() : look.case === 'lowercase' ? span.textContent.toLowerCase() : span.textContent
      ctx.font = look.font
      ctx.fillStyle = look.color
      ctx.shadowColor = look.glow ? 'rgb(255 214 234 / 0.75)' : 'transparent'
      ctx.shadowBlur = look.glow ? 14 * dpr : 0
      ctx.globalAlpha = span.closest('button')?.disabled ? 0.6 : 1 // a waiting button's label dims too
      ctx.fillText(ch, r.left - box.left, r.top - box.top + r.height / 2)
    }
    wctx.globalAlpha = 1
    if (status?.textContent) {
      const r = status.getBoundingClientRect()
      wctx.font = statusFont
      wctx.fillStyle = statusColor
      wctx.shadowColor = 'transparent'
      wctx.fillText(status.textContent, r.left - box.left, r.top - box.top + r.height / 2)
    }
    upload(2, words)
    upload(3, titled)
  }

  // The scene behind the card: the stage's layers under the card's box, blended as stage.css
  // blends them (closely enough to be seen through water).
  function paintScene() {
    const { width: W, height: H } = scene
    sctx.globalCompositeOperation = 'source-over'
    sctx.fillStyle = '#000'
    sctx.fillRect(0, 0, W, H)
    const layer = (source, mode) => {
      if (!source?.width) return
      const r = source.getBoundingClientRect()
      const k = source.width / r.width
      sctx.globalCompositeOperation = mode
      sctx.drawImage(source, (box.left - r.left) * k, (box.top - r.top) * k, box.width * k, box.height * k, 0, 0, W, H)
    }
    if (stage.querySelector('.runway')) {
      layer(stage.querySelector('.lit canvas'), 'source-over') // the stage in white light
      layer(stage.querySelector('canvas.haze'), 'screen') // the haze it lights
      const gel = stage.querySelector('.light-gel')?.style.backgroundColor
      if (gel) {
        sctx.globalCompositeOperation = 'multiply' // colored by the rig's gel
        sctx.fillStyle = gel
        sctx.fillRect(0, 0, W, H)
        light = gel.match(/\d+/g).slice(0, 3).map(Number)
      }
      layer(stage.querySelector('canvas.own'), 'screen') // light in its own colors
      layer(stage.querySelector('canvas.twinkle'), 'screen')
    } else {
      const [first, ...rest] = stage.querySelectorAll('canvas')
      layer(first, 'source-over')
      for (const c of rest) layer(c, 'screen')
    }
    upload(0, scene)
    gl.uniform3f(u.uLight, light[0] / 255, light[1] / 255, light[2] / 255)
  }

  function draw(ms) {
    box = card.getBoundingClientRect() // where the card is now (the page may have scrolled)
    const now = ms / 1000 // the page's clock, for timing things
    const t = now % 3600 // the shader's clock, kept small enough to stay precise
    paintScene()
    if (art) wetDress(now, t)
    // A raindrop now and then: often on the shop's rainy water, seldom on the calm one.
    if (!still.matches && now > nextDrop) {
      const i = Math.floor(Math.random() * 8) * 4
      drops.set([Math.random() * box.width, box.height * (rain ? 0.35 + Math.random() * 0.65 : Math.random()), t, 0], i)
      nextDrop = now + (rain ? 0.2 + Math.random() * 0.4 : 0.8 + Math.random() * 1.6)
    }
    gl.uniform4fv(u.uDrops, drops)
    // Lightning on the shop, every half a minute or so: a bright flicker, then a second, fading.
    if (rain && !still.matches && now > nextFlash) {
      flashAt = now
      nextFlash = now + 20 + Math.random() * 25
    }
    const since = now - flashAt
    const flash = since < 0 || since > 1.2 ? 0 : Math.exp(-since * 9) * 0.9 + (since > 0.18 ? Math.exp(-(since - 0.18) * 7) * 0.6 : 0)
    gl.uniform1f(u.uFlash, flash * 0.5)
    gl.uniform1f(u.uTime, still.matches ? 0 : t)
    gl.uniform1f(u.uRain, rain && !still.matches ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function tick(ms) {
    frame = requestAnimationFrame(tick)
    if (ms - last < (still.matches ? 250 : 33)) return // held still: 4 unmoving frames a second
    last = ms
    draw(ms)
  }

  function start() {
    cancelAnimationFrame(frame)
    if (document.hidden) draw(performance.now())
    else frame = requestAnimationFrame(tick)
  }

  const resize = new ResizeObserver(() => {
    measure()
    start()
  })
  resize.observe(card)
  document.fonts.ready.then(measure) // fonts can arrive after the first measure
  const changes = ['input', 'focus', 'blur']
  for (const el of controls) for (const type of changes) el.addEventListener(type, paint)
  const watch = new MutationObserver(paint)
  for (const el of controls) watch.observe(el, { attributes: true, attributeFilter: ['disabled'] })
  if (status) watch.observe(status, { childList: true, characterData: true, subtree: true })
  still.addEventListener('change', start)
  document.addEventListener('visibilitychange', start)

  return function stop() {
    cancelAnimationFrame(frame)
    resize.disconnect()
    still.removeEventListener('change', start)
    document.removeEventListener('visibilitychange', start)
    for (const el of controls) for (const type of changes) el.removeEventListener(type, paint)
    watch.disconnect()
    card.classList.remove('water-on')
    canvas.remove()
  }
}
