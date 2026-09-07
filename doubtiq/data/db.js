'use strict';

/**
 * DoubtIQ — database layer (PostgreSQL via node-postgres "pg").
 *
 * The application runtime database is PostgreSQL hosted on Supabase. The
 * schema, tables and data ALREADY exist there — this module only connects
 * and never creates, drops, seeds or migrates anything at runtime.
 *
 *   Connection : process.env.DATABASE_URL  (Supabase connection string)
 *   Driver     : pg (node-postgres) — asynchronous throughout.
 *
 * NOTES
 *   - better-sqlite3 is NOT used by the runtime. (It remains as a dependency
 *     only for the legacy SQLite backup/migration utilities in server/.)
 *   - Full-text search uses the pre-existing `questions.search_vector`
 *     tsvector column + its trigger/index — SQLite FTS5 is gone.
 *   - Passwords keep the unchanged scrypt "salt:hash" scheme.
 *
 * Output normalisation keeps API responses byte-compatible with the old
 * SQLite build:
 *   - bigint/int8 and numeric columns are returned as JavaScript numbers
 *     (ids, COUNT(*) and SUM results were numbers before).
 *   - timestamp columns are returned as "YYYY-MM-DD HH:MM:SS" UTC strings
 *     (exactly what SQLite's datetime('now') used to produce), so the
 *     front-end's timeAgo()/JSON-LD behaviour is unchanged.
 */

const path = require('path');
const crypto = require('crypto');
const { Pool, types } = require('pg');

// Load a local .env if present (never overrides real environment variables).
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true }); } catch (e) { /* dotenv optional */ }

/* ------------------------------------------------------- type normalisers */

// int8 / bigint → Number (so ids & COUNT(*) keep their old numeric JSON type).
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// numeric → Number (e.g. SUM() results).
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

/** Convert a pg timestamp value to the historical "YYYY-MM-DD HH:MM:SS" (UTC)
 * string format the API always returned. */
function toSqlUtc(d) {
  if (d === null || d === undefined) return d;
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  const t = new Date(String(d));
  if (Number.isNaN(t.getTime())) return String(d);
  return t.toISOString().slice(0, 19).replace('T', ' ');
}

/** Row normaliser: timestamps → SQLite-style strings; everything else kept. */
function normRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = toSqlUtc(out[k]);
  }
  return out;
}

function normRows(rows) {
  if (!rows || !rows.length) return rows || [];
  return rows.map(normRow);
}

/* ------------------------------------------------------------------ pool */

function isLocalHost(url) {
  return /localhost|127\.0\.0\.1|::1/.test(url.split('@').pop().split('/')[0]);
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Point it at the existing Supabase PostgreSQL ' +
      'connection string (see .env.example) and start again.'
    );
  }
  // Supabase requires TLS. Local/sandbox servers (127.0.0.1) generally do not.
  const needsSsl = !isLocalHost(url) || /(^|[?&])sslmode=require|(^|[?&])sslmode=verify/i.test(url);
  return new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined
  });
}

let pool = null;
function getPool() {
  if (!pool) pool = makePool();
  return pool;
}

/* ------------------------------------------------------------ low-level */

/** Run a statement against the pool and return { rowCount, rows } where rows
 * are timestamp-normalised. Use for INSERT/UPDATE/DELETE (optionally with
 * RETURNING) and SELECT. */
async function run(sql, params = []) {
  const res = await getPool().query(sql, params);
  return { rowCount: res.rowCount == null ? 0 : res.rowCount, rows: normRows(res.rows) };
}

/** SELECT — returns an array of normalised rows. */
async function q(sql, params = []) {
  const res = await getPool().query(sql, params);
  return normRows(res.rows);
}

/** SELECT — returns the first normalised row, or null. */
async function qOne(sql, params = []) {
  const res = await getPool().query(sql, params);
  return normRows(res.rows)[0] || null;
}

/* ----------------------------------------------------------- transaction */

/**
 * Run `work` inside a real PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK)
 * using a dedicated client checked out from the pool. `work` receives the
 * same q / qOne / run helpers bound to that client.
 */
async function tx(work) {
  const client = await getPool().connect();
  const cRun = async (sql, params = []) => {
    const res = await client.query(sql, params);
    return { rowCount: res.rowCount == null ? 0 : res.rowCount, rows: normRows(res.rows) };
  };
  const cQ = async (sql, params = []) => {
    const res = await client.query(sql, params);
    return normRows(res.rows);
  };
  const cQOne = async (sql, params = []) => {
    const res = await client.query(sql, params);
    return normRows(res.rows)[0] || null;
  };
  try {
    await client.query('BEGIN');
    const out = await work({ run: cRun, q: cQ, qOne: cQOne, client });
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------- auth helpers */
// scrypt "salt:hash" scheme — UNCHANGED behaviour (no DB involvement).

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/* ---------------------------------------------------------- db helpers */

/** Record an admin action in activity_log (async). */
async function logActivity(userId, action, detail = '') {
  await run(
    'INSERT INTO activity_log (user_id, action, detail) VALUES ($1, $2, $3)',
    [userId ?? null, action, detail || '']
  );
}

/** Recompute subjects.question_count from published questions. */
async function recountSubjects() {
  await run(`
    UPDATE subjects s
    SET question_count = (
      SELECT COUNT(*)::int FROM questions q
      WHERE q.subject_id = s.id AND q.status = 'published'
    )
  `);
}

/** Return the settings key/value map. */
async function getSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/* ------------------------------------------------------------ bootstrap */

let initialised = false;

/**
 * Runtime bootstrap. Connects to the existing PostgreSQL database and does a
 * light, read-only sanity check. It never creates tables, never migrates and
 * never seeds — the Supabase schema/data already exist.
 *
 * The only write ever performed here is the optional insertion of the two
 * default info pages, and ONLY when the pages table is completely empty
 * (i.e. an intentionally brand-new database with no migrated content).
 */
async function init() {
  const p = getPool(); // throws a helpful error if DATABASE_URL is missing
  await p.query('SELECT 1');

  const hasQuestions = await p.query(
    "SELECT to_regclass('questions') AS t"
  ).then((r) => r.rows[0] && r.rows[0].t);

  if (!initialised) {
    initialised = true;
    if (hasQuestions) {
      console.log('[db] connected to PostgreSQL. Schema OK.');
    } else {
      console.warn('[db] connected to PostgreSQL, but the "questions" table was not found.');
    }
  }

  // Brand-new empty database only: add the two static info pages so the
  // site's footer links never 404. No-op when pages already exist.
  if (hasQuestions) {
    try {
      await require('../server/default-pages').ensureDefaultPages();
    } catch (e) {
      console.error('[db] default pages skipped:', e.message);
    }
  }
}

/* ----------------------------------------------------------------- export */

module.exports = {
  pool: getPool,
  init,
  run,
  q,
  qOne,
  tx,
  logActivity,
  recountSubjects,
  getSettings,
  hashPassword,
  verifyPassword
};
