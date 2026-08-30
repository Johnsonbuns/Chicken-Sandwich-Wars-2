'use strict';
/**
 * POST /api/submit — the only path from a form to the database.
 *
 * Runs as a Vercel Node Function. No dependencies, because vercel.json has no install
 * step and node_modules does not exist on the build box: Supabase is reached over
 * PostgREST with global fetch.
 *
 * The service-role key bypasses RLS, which is exactly why it lives here and nowhere
 * else. It is read from the environment inside the function and never sent to a browser.
 * The intake schema is not exposed to PostgREST at all, so this is the only door.
 */

const FORMS = {
  'newsletter':    'newsletter',
  'contact':       'contact',
  'sell-property': 'sell_property',
  'buy-property':  'buy_criteria',
  'submit-deal':   'submit_deal'
};

const MAX_BYTES  = 32 * 1024;   // a generous ceiling for a contact form
const MAX_FIELDS = 40;
const MAX_VALUE  = 8000;
const RATE_LIMIT = 8;           // submissions per IP hash per hour

const crypto = require('crypto');

const url = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function pg(path, init = {}) {
  const r = await fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'intake',
      'Content-Profile': 'intake',
      ...(init.headers || {})
    }
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/* The raw address is never stored. The salt makes the hash useless outside this app. */
const hashIp = (req) => {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || '';
  if (!ip) return null;
  return crypto.createHash('sha256')
    .update((process.env.CSW_IP_SALT || 'csw-default-salt') + ip).digest('hex').slice(0, 32);
};

const str = (v) => (v == null ? null : String(v).slice(0, MAX_VALUE).trim() || null);
const money = (v) => {
  if (!v) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* Best-effort notification. A database nobody checks is worse than the mailto: it
   replaced, so a submission that lands but never reaches a human is a failure even
   when the insert succeeded. Never throws — the lead is already safely stored. */
async function notify(form, payload, id) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CSW_NOTIFY_EMAIL;
  if (!apiKey || !to) return 'not configured';
  try {
    const lines = Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join('\n');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.CSW_NOTIFY_FROM || 'CSW <desk@chickensandwichwars.com>',
        to: [to],
        subject: `CSW ${form}: ${payload.name || payload.email || 'new submission'}`,
        text: `${lines}\n\nsubmission ${id}`
      })
    });
    return r.ok ? 'sent' : `failed ${r.status}`;
  } catch (e) { return `failed ${e.message}`; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Use POST.' });
  }
  if (!url() || !key()) {
    // Misconfiguration must not look like success: the client falls back to mailto:.
    return res.status(503).json({ ok: false, error: 'Submissions are not configured.' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  const form = FORMS[String(body.form || '')];
  if (!form) return res.status(400).json({ ok: false, error: 'Unknown form.' });

  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  // Honeypot: a real browser leaves it empty because it is hidden.
  if (str(fields.website)) return res.status(200).json({ ok: true, id: null });
  delete fields.website;

  const entries = Object.entries(fields).slice(0, MAX_FIELDS);
  const payload = {};
  for (const [k, v] of entries) { const s = str(v); if (s) payload[k] = s; }

  const email = payload.email ? payload.email.toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ ok: false, error: 'That email address does not look right.' });
  if (form === 'newsletter' && !email)
    return res.status(400).json({ ok: false, error: 'An email address is required.' });

  const ip_hash = hashIp(req);

  try {
    if (ip_hash) {
      const since = new Date(Date.now() - 3600e3).toISOString();
      const recent = await pg(
        `submissions?select=id&ip_hash=eq.${ip_hash}&created_at=gte.${since}&limit=${RATE_LIMIT + 1}`);
      if (recent.length > RATE_LIMIT)
        return res.status(429).json({ ok: false, error: 'Too many submissions. Try again shortly.' });
    }

    /* Contact, upserted on email. Consent is per purpose: submitting a valuation
       request is not permission to send the newsletter. */
    let contactId = null;
    if (email) {
      const wantsMarketing = form === 'newsletter';
      const [c] = await pg('contacts?on_conflict=email', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{
          email,
          first_name: payload.first_name || null,
          last_name: payload.last_name || null,
          full_name: payload.name || null,
          phone: payload.phone || null,
          company: payload.company || null,
          role: payload.role || null,
          ...(wantsMarketing
            ? { marketing_consent: true, consent_at: new Date().toISOString(), consent_source: form }
            : {}),
          last_seen_at: new Date().toISOString()
        }])
      });
      contactId = c && c.id;
    }

    const [sub] = await pg('submissions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        form, contact_id: contactId, payload,
        ip_hash, user_agent: str(req.headers['user-agent']),
        referer: str(req.headers.referer),
        utm: body.utm && typeof body.utm === 'object' ? body.utm : null
      }])
    });

    /* Typed projection: jsonb alone cannot be indexed for matching buyers to listings. */
    if (form === 'buy_criteria') {
      await pg('buy_criteria', {
        method: 'POST',
        body: JSON.stringify([{
          submission_id: sub.id, contact_id: contactId,
          brands_label: payload.brands || null,
          price_min_usd: money((payload.price_range || '').split(/[-–—]/)[0]),
          price_max_usd: money((payload.price_range || '').split(/[-–—]/)[1]),
          cap_rate_min_pct: payload.cap_rate ? Number(String(payload.cap_rate).replace(/[^0-9.]/g, '')) || null : null,
          geographies: payload.geography ? [payload.geography] : null,
          deadline_1031: /^\d{4}-\d{2}-\d{2}$/.test(payload.deadline_1031 || '') ? payload.deadline_1031 : null,
          capital_structure: payload.capital || null,
          asset_interests: payload.interests ? [payload.interests] : null
        }])
      });
    }

    /* Double opt-in from the first row: pending until the reader confirms. */
    if (form === 'newsletter' && contactId) {
      await pg('subscriptions?on_conflict=contact_id,list_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([{
          contact_id: contactId, list_key: 'chicken-wire', status: 'pending',
          confirm_token: crypto.randomBytes(24).toString('hex')
        }])
      });
    }

    const delivery = await notify(form, payload, sub.id);
    return res.status(200).json({
      ok: true, id: sub.id,
      pending: form === 'newsletter',
      notified: delivery === 'sent'
    });
  } catch (e) {
    console.error('submit failed:', e.message);
    return res.status(502).json({ ok: false, error: 'Could not record the submission.' });
  }
};
