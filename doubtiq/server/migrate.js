'use strict';

/**
 * DoubtIQ — LEGACY SQLite migration utility (retained for archives).
 *
 * This was the one-time migration used by the old SQLite build. The runtime
 * now uses the existing PostgreSQL database on Supabase (data/db.js), which
 * is already provisioned and migrated — migrate.js is NOT invoked at runtime
 * any more. It is kept only for historical/offline SQLite archives.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const MAIN_DB = path.join(DATA_DIR, 'doubtiq.db');
const LEGACY_ADMIN_DB = path.join(__dirname, '..', 'data', 'admin-content.db');
const MIGRATED_KEY = 'db_migration_v2';

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'question';
}

function backupFiles(db) {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = path.join(DATA_DIR, 'backups', ts);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = () => new Date().toISOString().replace(/[-:T]/g, '');
  try {
    db.prepare(`VACUUM INTO ?`).run(path.join(dir, `doubtiq-${stamp()}.db`));
  } catch (e) {
    // VACUUM INTO may be unsupported — fall back to a file copy.
    if (fs.existsSync(MAIN_DB)) fs.copyFileSync(MAIN_DB, path.join(dir, `doubtiq-${stamp()}.db`));
  }
  if (fs.existsSync(LEGACY_ADMIN_DB)) {
    fs.copyFileSync(LEGACY_ADMIN_DB, path.join(dir, `admin-content-${stamp()}.db`));
  }
  console.log(`[migrate] backup snapshot → ${dir}`);
  return dir;
}

function ensureColumns(db) {
  const cols = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
  if (!cols.includes('source')) {
    db.prepare("ALTER TABLE questions ADD COLUMN source TEXT NOT NULL DEFAULT 'library'").run();
    console.log('[migrate] added questions.source');
  }
  if (!cols.includes('slug')) {
    db.prepare('ALTER TABLE questions ADD COLUMN slug TEXT').run();
    console.log('[migrate] added questions.slug');
  }
  if (!cols.includes('topics')) {
    db.prepare('ALTER TABLE questions ADD COLUMN topics TEXT NOT NULL DEFAULT \'\'').run();
    console.log('[migrate] added questions.topics');
  }
}

function mergeAdminContent(db) {
  if (!fs.existsSync(LEGACY_ADMIN_DB)) return false;
  // Idempotence guard: never merge twice (already-merged rows carry source='admin').
  if (db.prepare("SELECT 1 FROM questions WHERE source = 'admin' LIMIT 1").get()) {
    console.log('[migrate] admin content already merged — skipping');
    return false;
  }
  const legacy = require('better-sqlite3')(LEGACY_ADMIN_DB, { readonly: true });
  const legacyHas = legacy.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='admin_questions'"
  ).get().n > 0;
  if (!legacyHas) { legacy.close(); return false; }

  const aq = legacy.prepare('SELECT * FROM admin_questions').all();
  const aa = legacy.prepare('SELECT * FROM admin_answers').all();
  const av = legacy.prepare('SELECT * FROM admin_question_views').all();
  legacy.close();
  if (!aq.length) return false;

  const slugOf = (s) => db.prepare('SELECT id FROM subjects WHERE slug = ?').get(s);
  const subjFallback = () => db.prepare('SELECT id FROM subjects ORDER BY position LIMIT 1').get();

  const slugExists = db.prepare('SELECT 1 FROM questions WHERE slug = ?');
  const uniqSlug = (base) => {
    let slug = slugify(base); let i = 2;
    while (slugExists.get(slug)) slug = `${slugify(base)}-${i++}`;
    return slug;
  };

  const insQ = db.prepare(`
    INSERT INTO questions (subject_id, title, body, status, view_count, created_at, updated_at, source, slug, topics)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?)
  `);
  const insA = db.prepare(`
    INSERT INTO answers (question_id, author, body, is_verified, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insV = db.prepare('INSERT INTO question_views (question_id, viewed_at) VALUES (?, ?)');

  const tx = db.transaction(() => {
    const idMap = {};
    for (const q of aq) {
      const subj = slugOf(q.subject_slug) || subjFallback();
      const info = insQ.run(
        subj.id, q.title, q.body || '', q.status || 'published',
        q.view_count || 0, q.created_at, q.updated_at || q.created_at,
        uniqSlug(q.title), q.topics || ''
      );
      idMap[q.id] = info.lastInsertRowid;
    }
    for (const a of aa) {
      const nq = idMap[a.question_id];
      if (!nq) continue;
      insA.run(nq, a.author || 'DoubtIQ Expert', a.body, a.is_verified ? 1 : 0, a.status || 'published', a.created_at, a.updated_at || a.created_at);
    }
    for (const v of av) {
      const nq = idMap[v.question_id];
      if (!nq) continue;
      insV.run(nq, v.viewed_at);
    }
  });
  tx();
  console.log(`[migrate] merged admin content: ${aq.length} questions, ${aa.length} answers, ${av.length} view logs`);
  // Archive the legacy file so it can never be re-merged (backup copy exists).
  try { fs.renameSync(LEGACY_ADMIN_DB, LEGACY_ADMIN_DB + '.archived'); }
  catch (e) { try { fs.unlinkSync(LEGACY_ADMIN_DB); } catch (e2) { /* ignore */ } }
  return true;
}

