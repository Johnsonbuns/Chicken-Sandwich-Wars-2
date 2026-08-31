'use strict';
/**
 * Handler tests for api/admin.js and api/agent.js.
 *
 *   node scripts/check-admin.js
 *
 * Stubs global fetch, so this runs with no credentials and never touches Supabase. It
 * checks the two properties that would be expensive to get wrong, and that no amount of
 * reading the code proves on its own:
 *
 *   1. Neither endpoint ever sends the service-role key, and the dashboard forwards the
 *      signed-in user's own token — which is what makes Postgres, rather than this
 *      JavaScript, the thing that decides who may do what.
 *   2. The agent endpoint cannot reach canonical data. Every request it makes is to one
 *      of four review RPCs. If a future edit adds a table read to it, this fails.
 */
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key-abc';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'SERVICE-ROLE-MUST-NEVER-APPEAR';

const admin = require('../api/admin.js');
const agent = require('../api/agent.js');

const USER = { id: 'u-1', email: 'desk@example.com' };
let calls = [];
let deskMe = { user_id: 'u-1', email: 'desk@example.com', role: 'admin',
               is_staff: true, can_edit: true, is_admin: true, can_see_confidential: true };
let authOk = true;

global.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method: init.method || 'GET', body, headers: init.headers || {} });
  const json = (v, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(v) });

  if (url.includes('/auth/v1/user')) {
    return authOk ? json(USER) : json({ message: 'invalid token' }, 401);
  }
  if (url.includes('/rpc/desk_me')) return json(deskMe);
  if (url.includes('/rpc/desk_stats')) return json({ pending: 3, new_leads: 1 });
  if (url.includes('/rpc/review_schema')) return json([{ table_name: 'public.facts', columns: [] }]);
  if (url.includes('/rpc/review_lookup')) return json([{ ref: 'popeyes', label: 'Popeyes' }]);
  if (url.includes('/rpc/review_submit')) {
    return json({ batch_id: 'b-1', items: [{ id: 'i-1', accepted: true, status: 'pending' }] });
  }
  if (url.includes('/rpc/review_finish_batch')) return json({ batch_id: 'b-1', status: 'submitted' });
  if (url.includes('/rpc/review_decide')) return json({ id: 'i-1', status: 'applied' });
  if (url.includes('/rpc/')) return json({});
  if (url.includes('/rest/v1/agent_keys')) return json([{ id: 'k-1', key_prefix: 'csw_ag_xxxx' }]);
  /* One proposal, so the item detail can be exercised. Only for a by-id lookup — the
     queue listing tests assert on an empty list. */
  if (url.includes('v_review_queue') && url.includes('id=eq.')) {
    return json([{ id: 'i-1', target_table: 'public.facts', target_id: 'f-1',
                   title: 'test', status: 'pending', payload: {} }]);
  }
  return json([]);
};

