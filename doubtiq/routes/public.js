'use strict';

/**
 * DoubtIQ — public API (student-facing, strictly READ-ONLY). PostgreSQL.
 * Students browse subjects, questions and answers, and search.
 * No accounts, no writes (the single question endpoint only records a real
 * view, exactly as before).
 */

const express = require('express');
const { q, qOne, run } = require('../data/db');

const router = express.Router();

/** Wrap an async handler so rejections reach Express's error middleware. */
const ar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------ utilities */

function publicQuestion(row) {
  return {
    id: row.id,
    slug: row.slug || String(row.id),
    title: row.title,
    body: row.body,
    topics: (row.topics || '').split(',').map((t) => t.trim()).filter(Boolean),
    subject_id: row.subject_id,
    subject: row.subject_slug,
    subject_name: row.subject_name,
    subject_color: row.subject_color,
    status: row.status,
    source: row.source || 'library',
    view_count: row.view_count,
    answer_count: row.answer_count || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    excerpt: (row.body || '').replace(/[*#`]/g, '').slice(0, 160)
  };
}

const PUBLISHED_JOIN = `
  SELECT q.*, s.slug AS subject_slug, s.name AS subject_name, s.color AS subject_color,
         (SELECT COUNT(*)::int FROM answers a WHERE a.question_id = q.id AND a.status = 'published') AS answer_count
  FROM questions q
  JOIN subjects s ON s.id = q.subject_id
  WHERE q.status = 'published'
`;

/** Resolve a question by slug or numeric id (published only). Async. */
async function findPublishedQuestion(ref) {
  const n = parseInt(ref, 10);
  if (ref && String(ref) === String(n)) {
    return qOne(`${PUBLISHED_JOIN} AND q.id = $1`, [n]);
  }
  return qOne(`${PUBLISHED_JOIN} AND q.slug = $1`, [ref]);
}

/* -------------------------------------------------------------- subjects */

router.get('/subjects', ar(async (req, res) => {
  const rows = await q(
    `SELECT id, slug, name, tagline, description, color, icon, question_count, position
     FROM subjects ORDER BY position ASC`
  );
  res.json({ subjects: rows });
}));

/* ----------------------------------------------------------------- stats */

router.get('/stats', ar(async (req, res) => {
  res.json({
    questions: (await qOne("SELECT COUNT(*)::int AS n FROM questions WHERE status = 'published'")).n,
    answers: (await qOne("SELECT COUNT(*)::int AS n FROM answers WHERE status = 'published'")).n,
    subjects: (await qOne('SELECT COUNT(*)::int AS n FROM subjects')).n,
    views: (await qOne('SELECT COALESCE(SUM(view_count), 0)::int AS n FROM questions')).n
  });
}));

/* ---------------------------------------------------------------- search */

// Escape LIKE wildcards so user input is matched literally.
function likeEsc(str) {
  return String(str).replace(/[\\%_]/g, '\\$&');
}

/** Relevance score (higher = more relevant). Pure function, injection-safe. */
function scoreQuestion(query, row) {
  const title = String(row.title || '').toLowerCase();
  const topics = String(row.topics || '').toLowerCase();
  const subjectName = String(row.subject_name || '').toLowerCase();
  const body = String(row.body || '').toLowerCase();
  const needle = query.toLowerCase();

  if (title === needle) return 1000;                  // exact title match
  if (title.startsWith(needle)) return 800;           // title starts with
  if (title.includes(needle)) return 600;             // title contains
  if (topics.includes(needle)) return 400;            // topic/tag match
  if (subjectName.includes(needle)) return 300;       // subject name match
  if (body.includes(needle)) return 200;              // body contains
  return 120;                                          // FTS-matched fallback
}

/** Candidate search over the pre-existing questions.search_vector tsvector,
 * with a LIKE fallback for the same fields (keeps partial-word, single-letter
 * and Hindi queries working exactly as the old FTS + LIKE hybrid did). */
async function searchCandidates(query, limit) {
  const like = `%${likeEsc(query).toLowerCase()}%`;
  const select = `
    SELECT q.id, q.title, q.topics, q.body, q.view_count, q.created_at, s.name AS subject_name
    FROM questions q JOIN subjects s ON s.id = q.subject_id
    WHERE q.status = 'published'
  `;
  const likeClause =
    '(LOWER(q.title) LIKE $1 OR LOWER(q.body) LIKE $1 OR LOWER(q.topics) LIKE $1 OR LOWER(s.name) LIKE $1)';

  const terms = String(query).split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]+/gu, '').replace(/['\\]/g, ''))
    .filter(Boolean);

  let tsQuery = null;
  if (terms.length) tsQuery = terms.map((t) => `${t}:*`).join(' & ');

  try {
    if (tsQuery) {
      return await q(`
        ${select}
          AND (q.search_vector @@ to_tsquery('simple', $2) OR ${likeClause})
        ORDER BY ts_rank_cd(q.search_vector, to_tsquery('simple', $2)) DESC,
                 q.view_count DESC, q.created_at DESC
        LIMIT ${Math.min(parseInt(limit, 10) || 300, 300)}
      `, [like, tsQuery]);
    }
  } catch (e) {
    // to_tsquery can reject unusual input — fall through to LIKE only.
  }
  return q(`
    ${select} AND ${likeClause}
    ORDER BY q.view_count DESC, q.created_at DESC
    LIMIT ${Math.min(parseInt(limit, 10) || 300, 300)}
  `, [like]);
}

router.get('/search', ar(async (req, res) => {
  const query = String(req.query.q || '').trim();
  const subject = String(req.query.subject || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  if (!query && !(subject && subject !== 'all')) return res.json({ results: [], total: 0 });

  if (!query) {
    // Subject-only browse: all published questions in that subject.
    const rows = await q(`${PUBLISHED_JOIN} AND s.slug = $1 ORDER BY q.created_at DESC LIMIT $2`, [subject, limit]);
    return res.json({ results: rows.map(publicQuestion), total: rows.length });
  }

  // 1) Candidate selection — tsvector (+ LIKE fallback), popularity pre-sort.
  const candidates = await searchCandidates(query, 300);

  // 2) Rank by relevance, then popularity, then recency (as before).
  candidates.forEach((c) => { c._score = scoreQuestion(query, c); });
  candidates.sort((a, b) =>
    (b._score - a._score) ||
    (b.view_count - a.view_count) ||
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  const topIds = candidates.slice(0, limit).map((c) => c.id);

  // 3) Fetch the full published rows for the winners (ordered by rank).
  let results = [];
  if (topIds.length) {
    const rows = await q(
      `${PUBLISHED_JOIN} AND q.id IN (${topIds.map((_, i) => `$${i + 1}`).join(',')})`,
      topIds
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    results = topIds.map((id) => publicQuestion(byId[id])).filter(Boolean);
  }

  res.json({ results, total: results.length });
}));

/* -------------------------------------------------- all questions (list) */

router.get('/questions', ar(async (req, res) => {
  const subject = String(req.query.subject || '').trim();
  const sort = String(req.query.sort || 'recent');
  const query = String(req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);

  const clauses = [];
  const params = [];
  if (subject && subject !== 'all') { clauses.push(`s.slug = $${params.length + 1}`); params.push(subject); }
  if (query) {
    clauses.push(`(q.title ILIKE $${params.length + 1} OR q.body ILIKE $${params.length + 2} OR q.topics ILIKE $${params.length + 3})`);
    const like = `%${query}%`;
    params.push(like, like, like);
  }
  const order = sort === 'popular' ? 'q.view_count DESC, q.created_at DESC' : 'q.created_at DESC';
  params.push(limit);

  const rows = await q(`
    ${PUBLISHED_JOIN}
    ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
    ORDER BY ${order} LIMIT $${params.length}
  `, params);

  res.json({ questions: rows.map(publicQuestion) });
}));

/* ------------------------------------------------------- recent questions */

router.get('/questions/recent', ar(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 60);
  const subject = String(req.query.subject || '').trim();
  const extra = subject && subject !== 'all' ? 'AND s.slug = $2' : '';
  const params = subject && subject !== 'all' ? [limit, subject] : [limit];

  const rows = await q(`
    ${PUBLISHED_JOIN} ${extra}
    ORDER BY q.created_at DESC LIMIT $1
  `, params);

  res.json({ questions: rows.map(publicQuestion) });
}));

/* ------------------------------------------------------ subject questions */

router.get('/subjects/:slug/questions', ar(async (req, res) => {
  const subject = await qOne('SELECT * FROM subjects WHERE slug = $1', [req.params.slug]);
  if (!subject) return res.status(404).json({ error: 'Subject not found' });

  const sort = String(req.query.sort || 'recent');
  const order = sort === 'popular' ? 'q.view_count DESC' : 'q.created_at DESC';

  const rows = await q(`
    ${PUBLISHED_JOIN} AND s.slug = $1 ORDER BY ${order}
  `, [req.params.slug]);

  res.json({ subject, questions: rows.map(publicQuestion) });
}));

/* ---------------------------------------------------------------- pages */

router.get('/pages', ar(async (req, res) => {
  const rows = await q(
    `SELECT id, title, slug, status, updated_at FROM pages
     WHERE status = 'published' ORDER BY title ASC`
  );
  res.json({ pages: rows });
}));

router.get('/pages/:slug', ar(async (req, res) => {
  const page = await qOne(
    `SELECT id, title, slug, body, status, created_at, updated_at FROM pages
     WHERE slug = $1 AND status = 'published'`,
    [req.params.slug]
  );
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json({ page });
}));

/* ----------------------------------------------------- single question ++ */

// Lightweight view throttle: ignore repeated requests for the SAME question
// from the SAME IP within a short window, so obvious refresh/bot hammering of
// the JSON API doesn't inflate view counts. (Crawler SSR never counts views.)
const viewThrottle = new Map();
const VIEW_WINDOW_MS = 30 * 1000;

router.get('/questions/:ref', ar(async (req, res) => {
  const row = await findPublishedQuestion(req.params.ref);
  if (!row) return res.status(404).json({ error: 'Question not found' });

  const answers = await q(`
    SELECT id, question_id, author, body, is_verified, status, created_at, updated_at
    FROM answers WHERE question_id = $1 AND status = 'published'
    ORDER BY is_verified DESC, created_at ASC
  `, [row.id]);

  // One view per (ip, question) per 30s window — prevents obvious inflation.
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = ip + ':' + row.id;
  const now = Date.now();
  const last = viewThrottle.get(key) || 0;
  let counted = false;
  if (now - last >= VIEW_WINDOW_MS) {
    viewThrottle.set(key, now);
    if (viewThrottle.size > 20000) {
      // prune old entries occasionally to bound memory
      for (const [k, t] of viewThrottle) if (now - t > VIEW_WINDOW_MS) viewThrottle.delete(k);
    }
    await run('UPDATE questions SET view_count = view_count + 1 WHERE id = $1', [row.id]);
    await run('INSERT INTO question_views (question_id) VALUES ($1)', [row.id]);
    counted = true;
  }

  const question = publicQuestion(row);
  if (counted) question.view_count += 1; // reflect the recorded view
  question.answers = answers;
  res.json({ question });
}));

module.exports = { router, findPublishedQuestion };
