# How the shop works, file by file

For a CS student who has never taken a payment. Read [README.md](README.md) first for the one-screen version.

## The idea in one picture: the restaurant buzzer

You order at a food-court counter and get a buzzer. You walk back to your table. **Walking back to your table doesn't mean your food is ready**: anyone can walk to a table. The food is ready when **the buzzer goes off**, and only the kitchen can make it buzz.

| Food court | This shop |
|---|---|
| Ordering at the counter | `POST /api/checkout`: our server asks Stripe for a Checkout Session |
| The kitchen's card reader | Stripe's hosted Checkout page, where the card number is typed (never on our site) |
| Walking back to your table | Stripe redirects the browser to `/success`. **Proves nothing.** |
| The buzzer going off | Stripe's **webhook**: an HTTP POST to `/api/webhook`, signed with a secret only Stripe and our server share |
| The kitchen's ticket rail | The `orders` table in D1. **Only the webhook writes to it.** |

## One purchase, step by step

1. **Click "Buy the look".** [public/app.js](public/app.js) POSTs `{ name }` to `/api/checkout`.
2. **Make a session.** [src/index.ts](src/index.ts) checks the name, then calls `stripe.checkout.sessions.create(...)` with the price **in cents** (`200` is $2.00), `metadata: { name }`, and the two URLs Stripe will send the buyer back to. Stripe answers with a session whose `url` is a page on `checkout.stripe.com`.
3. **Pay on Stripe's page.** The browser goes there (`window.location.href = data.url`). Our server never sees the card.
4. **Stripe tells our server.** Stripe POSTs `checkout.session.completed` to `/api/webhook`. We check the signature, then insert the order. The board, which polls `GET /api/orders` every 2 seconds, shows the name.
5. **The redirect.** Stripe sends the browser to `/success?session_id=cs_…`. That page *asks* the server whether the webhook has confirmed this session. It writes nothing.

With a real deployed endpoint, Stripe even **waits up to 10 seconds for your webhook** before redirecting, so the name often lands before the success page loads. With `stripe listen` on your laptop, the redirect happens straight away.

## The files

### [src/index.ts](src/index.ts): the whole server (a Cloudflare Worker running Hono)

- **`type Bindings`** lists what Cloudflare hands the code on every request: the `DB` database and two secrets.
- **`PRODUCT`** is the one thing we sell. Prices are in **cents**, so `200` means $2.00, not $200.
- **`POST /api/checkout`**
  - `cleanName` decides what a valid name is. The browser's `maxlength` is only a hint, and anyone can `curl` us.
  - We never pass `apiVersion`: the `stripe` package (v23) pins the API version it was written for, `2026-10-28.endive`.
  - `allowed_payment_method_types: ['card']` keeps the page simple for a class. The older `payment_method_types` no longer exists, and TypeScript rejects it.
  - `success_url` contains the literal text `{CHECKOUT_SESSION_ID}`, which Stripe replaces with the real ID.
  - Errors: a rate limit becomes **429** ("tap again"), anything else from Stripe becomes **502**, and the details go to our logs, not to the buyer.
- **`POST /api/webhook`**, the important one, numbered in the code:
  1. `c.req.text()`: the **raw** body. Stripe signed these exact bytes.
  2. `constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET)` recomputes the signature. If it doesn't match, the request didn't come from Stripe, and we answer **400**. It's *Async* because Workers' crypto is async; the plain `constructEvent` throws here.
  3. `checkout.session.completed` (and `async_payment_succeeded`, for slow payment methods): if `payment_status === 'paid'`, record the order.
  4. `payment_intent.succeeded` with `channel: 'agent'`: an AI agent paid (see below).
  5. Answer `{ received: true }` with status 200. Any other answer, including a crash, makes Stripe **retry** later.
- **`recordOrder`:** `INSERT OR IGNORE` and the `session_id` primary key make it **idempotent**. Stripe retries and can send the same event twice, and the second insert does nothing.
- **`GET /api/orders` and `GET /api/orders/:sessionId`:** read-only. The board and the success page use them.
- **`POST /api/agent-buy` and `GET /.well-known/ucp`:** the agentic-commerce demo (below).

### [schema.sql](schema.sql)

One table. `session_id` is the primary key, which is what makes duplicates impossible. `amount` is in cents, as Stripe reports it. The index on `created_at` lets the board read just the newest 50 rows.

### [wrangler.jsonc](wrangler.jsonc)

The Worker's settings:
- `assets` serves [public/](public/) as plain files. `/success` is just `success.html`, with no server code at all, so typing it by hand *can't* create an order.
- `d1_databases` connects the `DB` database.
- `observability` keeps our `console.log`s in the Cloudflare dashboard.

### [public/app.js](public/app.js) and [public/success.js](public/success.js)

- **The Buy button** disables itself while it waits, so one click makes one session. The `pageshow` handler re-enables it when someone presses Back on Stripe's page.
- **The board** draws names with **`textContent`, never `innerHTML`**. The names are typed by strangers, and `innerHTML` would let someone inject HTML into everyone's screen.
- **The success page** polls `GET /api/orders/:sessionId` for 30 seconds and changes from "⏳ waiting for Stripe's webhook" to "✓ Confirmed".

