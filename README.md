# CS52 Workshop: Payments (Stripe Checkout, webhooks, agentic commerce)

**Who:** Minh Nguyen + Cathy · **When:** week N

A one-dress "fashion shop" with a live front row: the redirect to the success page is **not** proof of payment; Stripe's **signed webhook** is. Built on the CS52 stack (a Cloudflare Worker with Hono, and D1). Explained file by file in [EXPLAINER.md](EXPLAINER.md), and the questions we practiced are in [ELI5.md](ELI5.md).

## What it is

Stripe rents you a cash register. **Checkout** is Stripe's hosted payment page: your server asks Stripe for a session, the buyer types their card on *Stripe's* page (never yours), and Stripe then sends your server a **webhook**, a signed HTTP POST that says "this was paid". In our stack it sits next to Better Auth (who you are) and the database (what you have): it's what you paid.

## When to reach for it

* You need to take money this week, without a card number ever touching your server (Stripe's page holds the form, so PCI is Stripe's problem).
* You want receipts, Apple/Google Pay, 3-D Secure, fraud checks and test cards for free, behind one redirect.
* Your order is simple: one cart, one payment, then fulfill it when the webhook arrives.

## When not to

* You need a checkout that is part of your own page, pixel for pixel: use Stripe Elements instead (more work, more control).
* You pay *other* sellers (a marketplace): that's Stripe Connect, a different product.
* You sell digital goods inside an iOS app: Apple's in-app purchase rules apply, not Stripe's.

## Try it (5 minutes, no install, no account, no key)

1. Open **https://fandemonium-shop.minh-t-nguyen-27.workers.dev** on a laptop or phone.
2. Type your name (everyone sees it) and press **Buy the look**.
3. On Stripe's page, pay with card `4242 4242 4242 4242`, any future date, any CVC, any ZIP. It's test mode: no real money.
4. Watch the **front row**: your name lands only when Stripe's signed webhook arrives. The success page says so too.
5. Bonus: open `/success` yourself, without paying. Nothing is recorded, which is the point.

## Demo

Everything is in this repo: [src/index.ts](src/index.ts) is the whole server (`POST /api/checkout`, `POST /api/webhook`, `GET /api/orders`, plus `POST /api/agent-buy` and `GET /.well-known/ucp` for agents). The pages are in [public/](public/). To run it yourself (Node 22+, a free Stripe account, and the [Stripe CLI](https://docs.stripe.com/stripe-cli)):

```sh
npm install
cp .dev.vars.example .dev.vars    # paste your sandbox sk_test_ key
npm run db:local                  # create the orders table
stripe listen --print-secret      # paste this whsec_ into .dev.vars too
npm run dev                       # http://localhost:8787
npm run listen                    # second terminal: forwards Stripe's webhooks
npm run agent                     # optional: an AI agent buys with a Shared Payment Token
```

## The gotcha

After a perfect test payment, **every real webhook was rejected**, with Stripe's error *"No signatures found matching the expected signature for payload. **Are you passing the raw request body** you received from Stripe?"* Our body *was* raw. The real cause was the **secret**: `wrangler dev` reads `.dev.vars` only when it starts, and ours had started before we pasted in `STRIPE_WEBHOOK_SECRET`, so it was checking signatures against a placeholder. **Fix: restart `wrangler dev` after any change to `.dev.vars`**, and remember that `stripe listen` and your deployed endpoint each have their **own** `whsec_`.

Our clean-machine rehearsal of the class activity caught a second one. On a phone, Stripe's page had **"Save my information with Link" already ticked**, so Pay failed with *"Phone number is required"*, even though we only allow cards. The fix is account-wide: turn Link off in the sandbox's payment method settings (`stripe payment_method_configurations update <pmc_id> -d "link[display_preference][preference]=off"`).

## Agentic commerce, in one breath

Agents can't click through a payment page, so new protocols let them buy directly. **ACP** (Stripe + OpenAI, Sept 2025) powered checkout inside ChatGPT. **UCP** (Google with Shopify, Etsy, Wayfair, Target and Walmart, Jan 2026) has shops publish a machine-readable menu at `/.well-known/ucp`. Both can pay with Stripe's **Shared Payment Token**: a permission slip that lets an agent charge one buyer's card for one seller, up to one amount, until it expires, without the seller ever seeing the card. `npm run agent` does exactly this in our sandbox, and the order still only counts once the webhook says so.

## Links

* [Stripe Checkout docs](https://docs.stripe.com/payments/checkout)
* [Stripe webhooks docs](https://docs.stripe.com/webhooks): signatures, retries, event types
* [The one good tutorial: webhook endpoints and fulfillment](https://dev.to/stripe/building-an-ecommerce-store-33-webhook-endpoints-and-fulfillment-260j)
* [The one good video: Stripe in 100 seconds (Fireship)](https://www.youtube.com/watch?v=7edR32QVp_A) (an older API, but the right mental model)
* [Stripe's page on UCP](https://docs.stripe.com/agentic-commerce/protocols/ucp), for the agent part

## Slides

TODO: the link to our shared deck.
