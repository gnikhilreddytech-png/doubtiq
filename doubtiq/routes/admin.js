'use strict';

/**
 * DoubtIQ — admin API (PostgreSQL). Every endpoint here requires an active
 * admin session. Sections: overview, questions, answers, subjects, settings.
 * All database access is async (pg) with proper $1 placeholders.
 */

const express = require('express');
const crypto = require('crypto');
const {
  hashPassword, verifyPassword, logActivity, recountSubjects, getSettings,
  run, q, qOne, tx
} = require('../data/db');

const router = express.Router();

/** Wrap an async handler so rejections reach Express's error middleware. */
const ar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------ rate limit */
// Simple in-memory login rate limiter: 10 attempts / 15 min / IP.
const loginAttempts = new Map();
const RATE_MAX = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (rec.resetAt < now) { rec.count = 0; rec.resetAt = now + RATE_WINDOW_MS; }
  rec.count += 1;
  loginAttempts.set(ip, rec);
  if (rec.count > RATE_MAX) {
    const wait = Math.ceil((rec.resetAt - now) / 1000);
    return res.status(429).json({ error: `Too many login attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` });
  }
  // Prune stale entries occasionally
  if (Math.random() < 0.01) {
    for (const [k, v] of loginAttempts) if (v.resetAt < Date.now()) loginAttempts.delete(k);
  }
  next();
}

// Public-ish auth endpoints (login/logout/me). Mounted separately, before the
// requireAdmin guard — login must be reachable without a session.
const authRouter = express.Router();

authRouter.post('/login', loginRateLimit, ar(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.length > 64 || password.length > 256) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const user = await qOne('SELECT * FROM users WHERE username = $1', [username.trim()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  // Successful login resets the attempt counter for this IP.
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  loginAttempts.delete(ip);
  if (user.status !== 'active') return res.status(403).json({ error: 'This account has been disabled' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { createSession, sessionCookie } = require('../server/auth');
  const token = await createSession(user.id);
  await run('UPDATE users SET last_active_at = NOW() WHERE id = $1', [user.id]);

  const secure = process.env.COOKIE_SECURE === '1';
  res.setHeader('Set-Cookie', sessionCookie(token, { secure }));
  res.json({
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    token // in-memory fallback for environments where cookies are stripped
  });
}));

authRouter.post('/logout', ar(async (req, res) => {
  const { destroySession, clearCookie, getTokenFromRequest } = require('../server/auth');
  await destroySession(getTokenFromRequest(req));
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
}));

authRouter.get('/me', ar(async (req, res) => {
  const { getSessionUser } = require('../server/auth');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ user });
}));

/* ---------------------------------------------------------------- helpers */

