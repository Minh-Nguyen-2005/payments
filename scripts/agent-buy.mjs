// A pretend AI shopping agent, to show agentic commerce end to end:
//   1. discover the shop: its UCP profile at /.well-known/ucp
//   2. get a permission slip: a Shared Payment Token for this seller, up to a limit, for 10 minutes
//   3. ask the shop to charge it: the shop makes a PaymentIntent with the token
//   4. wait for the board: the order appears only when Stripe's signed webhook arrives
//
// Usage:  npm run agent                                 (local shop, $2.00 limit: succeeds)
//         npm run agent -- http://localhost:8787 100    ($1.00 limit: Stripe refuses)
//         npm run agent -- https://<your-worker>.workers.dev
//
// In real life the AGENT's own Stripe account makes the token from the shopper's saved card.
// In a sandbox we fake that step with Stripe's test helper, using our test key from .dev.vars.
import fs from 'node:fs'

const shop = process.argv[2] ?? 'http://localhost:8787'
const limitCents = Number(process.argv[3] ?? 200)
const key =
  process.env.STRIPE_SECRET_KEY ??
  fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1].trim()
if (!/^(sk|rk)_test_/.test(key ?? '')) throw new Error('Needs a TEST key: STRIPE_SECRET_KEY=sk_test_… in .dev.vars')

// 1. Discover: what does this shop accept?
const profile = await (await fetch(`${shop}/.well-known/ucp`)).json()
console.log(`1. The shop speaks UCP ${profile.ucp.version} and takes: ${Object.keys(profile.ucp.payment_handlers).join(', ')}`)

// 2. Permission slip (sandbox test helper; Shared Payment Tokens are a Stripe preview)
const slip = await (
  await fetch('https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': '2026-09-30.preview' },
    body: new URLSearchParams({
      payment_method: 'pm_card_visa',
      'usage_limits[currency]': 'usd',
      'usage_limits[max_amount]': String(limitCents),
      'usage_limits[expires_at]': String(Math.floor(Date.now() / 1000) + 600),
    }),
  })
).json()
if (!slip.id) throw new Error(slip.error?.message ?? 'No token')
console.log(`2. Permission slip ${slip.id.slice(0, 14)}…: this seller only, up to $${(limitCents / 100).toFixed(2)}, for 10 minutes`)

// 3. Buy: hand the slip to the shop
const res = await fetch(`${shop}/api/agent-buy`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Claude (AI agent)', spt: slip.id }),
})
const result = await res.json()
if (!res.ok) {
  console.log(`3. ✗ Refused: ${result.error}`)
  process.exit(1)
}
console.log(`3. The shop charged it: ${result.id.slice(0, 14)}… is ${result.status}`)

// 4. Proof: only the webhook puts it on the board
for (let i = 0; i < 30; i++) {
  const { paid } = await (await fetch(`${shop}/api/orders/${result.id}`)).json()
  if (paid) {
    console.log("4. ✓ On the board: Stripe's signed webhook confirmed it")
    process.exit(0)
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
console.log('4. No webhook after 30 seconds. Running locally? Start `npm run listen`.')
