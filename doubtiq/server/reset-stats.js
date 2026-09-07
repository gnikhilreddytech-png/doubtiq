'use strict';

/**
 * DoubtIQ — reset view statistics (one-off maintenance script).
 *
 * Why this exists: if the PostgreSQL database was migrated from the old
 * SQLite demo database (or was used during testing), the `view_count`
 * numbers, the `question_views` feed and the `activity_log` can carry
 * leftover demo/test data. That makes the admin Overview show inflated,
 * duplicated, fake-looking statistics.
 *
 * This script wipes ONLY statistics so every number starts honestly at zero:
 *   - questions.view_count          → 0 for every question
 *   - question_views (live feed)    → all rows deleted
 *   - activity_log (admin log)      → all rows deleted
 *
 * It NEVER touches questions, answers, subjects, pages, users, sessions or
 * settings — content is untouched. Safe to run repeatedly.
 *
 * Usage (requires DATABASE_URL):
 *   npm run reset-stats
 *   # or: DATABASE_URL='postgres://…' node server/reset-stats.js
 *
 * Run it ONCE on the production database right after migration (or whenever
 * you want to restart view statistics from zero).
 */

const { run } = require('../data/db');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — point it at your PostgreSQL database.');
    process.exit(1);
  }

  const zeroed = await run('UPDATE questions SET view_count = 0');
  const cleared = await run('DELETE FROM question_views');
  const logCleared = await run('DELETE FROM activity_log');

  console.log('[reset-stats] view statistics reset to zero:');
  console.log(`  · questions.view_count updated      → ${zeroed.rowCount} row(s)`);
  console.log(`  · question_views (live feed) cleared → ${cleared.rowCount} row(s)`);
  console.log(`  · activity_log cleared               → ${logCleared.rowCount} row(s)`);
  console.log('Questions, answers, subjects, pages, users, sessions and settings were NOT touched.');
  process.exit(0);
})().catch((err) => {
  console.error('[reset-stats] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
