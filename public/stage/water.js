// The cards are panes of water. This draws each one with WebGL (the graphics chip's own pixel
// shading, which is what makes water smooth): the scene behind the card seen through slow swells
// and raindrop rings, glinting where a wave catches bright light; on the shop, the dress standing in
// the water, wet, with its reflection rippling below it, rain falling past and now and then a flash
// of lightning; and the card's words, rippling with the water. The name field and the button stay
// crisp on top, and the words stay in the page (invisible) for screen readers.
// Decoration only. At most 30 frames a second, asleep while the tab is hidden, and one still frame
// (no rain) for anyone who asks their system for less motion. Without WebGL, the card stays glass.

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
uniform vec2 uSize;     // the card, in CSS px
uniform float uTime;    // seconds
uniform float uFlash;   // lightning, 0 to 1
uniform float uRain;    // 1 on the shop, 0 elsewhere
uniform float uHasArt;  // 1 if a dress stands in the water
uniform vec4 uBox;      // where the dress's picture is: x, y, width, height (CSS px)
uniform float uWater;   // the waterline: the dress's hem (CSS px from the card's top)
uniform vec3 uLight;    // the scene's light (the rig's gel, or the planet's pink), 0 to 1
uniform vec3 uDrops[8]; // raindrops: x, y (CSS px) and when they hit (s)
uniform vec4 uTitleBox; // where the title is: x, y, width, height (CSS px); width 0 for none

float hash(float n) { return fract(sin(n) * 43758.5453); }

// The water's height at p: three long, slow swells.
float swell(vec2 p) {
  float t = uTime;
  return sin(p.x * 0.031 + t * 0.70)
       + sin(p.y * 0.052 - t * 0.95 + p.x * 0.012) * 0.7
       + sin((p.x * 0.6 - p.y) * 0.041 + t * 0.53) * 0.6;
}

