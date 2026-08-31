'use strict';
/**
 * POST /api/admin — everything the intelligence dashboard does.
 *
 * One function, dispatching on `op`, because a Vercel project has a function budget and
 * eighteen routes that all do "authenticate, then call one RPC" is eighteen copies of
 * the same file.
 *
 * Authorisation is not done here. Every call carries the signed-in user's Supabase JWT
 * and is forwarded with it, so Postgres evaluates is_staff(), can_edit() and every RLS
 * policy against the real person. This endpoint holds only the publishable anon key: if
 * it were compromised it could do nothing a signed-out browser could not already do.
 * That is deliberate — the alternative, a service-role key plus role checks in
 * JavaScript, makes every future op a place to forget one.
 *
 * The one thing done in JavaScript is the shape of the reply, so the dashboard renders
 * from one round trip instead of five.
 */
const { call, rpc, select, userFromToken, bearer, readBody, send, fail, configured, url,
        anon, RestError } = require('../lib/supabase-rest');

const crypto = require('crypto');

const int = (v, d, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), max) : d;
};
const str = (v, max = 400) => (v == null ? null : String(v).slice(0, max).trim() || null);
const enc = encodeURIComponent;

/* PostgREST parses its filters out of the query string AFTER url-decoding it, so an
   encoded comma or bracket in a search term is not inert — it lands inside the filter
   grammar. Values that go into a filter expression are therefore reduced to characters
   that mean nothing to it, rather than escaped. */
