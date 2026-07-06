import { get, all, put, del } from './db.js';
import { openMeasure } from './measure.js';

// ponytail: paywall dormant until this points at the deployed server/worker.js URL
const BILLING_URL = null;

const DEFAULT_PRESETS = [
  { name: 'Interior paint', material: 0.50, labor: 1.50 },
  { name: 'Exterior paint', material: 0.60, labor: 2.00 },
  { name: 'Flooring (LVP)', material: 3.00, labor: 2.50 },
  { name: 'Drywall hang + finish', material: 0.60, labor: 1.90 },
  { name: 'Concrete slab', material: 4.00, labor: 4.50 },
  { name: 'Wood fence (face area)', material: 2.50, labor: 2.00 },
];

const app = document.querySelector('#app');
const $ = (s, el = app) => el.querySelector(s);
const $$ = (s, el = app) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID().slice(0, 8);
const money = n => (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const quoteTotal = q => q.items.reduce((t, i) => t + i.qty * i.rate, 0);
const getSettings = async () =>
  await get('kv', 'settings') ?? { business: { name: '', phone: '', email: '' }, logo: null, presets: DEFAULT_PRESETS };

// ---------- router ----------

async function render() {
  const [route, id] = location.hash.replace(/^#\/?/, '').split('/');
  $$('nav a', document).forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#/${route}` || (!route && a.getAttribute('href') === '#/')));
  if (route === 'clients') return viewClients();
  if (route === 'settings') return viewSettings();
  if (route === 'quote' && id) return viewQuote(id);
  if (route === 'print' && id) return viewPrint(id);
  return viewQuotes();
}

// ---------- quotes list ----------

async function viewQuotes() {
  const [quotes, clients] = await Promise.all([all('quotes'), all('clients')]);
  const cname = id => clients.find(c => c.id === id)?.name || 'No client';
  quotes.sort((a, b) => b.created - a.created);
  app.innerHTML = `
    <div class="row spread"><h2>Quotes</h2><button id="new">+ New quote</button></div>
    ${quotes.length ? '' : '<p class="muted">No quotes yet. Tap "New quote", snap a photo with an 8.5×11 sheet in frame, and price the job on the spot.</p>'}
    <ul class="cards">${quotes.map(q => `
      <li class="card row spread">
        <a href="#/quote/${q.id}" class="grow">
          <strong>${esc(cname(q.clientId))}</strong>
          <span class="muted">${new Date(q.created).toLocaleDateString()} · #${q.id}</span>
          <span class="total">${money(quoteTotal(q))}</span>
        </a>
        <button class="danger del" data-id="${q.id}">✕</button>
      </li>`).join('')}
    </ul>`;
  $('#new').onclick = async () => {
    const q = { id: uid(), clientId: null, created: Date.now(), measurements: [], items: [], notes: '' };
    await put('quotes', q);
    location.hash = `#/quote/${q.id}`;
  };
  $$('.del').forEach(b => b.onclick = async () => {
    if (confirm('Delete this quote?')) { await del('quotes', b.dataset.id); render(); }
  });
}

// ---------- quote editor ----------

async function viewQuote(id) {
  const q = await get('quotes', id);
  if (!q) { location.hash = ''; return; }
  const [clients, s] = await Promise.all([all('clients'), getSettings()]);
  const totalSqft = q.measurements.reduce((t, m) => t + m.sqft, 0);
  app.innerHTML = `
    <div class="row spread"><h2>Quote #${q.id}</h2><a class="button" href="#/print/${q.id}">Preview / PDF</a></div>
    <label>Client
      <select id="client">
        <option value="">— select client —</option>
        ${clients.map(c => `<option value="${c.id}" ${c.id === q.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </label>
    <p class="muted small">Angled photo? Use the rectangle reference (tap 4 corners of a sheet of paper on the surface). The line reference assumes a straight-on shot.</p>
    <section>
      <div class="row spread"><h3>Measured areas</h3><button id="measure">📷 Measure</button></div>
      <ul class="plain">${q.measurements.map((m, i) => `
        <li class="row spread"><span>${esc(m.label)} — <strong>${m.sqft.toFixed(1)} sq ft</strong>${m.cuts?.length ? ` <span class="muted small">(${m.cuts.length} cutout${m.cuts.length > 1 ? 's' : ''})</span>` : ''}</span>
        <button class="danger delm" data-i="${i}">✕</button></li>`).join('')}
      </ul>
      <p class="muted">${q.measurements.length ? `Total: ${totalSqft.toFixed(1)} sq ft` : 'No measurements yet.'}</p>
    </section>
    <section>
      <div class="row spread"><h3>Line items</h3>
        <span class="row">
          <select id="preset"><option value="">Add preset…</option>
            ${s.presets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}
          </select>
          <button id="additem">+ item</button>
        </span>
      </div>
      <table class="items">
        <thead><tr><th>Description</th><th>Qty (sq ft)</th><th>Rate $</th><th>Amount</th><th></th></tr></thead>
        <tbody>${q.items.map((it, i) => `
          <tr>
            <td><input data-i="${i}" data-k="desc" value="${esc(it.desc)}"></td>
            <td><input data-i="${i}" data-k="qty" type="number" step="any" inputmode="decimal" value="${it.qty}"></td>
            <td><input data-i="${i}" data-k="rate" type="number" step="any" inputmode="decimal" value="${it.rate}"></td>
            <td class="right">${money(it.qty * it.rate)}</td>
            <td><button class="danger deli" data-i="${i}">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="right big"><strong>Total: ${money(quoteTotal(q))}</strong></p>
    </section>
    <label>Notes / terms<textarea id="notes" rows="3">${esc(q.notes)}</textarea></label>`;

  const save = () => put('quotes', q);
  $('#client').onchange = e => { q.clientId = e.target.value || null; save(); };
  $('#notes').onchange = e => { q.notes = e.target.value; save(); };
  $('#measure').onclick = () => openMeasure(m => { if (m) { q.measurements.push(m); save().then(render); } });
  $('#preset').onchange = e => {
    const p = s.presets[+e.target.value];
    if (!p) return;
    const qty = +totalSqft.toFixed(1);
    q.items.push(
      { desc: `${p.name} — materials`, qty, rate: p.material },
      { desc: `${p.name} — labor`, qty, rate: p.labor },
    );
    save().then(render);
  };
  $('#additem').onclick = () => { q.items.push({ desc: '', qty: 1, rate: 0 }); save().then(render); };
  $$('tbody input').forEach(inp => inp.onchange = () => {
    const it = q.items[+inp.dataset.i];
    it[inp.dataset.k] = inp.dataset.k === 'desc' ? inp.value : +inp.value || 0;
    save().then(render);
  });
  $$('.deli').forEach(b => b.onclick = () => { q.items.splice(+b.dataset.i, 1); save().then(render); });
  $$('.delm').forEach(b => b.onclick = () => { q.measurements.splice(+b.dataset.i, 1); save().then(render); });
}

// ---------- print / PDF ----------

async function viewPrint(id) {
  const q = await get('quotes', id);
  if (!q) { location.hash = ''; return; }
  const [client, s] = await Promise.all([q.clientId ? get('clients', q.clientId) : null, getSettings()]);
  const logo = s.logo ? URL.createObjectURL(s.logo) : null;
  app.innerHTML = `
    <div class="no-print row spread">
      <a class="button" href="#/quote/${q.id}">← Back</a>
      <button id="pdf">🖨 Print / Save as PDF</button>
    </div>
    <div class="doc">
      <header class="row spread">
        <div>
          ${logo ? `<img class="logo" src="${logo}" alt="logo">` : ''}
          <h1>${esc(s.business.name || 'Your Business')}</h1>
          <p class="muted">${esc(s.business.phone)}${s.business.phone && s.business.email ? ' · ' : ''}${esc(s.business.email)}</p>
        </div>
        <div class="right">
          <h2>QUOTE</h2>
          <p>#${q.id}<br>${new Date(q.created).toLocaleDateString()}</p>
        </div>
      </header>
      <section>
        <h3>Prepared for</h3>
        <p>${client ? [client.name, client.address, client.phone, client.email].filter(Boolean).map(esc).join('<br>') : '—'}</p>
      </section>
      ${q.measurements.length ? `<section><h3>Measured areas</h3>
        <p>${q.measurements.map(m => `${esc(m.label)}: ${m.sqft.toFixed(1)} sq ft`).join(' · ')}</p></section>` : ''}
      <table class="items">
        <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
        <tbody>
          ${q.items.map(it => `<tr><td>${esc(it.desc)}</td><td class="right">${it.qty}</td><td class="right">${money(it.rate)}</td><td class="right">${money(it.qty * it.rate)}</td></tr>`).join('')}
          <tr class="total-row"><td colspan="3" class="right"><strong>Total</strong></td><td class="right"><strong>${money(quoteTotal(q))}</strong></td></tr>
        </tbody>
      </table>
      ${q.notes ? `<section><h3>Notes</h3><p>${esc(q.notes).replace(/\n/g, '<br>')}</p></section>` : ''}
    </div>`;
  $('#pdf').onclick = () => window.print();
}

// ---------- clients ----------

async function viewClients() {
  const clients = await all('clients');
  app.innerHTML = `
    <h2>Clients</h2>
    <form id="cform" class="card stack">
      <input name="name" placeholder="Name *" required>
      <input name="phone" placeholder="Phone">
      <input name="email" placeholder="Email" type="email">
      <input name="address" placeholder="Job address">
      <input type="hidden" name="id">
      <button>Save client</button>
    </form>
    <ul class="cards">${clients.map(c => `
      <li class="card row spread">
        <div><strong>${esc(c.name)}</strong><br><span class="muted">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</span></div>
        <span class="row"><button class="edit" data-id="${c.id}">Edit</button><button class="danger delc" data-id="${c.id}">✕</button></span>
      </li>`).join('')}
    </ul>`;
  $('#cform').onsubmit = async e => {
    e.preventDefault();
    const c = Object.fromEntries(new FormData(e.target));
    c.id = c.id || uid();
    await put('clients', c);
    render();
  };
  $$('.edit').forEach(b => b.onclick = () => {
    const c = clients.find(x => x.id === b.dataset.id);
    for (const [k, v] of Object.entries(c)) if ($(`#cform [name=${k}]`)) $(`#cform [name=${k}]`).value = v;
    $('#cform [name=name]').focus();
  });
  $$('.delc').forEach(b => b.onclick = async () => {
    if (confirm('Delete this client? Their quotes stay.')) { await del('clients', b.dataset.id); render(); }
  });
}

// ---------- settings ----------

async function viewSettings() {
  const s = await getSettings();
  app.innerHTML = `
    <h2>Settings</h2>
    <section>
      <h3>Your business (shown on quotes)</h3>
      <label>Business name<input id="b-name" value="${esc(s.business.name)}"></label>
      <label>Phone<input id="b-phone" value="${esc(s.business.phone)}"></label>
      <label>Email<input id="b-email" value="${esc(s.business.email)}"></label>
      <label>Logo ${s.logo ? '✓ saved' : ''}<input id="b-logo" type="file" accept="image/*"></label>
    </section>
    <section>
      <h3>Rate presets ($ per sq ft)</h3>
      <table class="items">
        <thead><tr><th>Trade</th><th>Material</th><th>Labor</th><th></th></tr></thead>
        <tbody>${s.presets.map((p, i) => `
          <tr>
            <td><input data-i="${i}" data-k="name" value="${esc(p.name)}"></td>
            <td><input data-i="${i}" data-k="material" type="number" step="any" inputmode="decimal" value="${p.material}"></td>
            <td><input data-i="${i}" data-k="labor" type="number" step="any" inputmode="decimal" value="${p.labor}"></td>
            <td><button class="danger delp" data-i="${i}">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button id="addp">+ preset</button>
    </section>
    <section>
      <h3>Backup</h3>
      <div class="row">
        <button id="export">Export backup</button>
        <label class="button">Import backup<input id="import" type="file" accept=".json" hidden></label>
      </div>
      <p class="muted small">All data lives on this device only. Export a backup file now and then.</p>
    </section>`;

  const save = () => put('kv', s, 'settings');
  ['name', 'phone', 'email'].forEach(k => $(`#b-${k}`).onchange = e => { s.business[k] = e.target.value; save(); });
  $('#b-logo').onchange = e => { if (e.target.files[0]) { s.logo = e.target.files[0]; save().then(render); } };
  $$('tbody input').forEach(inp => inp.onchange = () => {
    const p = s.presets[+inp.dataset.i];
    p[inp.dataset.k] = inp.dataset.k === 'name' ? inp.value : +inp.value || 0;
    save();
  });
  $$('.delp').forEach(b => b.onclick = () => { s.presets.splice(+b.dataset.i, 1); save().then(render); });
  $('#addp').onclick = () => { s.presets.push({ name: 'New trade', material: 0, labor: 0 }); save().then(render); };

  $('#export').onclick = async () => {
    const b64 = b => b ? new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }) : null;
    const quotes = [];
    for (const q of await all('quotes'))
      quotes.push({ ...q, measurements: await Promise.all(q.measurements.map(async m => ({ ...m, photo: await b64(m.photo) }))) });
    const data = { clients: await all('clients'), quotes, settings: { ...s, logo: await b64(s.logo) } };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `quickquote-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $('#import').onchange = async e => {
    const f = e.target.files[0];
    if (!f || !confirm('Import merges the backup into current data. Continue?')) return;
    const data = JSON.parse(await f.text());
    const toBlob = async d => d ? await (await fetch(d)).blob() : null;
    for (const c of data.clients || []) await put('clients', c);
    for (const q of data.quotes || []) {
      for (const m of q.measurements || []) m.photo = await toBlob(m.photo);
      await put('quotes', q);
    }
    if (data.settings) {
      data.settings.logo = await toBlob(data.settings.logo);
      await put('kv', data.settings, 'settings');
    }
    alert('Imported.');
    render();
  };
}

// ---------- billing gate (dormant while BILLING_URL is null) ----------

async function licensed() {
  const lic = await get('kv', 'license') || {};
  if (lic.email && navigator.onLine) {
    try {
      const r = await fetch(`${BILLING_URL}/status?email=${encodeURIComponent(lic.email)}`);
      lic.active = (await r.json()).active;
      await put('kv', lic, 'license');
    } catch { /* offline or server down: keep cached entitlement */ }
  }
  return !!lic.active;
}

function renderPaywall() {
  app.innerHTML = `
    <div class="card stack center">
      <h2>QuickQuote</h2>
      <p>Measure from a photo, quote on the spot. 14-day free trial, then subscription.</p>
      <input id="pw-email" type="email" placeholder="you@yourbusiness.com">
      <button id="pw-sub">Start free trial</button>
      <button id="pw-refresh">Already subscribed — check again</button>
    </div>`;
  const email = () => $('#pw-email').value.trim();
  $('#pw-sub').onclick = async () => {
    if (!email()) return alert('Enter your email first.');
    await put('kv', { email: email(), active: false }, 'license');
    try {
      const r = await fetch(`${BILLING_URL}/checkout?back=${encodeURIComponent(location.href)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email() }),
      });
      const j = await r.json();
      if (j.url) location.href = j.url; else alert('Could not start checkout.');
    } catch { alert('You appear to be offline.'); }
  };
  $('#pw-refresh').onclick = async () => {
    if (email()) await put('kv', { email: email(), active: false }, 'license');
    main();
  };
}

// ---------- boot ----------

async function main() {
  if (BILLING_URL && !(await licensed())) return renderPaywall();
  render();
}

window.addEventListener('hashchange', render);
main();