function adminQuestion(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    topics: row.topics || '',
    status: row.status,
    view_count: row.view_count,
    answer_count: row.answer_count || 0,
    subject_id: row.subject_id,
    subject_slug: row.subject_slug,
    subject_name: row.subject_name,
    subject_color: row.subject_color,
    source: row.source || 'library',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const QUESTION_SELECT = `
  SELECT q.*, s.slug AS subject_slug, s.name AS subject_name, s.color AS subject_color,
         (SELECT COUNT(*)::int FROM answers a WHERE a.question_id = q.id) AS answer_count
  FROM questions q JOIN subjects s ON s.id = q.subject_id
`;

function slugify(str) {
  return String(str || '').toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'question';
}

async function uniqueSlug(base, excludeId, dbx) {
  const look = dbx || { qOne };
  const slug = slugify(base);
  let candidate = slug;
  let i = 2;
  while (await look.qOne('SELECT 1 FROM questions WHERE slug = $1 AND id != $2', [candidate, excludeId || 0])) {
    candidate = `${slug}-${i++}`;
  }
  return candidate;
}

async function audit(admin, action, detail) {
  await logActivity(admin.id, `admin_${action}`, detail);
}

/* ---------------------------------------------------------------- overview */

router.get('/overview', ar(async (req, res) => {
  const [counts, recent, recentViews, subjectDist, topQuestions] = await Promise.all([
    qOne(`
      SELECT
        (SELECT COUNT(*)::int FROM questions) AS questions_total,
        (SELECT COUNT(*)::int FROM questions WHERE status = 'published') AS questions_published,
        (SELECT COUNT(*)::int FROM questions WHERE status = 'unpublished') AS questions_unpublished,
        (SELECT COUNT(*)::int FROM answers) AS answers_total,
        (SELECT COUNT(*)::int FROM answers WHERE status = 'published') AS answers_published,
        (SELECT COUNT(*)::int FROM subjects) AS subjects,
        (SELECT COALESCE(SUM(view_count), 0)::int FROM questions) AS views
    `),
    q(`
      SELECT a.id, a.action, a.detail, a.created_at, u.username, u.display_name
      FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT 12
    `),
    // Live view feed (newest first).
    q(`
      SELECT q.id, q.title, v.viewed_at
      FROM question_views v JOIN questions q ON q.id = v.question_id
      ORDER BY v.viewed_at DESC, v.id DESC LIMIT 12
    `),
    q(`
      SELECT s.slug, s.name, s.color, COUNT(q.id)::int AS n
      FROM subjects s LEFT JOIN questions q ON q.subject_id = s.id
      GROUP BY s.id, s.slug, s.name, s.color
      ORDER BY s.position
    `),
    q(`
      SELECT q.id, q.slug, q.title, s.name AS subject_name, q.view_count
      FROM questions q JOIN subjects s ON s.id = q.subject_id
      ORDER BY q.view_count DESC LIMIT 5
    `)
  ]);

  res.json({ counts, recent, recentViews, subjectDist, topQuestions });
}));

/* -------------------------------------------------------------- questions */

router.get('/questions', ar(async (req, res) => {
  const search = String(req.query.q || '').trim();
  const subject = String(req.query.subject || '').trim();
  const status = String(req.query.status || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(q.title ILIKE $' + (params.length + 1) + ' OR q.body ILIKE $' + (params.length + 2) + ' OR q.topics ILIKE $' + (params.length + 3) + ')');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (subject && subject !== 'all') { clauses.push(`s.slug = $${params.length + 1}`); params.push(subject); }
  if (status && status !== 'all') { clauses.push(`q.status = $${params.length + 1}`); params.push(status); }
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await q(`${QUESTION_SELECT} ${where} ORDER BY q.created_at DESC LIMIT $${params.length}`, params);
  res.json({ questions: rows.map(adminQuestion), total: rows.length });
}));

router.post('/questions', ar(async (req, res) => {
  const { title, body, subject_id, status, topics, answer_body, answer_author, answer_verified } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  const sid = parseInt(subject_id, 10);
  if (!await qOne('SELECT id FROM subjects WHERE id = $1', [sid])) {
    return res.status(400).json({ error: 'Choose a valid subject' });
  }
  const pub = status === 'published' ? 'published' : 'unpublished';
  const cleanTitle = String(title).trim().slice(0, 300);
  const cleanBody = String(body || '').slice(0, 20000);
  const cleanTopics = String(topics || '').slice(0, 500);
  const hasAnswer = !!(answer_body && String(answer_body).trim());
  const cleanAnswer = hasAnswer ? String(answer_body).trim().slice(0, 50000) : null;
  const cleanAuthor = hasAnswer ? (String(answer_author || 'Author').trim().slice(0, 100) || 'Author') : null;

  // Atomic create: the question AND its answer are written in ONE PostgreSQL
  // transaction (BEGIN/COMMIT/ROLLBACK) so a failure can never leave an
  // orphaned question or half-saved content.
  const qid = await tx(async (dbx) => {
    const slug = await uniqueSlug(cleanTitle, 0, dbx);
    const ins = await dbx.run(`
      INSERT INTO questions (subject_id, title, body, topics, status, slug)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [sid, cleanTitle, cleanBody, cleanTopics, pub, slug]);
    const id = ins.rows[0].id;
    if (hasAnswer) {
      await dbx.run(`
        INSERT INTO answers (question_id, author, body, is_verified, status)
        VALUES ($1, $2, $3, $4, $5)
      `, [id, cleanAuthor, cleanAnswer, answer_verified !== false ? 1 : 0, pub]);
    }
    return id;
  });

  await recountSubjects();
  await audit(req.user, 'question_create', String(qid));
  res.json({ ok: true, id: qid });
}));

router.put('/questions/:id', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const qrow = await qOne('SELECT id FROM questions WHERE id = $1', [id]);
  if (!qrow) return res.status(404).json({ error: 'Question not found' });

  const { title, body, subject_id, status, topics } = req.body || {};
  if (title !== undefined && !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  let sid = parseInt(subject_id, 10);
  if (!sid) sid = null;

  // SLUG STABILITY: editing a title must NOT regenerate the slug. A stable
  // slug means previously indexed Google URLs never break. A slug is only
  // ever assigned at creation.
  await run(`
    UPDATE questions SET
      title = COALESCE($1, title),
      body = COALESCE($2, body),
      topics = COALESCE($3, topics),
      subject_id = COALESCE($4, subject_id),
      status = COALESCE($5, status),
      updated_at = NOW()
    WHERE id = $6
  `, [
    title !== undefined ? String(title).trim().slice(0, 300) : null,
    body !== undefined ? String(body).slice(0, 20000) : null,
    topics !== undefined ? String(topics).slice(0, 500) : null,
    sid,
    status === 'published' || status === 'unpublished' ? status : null,
    id
  ]);
  await recountSubjects();
  await audit(req.user, 'question_update', String(id));
  res.json({ ok: true });
}));

router.put('/questions/:id/status', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body.status || '');
  if (!['published', 'unpublished'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const info = await run('UPDATE questions SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
  if (!info.rowCount) return res.status(404).json({ error: 'Question not found' });
  await recountSubjects();
  await audit(req.user, `question_${status}`, String(id));
  res.json({ ok: true });
}));

router.delete('/questions/:id', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const info = await run('DELETE FROM questions WHERE id = $1', [id]);
  if (!info.rowCount) return res.status(404).json({ error: 'Question not found' });
  await recountSubjects();
  await audit(req.user, 'question_delete', String(id));
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- answers */

router.get('/questions/:id/answers', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = await q(`
    SELECT a.*, q.title AS question_title, s.name AS subject_name
    FROM answers a JOIN questions q ON q.id = a.question_id JOIN subjects s ON s.id = q.subject_id
    WHERE a.question_id = $1 ORDER BY a.created_at DESC
  `, [id]);
  res.json({ answers: rows });
}));

router.post('/answers', ar(async (req, res) => {
  const { question_id, author, body, is_verified, status } = req.body || {};
  const qid = parseInt(question_id, 10);
  if (!await qOne('SELECT id FROM questions WHERE id = $1', [qid])) {
    return res.status(400).json({ error: 'Question not found' });
  }
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Answer body is required' });
  const cleanBody = String(body).trim().slice(0, 50000);
  const info = await run(`
    INSERT INTO answers (question_id, author, body, is_verified, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [
    qid,
    String(author || 'Author').trim().slice(0, 100) || 'Author',
    cleanBody,
    is_verified ? 1 : 0,
    status === 'published' ? 'published' : 'unpublished'
  ]);
  await run('UPDATE questions SET updated_at = NOW() WHERE id = $1', [qid]);
  await audit(req.user, 'answer_create', String(info.rows[0].id));
  res.json({ ok: true, id: info.rows[0].id });
}));

router.put('/answers/:id', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const a = await qOne('SELECT id, question_id FROM answers WHERE id = $1', [id]);
  if (!a) return res.status(404).json({ error: 'Answer not found' });
  const { body, author, is_verified, status } = req.body || {};
  await run(`
    UPDATE answers SET
      body = COALESCE($1, body),
      author = COALESCE($2, author),
      is_verified = COALESCE($3, is_verified),
      status = COALESCE($4, status),
      updated_at = NOW()
    WHERE id = $5
  `, [
    body !== undefined ? String(body).trim().slice(0, 50000) : null,
    author !== undefined ? String(author).trim().slice(0, 100) : null,
    is_verified !== undefined ? (is_verified ? 1 : 0) : null,
    status === 'published' || status === 'unpublished' ? status : null,
    id
  ]);
  await run('UPDATE questions SET updated_at = NOW() WHERE id = $1', [a.question_id]);
  await audit(req.user, 'answer_update', String(id));
  res.json({ ok: true });
}));

router.put('/answers/:id/status', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body.status || '');
  if (!['published', 'unpublished'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const info = await run('UPDATE answers SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
  if (!info.rowCount) return res.status(404).json({ error: 'Answer not found' });
  await audit(req.user, `answer_${status}`, String(id));
  res.json({ ok: true });
}));

router.delete('/answers/:id', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const info = await run('DELETE FROM answers WHERE id = $1', [id]);
  if (!info.rowCount) return res.status(404).json({ error: 'Answer not found' });
  await audit(req.user, 'answer_delete', String(id));
  res.json({ ok: true });
}));

/* --------------------------------------------------------------- subjects */

router.get('/subjects', ar(async (req, res) => {
  const rows = await q(`
    SELECT s.*,
           (SELECT COUNT(*)::int FROM questions q WHERE q.subject_id = s.id) AS question_count,
           (SELECT COUNT(*)::int FROM answers a JOIN questions q ON q.id = a.question_id WHERE q.subject_id = s.id) AS answer_count
    FROM subjects s ORDER BY s.position ASC
  `);
  res.json({ subjects: rows });
}));

// Create an extra subject (the six core subjects are part of the existing
// database; extras are stored permanently and appear everywhere).
router.post('/subjects', ar(async (req, res) => {
  const { name, slug, tagline, description, color, icon } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });

  const cleanName = String(name).trim().slice(0, 100);
  let finalSlug = String(slug || '').trim().toLowerCase() || slugify(cleanName);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(finalSlug) || finalSlug.length > 60) {
    return res.status(400).json({ error: 'Slug must be lowercase letters, numbers and hyphens only' });
  }
  if (await qOne('SELECT 1 FROM subjects WHERE slug = $1', [finalSlug])) {
    return res.status(400).json({ error: 'A subject with this slug already exists' });
  }

  const pos = await qOne('SELECT COALESCE(MAX(position), 0)::int + 1 AS n FROM subjects');
  const position = pos ? pos.n : 1;
  const col = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#3d4fe3';
  const iconName = String(icon || 'book').trim().slice(0, 40) || 'book';

  const info = await run(`
    INSERT INTO subjects (slug, name, tagline, description, color, icon, position)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    finalSlug, cleanName,
    String(tagline || '').trim().slice(0, 200),
    String(description || '').trim().slice(0, 2000),
    col, iconName, position
  ]);
  await audit(req.user, 'subject_create', `${info.rows[0].id}:${finalSlug}`);
  res.json({ ok: true, id: info.rows[0].id, slug: finalSlug });
}));

// Delete an extra subject — only allowed when it has NO questions.
router.delete('/subjects/:id', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = await qOne('SELECT id, name FROM subjects WHERE id = $1', [id]);
  if (!s) return res.status(404).json({ error: 'Subject not found' });
  const qn = (await qOne('SELECT COUNT(*)::int AS n FROM questions WHERE subject_id = $1', [id])).n;
  if (qn > 0) {
    return res.status(400).json({
      error: `Cannot delete "${s.name}" — it contains ${qn} question(s). Delete or move those questions first.`
    });
  }
  await run('DELETE FROM subjects WHERE id = $1', [id]);
  await audit(req.user, 'subject_delete', String(id));
  res.json({ ok: true });
}));

router.put('/subjects/:id', ar(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = await qOne('SELECT id FROM subjects WHERE id = $1', [id]);
  if (!s) return res.status(404).json({ error: 'Subject not found' });
  const { name, tagline, description, color, icon } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });

  await run(`
    UPDATE subjects SET
      name = COALESCE($1, name),
      tagline = COALESCE($2, tagline),
      description = COALESCE($3, description),
      color = COALESCE($4, color),
      icon = COALESCE($5, icon)
    WHERE id = $6
  `, [
    name !== undefined ? String(name).trim().slice(0, 100) : null,
    tagline !== undefined ? String(tagline).trim().slice(0, 200) : null,
    description !== undefined ? String(description).slice(0, 2000) : null,
    color !== undefined && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    icon !== undefined && String(icon).trim() ? String(icon).trim().slice(0, 40) : null,
    id
  ]);
  await audit(req.user, 'subject_update', String(id));
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- settings */

router.get('/settings', ar(async (req, res) => {
  res.json({ settings: await getSettings() });
}));

router.put('/settings', ar(async (req, res) => {
  const allowed = ['site_name', 'site_tagline'];
  const { settings = {} } = req.body || {};
  for (const key of allowed) {
    if (typeof settings[key] === 'string') {
      await run(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, settings[key].trim().slice(0, 200)]
      );
    }
  }
  await audit(req.user, 'settings_update', allowed.filter((k) => typeof settings[k] === 'string').join(','));
  res.json({ ok: true, settings: await getSettings() });
}));

router.put('/me/password', ar(async (req, res) => {
  const { current, next } = req.body || {};
  const admin = await qOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!verifyPassword(current, admin.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!next || typeof next !== 'string' || String(next).length < 8 || String(next).length > 128) {
    return res.status(400).json({ error: 'New password must be 8–128 characters' });
  }
  await run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(String(next)), req.user.id]);
  // Invalidate every OTHER session for this admin after a password change;
  // keep the current session active.
  const { getTokenFromRequest } = require('../server/auth');
  const currentToken = getTokenFromRequest(req);
  await run('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [req.user.id, currentToken || '']);
  await audit(req.user, 'password_change', '');
  res.json({ ok: true });
}));

module.exports = { router, authRouter };
