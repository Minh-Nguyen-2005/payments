-- One row per PAID order. Only the Stripe webhook (POST /api/webhook) ever writes here.
CREATE TABLE IF NOT EXISTS orders (
  session_id TEXT PRIMARY KEY,                -- Stripe's id for this purchase; a retried webhook can't add a second row
  name       TEXT NOT NULL,                   -- what the buyer typed; shown on the public board
  amount     INTEGER NOT NULL,                -- in cents, as Stripe reports it: 200 means $2.00
  currency   TEXT NOT NULL,                   -- 'usd'
  channel    TEXT NOT NULL DEFAULT 'checkout',-- 'checkout' (a person on Stripe's page) or 'agent' (an AI agent)
  created_at INTEGER NOT NULL                 -- when the webhook confirmed it, in milliseconds since 1970
);

-- The board asks for the newest 50 orders. This index lets the database read
-- just those 50 rows instead of the whole table on every poll.
CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at);
