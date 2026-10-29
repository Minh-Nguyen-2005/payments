// Light on the water: the product card's glass has no light of its own. It catches the stage's,
// the way sunlight glitters on water: tiny white-hot glints along the crests of slow waves, each
// lit for a split second as a facet of a wave tips into the light, then gone, then lit again a
// little further along. They shine only where something bright stands behind the card (a beam, a
// light on the rig, the glitter on the floor), edged in that light's color: the rig's gel as it
// changes, or the glitter's own. It also hands the gel to the card's CSS as --gel.
// Decoration only. At most 30 frames a second, asleep while the tab is hidden, and still for anyone
// who asks their system for less motion.

const STEP = 10 // how finely to look behind the card, in CSS px
export const ROW = 22 // the distance between two wave crests, in CSS px
export const SWELL = 10 // seconds: one slow swell, shared with the water filter and float.js

// A glint: a white-hot core whose glow is tinted by the light it reflects. Drawn once per color.
function sprite(color) {
  const s = document.createElement('canvas')
  s.width = s.height = 32
  const c = s.getContext('2d')
  const glow = c.createRadialGradient(16, 16, 0, 16, 16, 16)
  glow.addColorStop(0, 'rgb(255 255 255 / 1)')
  glow.addColorStop(0.16, 'rgb(255 255 255 / 0.9)')
  glow.addColorStop(0.32, `rgb(${color} / 0.35)`)
  glow.addColorStop(1, `rgb(${color} / 0)`)
  c.fillStyle = glow
  c.fillRect(0, 0, 32, 32)
  return s
}

// Light mixed with white, the way a bright glint washes out toward its core.
const toward = (rgb, k) => rgb.map((v) => Math.round(v + (255 - v) * k)).join(' ')
// A repeatable random number in [0, 1) for any input: where a glint lands on each of its flashes.
const hash = (n) => {
  const s = Math.sin(n) * 43758.5453
  return s - Math.floor(s)
}

// How far the water's surface stands above its rest at x on wave row k, at time t (seconds):
// two slow sines, so no two rows look alike. Their periods (10 s and 6.18 s, the golden ratio
// apart) never line up, so the water never visibly repeats. float.js rides the content on it.
export const swell = (k, x, t) =>
  4.5 * Math.sin(x / 60 + (t / SWELL) * Math.PI * 2 + k * 1.9) +
  2.5 * Math.sin(x / 24 - (t / (SWELL * 0.618)) * Math.PI * 2 + k * 0.7)
// The crest of wave row k at x, at time t.
const crest = (k, x, t) => (k + 0.5) * ROW + swell(k, x, t)
// Its slope, so a glint can lie along the wave.
const slope = (k, x, t) =>
  (4.5 / 60) * Math.cos(x / 60 + (t / SWELL) * Math.PI * 2 + k * 1.9) +
  (2.5 / 24) * Math.cos(x / 24 - (t / SWELL) * Math.PI * 4 + k * 0.7)

