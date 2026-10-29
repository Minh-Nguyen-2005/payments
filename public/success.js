// Anyone can type /success into the address bar, so this page proves nothing by itself.
// It asks our server whether Stripe's signed webhook has confirmed THIS purchase yet.
const proof = document.querySelector('#proof')
const sessionId = new URLSearchParams(location.search).get('session_id')

function show(state, text) {
  proof.dataset.state = state // styles the line: waiting, confirmed or none
  proof.textContent = text
}

if (!sessionId) {
  show('none', 'No purchase to check: this address was typed by hand. Nothing was recorded.')
} else {
  let tries = 0
  const check = async () => {
    try {
      const { paid, order } = await (await fetch(`/api/orders/${encodeURIComponent(sessionId)}`)).json()
      if (paid) return show('confirmed', `✓ Confirmed by Stripe's signed webhook: ${order.name} is in the front row.`)
    } catch {
      // A network blip: just try again.
    }
    if (++tries < 30) {
      // Say it once: screen readers would otherwise hear it again every second.
      if (tries === 1) show('waiting', "⏳ Waiting for Stripe's webhook… (the redirect alone proves nothing)")
      setTimeout(check, 1000)
    } else {
      show('none', 'No webhook after 30 seconds, so this purchase is not on the board. Running locally? Start `npm run listen`.')
    }
  }
  check()
}
