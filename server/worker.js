// QuickQuote billing — Cloudflare Worker. Stores ONLY {email → subscription status} in KV.
// Deploy: wrangler deploy (see README.md). Then set BILLING_URL in app.js.
// Bindings: KV namespace SUBS. Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID.

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/status') {
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      const status = email && await env.SUBS.get(email);
      return Response.json({ active: status === 'active' || status === 'trialing' }, { headers: CORS });
    }

    if (url.pathname === '/checkout' && req.method === 'POST') {
      const { email } = await req.json().catch(() => ({}));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
        return Response.json({ error: 'invalid email' }, { status: 400, headers: CORS });
      }
      const back = url.searchParams.get('back') || 'https://example.com';
      const body = new URLSearchParams({
        mode: 'subscription',
        customer_email: email,
        'line_items[0][price]': env.STRIPE_PRICE_ID,
        'line_items[0][quantity]': '1',
        'subscription_data[trial_period_days]': '14',
        success_url: back,
        cancel_url: back,
      });
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const s = await r.json();
      return Response.json({ url: s.url || null }, { headers: CORS });
    }

    if (url.pathname === '/webhook' && req.method === 'POST') {
      const payload = await req.text();
      if (!await verifySig(payload, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) {
        return new Response('bad signature', { status: 400 });
      }
      const ev = JSON.parse(payload);
      if (ev.type.startsWith('customer.subscription.')) {
        const sub = ev.data.object;
        const cust = await (await fetch(`https://api.stripe.com/v1/customers/${sub.customer}`, {
          headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        })).json();
        if (cust.email) await env.SUBS.put(cust.email.toLowerCase(), sub.status);
      }
      return new Response('ok');
    }

    return new Response('QuickQuote billing', { status: 404 });
  },
};

async function verifySig(payload, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === parts.v1; // ponytail: not constant-time; acceptable for this threat model
}
