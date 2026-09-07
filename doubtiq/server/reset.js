'use strict';

/**
 * DoubtIQ — reset guard (PostgreSQL build).
 *
 * The runtime database is PostgreSQL hosted on Supabase. A "reset" that wiped
 * that database would destroy production content, so this script REFUSES to
 * run when DATABASE_URL is set. Reset content in Supabase deliberately via
 * the Supabase dashboard / SQL editor (or restore from a Supabase backup).
 *
 * (The old SQLite file-wipe behaviour was part of the pre-PostgreSQL build
 * and is intentionally gone.)
 */

if (process.env.DATABASE_URL) {
  console.error('────────────────────────────────────────────────────────────');
  console.error('`npm run reset` is DISABLED for this PostgreSQL build.');
  console.error('');
  console.error('This application now uses the existing Supabase PostgreSQL');
  console.error('database (DATABASE_URL). Deleting or resetting PostgreSQL');
  console.error('data is intentionally not supported from this command.');
  console.error('');
  console.error('To reset content, use the Supabase dashboard / SQL editor,');
  console.error('or restore from a Supabase backup.');
  console.error('────────────────────────────────────────────────────────────');
  process.exit(1);
}

console.error('DATABASE_URL is not set — nothing to reset.');
console.error('Set DATABASE_URL to your Supabase connection string and re-run the server.');
process.exit(1);
