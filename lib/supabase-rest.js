'use strict';
/**
 * PostgREST and GoTrue over global fetch, with no client library.
 *
 * Shared by api/admin.js and api/agent.js. It lives in lib/ rather than in api/
 * because every .js file directly under api/ becomes its own serverless function on
 * Vercel; Vercel's file tracing follows the require from there and bundles this with
 * both. build.js never touches it, so the zero-dependency build path is unaffected.
 *
 * The only credential either endpoint holds is SUPABASE_ANON_KEY, which is designed
 * to ship in a browser. Authorisation is Postgres's job:
 *
 *   - the dashboard sends the signed-in user's JWT, so RLS decides what they see
 *   - an agent sends its key inside the RPC argument, and the function checks the hash
 *
 * The service-role key stays where it already was — api/submit.js, writing PII into a
 * schema no browser role can reach. Nothing here reads it.
 */

const url = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const anon = () => process.env.SUPABASE_ANON_KEY || '';
const configured = () => Boolean(url() && anon());

/* PostgREST reports Postgres errors as JSON with the SQLSTATE in `code`. Mapping the
   ones the review functions raise deliberately means the dashboard can distinguish
   "you may not do that" from "somebody else changed it first" without parsing prose. */
const STATUS_BY_SQLSTATE = {
  '42501': 403,   // raised by is_staff() / can_edit() / an invalid agent key
  '02000': 404,   // no such row
  '22023': 400,   // unknown target, unknown decision
  '23503': 400,   // a reference that did not resolve
  '23514': 400,   // a check constraint, including "cannot publish a confidential record"
  '23505': 409,   // already exists
  '40001': 409    // the record moved while the proposal waited
};

class RestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 502;
    this.code = code || null;
  }
}

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  if (!configured()) throw new RestError('Supabase is not configured for this deployment.', 503);
  const r = await fetch(`${url()}${path}`, {
    method,
    headers: {
      apikey: anon(),
      Authorization: `Bearer ${token || anon()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }

  if (!r.ok) {
    const code = parsed && parsed.code;
    const message = (parsed && (parsed.message || parsed.error_description || parsed.error))
      || text.slice(0, 300) || `request failed (${r.status})`;
    /* PGRST106 is "the schema is not in the exposed list", which is a configuration
       answer rather than a failure the user did anything to cause. Say so. */
    if (code === 'PGRST106') {
      throw new RestError(
        'That schema is not exposed to the API. Add it under Settings → API → Exposed schemas.',
        503, code);
    }
    throw new RestError(message, STATUS_BY_SQLSTATE[code] || (r.status === 401 ? 401 : r.status), code);
  }
  return parsed;
}

const rpc = (fn, args, token) =>
  call(`/rest/v1/rpc/${fn}`, { token, method: 'POST', body: args || {} });

const select = (path, token, headers) =>
  call(`/rest/v1/${path}`, { token, headers });

/* Who is holding this token. GoTrue is the only thing that can answer, and a bad or
   expired token has to come back as 401 rather than as a 500. */
async function userFromToken(token) {
  if (!token) throw new RestError('Sign in to continue.', 401);
  const u = await call('/auth/v1/user', { token }).catch((e) => {
    throw new RestError(e.status === 403 || e.status === 401
      ? 'That session has expired. Sign in again.' : e.message, 401);
  });
  if (!u || !u.id) throw new RestError('That session has expired. Sign in again.', 401);
  return u;
}

const bearer = (req) => {
  const h = req.headers.authorization || req.headers.Authorization || '';
  return /^Bearer\s+(.+)$/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : null;
};

/* Vercel parses JSON bodies for us, but only when the content-type says so; the
   fallback keeps the endpoints usable from curl without ceremony. */
function readBody(req, maxBytes = 512 * 1024) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > maxBytes) { reject(new RestError('That request is too large.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new RestError('That request body is not valid JSON.', 400)); }
    });
    req.on('error', reject);
  });
}

const send = (res, status, payload) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
};

const fail = (res, e) => {
  const status = e instanceof RestError ? e.status : 500;
  if (status >= 500) console.error('api error:', e && e.message);
  return send(res, status, { ok: false, error: e && e.message ? e.message : 'Something went wrong.' });
};

module.exports = { url, anon, configured, call, rpc, select, userFromToken, bearer,
                   readBody, send, fail, RestError };