const term = (v) => (v == null ? null
  : String(v).slice(0, 120).replace(/[^\p{L}\p{N}\s'&-]/gu, ' ').trim() || null);

const STATUSES = new Set(['pending', 'needs_verification', 'approved', 'applied',
                          'rejected', 'duplicate', 'withdrawn']);
const KINDS = new Set(['human', 'agent', 'import']);
const VISIBILITIES = new Set(['public', 'internal', 'confidential']);
const uuid = (v) => (/^[0-9a-f-]{36}$/i.test(String(v || '')) ? String(v) : null);

/* ---------- the queue, with its provenance and its warnings ---------- */
async function itemDetail(id, token) {
  const [item] = await select(`v_review_queue?id=eq.${enc(id)}&limit=1`, token);
  if (!item) throw new RestError('That proposal no longer exists.', 404);
  const [sources, matches, events, validation] = await Promise.all([
    select(`review_item_sources?item_id=eq.${enc(id)}&order=ordinal&select=*,source:sources(id,key,publisher,title,url,date_label)`, token),
    select(`review_item_matches?item_id=eq.${enc(id)}&order=similarity.desc`, token),
    select(`review_events?item_id=eq.${enc(id)}&order=at.desc&limit=50`, token),
    rpc('review_validate', { p_item_id: id }, token)
  ]);
  /* The right-hand side of the diff is the proposal; the left-hand side has to be the
     record as it stands NOW, not as it stood when the proposal was made. Showing the
     stored baseline would hide exactly the change that makes a proposal stale. */
  let current = null;
  if (item.target_id) {
    current = await rpc('review_row_json',
      { p_table: item.target_table, p_id: item.target_id }, token).catch(() => null);
  }
  return { item, sources, matches, events, validation, current };
}

const OPS = {
  /* Identity and capability, before the dashboard draws anything. */
  async me(_a, token) {
    const me = await rpc('desk_me', {}, token);
    return { me };
  },

  async stats(_a, token) {
    return { stats: await rpc('desk_stats', {}, token) };
  },

  async schema(_a, token) {
    return { targets: await rpc('review_schema', {}, token) };
  },

  async queue(a, token) {
    const parts = ['select=*', 'order=created_at.desc', `limit=${int(a.limit, 50, 200)}`,
                   `offset=${int(a.offset, 0, 100000)}`];
    if (a.status && a.status !== 'all') {
      /* Checked against the enum rather than passed through: an unrecognised value is a
         bug in the caller, and a value carrying a bracket is something else entirely. */
      const list = String(a.status).split(',').map((x) => x.trim()).filter((x) => STATUSES.has(x));
      if (list.length) parts.push(`status=in.(${list.join(',')})`);
    }
    if (a.target) parts.push(`target_table=eq.${enc(str(a.target, 80))}`);
    if (KINDS.has(a.submitter)) parts.push(`submitter_kind=eq.${a.submitter}`);
    if (uuid(a.batch)) parts.push(`batch_id=eq.${uuid(a.batch)}`);
    if (VISIBILITIES.has(a.visibility)) parts.push(`visibility=eq.${a.visibility}`);
    const q = term(a.q);
    if (q) parts.push(`or=(title.ilike.*${enc(q)}*,entity_label.ilike.*${enc(q)}*)`);
    return { items: await select(`v_review_queue?${parts.join('&')}`, token) };
  },

  item: async (a, token) => itemDetail(str(a.id, 40), token),

  /* Submitting from the dashboard uses the same RPC an agent uses. There is one queue
     and one entry point; the form is a different way of filling in the same shape. */
  async submit(a, token) {
    const result = await rpc('review_submit', { p: {
      batch: a.batch || undefined,
      batch_id: a.batch_id || undefined,
      items: Array.isArray(a.items) ? a.items.slice(0, 100) : []
    } }, token);
    return { result };
  },

  async decide(a, token) {
    const result = await rpc('review_decide', {
      p_item_id: str(a.id, 40),
      p_decision: str(a.decision, 40),
      p_note: str(a.note, 4000),
      p_override: a.override && typeof a.override === 'object' ? a.override : null,
      p_force: Boolean(a.force),
      p_duplicate_of: str(a.duplicate_of, 40)
    }, token);
    return { result };
  },

  /* Bulk approval exists because a research run of forty figures from one filing is one
     editorial decision. It stops at the first failure and reports it rather than
     applying half a run silently. */
  async decideMany(a, token) {
    const ids = Array.isArray(a.ids) ? a.ids.slice(0, 100) : [];
    const done = []; const failed = [];
    for (const id of ids) {
      try {
        await rpc('review_decide', { p_item_id: id, p_decision: str(a.decision, 40),
                                     p_note: str(a.note, 4000), p_force: Boolean(a.force) }, token);
        done.push(id);
      } catch (e) {
        failed.push({ id, error: e.message });
      }
    }
    return { done, failed };
  },

  /* Marking a duplicate candidate same-or-different. A plain update rather than an RPC:
     the staff_amend policy on review_item_matches already restricts it to can_edit(). */
  async resolveMatch(a, token) {
    await call(`/rest/v1/review_item_matches?id=eq.${enc(str(a.id, 40))}`, {
      token, method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: { resolution: str(a.resolution, 20), resolved_at: new Date().toISOString() }
    });
    return { ok: true };
  },

  lookup: async (a, token) => ({
    results: await rpc('review_lookup', {
      p_kind: str(a.kind, 40), p_q: str(a.q, 120) || '', p_limit: int(a.limit, 10, 50)
    }, token)
  }),

  batches: async (a, token) => ({
    batches: await select(
      `review_batches?select=*,items:review_items(count)&order=started_at.desc&limit=${int(a.limit, 40, 200)}`,
      token)
  }),

  async batch(a, token) {
    const id = str(a.id, 40);
    const [batch] = await select(`review_batches?id=eq.${enc(id)}&limit=1`, token);
    if (!batch) throw new RestError('That research run no longer exists.', 404);
    const items = await select(`v_review_queue?batch_id=eq.${enc(id)}&order=seq`, token);
    return { batch, items };
  },

  records: async (a, token) => ({
    records: await rpc('desk_records', {
      p_table: str(a.table, 80), p_q: str(a.q, 120), p_id: uuid(a.id),
      p_limit: int(a.limit, 50, 200), p_offset: int(a.offset, 0, 100000)
    }, token)
  }),

  history: async (a, token) => ({
    history: await rpc('record_history', {
      p_table: str(a.table, 80), p_id: str(a.id, 40), p_limit: int(a.limit, 25, 200)
    }, token)
  }),

  /* The intake inbox. Reached through a security definer function, so the schema that
     holds every name, email and phone number stays revoked from every browser role. */
  leads: async (a, token) => ({
    leads: await rpc('lead_list', {
      p_status: str(a.status, 30), p_form: str(a.form, 30),
      p_limit: int(a.limit, 50, 200), p_offset: int(a.offset, 0, 100000)
    }, token)
  }),

  leadUpdate: async (a, token) => ({
    lead: await rpc('lead_update', {
      p_id: str(a.id, 40), p_status: str(a.status, 30), p_note: str(a.note, 4000)
    }, token)
  }),

  staff: async (_a, token) => ({ staff: await rpc('staff_list', {}, token) }),

  grantStaff: async (a, token) => ({
    granted: await rpc('grant_staff', { p_email: str(a.email, 200), p_role: str(a.role, 20) }, token)
  }),

  agentKeys: async (_a, token) => ({
    keys: await select('agent_keys?select=id,name,key_prefix,scopes,note,created_at,last_used_at,use_count,revoked_at&order=created_at.desc', token)
  }),

  /* The raw key is generated here, shown once, and stored only as a sha256 — the same
     hash agent_for_key() recomputes. Nothing can recover it afterwards, including us. */
  async agentKeyCreate(a, token) {
    const secret = `csw_ag_${crypto.randomBytes(24).toString('base64url')}`;
    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    const scopes = Array.isArray(a.scopes) && a.scopes.length
      ? a.scopes.filter((s) => ['submit', 'lookup'].includes(s)) : ['submit', 'lookup'];
    const [key] = await call('/rest/v1/agent_keys', {
      token, method: 'POST', headers: { Prefer: 'return=representation' },
      body: [{ name: str(a.name, 120) || 'Research agent', key_prefix: secret.slice(0, 14),
               key_hash: hash, scopes, note: str(a.note, 500) }]
    });
    return { key, secret };
  },

  async agentKeyRevoke(a, token) {
    await call(`/rest/v1/agent_keys?id=eq.${enc(str(a.id, 40))}`,
      { token, method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: { revoked_at: new Date().toISOString() } });
    return { ok: true };
  }
};

/* Ops a signed-in user with no desk role may call. Everything else needs a staff row,
   which the database enforces anyway; this is so the dashboard gets a clean 403 with a
   message rather than a Postgres one. */
const OPEN_TO_SIGNED_IN = new Set(['me']);

module.exports = async function handler(req, res) {
  /* The browser needs the project URL and the publishable key to sign in at all, and
     neither is secret. Serving them here rather than baking them into the static build
     means rotating a key or moving projects does not need a rebuild. */
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true, configured: configured(), url: url(), anonKey: anon()
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'Use POST.' });
  }

  try {
    if (!configured()) {
      throw new RestError(
        'This deployment has no Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY.', 503);
    }
    const body = await readBody(req);
    const op = String(body.op || '');
    if (!Object.prototype.hasOwnProperty.call(OPS, op)) {
      throw new RestError(`Unknown operation "${op}".`, 400);
    }

    const token = bearer(req);
    const user = await userFromToken(token);

    if (!OPEN_TO_SIGNED_IN.has(op)) {
      /* One cheap round trip, so an outsider gets "you have no desk access" instead of
         a stack of RLS-shaped empty arrays. The database refuses them regardless. */
      const me = await rpc('desk_me', {}, token);
      if (!me || !me.is_staff) {
        throw new RestError(
          `${user.email} is signed in but has no desk access yet.`, 403);
      }
    }

    const result = await OPS[op](body, token);
    return send(res, 200, { ok: true, ...result });
  } catch (e) {
    return fail(res, e);
  }
};
