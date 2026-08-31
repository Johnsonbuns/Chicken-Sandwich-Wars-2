'use strict';
/**
 * POST /api/publish — the last mile.
 *
 * Approving a proposal writes canonical data to Postgres. The site is a static build
 * from data/*.json and does not read the database, so without this the desk is a
 * database editor that cannot publish — and a dashboard that says "approved" while the
 * site shows nothing is worse than no dashboard.
 *
 * This closes it:
 *
 *   Supabase  →  scripts/export-data.js  →  data/*.json  →  one git commit  →  Vercel
 *
 * The export is the same code the Phase 2 round-trip gate exercises — buildDataFiles()
 * is imported, not reimplemented, because two copies would drift and the gate would
 * only catch whichever one it happened to run.
 *
 * Publishing is the one thing here that needs the service-role key: the exporter has to
 * read rows the site's anonymous reader cannot (the twelve non-chicken brands exist only
 * so an operator's portfolio can be a real foreign key, and are deliberately
 * unpublished). It stays server-side, is sent to Supabase and nowhere else, and rows
 * marked internal or confidential are filtered out in scripts/lib/csw-db.js before they
 * can reach a file.
 */
const crypto = require('crypto');
const { rpc, select, userFromToken, bearer, readBody, send, fail, RestError } =
  require('../lib/supabase-rest');
const { makeClient } = require('../scripts/lib/csw-db');
const { buildDataFiles } = require('../scripts/export-data');

const GH = 'https://api.github.com';

const env = () => ({
  url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  token: process.env.CSW_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '',
  owner: process.env.CSW_PUBLISH_OWNER || process.env.VERCEL_GIT_REPO_OWNER || '',
  repo: process.env.CSW_PUBLISH_REPO || process.env.VERCEL_GIT_REPO_SLUG || '',
  branch: process.env.CSW_PUBLISH_BRANCH || 'main'
});

function missingConfig(e) {
  const missing = [];
  if (!e.url) missing.push('SUPABASE_URL');
  if (!e.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!e.token) missing.push('CSW_GITHUB_TOKEN');
  if (!e.owner || !e.repo) missing.push('CSW_PUBLISH_OWNER / CSW_PUBLISH_REPO');
  return missing;
}

async function gh(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${GH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'csw-desk',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!r.ok) {
    const msg = (data && data.message) || text.slice(0, 200) || `GitHub ${r.status}`;
    throw new RestError(
      r.status === 401 || r.status === 403
        ? `GitHub refused the request (${msg}). Check CSW_GITHUB_TOKEN has contents write access to this repository.`
        : `GitHub: ${msg}`,
      r.status === 404 ? 404 : 502);
  }
  return data;
}

/* Git's own object id, so a file that has not changed is recognised without downloading
   it. One tree listing rather than thirteen content fetches. */
