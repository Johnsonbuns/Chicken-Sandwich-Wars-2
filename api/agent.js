'use strict';
/**
 * POST /api/agent — how a research agent puts a finding in front of a human.
 *
 * This endpoint cannot write canonical data. Not "does not" — cannot. It calls exactly
 * four database functions, listed in RPCS below, and three of them only touch review_*
 * tables while the fourth is read-only. There is no generic table access here and no
 * service-role key: the agent's key travels inside the RPC argument and
 * agent_for_key() checks its sha256 in Postgres, so a request that reached PostgREST
 * directly would be refused by exactly the same code.
 *
 * The contract is in db/AGENT_INTAKE.md. The short version:
 *
 *   POST /api/agent   Authorization: Bearer csw_ag_...
 *   { "op": "schema" }                        what may be proposed, and in what shape
 *   { "op": "lookup", "kind": "brand", "q": "popeyes" }   what already exists
 *   { "op": "submit", "batch": {...}, "items": [...] }    propose, with citations
 *   { "op": "finish", "batch_id": "...", "summary": "..." }
 *
 * An agent that skips `lookup` proposes duplicates; an agent that skips `schema`
 * proposes columns that do not exist. Both are recoverable — every reply says what was
 * accepted and what was not — but a run that does neither wastes a reviewer's evening.
 */
const { rpc, bearer, readBody, send, fail, configured, RestError } =
  require('../lib/supabase-rest');

/* The whole surface. Anything not on this list is unreachable from an agent key. */
const RPCS = {
  schema: 'review_schema',
  lookup: 'review_lookup',
  submit: 'review_submit',
  finish: 'review_finish_batch'
};

const MAX_ITEMS = 200;
const str = (v, max = 400) => (v == null ? null : String(v).slice(0, max).trim() || null);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Use POST.' });
  }

  try {
    if (!configured()) {
      throw new RestError('This deployment has no Supabase credentials.', 503);
    }

    const key = bearer(req);
    if (!key || !/^csw_ag_/.test(key)) {
      throw new RestError(
        'Send an agent key as "Authorization: Bearer csw_ag_...". Mint one in the dashboard under Settings.',
        401);
    }

    const body = await readBody(req);
    const op = String(body.op || 'submit');
    if (!Object.prototype.hasOwnProperty.call(RPCS, op)) {
      throw new RestError(
        `Unknown operation "${op}". Use schema, lookup, submit or finish.`, 400);
    }

    if (op === 'schema') {
      return send(res, 200, { ok: true, targets: await rpc('review_schema', { p_agent_key: key }) });
    }

    if (op === 'lookup') {
      const results = await rpc('review_lookup', {
        p_kind: str(body.kind, 40), p_q: str(body.q, 120) || '',
        p_limit: Math.min(Math.max(Number(body.limit) || 10, 1), 50),
        p_agent_key: key
      });
      return send(res, 200, { ok: true, results });
    }

    if (op === 'finish') {
      /* Closing a run is bookkeeping, and it is what makes the dashboard able to say
         "this run is still going" rather than "this run produced nothing yet". The key
         is verified by review_submit with an empty item list, so a stranger cannot
         close somebody else's run. */
      const batchId = str(body.batch_id, 40);
      if (!batchId) throw new RestError('finish needs a batch_id.', 400);
      const closed = await rpc('review_finish_batch', {
        p_agent_key: key, p_batch_id: batchId, p_summary: str(body.summary, 8000)
      });
      return send(res, 200, { ok: true, ...closed });
    }

    /* submit */
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new RestError('Send at least one item.', 400);
    if (items.length > MAX_ITEMS) {
      throw new RestError(`Send at most ${MAX_ITEMS} items per request.`, 400);
    }

    const result = await rpc('review_submit', { p: {
      agent_key: key,
      batch: body.batch && typeof body.batch === 'object' ? body.batch : { title: 'Research run' },
      batch_id: str(body.batch_id, 40) || undefined,
      items
    } });

    const accepted = (result.items || []).filter((i) => i.accepted);
    const rejected = (result.items || []).filter((i) => !i.accepted);
    return send(res, rejected.length && !accepted.length ? 400 : 200, {
      ok: true,
      batch_id: result.batch_id,
      accepted: accepted.length,
      rejected: rejected.length,
      /* Every item comes back with what the database thought of it — the duplicate
         candidates it matched, the columns it could not write, whether it landed in
         pending or needs-verification. An agent that reads this can fix its next run. */
      items: result.items,
      note: 'Nothing here is published. Every item waits for a human decision in the CSW dashboard.'
    });
  } catch (e) {
    return fail(res, e);
  }
};
