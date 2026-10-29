// Everything on the product card rides the same water as the glints (shimmer.js), gently enough
// that it can still be read and used: each letter of the card's words rises, falls and tips a
// little as a wave passes under it (big letters more, small ones less); the name field, the
// button and the status line ride as whole pieces; and the dress floats: its hem sits on the
// water, it bobs and rocks on a slow swell, the waves shift its picture in thin slices, and its
// reflection hangs upside down beneath it, fading and broken up by the ripples.
// Decoration only. At most 30 frames a second, asleep while the tab is hidden, and perfectly
// still for anyone who asks their system for less motion.
import { ROW, SWELL, swell } from './shimmer.js'

const RIDE = 1 / 190 // a letter rides this much of the waves' height per px of its font size
const BLOCK = 0.12 // how much of it the field, the button and the status line ride (under 1 px)
const SWAY = 0.15 // how much of it shifts the dress's slices sideways (about 1 px)
const WATERLINE = 0.84 // where the hem meets the water, as a share of the picture's height
const BOB = 1.6 // how far a third, slower swell (16.18 s) lifts the floating dress, in CSS px
const ROLL = 0.005 // how far it rocks about the waterline as the swell passes (about 0.3°)
const MIRROR = 0.3 // how strong its reflection is right under the waterline
const SLICE = 1 // the dress's slices, in CSS px

// The lowest row of a picture with something in it: the hem, where the dress meets the water.
function hemOf(canvas) {
  const { width, height } = canvas
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
  for (let y = height - 1; y > 0; y--) {
    for (let x = 0; x < width; x += 3) if (data[(y * width + x) * 4 + 3] > 40) return y
  }
  return height
}

// Wrap each letter of an element's text in a span the waves can move, keeping its markup (like
// <b>) around them. Letters sit in unbreakable words, so a line never breaks inside one, and a
// hidden copy of the text is what screen readers read.
function letters(el) {
  const spoken = el.textContent
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
      word.className = 'float-word'
      word.setAttribute('aria-hidden', 'true')
      for (const ch of part) {
        const span = document.createElement('span')
        span.className = 'float-letter'
        span.textContent = ch
        word.append(span)
        spans.push(span)
      }
      pieces.append(word)
    }
    node.replaceWith(pieces)
  }
  const copy = document.createElement('span')
  copy.className = 'visually-hidden'
  copy.textContent = spoken
  el.append(copy)
  return spans
}

export function mountFloat(card, { art, texts, blocks }) {
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  const spans = texts.flatMap(letters)
  let riders = [] // everything that rides: { el, x, y, lift } in the card's coordinates
  // The dress seen through the water: a copy laid over it, redrawn slice by slice. (The thank-you
  // card has no picture, only words.)
  const copy = art ? document.createElement('canvas') : null
  if (copy) {
    copy.className = 'float-art'
    copy.setAttribute('aria-hidden', 'true')
    card.append(copy)
  }
  const ctx = copy?.getContext('2d')
  let frame = 0
  let last = 0
  let artTop = 0 // where the dress starts, in the card's coordinates
  let hem = 0 // the hem's row in dress.js's picture (found once it has painted)
  let hemFound = 0 // when it was last looked for, in ms

  function measure() {
    const box = card.getBoundingClientRect()
    const place = (el, lift, tip) => {
      const r = el.getBoundingClientRect()
      return { el, x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, lift, tip }
    }
    riders = [
      ...spans.map((span) => place(span, RIDE * parseFloat(getComputedStyle(span).fontSize), 1)),
      ...blocks.map((el) => place(el, BLOCK, 0.4)), // wide pieces tip less: a small tilt shows at their ends
    ]
    if (!art) return
    const h = art.getBoundingClientRect()
    artTop = h.top - box.top
    Object.assign(copy.style, { left: `${h.left - box.left}px`, top: `${artTop}px`, width: `${h.width}px`, height: `${h.height}px` })
  }

  function draw(ms) {
    const t = ms / 1000
    // Each rider: up and down with the wave under it, tipped to the water's slope.
    for (const { el, x, y, lift, tip } of riders) {
      const k = Math.floor(y / ROW)
      const dy = -lift * swell(k, x, t)
      const tilt = Math.atan((-lift * tip * (swell(k, x + 4, t) - swell(k, x - 4, t))) / 8)
      el.style.transform = `translateY(${dy.toFixed(2)}px) rotate(${tilt.toFixed(4)}rad)`
    }
    if (!art) return
    // The dress. dress.js sizes its canvas when it paints, so the copy follows its size, and the
    // hem is looked for again until the picture has settled.
    const W = art.width
    const H = art.height
    if (copy.width !== W || copy.height !== H) {
      copy.width = W
      copy.height = H
      hemFound = 0
    }
    if (!hemFound || (ms - hemFound > 1500 && ms < 12000)) {
      hem = hemOf(art)
      hemFound = ms
    }
    const scale = W / art.clientWidth || 1
    const step = Math.max(1, Math.round(SLICE * scale))
    const s = Math.min(1, (H * WATERLINE) / hem) // small enough that its hem sits on the water
    const swellNow = (t / (SWELL * 1.618)) * Math.PI * 2 // a third, slower swell, so nothing moves in step
    const water = H * WATERLINE + BOB * Math.sin(swellNow) * scale // the waterline, rising and falling
    const top = water - hem * s
    const left = (W - W * s) / 2
    ctx.clearRect(0, 0, W, H)
    ctx.save()
    // It rocks a little about the waterline as the swell passes under it.
    ctx.translate(W / 2, water)
    ctx.rotate(ROLL * Math.sin(swellNow + 1.1))
    ctx.translate(-W / 2, -water)
    // Each thin slice shifted sideways by the waves passing at its height.
    for (let y = 0; y <= hem; y += step) {
      const cy = artTop + (top + y * s) / scale
      const dx = SWAY * swell(Math.floor(cy / ROW), cy * 2.3, t) * scale
      ctx.drawImage(art, 0, y, W, step, left + dx, top + y * s, W * s, step * s + 1)
    }
    // Its reflection: upside down under the waterline, fading with depth, broken up by ripples.
    const depth = Math.min(H - water, hem * s * 0.4)
    for (let i = 0; i < depth; i += step) {
      const from = hem - i / s // the row it mirrors, going back up the dress
      const cy = artTop + (water + i) / scale
      const dx = 3 * SWAY * swell(Math.floor(cy / ROW), cy * 3.1, t) * scale
      ctx.globalAlpha = MIRROR * (1 - i / depth) ** 1.6
      ctx.drawImage(art, 0, from, W, step / s, left + dx, water + i, W * s, step + 0.5)
    }
    ctx.restore()
  }

  function tick(ms) {
    frame = requestAnimationFrame(tick)
    if (ms - last < 33) return
    last = ms
    draw(ms)
  }

  function start() {
    cancelAnimationFrame(frame)
    card.classList.toggle('floating', !!art && !still.matches) // CSS swaps the dress for its copy
    if (still.matches) for (const { el } of riders) el.style.transform = ''
    else if (!document.hidden) frame = requestAnimationFrame(tick)
  }

  const resize = new ResizeObserver(() => {
    measure()
    start()
  })
  resize.observe(card)
  still.addEventListener('change', start)
  document.addEventListener('visibilitychange', start)

  return function stop() {
    cancelAnimationFrame(frame)
    resize.disconnect()
    still.removeEventListener('change', start)
    document.removeEventListener('visibilitychange', start)
    card.classList.remove('floating')
    copy?.remove()
  }
}