### The look (decoration only: nothing here touches payments)

[public/decor.js](public/decor.js) loads the scenery from our Fandemonium lab:
- `stage/runway.js` is the glitter runway and `stage/galaxy.js` the galaxy behind `/success`.
- `product/dress.js` draws the dress, in code.
- `stage/shimmer.js` and `stage/float.js` make the card a water surface: it catches the stage's own light, and its content rides the waves.

Everything holds still for anyone who turns on "reduce motion", and pauses in a hidden tab. If any of it fails, the shop still works on a plain dark background.

## Agentic commerce: [scripts/agent-buy.mjs](scripts/agent-buy.mjs)

An AI agent can't click "Pay" on a web page. `npm run agent` plays the agent in four steps:
1. **Discover** the shop by reading `/.well-known/ucp`, its menu for agents (simplified from the Universal Commerce Protocol).
2. **Get a permission slip**: a Shared Payment Token, valid only for *this* seller, up to *this* amount, for 10 minutes. In a sandbox, Stripe's test helper fakes the step where a real agent platform would make one from your saved card.
3. **Hand it to the shop.** `POST /api/agent-buy` charges it with a PaymentIntent. The SDK has no types for this preview feature yet, hence `rawRequest`.
4. **Wait for the board.** The order appears only when `payment_intent.succeeded` arrives at the *same* webhook. Agents don't get a shortcut around the proof.

Run `npm run agent -- http://localhost:8787 100` to give the agent a **$1.00** slip for a **$2.00** dress. Stripe refuses: *"The requested amount is greater than the remaining amount capturable with this shared payment granted token."*

## Break it on purpose (for the gotcha slide)

Do this on a branch, never in the main code. In `/api/webhook`, replace the first line with:

```ts
const body = JSON.stringify(await c.req.json()) // ❌ parsed, then turned back into text
```

Then buy something with `npm run listen` running. The webhook now answers 400, and the log shows *"No signatures found matching the expected signature for payload. Are you passing the raw request body you received from Stripe?"* Stripe sends **pretty-printed** JSON, and re-serializing removes the spaces and newlines, so the bytes no longer match the signature. (Sneaky: a compact test payload passes by accident.)

Two more ways to get the same kind of failure:
- **Use the sync version.** `stripe.webhooks.constructEvent(...)` throws *"SubtleCryptoProvider cannot be used in a synchronous context. Use `await constructEventAsync(...)`"*.
- **Use the wrong secret.** A stale `.dev.vars` (restart `wrangler dev`!), or the `stripe listen` secret on the deployed endpoint, gives exactly the "raw request body" message above, even though the body *is* raw. This is the gotcha that actually bit us.

## Testing checklist

- [ ] **Clean machine:** clone, `npm install`, `.dev.vars` from the example, `npm run db:local`, `npm run dev` and `npm run listen`, buy with 4242, and see the name.
- [ ] `stripe events resend <evt_id>` for the same event leaves **exactly one** row.
- [ ] Opening `/success` without paying creates **no** row.
- [ ] `curl -X POST localhost:8787/api/webhook -H 'stripe-signature: t=1,v1=bad' -d '{}'` returns **400**.
- [ ] `npm run agent` puts 🤖 on the board, and `npm run agent -- http://localhost:8787 100` is refused.

## Deploying (what we did)

Live at **https://fandemonium-shop.minh-t-nguyen-27.workers.dev**.

```sh
npx wrangler login
npx wrangler d1 create fandemonium-shop          # then put its database_id in wrangler.jsonc
npm run db:remote                                # the same schema, on the real database
npx wrangler deploy                              # prints https://fandemonium-shop.<you>.workers.dev
npx wrangler secret put STRIPE_SECRET_KEY        # paste your sk_test_ key
stripe webhook_endpoints create -d url=https://fandemonium-shop.<you>.workers.dev/api/webhook \
  -d "enabled_events[]=checkout.session.completed" -d "enabled_events[]=checkout.session.async_payment_succeeded" \
  -d "enabled_events[]=payment_intent.succeeded" -d api_version=2026-10-28.endive
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # the "secret" that create printed, NOT the stripe listen one
stripe payment_method_configurations list        # find the Default one (pmc_…), then turn Link off:
stripe payment_method_configurations update pmc_… -d "link[display_preference][preference]=off"
npx wrangler tail --format pretty                # watch the webhook logs live during class
```

Why turn Link off? Our rehearsal on a phone found Stripe's page with "Save my information with Link" already ticked, which makes a phone number required. Pay then fails with *"Phone number is required"*, a dead end for a classroom.

Rehearsed on the live site:
- **A clean browser at phone size** went from the shop, to Stripe, to paying with 4242, to `/success` saying "✓ Confirmed by Stripe's signed webhook", to its name on the board, in under 10 seconds.
- **The agent bought** through the deployed webhook.
- **30 simultaneous board polls and 15 simultaneous checkouts** all returned 200.

To take a name off the public board: `npx wrangler d1 execute fandemonium-shop --remote --command "DELETE FROM orders WHERE name = '…'"`.
