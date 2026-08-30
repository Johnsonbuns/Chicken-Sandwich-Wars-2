'use strict';
/**
 * Handler tests for api/submit.js.
 *
 *   node scripts/check-api.js
 *
 * Stubs global fetch, so this runs with no credentials and never touches Supabase. It
 * checks the things that would be expensive to get wrong: that the endpoint refuses
 * what it should, that a raw IP address is never written, and that submitting a
 * valuation request does not quietly opt someone into the newsletter.
 */
const handler = require('../api/submit.js');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.CSW_IP_SALT = 'salt';

let calls = [];
let rateLimited = false;
global.fetch = async (url, init) => {
  calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null,
               profile: init.headers['Content-Profile'] });
  if (url.includes('submissions?select=id'))
    return { ok: true, status: 200, json: async () => rateLimited ? new Array(20).fill({ id: 'x' }) : [] };
  if (url.includes('/contacts')) return { ok: true, status: 200, json: async () => [{ id: 'c-1' }] };
  if (url.includes('/submissions')) return { ok: true, status: 200, json: async () => [{ id: 's-1' }] };
  return { ok: true, status: 204, json: async () => null, text: async () => '' };
};

function mkReq(method, body, headers = {}) {
  return { method, body, headers: { 'user-agent': 'test', 'x-forwarded-for': '203.0.113.9', ...headers }, socket: {} };
}
function mkRes() {
  const r = { code: 0, payload: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (p) => { r.payload = p; return r; };
  return r;
}
const run = async (name, req, expect) => {
  calls = [];
  const res = mkRes();
  await handler(req, res);
  const pass = expect(res, calls);
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}  -> ${res.code} ${JSON.stringify(res.payload).slice(0, 70)}`);
  return pass;
};

(async () => {
  let all = true;
  all &= await run('GET is rejected', mkReq('GET', {}), (r) => r.code === 405);
  all &= await run('unknown form is rejected', mkReq('POST', { form: 'evil', fields: {} }), (r) => r.code === 400);
  all &= await run('honeypot silently accepted, nothing written',
    mkReq('POST', { form: 'contact', fields: { website: 'http://spam', email: 'a@b.co' } }),
    (r, c) => r.code === 200 && c.length === 0);
  all &= await run('bad email rejected',
    mkReq('POST', { form: 'contact', fields: { email: 'not-an-email' } }), (r) => r.code === 400);
  all &= await run('newsletter without email rejected',
    mkReq('POST', { form: 'newsletter', fields: {} }), (r) => r.code === 400);
  all &= await run('contact stores submission under intake profile',
    mkReq('POST', { form: 'contact', fields: { name: 'Jo', email: 'JO@X.CO', message: 'hi' } }),
    (r, c) => r.code === 200 && c.some((x) => x.url.includes('/submissions') && x.method === 'POST'
      && x.profile === 'intake' && x.body[0].form === 'contact'));
  all &= await run('email is lowercased, ip is hashed not stored',
    mkReq('POST', { form: 'contact', fields: { email: 'MiXeD@Case.CO' } }),
    (r, c) => {
      const contact = c.find((x) => x.url.includes('/contacts'));
      const sub = c.find((x) => x.url.includes('/submissions') && x.method === 'POST');
      return contact.body[0].email === 'mixed@case.co'
        && /^[0-9a-f]{32}$/.test(sub.body[0].ip_hash)
        && !JSON.stringify(sub.body).includes('203.0.113.9');
    });
  all &= await run('newsletter sets consent + pending subscription',
    mkReq('POST', { form: 'newsletter', fields: { email: 'a@b.co' } }),
    (r, c) => r.payload.pending === true
      && c.find((x) => x.url.includes('/contacts')).body[0].marketing_consent === true
      && c.some((x) => x.url.includes('/subscriptions') && x.body[0].status === 'pending' && x.body[0].confirm_token));
  all &= await run('sell form does NOT grant marketing consent',
    mkReq('POST', { form: 'sell-property', fields: { email: 'a@b.co', address: '1 Main St' } }),
    (r, c) => c.find((x) => x.url.includes('/contacts')).body[0].marketing_consent === undefined);
  all &= await run('buy form writes typed criteria',
    mkReq('POST', { form: 'buy-property', fields: { email: 'a@b.co', price_range: '$1.5M – $4M', cap_rate: '5.5%+' } }),
    (r, c) => c.some((x) => x.url.includes('/buy_criteria')));
  rateLimited = true;
  all &= await run('rate limit returns 429 once the window is full',
    mkReq('POST', { form: 'contact', fields: { email: 'a@b.co' } }), (r) => r.code === 429);
  rateLimited = false;

  delete process.env.SUPABASE_URL;
  all &= await run('missing config fails loudly so the client falls back to mailto',
    mkReq('POST', { form: 'contact', fields: { email: 'a@b.co' } }), (r) => r.code === 503);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  if (!all) { console.error('\n  SOME HANDLER TESTS FAILED'); process.exit(1); }
  console.log('\n\u2713 api/submit.js \u00b7 rejects bad input \u00b7 never stores a raw IP \u00b7 consent stays per-purpose');
})();