const mkReq = (method, body, headers = {}) => ({
  method, body, headers: { 'content-type': 'application/json', ...headers }, on: () => {}
});
function mkRes() {
  const r = { code: 0, payload: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (p) => { r.payload = p; return r; };
  return r;
}

let all = true;
const run = async (handler, name, req, expect) => {
  calls = [];
  const res = mkRes();
  await handler(req, res);
  let pass = false;
  try { pass = expect(res, calls); } catch (e) { pass = false; }
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}  -> ${res.code} ${JSON.stringify(res.payload).slice(0, 78)}`);
  if (!pass) all = false;
  return res;
};

const AUTH = { authorization: 'Bearer user-jwt-token' };
const sentServiceRole = (cs) => cs.some((c) =>
  JSON.stringify(c.headers).includes('SERVICE-ROLE') || JSON.stringify(c.body || {}).includes('SERVICE-ROLE'));

(async () => {
  console.log('\n  api/admin.js');
  await run(admin, 'GET returns the public config the sign-in page needs',
    mkReq('GET', null),
    (r) => r.code === 200 && r.payload.anonKey === 'anon-key-abc' && r.payload.configured === true);
  await run(admin, 'GET never leaks the service-role key',
    mkReq('GET', null), (r) => !JSON.stringify(r.payload).includes('SERVICE-ROLE'));
  await run(admin, 'PUT is rejected', mkReq('PUT', {}), (r) => r.code === 405);
  await run(admin, 'no token is a 401, not a silent empty list',
    mkReq('POST', { op: 'stats' }), (r) => r.code === 401);
  authOk = false;
  await run(admin, 'an expired token is a 401 with something a human can act on',
    mkReq('POST', { op: 'stats' }, AUTH),
    (r) => r.code === 401 && /sign in again/i.test(r.payload.error));
  authOk = true;
  await run(admin, 'an unknown operation is refused before anything is called',
    mkReq('POST', { op: 'drop_everything' }, AUTH),
    (r, c) => r.code === 400 && c.length === 0);

  deskMe = { ...deskMe, role: null, is_staff: false, can_edit: false, is_admin: false };
  await run(admin, 'a signed-in outsider is told they have no desk access',
    mkReq('POST', { op: 'queue' }, AUTH),
    (r) => r.code === 403 && r.payload.error.includes('desk@example.com'));
  await run(admin, 'and cannot reach a single record',
    mkReq('POST', { op: 'records', table: 'public.facts' }, AUTH),
    (r, c) => r.code === 403 && !c.some((x) => x.url.includes('desk_records')));
  deskMe = { ...deskMe, role: 'admin', is_staff: true, can_edit: true, is_admin: true };

  await run(admin, 'the dashboard forwards the user\'s own token, so RLS applies to them',
    mkReq('POST', { op: 'stats' }, AUTH),
    (r, c) => r.code === 200 && c.every((x) => x.headers.Authorization === 'Bearer user-jwt-token'));
  await run(admin, 'and never sends the service-role key anywhere',
    mkReq('POST', { op: 'stats' }, AUTH), (r, c) => !sentServiceRole(c));
  await run(admin, 'the anon key is what identifies the project',
    mkReq('POST', { op: 'stats' }, AUTH),
    (r, c) => c.every((x) => x.headers.apikey === 'anon-key-abc'));
  await run(admin, 'submitting from the form uses the same RPC an agent uses',
    mkReq('POST', { op: 'submit', items: [{ target_table: 'public.facts', payload: { a: 1 } }] }, AUTH),
    (r, c) => r.code === 200 && c.some((x) => x.url.includes('/rpc/review_submit')));
  await run(admin, 'a decision goes through review_decide, never a direct table write',
    mkReq('POST', { op: 'decide', id: 'i-1', decision: 'approve', note: 'ok' }, AUTH),
    (r, c) => r.code === 200 && c.some((x) => x.url.includes('/rpc/review_decide'))
      && !c.some((x) => /\/rest\/v1\/(facts|brands|transactions|properties)/.test(x.url)));
  await run(admin, 'a minted agent key is returned once and stored only as a hash',
    mkReq('POST', { op: 'agentKeyCreate', name: 'Claude' }, AUTH),
    (r, c) => {
      const post = c.find((x) => x.url.includes('/rest/v1/agent_keys') && x.method === 'POST');
      const row = post.body[0];
      return r.payload.secret.startsWith('csw_ag_') && r.payload.secret.length > 30
        && /^[0-9a-f]{64}$/.test(row.key_hash)
        && !JSON.stringify(post.body).includes(r.payload.secret);
    });
  await run(admin, 'a search term cannot smuggle a filter into the PostgREST query',
    mkReq('POST', { op: 'queue', q: 'x,status.eq.applied)' }, AUTH),
    (r, c) => {
      const u = c.find((x) => x.url.includes('v_review_queue')).url;
      return r.code === 200 && !/status\.eq/.test(decodeURIComponent(u));
    });
  await run(admin, 'and an unrecognised status is dropped rather than passed through',
    mkReq('POST', { op: 'queue', status: 'pending,evil)' }, AUTH),
    (r, c) => {
      const u = decodeURIComponent(c.find((x) => x.url.includes('v_review_queue')).url);
      return u.includes('status=in.(pending)') && !u.includes('evil');
    });
  /* review_item_sources points at sources twice — source_id for a citation already in
     the registry, created_source_id for the one approval writes. PostgREST refuses an
     embed it cannot disambiguate, and the failure only appears when a proposal is
     opened, which is the moment the desk is least useful broken. */
  await run(admin, 'the sources embed names which foreign key it means',
    mkReq('POST', { op: 'item', id: 'i-1' }, AUTH),
    (r, c) => {
      const u = decodeURIComponent(c.find((x) => x.url.includes('review_item_sources')).url);
      return u.includes('sources!review_item_sources_source_id_fkey');
    });
  await run(admin, 'the leads inbox goes through the function, not the intake schema',
    mkReq('POST', { op: 'leads' }, AUTH),
    (r, c) => c.some((x) => x.url.includes('/rpc/lead_list'))
      && !c.some((x) => JSON.stringify(x.headers).includes('intake')));

  console.log('\n  api/agent.js');
  const AGENT = { authorization: 'Bearer csw_ag_secret_key_value_long_enough' };
  await run(agent, 'GET is rejected', mkReq('GET', {}), (r) => r.code === 405);
  await run(agent, 'no key is refused with instructions',
    mkReq('POST', { op: 'submit', items: [{}] }),
    (r, c) => r.code === 401 && c.length === 0 && /dashboard/i.test(r.payload.error));
  await run(agent, 'a user JWT is not an agent key',
    mkReq('POST', { op: 'submit', items: [{}] }, AUTH), (r) => r.code === 401);
  await run(agent, 'an unknown operation is refused',
    mkReq('POST', { op: 'delete' }, AGENT), (r, c) => r.code === 400 && c.length === 0);
  await run(agent, 'an empty submission is refused',
    mkReq('POST', { op: 'submit', items: [] }, AGENT), (r) => r.code === 400);

  const submitted = await run(agent, 'a submission reaches review_submit carrying the key',
    mkReq('POST', {
      op: 'submit',
      batch: { title: 'Q3 sweep', model: 'claude-opus-5' },
      items: [{ target_table: 'public.facts', title: 'Popeyes AUV',
                payload: { subject_id: '@brand:popeyes', metric_key: 'auv_usd' },
                sources: [{ publisher: 'RBI', url: 'https://example.com/q3' }] }]
    }, AGENT),
    (r, c) => {
      const rpc = c.find((x) => x.url.includes('/rpc/review_submit'));
      return r.code === 200 && rpc && rpc.body.p.agent_key === 'csw_ag_secret_key_value_long_enough'
        && rpc.body.p.items.length === 1;
    });
  await run(agent, 'and the reply says plainly that nothing was published',
    mkReq('POST', { op: 'submit', items: [{ target_table: 'public.facts', payload: {} }] }, AGENT),
    (r) => /waits for a human/i.test(r.payload.note) && r.payload.accepted === 1);

  /* The important one. Every request this endpoint can be made to issue must be to a
     review RPC — no table reads, no writes, nothing that could reach canonical data. */
  const ALLOWED = ['/rest/v1/rpc/review_schema', '/rest/v1/rpc/review_lookup',
                   '/rest/v1/rpc/review_submit', '/rest/v1/rpc/review_finish_batch'];
  let touched = [];
  for (const body of [
    { op: 'schema' },
    { op: 'lookup', kind: 'brand', q: 'popeyes' },
    { op: 'submit', items: [{ target_table: 'public.brands', payload: { name: 'X' } }] },
    { op: 'finish', batch_id: 'b-1', summary: 'done' }
  ]) {
    calls = [];
    await agent(mkReq('POST', body, AGENT), mkRes());
    touched = touched.concat(calls.map((c) => c.url.replace('https://example.supabase.co', '')));
  }
  const strays = touched.filter((u) => !ALLOWED.some((a) => u.startsWith(a)));
  console.log(`  ${strays.length === 0 ? 'ok  ' : 'FAIL'} the agent endpoint can reach nothing but the four review RPCs`
    + (strays.length ? `  -> ${strays.join(', ')}` : `  -> ${touched.length} calls, all allowed`));
  if (strays.length) all = false;

  const usedServiceRole = touched.length && sentServiceRole(calls);
  console.log(`  ${usedServiceRole ? 'FAIL' : 'ok  '} and holds no service-role key`);
  if (usedServiceRole) all = false;

  if (!all) { console.error('\n  SOME HANDLER TESTS FAILED'); process.exit(1); }
  console.log('\n✓ api/admin.js + api/agent.js · the user\'s own token does the authorising · '
    + 'no service-role key · agents cannot reach canonical data');
})();
