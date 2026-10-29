// The shop's logic: the Buy button and the front row. (decor.js only paints the scenery.)

// ---- Buy: ask OUR server for a Stripe Checkout page, then go there.
// The card number is typed on Stripe's page, never on ours.
const form = document.querySelector('#buy-form')
const nameInput = document.querySelector('#name')
const button = form.querySelector('button')
const status = document.querySelector('#status')

form.addEventListener('submit', async (event) => {
  event.preventDefault() // we send the request ourselves, as JSON
  button.disabled = true // one click, one Checkout Session
  status.textContent = 'Opening Stripe…'
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameInput.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.url) throw new Error(data.error || 'Something went wrong. Try again.')
    window.location.href = data.url // leave our site: Stripe's page takes the card
  } catch (err) {
    status.textContent = err.message
    button.disabled = false
  }
})

// Pressing Back on Stripe's page can bring this page back from the browser's cache exactly as we
// left it (button disabled, "Opening Stripe…"), so re-arm it when that happens.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return // a normal load: nothing to undo
  button.disabled = false
  status.textContent = ''
})

// ---- The front row: ask our server for the paid orders every 2 seconds and draw them.
// Names are typed by strangers, so they go in with textContent, never innerHTML.
const board = document.querySelector('#board')
const arrivals = document.querySelector('#arrivals')
let drawn = null // the orders already on the board (null until the first poll)

async function refreshBoard() {
  if (document.hidden) return // nobody's looking: don't spend the server's free quota
  try {
    const { orders } = await (await fetch('/api/orders')).json()
    // Anything we haven't drawn before just arrived, which means Stripe's webhook just landed.
    const fresh = drawn ? orders.filter((order) => !drawn.has(keyOf(order))) : []
    if (drawn && fresh.length === 0 && drawn.size === orders.length) return // nothing changed
    drawn = new Set(orders.map(keyOf))
    board.replaceChildren(...orders.map((order) => chipFor(order, fresh.includes(order))))
    if (fresh.length) arrivals.textContent = `✓ Webhook received: ${fresh.map((o) => o.name).join(', ')} just took a seat`
  } catch {
    // Offline for a moment: keep the last board and try again on the next tick.
  }
}

function keyOf(order) {
  return `${order.created_at}:${order.name}`
}

function chipFor(order, isNew) {
  const chip = document.createElement('li')
  chip.className = isNew ? 'chip is-new' : 'chip'
  chip.style.setProperty('--act', `var(--act-${order.created_at % 7})`) // one of the seven stage lights
  const name = document.createElement('span')
  name.textContent = (order.channel === 'agent' ? '🤖 ' : '') + order.name
  const amount = document.createElement('small')
  amount.textContent = `$${(order.amount / 100).toFixed(2)}` // Stripe counts cents: 200 is $2.00
  chip.append(name, amount)
  return chip
}

refreshBoard()
setInterval(refreshBoard, 2000)
document.addEventListener('visibilitychange', refreshBoard) // catch up as soon as the tab is back