export function mountShimmer(card, stage) {
  const canvas = document.createElement('canvas')
  canvas.className = 'shimmer'
  canvas.setAttribute('aria-hidden', 'true')
  card.prepend(canvas)
  const ctx = canvas.getContext('2d')
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  const sprites = new Map() // one per color, made the first time it's needed
  const spriteOf = (color) => sprites.get(color) ?? sprites.set(color, sprite(color)).get(color)
  let light = null // what's behind the card: { cols, rows, bright, own } on a STEP grid
  let rowsCdf = [] // for each wave row, where along it the light is (a running total across x)
  let glints = []
  let gel = [255, 96, 196] // magenta until the runway says otherwise
  let w = 0
  let h = 0
  let dpr = 1
  let frame = 0
  let last = 0
  let lastGel = 0
  let timer = 0

  // The rig's gel, read off the runway's gel layer (runway.js sets its background color).
  function readGel() {
    const m = stage.querySelector('.light-gel')?.style.backgroundColor.match(/\d+/g)
    if (!m) return
    gel = m.slice(0, 3).map(Number)
    card.style.setProperty('--gel', gel.join(' '))
  }

  // How bright is it behind each 10 px of the card? Read every painted layer of the scene under the
  // card's box (the runway's or the galaxy's), except the runway's twinkling one, which changes
  // every frame. The runway's light map (inside .lit) is white light that the gel colors; every
  // other layer keeps its own colors.
  function look() {
    const box = card.getBoundingClientRect()
    const cols = Math.ceil(box.width / STEP)
    const rows = Math.ceil(box.height / STEP)
    const bright = new Float32Array(cols * rows)
    const own = new Array(cols * rows).fill(null)
    for (const source of stage.querySelectorAll('canvas:not(.twinkle)')) {
      const isOwn = !source.closest('.lit')
      if (!source.width || !source.clientWidth) continue
      const k = source.width / source.clientWidth // device pixels per CSS px
      const x0 = Math.max(0, Math.round(box.left * k))
      const y0 = Math.max(0, Math.round(box.top * k))
      const sw = Math.min(source.width - x0, Math.round(box.width * k))
      const sh = Math.min(source.height - y0, Math.round(box.height * k))
      if (sw <= 0 || sh <= 0) continue
      let pixels
      try {
        pixels = source.getContext('2d').getImageData(x0, y0, sw, sh).data
      } catch {
        continue
      }
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const px = Math.min(sw - 1, Math.round((gx + 0.5) * STEP * k))
          const py = Math.min(sh - 1, Math.round((gy + 0.5) * STEP * k))
          const i = (py * sw + px) * 4
          const b = ((0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255) * (pixels[i + 3] / 255)
          const cell = gy * cols + gx
          if (b > bright[cell]) {
            bright[cell] = b
            own[cell] = isOwn ? toward([pixels[i], pixels[i + 1], pixels[i + 2]], 0.3) : null
          }
        }
      }
    }
    return { cols, rows, bright, own }
  }

  const cellAt = (x, y) =>
    Math.min(light.rows - 1, Math.max(0, Math.floor(y / STEP))) * light.cols +
    Math.min(light.cols - 1, Math.max(0, Math.floor(x / STEP)))

  // A place along wave row k, the brighter the likelier, for a random u in [0, 1).
  function along(k, u) {
    const cdf = rowsCdf[k]
    const goal = u * cdf[cdf.length - 1]
    let i = 0
    while (i < cdf.length - 1 && cdf[i] < goal) i++
    return (i + hash(u * 97.1)) * STEP
  }

  function layout() {
    dpr = Math.min(devicePixelRatio || 1, 2)
    w = card.clientWidth
    h = card.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    light = look()
    // For each wave row, a running total of the light along it.
    const waveRows = Math.max(1, Math.floor(h / ROW))
    const rowLight = []
    rowsCdf = []
    for (let k = 0; k < waveRows; k++) {
      const cdf = new Float32Array(light.cols)
      let sum = 0
      for (let gx = 0; gx < light.cols; gx++) {
        sum += light.bright[cellAt(gx * STEP, (k + 0.5) * ROW)] ** 1.5 + 0.0005
        cdf[gx] = sum
      }
      rowsCdf.push(cdf)
      rowLight.push(sum)
    }
    // More glints where more light stands behind the card; most of them small, a few bright.
    const total = light.bright.reduce((sum, b) => sum + b, 0)
    const rowTotal = rowLight.reduce((sum, v) => sum + v, 0)
    glints = Array.from({ length: Math.round(Math.min(520, 40 + total * 0.9)) }, (_, id) => {
      let pick = Math.random() * rowTotal
      const row = Math.max(0, rowLight.findIndex((v) => (pick -= v) <= 0))
      const u = Math.random()
      return {
        id,
        row,
        size: 0.45 + 2.1 * u ** 4,
        stretch: 1.4 + 3 * Math.random() ** 2, // longer along the crest than across it
        period: 0.5 + Math.random() * 1.8, // seconds between two flashes
        duty: 0.07 + Math.random() * 0.15, // the part of that time it's lit
        offset: Math.random(),
      }
    })
  }

  function draw(ms) {
    const t = ms / 1000
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'lighter'
    const gelColor = toward(gel, 0.2)
    for (const g of glints) {
      // Where it is in its flash: lit for the first `duty` of each period, quickly up, slowly down.
      const phase = t / g.period + g.offset
      const p = phase - Math.floor(phase)
      let lit
      if (still.matches) lit = 0.35
      else if (p > g.duty) continue
      else lit = p / g.duty < 0.2 ? p / g.duty / 0.2 : (1 - p / g.duty) / 0.8
      // Each flash lands somewhere new along its wave, where the light behind is.
      const x = along(g.row, hash(g.id * 31.7 + Math.floor(phase) * 7.3))
      const y = crest(g.row, x, still.matches ? 0 : t)
      const cell = cellAt(x, y)
      const behind = light.bright[cell]
      if (behind < 0.06) continue
      const a = lit * Math.min(1, 0.3 + behind * 1.5)
      const r = g.size * 2.4
      ctx.globalAlpha = a
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.translate(x, y)
      ctx.rotate(Math.atan(slope(g.row, x, t)))
      ctx.scale(g.stretch, 1)
      ctx.drawImage(spriteOf(light.own[cell] ?? gelColor), -r, -r, r * 2, r * 2)
      // The brightest catch the camera: a faint, short starburst, square to the frame.
      if (g.size > 1.6 && lit > 0.55 && !still.matches) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.globalAlpha = a * 0.35
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(x - r * 2, y)
        ctx.lineTo(x + r * 2, y)
        ctx.moveTo(x, y - r * 1.1)
        ctx.lineTo(x, y + r * 1.1)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  function tick(ms) {
    frame = requestAnimationFrame(tick)
    if (ms - last < 33) return
    last = ms
    if (ms - lastGel > 200) {
      readGel()
      lastGel = ms
    }
    draw(ms)
  }

  function start() {
    cancelAnimationFrame(frame)
    readGel()
    if (!light) return
    if (still.matches || document.hidden) draw(0)
    else frame = requestAnimationFrame(tick)
  }

  // Look again once the runway has repainted after a resize (it waits 150 ms), or after a scroll.
  function relook() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      layout()
      start()
    }, 400)
  }
  const resize = new ResizeObserver(relook)
  resize.observe(card)
  setTimeout(relook, 2500) // and once more after the galaxy, which paints a piece at a time, is done
  addEventListener('resize', relook)
  addEventListener('scroll', relook, { passive: true })
  still.addEventListener('change', start)
  document.addEventListener('visibilitychange', start)

  return function stop() {
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    resize.disconnect()
    removeEventListener('resize', relook)
    removeEventListener('scroll', relook)
    still.removeEventListener('change', start)
    document.removeEventListener('visibilitychange', start)
    canvas.remove()
  }
}