// How far the water bends what's behind it at p, in CSS px: its slope, plus the raindrops' rings.
vec2 bend(vec2 p) {
  vec2 b = vec2(swell(p + vec2(1.0, 0.0)) - swell(p - vec2(1.0, 0.0)),
                swell(p + vec2(0.0, 1.0)) - swell(p - vec2(0.0, 1.0))) * 2.6;
  for (int i = 0; i < 8; i++) {
    float age = uTime - uDrops[i].z;
    if (age < 0.0 || age > 1.6) continue;
    vec2 q = p - uDrops[i].xy;
    float d = length(q);
    float z = (d - age * 46.0) / 5.0; // distance from the ring as it spreads
    b += q / (d + 0.001) * exp(-z * z) * (1.0 - age / 1.6) * sin(z * 4.5) * 3.2;
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

vec4 dressAt(vec2 a) {
  if (a.x < 0.0 || a.x > 1.0 || a.y < 0.0 || a.y > 1.0) return vec4(0.0);
  return texture2D(uArt, a);
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
  float lum = dot(scene, vec3(0.2126, 0.7152, 0.0722));
  col += spec * (0.25 + lum * 1.6) * mix(vec3(1.0), uLight, 0.25);
  col += caustic(p / 260.0 + b * 0.004) * 0.09 * mix(vec3(1.0), uLight, 0.5); // the water's own light

  if (uHasArt > 0.5) {
    if (p.y <= uWater + 1.0) {
      // The dress, standing in the water, swaying gently with it. Wet: a little darker and
      // glossier, a soft sheen drifting across it, and water running down in thin bright lanes.
      vec2 a = (p - uBox.xy + liquid(p, 0.45) + b * 0.2) / uBox.zw;
      vec4 d = dressAt(a);
      vec3 wet = pow(d.rgb, vec3(1.12));
      float lane = floor(a.x * 70.0);
      float run = step(0.86, hash(lane)) * smoothstep(0.75, 1.0, fract(a.y * 1.4 - uTime * 0.18 + hash(lane * 1.3)));
      float sheen = pow(max(0.0, 1.0 - abs(a.x - 0.42 - 0.12 * sin(uTime * 0.35)) * 2.6), 8.0) * 0.16;
      col = mix(col, wet + (run * 0.35 + sheen) * d.a, d.a);
    } else {
      // Its reflection: upside down under the waterline, broken up by the water, fading with depth.
      float depth = p.y - uWater;
      float near = smoothstep(uBox.x - 40.0, uBox.x + 30.0, p.x) * (1.0 - smoothstep(uBox.x + uBox.z - 30.0, uBox.x + uBox.z + 40.0, p.x));
      col *= 1.0 - 0.18 * near; // the water floor the dress stands in
      vec4 d = dressAt((vec2(p.x, uWater - depth) + b * 1.6 + liquid(p, 1.4) - uBox.xy) / uBox.zw);
      col = mix(col, d.rgb * 0.8, d.a * 0.55 * exp(-depth / 60.0));
    }
  }

  // The small words ripple with the water, gently enough to read.
  vec4 text = texture2D(uText, clamp((p + liquid(p, 0.3) + b * 0.2) / uSize, 0.0, 1.0));
  col = mix(col, text.rgb, text.a);

  // The title, like liquid type: it stands on the water with its reflection beneath it, upside
  // down, broken up and fading, and its letters glitter a little, like wet ink.
  if (uTitleBox.z > 0.0) {
    float axis = uTitleBox.y + uTitleBox.w * 0.86; // where the letters stand
    if (p.y > axis && p.y - axis < 34.0) { // one line's worth, so a wrapped title's first line isn't mirrored
      float depth = p.y - axis;
      vec2 m = vec2(p.x, axis - depth * 1.15) + liquid(p, 2.4) + b * 0.5;
      vec4 r = texture2D(uTitle, clamp(m / uSize, 0.0, 1.0));
      col = mix(col, r.rgb * 0.85, r.a * 0.4 * exp(-depth / 16.0));
    }
    vec4 title = texture2D(uTitle, clamp((p + liquid(p, 1.0) + b * 0.25) / uSize, 0.0, 1.0));
    float speck = step(0.993, hash(floor(p.x) * 17.0 + floor(p.y) * 131.0 + floor(uTime * 6.0)));
    col = mix(col, title.rgb + speck * 0.5, title.a);
  }

  // Rain, and now and then lightning lighting up the water.
  col += rain(p) * uRain * 0.38 * mix(vec3(1.0), uLight, 0.2);
  col += uFlash * (scene * 0.6 + vec3(0.10, 0.11, 0.14));
  gl_FragColor = vec4(col, 1.0);
}`

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

// The lowest row of a picture with something in it: the hem, where the dress meets the water.
function hemOf(canvas) {
  const { width, height } = canvas
  if (!width || !height) return height
  const probe = document.createElement('canvas')
  probe.width = width
  probe.height = height
  const pctx = probe.getContext('2d', { willReadFrequently: true })
  pctx.drawImage(canvas, 0, 0)
  const data = pctx.getImageData(0, 0, width, height).data
  for (let y = height - 1; y > 0; y--) {
    for (let x = 0; x < width; x += 3) if (data[(y * width + x) * 4 + 3] > 40) return y
  }
  return height
}

export function mountWater(card, { stage, art = null, texts = [], rain = false, light = [255, 96, 196] }) {
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
  for (const name of ['uScene', 'uArt', 'uText', 'uTitle', 'uTitleBox', 'uSize', 'uTime', 'uFlash', 'uRain', 'uHasArt', 'uBox', 'uWater', 'uLight', 'uDrops']) {
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
  const looks = new Map(
    spans.map((span) => {
      const s = getComputedStyle(span)
      const glow = s.textShadow !== 'none'
      return [span, { font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`, color: s.color, case: s.textTransform, glow }]
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
  const drops = new Float32Array(24).fill(-99)
  let nextDrop = 0
  let flashAt = -99
  let nextFlash = 12 + Math.random() * 20
  let hem = 0
  let hemFound = 0
  let frame = 0
  let last = 0
  let box = card.getBoundingClientRect()

  function measure() {
    box = card.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = words.width = titled.width = Math.round(box.width * dpr)
    canvas.height = words.height = titled.height = Math.round(box.height * dpr)
    scene.width = Math.round(box.width)
    scene.height = Math.round(box.height)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(u.uSize, box.width, box.height)
    paint()
    const h = heading?.getBoundingClientRect()
    gl.uniform4f(u.uTitleBox, h ? h.left - box.left : 0, h ? h.top - box.top : 0, h ? h.width : 0, h ? h.height : 0)
    gl.uniform1f(u.uRain, rain ? 1 : 0)
    gl.uniform1f(u.uHasArt, art ? 1 : 0)
    hemFound = 0
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
    const t = (ms / 1000) % 3600
    paintScene()
    if (art) {
      upload(1, art)
      if (!hemFound || (ms - hemFound > 1500 && ms < 12000)) {
        hem = hemOf(art)
        hemFound = ms || 1
      }
      const a = art.getBoundingClientRect()
      gl.uniform4f(u.uBox, a.left - box.left, a.top - box.top, a.width, a.height)
      gl.uniform1f(u.uWater, a.top - box.top + (hem / (art.height || 1)) * a.height)
    }
    // A raindrop now and then: often on the shop's rainy water, seldom on the calm one.
    if (!still.matches && t > nextDrop) {
      const i = Math.floor(Math.random() * 8) * 3
      drops[i] = Math.random() * box.width
      drops[i + 1] = box.height * (rain ? 0.35 + Math.random() * 0.65 : Math.random())
      drops[i + 2] = t
      nextDrop = t + (rain ? 0.2 + Math.random() * 0.4 : 0.8 + Math.random() * 1.6)
    }
    gl.uniform3fv(u.uDrops, drops)
    // Lightning on the shop, every half a minute or so: a bright flicker, then a second, fading.
    if (rain && !still.matches && t > nextFlash) {
      flashAt = t
      nextFlash = t + 20 + Math.random() * 25
    }
    const since = t - flashAt
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
