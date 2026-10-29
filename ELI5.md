# ELI5 practice notes (for Minh and Cathy)

Things that might confuse *us* while presenting. Each answer is short enough to say out loud. Practice by covering the answer and saying it yourself.

## The core idea

**Why isn't landing on `/success` proof that someone paid?**
Because it's just a web address. Anyone can type `/success` into the browser, the same way anyone can walk to a table in a food court. Proof has to come from Stripe, not from the browser.

**So what *is* the proof?**
The webhook: Stripe's server calling *our* server directly ("this session was paid"), signed with a secret only Stripe and we know. That's the restaurant buzzer: only the kitchen can make it go off.

**What's a webhook, in one sentence?**
An HTTP POST that *another* company's server sends to *your* server when something happens, so you don't have to keep asking.

**Why does the board take a second or two?**
Two reasons: the board checks the server every 2 seconds, and the webhook takes about a second to arrive after paying.

**Why did the name sometimes appear *before* the success page loaded?**
With a deployed webhook endpoint, Stripe waits up to 10 seconds for our webhook to answer before it redirects the buyer. The proof often arrives first, which makes the point for us.

## The code words

| Word | Say it like this |
|---|---|
| Checkout Session | "A one-time payment page Stripe makes for us. Our server asks for one and gets back a URL." |
| `sk_test_…` | "Our secret API key. Server only, never in the browser, never in git." |
| `whsec_…` | "The webhook signing secret, used only to check that a webhook really came from Stripe. Different from the API key." |
| Signature / `stripe-signature` | "A fingerprint of the exact bytes Stripe sent, made with the shared secret. Change one byte and it doesn't match." |
| Raw body | "The request exactly as it arrived. Parsing the JSON and turning it back into text changes the bytes, and the fingerprint breaks." |
| `constructEventAsync` | "Stripe's 'check the fingerprint' function. It's async on Workers because their crypto is async." |
| Idempotent | "Doing it twice has the same effect as doing it once. Stripe can deliver an event twice, so saving it twice must not double-count." |
| `INSERT OR IGNORE` | "Insert the row unless one with this session ID already exists; then quietly do nothing. That's how we're idempotent." |
| Cents | "Stripe counts money in the smallest unit. `200` is $2.00. Write `20` and you charge 20 cents." |
| Test mode / sandbox | "A practice copy of Stripe. Test cards work, and no real money moves." |
| `stripe listen` | "The Stripe CLI forwarding webhooks to our laptop, because Stripe can't reach `localhost`. It has its *own* `whsec_`." |
| Worker / D1 / Hono | "Cloudflare runs our server code (the Worker), D1 is its SQLite database, and Hono is the small router mapping URLs to functions." |

## Agentic commerce

**Why can't an AI agent just use Checkout?**
Checkout is a page for a human with a browser. An agent needs an API to buy through, and a way to pay without holding your card number.

**ACP vs UCP?**
- **ACP:** Stripe and OpenAI, launched September 2025. It powered buying inside ChatGPT.
- **UCP:** Google with Shopify, Etsy, Wayfair, Target and Walmart, January 2026. Each shop publishes a machine-readable menu at `/.well-known/ucp`, and Stripe can be its payment handler.
- **The difference:** both are open standards for the same job. ACP came from two companies; UCP has a bigger coalition.

**What's a Shared Payment Token?**
A permission slip. The buyer's agent asks Stripe for a token that can charge their card for **one seller**, **up to one amount**, **until it expires**. The *seller* never sees the card. In our demo, a $1.00 slip can't pay for a $2.00 dress.

**Is the agent part real?**
The payment is real (in test mode), and so is the webhook. Two parts are simulated, and we should say so:
- **The token:** in a sandbox, Stripe's test helper stands in for the agent's own Stripe account.
- **The UCP menu:** ours is simplified. A full UCP shop also lists its checkout endpoints.

**Claude Duet?**
It's real: Anthropic launched it on 2026-10-21 as a research preview. It's an assistant for small-business owners, not a shopper, and it can pay through Stripe Link with a one-time card limited to one merchant and one amount. Don't say it uses Shared Payment Tokens or UCP.

## Questions the class might ask

- **"Is this real money?"** No: test mode. The card `4242…` only works there.
- **"What if our server is down when Stripe calls?"** Stripe retries automatically, for up to 3 days in live mode (a sandbox retries a few times over a few hours). That's why we answer 500 when saving fails: it means "try again later".
- **"Can someone fake a webhook?"** Not without the `whsec_` secret. Their signature won't match, and we answer 400.
- **"Why not save the order on the success page?"** Because anyone can open it, and a buyer might close the tab before it loads. Then you'd lose a real, paid order.
- **"What about sales tax?"** Stripe Tax: one setting, `automatic_tax: { enabled: true }`. It's a paid add-on.
- **"Going live?"** Swap in live keys, create a live webhook endpoint with its *own* `whsec_`, and activate the account.
- **"Alternatives?"** PayPal, Square, Paddle, Lemon Squeezy. Paddle and Lemon Squeezy also handle sales tax for you.
- **"Why two secrets?"** The API key lets *us* call Stripe. The webhook secret lets us *check* calls that come *from* Stripe.

## If something goes wrong on stage

| What you see | What to do |
|---|---|
| The board never updates after paying | The webhook isn't arriving or is rejected. Locally: is `npm run listen` running? Did you restart `npm run dev` after editing `.dev.vars`? Deployed: run `npx wrangler tail` and look for `rejected webhook`. Recovery line: "and *this* is exactly why the redirect isn't proof." |
| "Wrangler requires at least Node.js v22" | The terminal found the old Node. Run `export PATH="/opt/homebrew/bin:$PATH"`. |
| The Buy button says "Busy! Tap Buy again" | Stripe's sandbox allows 25 requests a second. Wait a second and tap again. |
| A rude name on the board | `npx wrangler d1 execute fandemonium-shop --remote --command "DELETE FROM orders WHERE name = '…'"` |
| Stripe's page shows a different shop name | You're in a different sandbox. Use the Fandemonium sandbox. |
| Pay fails with "Phone number is required" | Link got switched back on. Untick "Save my information with Link", or turn Link off again (EXPLAINER, "Deploying"). |

## The 12-minute run of show

| Time | Who | Beat |
|---|---|---|
| 0:00–2:30 | Cathy | ELI5 and where Stripe fits in the stack. End on the question: "anyone can type `/success`. So how do we *know*?" |
| 2:30–3:15 | Minh | Buy the dress live, pay with 4242, and watch the front row light up |
| 3:15–3:45 | Minh | Type `/success` by hand: "nothing was recorded" |
| 3:45–5:15 | Minh + Cathy | The three routes, then the webhook code line by line: raw body, signature, secret, verify, save once |
| 5:15–6:00 | Minh | `npm run agent`: 🤖 joins. Then a $1.00 slip: refused. |
| 6:00–10:00 | Everyone | The class activity (README, "Try it") |
| 10:00–11:00 | Minh | The gotcha |
| 11:00–12:00 | Cathy | When to reach for it, when not to, and links |

That leaves 3 minutes of buffer for questions and slow Wi-Fi.