const blobSha = (content) => {
  const buf = Buffer.from(content, 'utf8');
  return crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`, 'utf8'), buf])).digest('hex');
};

/* The one check.js assertion that matters before a commit: a stat whose src does not
   resolve renders silently with no footnote, and nothing downstream catches it. The
   rest of the integrity checks run in the Vercel build, where a failure leaves the
   previous deployment serving. */
function validate(files) {
  const problems = [];
  const names = Object.keys(files);
  if (names.length < 13) problems.push(`only ${names.length} files were produced`);

  let sources;
  for (const [name, body] of Object.entries(files)) {
    try {
      const parsed = JSON.parse(body);
      if (name === 'sources.json') sources = parsed;
      const n = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
      if (n === 0) problems.push(`${name} came out empty`);
    } catch (e) {
      problems.push(`${name} is not valid JSON (${e.message})`);
    }
  }
  if (!sources) return problems.concat('sources.json is missing');

  const used = new Set();
  for (const [name, body] of Object.entries(files)) {
    if (name === 'sources.json') continue;
    for (const m of body.matchAll(/"srcs?"\s*:\s*(?:"([^"]+)"|\[([^\]]*)\])/g)) {
      if (m[1]) used.add(m[1]);
      else for (const id of m[2].split(',')) {
        const k = id.trim().replace(/"/g, '');
        if (k) used.add(k);
      }
    }
  }
  for (const id of used) {
    if (!sources[id]) problems.push(`"${id}" is cited but absent from sources.json`);
  }
  return problems;
}

async function lastPublish(e) {
  const commits = await gh(
    `/repos/${e.owner}/${e.repo}/commits?sha=${encodeURIComponent(e.branch)}&path=data&per_page=1`,
    { token: e.token });
  const c = commits && commits[0];
  if (!c) return null;
  return { sha: c.sha, at: c.commit.committer.date, message: c.commit.message.split('\n')[0],
           url: c.html_url };
}

const OPS = {
  /* What would happen if you pressed the button. */
  async status(_a, token) {
    const e = env();
    const missing = missingConfig(e);
    if (missing.length) return { configured: false, missing };

    const last = await lastPublish(e);
    /* Read with the caller's own token, so RLS still decides — and so this needs no
       function of its own, and therefore no further migration to run. */
    let pending = null;
    if (last) {
      const rows = await select(
        `review_items?status=eq.applied&applied_at=gt.${encodeURIComponent(last.at)}`
        + '&select=id&limit=500', token).catch(() => null);
      pending = rows ? rows.length : null;
    }
    return { configured: true, missing: [], last, pending,
             repo: `${e.owner}/${e.repo}`, branch: e.branch };
  },

  async publish(a, token) {
    const e = env();
    const missing = missingConfig(e);
    if (missing.length) {
      throw new RestError(`Publishing is not configured. Missing: ${missing.join(', ')}.`, 503);
    }

    /* 1. Read the database and rebuild every file. */
    const db = makeClient({ mode: 'postgrest', url: e.url, key: e.serviceKey });
    let files;
    try {
      files = await buildDataFiles(db);
    } catch (err) {
      throw new RestError(`Could not read the database: ${err.message}`, 502);
    }

    /* 2. Refuse to commit something the site cannot render. */
    const problems = validate(files);
    if (problems.length) {
      throw new RestError(`The export did not pass its checks, so nothing was published. `
        + problems.slice(0, 5).join('; '), 422);
    }

    /* 3. Only the files that actually differ. */
    const ref = await gh(`/repos/${e.owner}/${e.repo}/git/ref/heads/${encodeURIComponent(e.branch)}`,
                         { token: e.token });
    const baseSha = ref.object.sha;
    const baseCommit = await gh(`/repos/${e.owner}/${e.repo}/git/commits/${baseSha}`, { token: e.token });
    const tree = await gh(`/repos/${e.owner}/${e.repo}/git/trees/${baseCommit.tree.sha}?recursive=1`,
                          { token: e.token });
    const existing = new Map((tree.tree || [])
      .filter((t) => t.type === 'blob' && t.path.startsWith('data/'))
      .map((t) => [t.path, t.sha]));

    const changed = Object.entries(files)
      .filter(([name, body]) => existing.get(`data/${name}`) !== blobSha(body));

    if (!changed.length) {
      return { published: false, changed: [], message: 'The site already matches the database.' };
    }

    /* 4. One commit, so the site never deploys a half-updated dataset. */
    const blobs = [];
    for (const [name, body] of changed) {
      const b = await gh(`/repos/${e.owner}/${e.repo}/git/blobs`, {
        token: e.token, method: 'POST', body: { content: body, encoding: 'utf-8' } });
      blobs.push({ path: `data/${name}`, mode: '100644', type: 'blob', sha: b.sha });
    }
    const newTree = await gh(`/repos/${e.owner}/${e.repo}/git/trees`, {
      token: e.token, method: 'POST', body: { base_tree: baseCommit.tree.sha, tree: blobs } });

    const who = a.actor || 'the desk';
    const commit = await gh(`/repos/${e.owner}/${e.repo}/git/commits`, {
      token: e.token, method: 'POST', body: {
        message: `Publish ${changed.length} data file${changed.length === 1 ? '' : 's'} from the desk\n\n`
          + `Exported from Supabase by ${who} at ${new Date().toISOString()}.\n`
          + changed.map(([n]) => `  data/${n}`).join('\n')
          + '\n\nGenerated by api/publish.js — edit through /admin/, not by hand.',
        tree: newTree.sha, parents: [baseSha]
      } });

    await gh(`/repos/${e.owner}/${e.repo}/git/refs/heads/${encodeURIComponent(e.branch)}`, {
      token: e.token, method: 'PATCH', body: { sha: commit.sha } });

    return {
      published: true,
      changed: changed.map(([n]) => n),
      commit: { sha: commit.sha.slice(0, 7), url: commit.html_url },
      message: `Committed to ${e.branch}. Vercel rebuilds the site from it — usually a minute or two.`
    };
  }
};

/* Exported for scripts/check-admin.js. If this hash were wrong the failure would be
   silent and one-directional: files that changed would look unchanged and never be
   published, which is indistinguishable from the desk not working. */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Use POST.' });
  }
  try {
    const body = await readBody(req);
    const op = String(body.op || 'status');
    if (!Object.prototype.hasOwnProperty.call(OPS, op)) {
      throw new RestError(`Unknown operation "${op}".`, 400);
    }

    /* Publishing changes what the public site says, so it is editor and admin only —
       checked in Postgres against the caller's own token, like everything else. */
    const token = bearer(req);
    await userFromToken(token);
    const me = await rpc('desk_me', {}, token);
    if (!me || !me.can_edit) {
      throw new RestError('Publishing to the site needs an editor or admin role.', 403);
    }

    const result = await OPS[op]({ ...body, actor: me.email }, token);
    return send(res, 200, { ok: true, ...result });
  } catch (e) {
    return fail(res, e);
  }
};

module.exports.blobSha = blobSha;