function removeCuriousQuestions(db) {
  const subj = db.prepare("SELECT id FROM subjects WHERE slug = 'curious-questions'").get();
  if (!subj) return;
  const before = db.prepare('SELECT COUNT(*) AS n FROM questions WHERE subject_id = ?').get(subj.id).n;
  db.prepare('DELETE FROM questions WHERE subject_id = ?').run(subj.id);
  db.prepare('DELETE FROM subjects WHERE id = ?').run(subj.id);
  console.log(`[migrate] removed Curious Questions subject + ${before} questions (and their answers/views via cascade)`);
}

function backfillSlugs(db) {
  const rows = db.prepare('SELECT id, title FROM questions WHERE slug IS NULL OR slug = \'\'').all();
  if (!rows.length) return;
  const exists = db.prepare('SELECT 1 FROM questions WHERE slug = ? AND id != ?');
  const upd = db.prepare('UPDATE questions SET slug = ? WHERE id = ?');
  const tx = db.transaction((list) => {
    for (const r of list) {
      let slug = slugify(r.title); let i = 2;
      while (exists.get(slug, r.id)) slug = `${slugify(r.title)}-${i++}`;
      upd.run(slug, r.id);
    }
  });
  tx(rows);
  console.log(`[migrate] backfilled ${rows.length} question slug(s)`);
}

/** Replace a legacy external-content FTS table (from old builds) with the
 * standalone index; safe to run on every boot — only acts when needed. */
function ensureStandaloneFts(db) {
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='questions_fts'").get();
    if (row && /content\s*=/.test(row.sql || '')) {
      db.exec(`
        DROP TRIGGER IF EXISTS questions_ai;
        DROP TRIGGER IF EXISTS questions_ad;
        DROP TRIGGER IF EXISTS questions_au;
        DROP TABLE IF EXISTS questions_fts;
        CREATE VIRTUAL TABLE IF NOT EXISTS questions_fts USING fts5(
          title, body, topics, subject_name, tokenize='unicode61'
        );
      `);
      console.log('[migrate] replaced legacy external-content FTS index');
    }
  } catch (e) { /* table absent or FTS unavailable — fine */ }
}

function migrate(db) {
  ensureStandaloneFts(db);
  const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get(MIGRATED_KEY);
  if (settings && settings.value === '1') return false;

  console.log('[migrate] starting database migration…');
  backupFiles(db);
  ensureColumns(db);
  mergeAdminContent(db);
  removeCuriousQuestions(db);
  backfillSlugs(db);
  db.prepare("INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run(MIGRATED_KEY);
  console.log('[migrate] complete ✓');
  return true;
}

module.exports = { migrate };

// Standalone run: node server/migrate.js
if (require.main === module) {
  if (process.env.DATABASE_URL) {
    console.log('[migrate] PostgreSQL (Supabase) database is already provisioned & migrated — nothing to do.');
    process.exit(0);
  }
  console.error('[migrate] The one-time SQLite migration is not part of the PostgreSQL runtime.');
  console.error('To migrate an old local SQLite archive, use the pre-PostgreSQL version of this repository.');
  process.exit(1);
}
