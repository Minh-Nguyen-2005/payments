import { Hono } from 'hono'
import Stripe from 'stripe'

// What Cloudflare hands our code on every request (configured in wrangler.jsonc and .dev.vars).
type Bindings = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
}

// The one thing this shop sells. Stripe counts money in cents: 200 means $2.00.
const PRODUCT = {
  name: 'The Strawberry Slip Dress',
  description: 'Sheer blush organza over a satin slip, scattered with tiny strawberries and crystals. Very 2003.',
  priceCents: 200,
}

const app = new Hono<{ Bindings: Bindings }>()

// A heartbeat route: proves the Worker runs before we add Stripe or a database.
app.get('/api/health', (c) => c.json({ ok: true }))

// The Buy button: ask Stripe for a hosted payment page and send back its address.
app.post('/api/checkout', async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  const name = cleanName(body?.name)
  if (!name) return c.json({ error: 'Type a name between 1 and 30 characters.' }, 400)

  const origin = new URL(c.req.url).origin
  try {
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: PRODUCT.priceCents,
            product_data: {
              name: PRODUCT.name,
              description: PRODUCT.description,
              // Stripe's page can only show a picture it can reach, so there's none on localhost.
              images: origin.startsWith('https://') ? [`${origin}/product/strawberry-slip.png`] : undefined,
            },
          },
        },
      ],
      allowed_payment_method_types: ['card'], // only the card form: one less thing to explain in class
      metadata: { name }, // Stripe hands this back to us in the webhook
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`, // Stripe fills in the id
      cancel_url: `${origin}/`,
    })
    return c.json({ url: session.url })
  } catch (err) {
    // The details go to our logs; the buyer gets a short, safe message.
    console.error('checkout failed:', err instanceof Error ? err.message : err)
    if (err instanceof Stripe.errors.StripeRateLimitError) {
      return c.json({ error: 'Busy! Tap Buy again in a second.' }, 429)
    }
    return c.json({ error: 'Stripe is unavailable right now. Try again.' }, 502)
  }
})

// Stripe calls this after every payment. It is the ONLY code that records an order.
app.post('/api/webhook', async (c) => {
  // 1. The raw text, exactly as Stripe sent it. The signature covers these bytes,
  //    so parsing the JSON first (and turning it back into text) would break the check.
  const body = await c.req.text()
  const signature = c.req.header('stripe-signature')
  if (!signature) return c.text('Missing stripe-signature header', 400)

  // 2. Prove Stripe sent it: only Stripe and this server know the webhook secret.
  //    Workers' crypto is async, so it's constructEventAsync (plain constructEvent throws here).
  let event: Stripe.Event
  try {
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
    event = await stripe.webhooks.constructEventAsync(body, signature, c.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.warn('rejected webhook:', err instanceof Error ? err.message : err)
    return c.text('Bad signature', 400)
  }
  console.log('webhook:', event.type, event.id)

  // 3. A person paid on Stripe's Checkout page. Cards are paid at once; slower methods report back later.
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object
    if (session.payment_status === 'paid') {
      await recordOrder(c.env.DB, session.id, session.metadata?.name, session.amount_total, session.currency, 'checkout')
    }
  }

  // 4. An AI agent paid with a Shared Payment Token (see /api/agent-buy below).
  if (event.type === 'payment_intent.succeeded' && event.data.object.metadata.channel === 'agent') {
    const intent = event.data.object
    await recordOrder(c.env.DB, intent.id, intent.metadata.name, intent.amount_received, intent.currency, 'agent')
  }

  // 5. "Got it." Any other answer, including a crash above, makes Stripe try again later.
  return c.json({ received: true })
})

// The public board: the newest 50 paid orders. Nothing here writes; only the webhook does.
app.get('/api/orders', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT name, amount, currency, channel, created_at FROM orders ORDER BY created_at DESC LIMIT 50',
  ).all()
  return c.json({ orders: results })
})

// The success page asks: "has Stripe's webhook confirmed THIS purchase yet?"
app.get('/api/orders/:sessionId', async (c) => {
  const order = await c.env.DB.prepare('SELECT name, amount, currency, created_at FROM orders WHERE session_id = ?')
    .bind(c.req.param('sessionId'))
    .first()
  return c.json(order ? { paid: true, order } : { paid: false })
})

// An AI agent buys without a browser. Instead of a card typed on Stripe's page, it hands us a
// Shared Payment Token: a permission slip to charge a card for THIS seller, up to a limit, for a short time.
app.post('/api/agent-buy', async (c) => {
  const body = await c.req.json<{ name?: unknown; spt?: unknown }>().catch(() => null)
  const name = cleanName(body?.name)
  const spt = typeof body?.spt === 'string' && body.spt.startsWith('spt_') ? body.spt : ''
  if (!name || !spt) return c.json({ error: 'Send { name, spt } with a 1-30 character name.' }, 400)

  try {
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
    // Shared Payment Tokens are a Stripe preview, not in the SDK's types yet, hence the raw request.
    const intent = await stripe.rawRequest(
      'POST',
      '/v1/payment_intents',
      {
        amount: PRODUCT.priceCents,
        currency: 'usd',
        confirm: true,
        payment_method_data: { shared_payment_granted_token: spt },
        metadata: { name, channel: 'agent' },
      },
      { apiVersion: '2026-09-30.preview' },
    )
    // No order is written here: like every purchase, it reaches the board only through the signed webhook.
    return c.json({ id: intent.id, status: intent.status })
  } catch (err) {
    console.warn('agent purchase refused:', err instanceof Error ? err.message : err)
    // Tell the agent why Stripe said no (say, the slip's limit is too low), but nothing about our setup.
    if (err instanceof Stripe.errors.StripeCardError || err instanceof Stripe.errors.StripeInvalidRequestError) {
      return c.json({ error: err.message }, 402)
    }
    if (err instanceof Stripe.errors.StripeRateLimitError) return c.json({ error: 'Busy! Try again in a second.' }, 429)
    return c.json({ error: 'Stripe is unavailable right now. Try again.' }, 502)
  }
})

// UCP discovery: the shop's machine-readable "menu" for AI agents (the Universal Commerce Protocol).
// Simplified for class: a full UCP shop also lists its checkout endpoints under "services".
app.get('/.well-known/ucp', (c) => {
  c.header('Cache-Control', 'public, max-age=60')
  return c.json({
    ucp: {
      version: '2026-08-25',
      services: {},
      capabilities: {},
      payment_handlers: {
        'com.stripe.payments': [
          {
            id: 'stripe_payments',
            version: '2026-06-25',
            spec: 'https://docs.stripe.com/agentic-commerce/protocols/ucp/stripe-payments-handler',
            schema: 'https://ucp.stripe.com/payments/2026-06-25/schema.json',
            available_instruments: [{ type: 'card' }],
            config: { environment: 'testmode' },
          },
        ],
      },
    },
  })
})

// Names are typed by strangers and shown in public: squeeze the spaces, then allow 1-30 characters.
function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return name.length >= 1 && name.length <= 30 ? name : ''
}

// The session_id PRIMARY KEY + INSERT OR IGNORE: when Stripe delivers the same payment twice
// (it retries, and can send duplicates), the second insert quietly does nothing.
async function recordOrder(
  db: D1Database,
  id: string,
  name: string | undefined,
  amount: number | null,
  currency: string | null,
  channel: 'checkout' | 'agent',
) {
  await db
    .prepare('INSERT OR IGNORE INTO orders (session_id, name, amount, currency, channel, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name || 'Anonymous', amount ?? 0, currency ?? 'usd', channel, Date.now())
    .run()
}

export default app
