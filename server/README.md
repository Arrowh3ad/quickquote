# QuickQuote billing worker

Stores only `{email → Stripe subscription status}`. No app data ever touches it.

## Deploy (once, ~10 min)

1. Stripe dashboard: create a recurring Price ($19–39/mo). Copy the `price_...` id.
2. `npm i -g wrangler && wrangler login`
3. `wrangler kv namespace create SUBS` → put the binding in `wrangler.toml`:

   ```toml
   name = "quickquote-billing"
   main = "worker.js"
   compatibility_date = "2026-07-01"
   [[kv_namespaces]]
   binding = "SUBS"
   id = "<from step 3>"
   ```

4. Secrets:
   ```
   wrangler secret put STRIPE_SECRET_KEY
   wrangler secret put STRIPE_PRICE_ID
   wrangler secret put STRIPE_WEBHOOK_SECRET   # from step 6
   ```
5. `wrangler deploy` → note the URL.
6. Stripe dashboard → Webhooks → add endpoint `<worker-url>/webhook`, events: `customer.subscription.*`. Copy the signing secret into step 4.
7. Set `BILLING_URL = '<worker-url>'` in `app.js`. Paywall is live.
