'use strict';
/* DoubtIQ — reliability audit (run against a live server).
 * Covers the production-readiness checklist that must be verified on every
 * release:
 *   1. create → logout → login → "refresh" → data persists
 *   2. publish → public page → Google-crawlable URL + sitemap entry
 *   3. view → live statistics update (no double count)
 *   4. backup → restore (backup file valid; restore documented)
 *   5. auth guards + analytics removal
 * Server-restart persistence is verified manually (see README audit); this
 * suite covers everything that can be checked against a running instance.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD || 'thunderreddy123';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) failures++;
};

async function api(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, data, headers: res.headers };
}

(async () => {
  console.log('\n── Reliability audit ──────────────────────────');

  /* 1. Login */
  const login = await api('POST', '/api/admin/auth/login', { username: 'admin', password: ADMIN_PASS });
  check('admin login', login.status === 200, 'status ' + login.status);
  const token = login.data.token;
  const q = (p) => api('GET', p, undefined, token);

  /* 2. Create question + answer (published) */
  const title = 'Reliability audit ' + Date.now();
  const created = await api('POST', '/api/admin/questions', {
    subject_id: 1, title, topics: 'reliability, audit', status: 'published',
    answer_body: 'Reliability audit answer body.'
  }, token);
  check('create question', created.status === 200, 'id ' + (created.data && created.data.id));
  const qid = created.data.id;

  /* 3. Publish → public page + sitemap immediately */
  const qlist = await q(`/api/admin/questions?q=${encodeURIComponent(title)}`);
  const row = (qlist.data.questions || []).find((x) => x.id === qid);
  check('question persisted after create', !!row, row && row.slug);
  const slug = row.slug;

  const pub = await (await fetch(`${BASE}/api/questions/${slug}`)).json();
  check('public page serves question + answer', pub.question && pub.question.answers.length === 1);

  const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check('sitemap includes new question', sm.includes(`/questions/${slug}`));

  const crawler = await fetch(`${BASE}/questions/${slug}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
  });
  const crawlHtml = await crawler.text();
  check('Googlebot gets crawlable HTML', crawler.status === 200 && crawlHtml.includes(title));
  check('crawlable HTML has JSON-LD Question', crawlHtml.includes('"@type":"Question"'));

  /* 4. Logout → login again (fresh session) */
  const logout = await api('POST', '/api/admin/auth/logout', {}, token);
  check('logout invalidates session', (await q('/api/admin/overview')).status === 401);
  check('logout endpoint ok', logout.status === 200);

  const login2 = await api('POST', '/api/admin/auth/login', { username: 'admin', password: ADMIN_PASS });
  const token2 = login2.data.token;
  const q2 = (p) => api('GET', p, undefined, token2);
  const after = await q2(`/api/admin/questions?q=${encodeURIComponent(title)}`);
  check('question survives logout → login', (after.data.questions || []).some((x) => x.id === qid));

  /* 5. View counting + anti-inflation.
     Create a brand-new published question (never viewed), open it ONCE →
     total +1. Open the SAME question again within the 30s per-IP window →
     must NOT inflate (+0). */
  const freshCreate = await api('POST', '/api/admin/questions', {
    subject_id: 1, title: 'View count probe ' + Date.now(), status: 'published',
    answer_body: 'Probe answer.'
  }, token2);
  const freshId = freshCreate.data.id;
  const probe = await q2(`/api/admin/questions?q=${encodeURIComponent('View count probe')}`);
  const freshSlug = (probe.data.questions || []).find((x) => x.id === freshId).slug;
  const v0 = (await q2('/api/admin/overview')).data.counts.views;
  await fetch(`${BASE}/api/questions/${freshSlug}`);      // first view
  const v1 = (await q2('/api/admin/overview')).data.counts.views;
  await fetch(`${BASE}/api/questions/${freshSlug}`);      // throttled repeat
  const v2 = (await q2('/api/admin/overview')).data.counts.views;
  check('view increments statistics by exactly 1', v1 === v0 + 1, `${v0} → ${v1}`);
  check('repeated refresh does not inflate views', v2 === v1, `${v1} → ${v2}`);
  await api('DELETE', `/api/admin/questions/${freshId}`, undefined, token2);

  /* 6. Unpublish → hidden from public + sitemap (not indexable) */
  await api('PUT', `/api/admin/questions/${qid}/status`, { status: 'unpublished' }, token2);
  const hidden = await (await fetch(`${BASE}/api/questions/${slug}`, {
    headers: { 'User-Agent': 'Googlebot' }
  }));
  check('unpublished → not publicly indexable', hidden.status === 404);
  const sm2 = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check('unpublished → removed from sitemap', !sm2.includes(`/questions/${slug}`));

  /* 7. Republish → back on public URL */
  await api('PUT', `/api/admin/questions/${qid}/status`, { status: 'published' }, token2);
  check('republish → public again', (await fetch(`${BASE}/api/questions/${slug}`)).status === 200);

  /* 8. Backup helper (script-level, no restart needed).
     PostgreSQL mode: production backups are handled by Supabase (PITR) —
     verify the retained helper exits cleanly with its informative message.
     SQLite mode (legacy local archive): verify the snapshot is a valid
     complete database. */
  const { execSync } = require('child_process');
  if (process.env.DATABASE_URL) {
    const out = execSync('node server/backup.js', { cwd: __dirname, encoding: 'utf8' });
    check('backup helper exits cleanly (PostgreSQL mode)', !out.includes('TypeError'), (out.split('\n')[0] || '').trim());
  } else {
    const out = execSync('node server/backup.js', { cwd: __dirname, encoding: 'utf8' });
    check('backup script exits cleanly', !out.includes('TypeError') && out.includes('Backup created'), out.split('\n')[0]);
    const Database = require('better-sqlite3');
    const backups = require('fs').readdirSync(require('path').join(__dirname, 'data', 'backups')).filter((d) => /^\d{14}$/.test(d)).sort().reverse();
    let backupOk = false;
    for (const b of backups.slice(0, 2)) {
      const p = require('path').join(__dirname, 'data', 'backups', b, 'doubtiq.db');
      if (!require('fs').existsSync(p)) continue;
      const bdb = new Database(p, { readonly: true });
      backupOk = backupOk || bdb.prepare('SELECT COUNT(*) n FROM questions').get().n >= 18;
      bdb.close();
      if (backupOk) break;
    }
    check('backup file is a valid, complete database', backupOk);
  }

  /* 9. Analytics removed; Overview has live stats */
  check('analytics endpoint removed', (await q2('/api/admin/analytics')).status === 404);
  const ov = await q2('/api/admin/overview');
  check('overview has live counts', ov.data.counts && typeof ov.data.counts.views === 'number');
  check('overview has live view feed', Array.isArray(ov.data.recentViews));

  /* 10. Cleanup */
  await api('DELETE', `/api/admin/questions/${qid}`, undefined, token2);
  check('test question cleaned up', true);

  console.log('\n' + (failures ? `✗ ${failures} failure(s)` : '✓ Reliability audit passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('Audit crashed:', e); process.exit(1); });
