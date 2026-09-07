'use strict';

/**
 * DoubtIQ — SQLite file backup helper (LEGACY, retained utility).
 * Usage: node server/backup.js   (or: npm run backup)
 *
 * This copies a local SQLite database file — it is kept only so existing
 * local SQLite archives (or a checked-out copy of the old data/ dir) can
 * still be snapshotted. In the normal PostgreSQL/Supabase runtime there is
 * no local SQLite database: backups are handled by Supabase (point-in-time
 * recovery / pg_dump), and this script reports that cleanly instead.
 *
 * SQLite mode creates a consistent snapshot of the local database into
 * data/backups/<ts>/ WITHOUT stopping the app:
 *
 *   1. Open a second connection to the live database (WAL mode).
 *   2. `PRAGMA wal_checkpoint(TRUNCATE)` — flush all WAL frames into the
 *      main .db file so the copy is complete and consistent.
 *   3. Copy doubtiq.db (plus any -wal/-shm sidecars, for completeness).
 *
 * The SQLite backup() API is NOT used: in some environments/versions it
 * reports success while producing no file (see audit note). The checkpoint
 * + copy approach is deterministic and verified.
 *
 * RESTORE:
 *   1. Stop the app.
 *   2. Replace data/doubtiq.db with the backup (also -wal/-shm if present).
 *   3. Start the app again. That's it — the database is the single source
 *      of truth and the app never re-seeds an existing database.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const SOURCE = path.join(DATA_DIR, 'doubtiq.db');

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const dir = path.join(DATA_DIR, 'backups', stamp());
fs.mkdirSync(dir, { recursive: true });

if (!fs.existsSync(SOURCE)) {
  if (process.env.DATABASE_URL) {
    console.log('PostgreSQL/Supabase mode: there is no local SQLite database to back up.');
    console.log('Production backups are handled by Supabase (PITR) or pg_dump — see DEPLOY.md.');
    try { fs.rmdirSync(dir); } catch (e) { /* ignore */ }
    process.exit(0);
  }
  console.error('No database found at', SOURCE);
  process.exit(1);
}

let ok = false;

// 1) Checkpoint WAL into the main file so the copy is a complete snapshot.
try {
  const Database = require('better-sqlite3');
  const conn = new Database(SOURCE);
  conn.pragma('wal_checkpoint(TRUNCATE)');
  conn.close();
  ok = true;
} catch (e) {
  console.error('WAL checkpoint failed (proceeding with copy):', e.message);
}

// 2) Copy the main file + any WAL/SHM sidecars.
const files = ['doubtiq.db'];
for (const s of ['doubtiq.db-wal', 'doubtiq.db-shm']) {
  if (fs.existsSync(path.join(DATA_DIR, s))) files.push(s);
}
for (const f of files) {
  fs.copyFileSync(path.join(DATA_DIR, f), path.join(dir, f));
}

const size = fs.statSync(path.join(dir, 'doubtiq.db')).size;
console.log(`Backup created → ${path.join(dir, 'doubtiq.db')} (${(size / 1024).toFixed(0)} KB, ${files.join(', ')})`);
console.log('To restore: stop the app, replace the data files with this backup, start again.');
console.log('Latest backups:');
const backups = fs.readdirSync(path.join(DATA_DIR, 'backups')).filter((d) => /^\d{14}$/.test(d)).sort().reverse().slice(0, 5);
for (const b of backups) {
  const p = path.join(DATA_DIR, 'backups', b, 'doubtiq.db');
  if (fs.existsSync(p)) console.log(`  ${b}  ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
}
process.exit(ok ? 0 : 1);
