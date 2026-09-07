'use strict';

/**
 * DoubtIQ — default static pages (PostgreSQL).
 *
 * Called by data/db.js during boot ONLY when the `pages` table is empty — a
 * genuinely brand-new database with no migrated content. In that situation it
 * inserts two informational pages (About, How to use) so the site footer
 * links never 404. When the existing (Supabase) database already has pages
 * this is a complete no-op and touches no data.
 *
 * No demo questions/answers are ever inserted, and nothing else is created.
 */

const { q, run } = require('../data/db');

/** Default custom pages — only when the pages table is empty. */
async function ensureDefaultPages() {
  const existing = await qOneEmptyCheck();
  if (existing > 0) return;

  const ins = `
    INSERT INTO pages (title, slug, body, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
  `;

  const PAGES = [
    {
      title: 'About DoubtIQ',
      slug: 'about',
      body: '**DoubtIQ is a curated question-and-answer library.** It brings together high-quality questions and clear, well-explained answers across Maths, Physics, Chemistry, Biology, Social Science and Hindi.\n\nEvery question and answer is written, checked and published by the editorial team — so you can trust what you read. There are no community posts, no unverified answers and no distractions.\n\n### What you can do\n\n- Browse questions by subject\n- Read clear, step-by-step answers\n- Search across the whole library\n- Switch between light and dark mode\n\n### What you won\u2019t find\n\n- No accounts or sign-ins\n- No asking or answering — this is a reading library\n- No ads, AI or community noise\n\nDoubtIQ is built for one simple purpose: **every doubt, answered clearly.**',
      status: 'published'
    },
    {
      title: 'How to use this library',
      slug: 'how-to-use',
      body: 'Finding answers on DoubtIQ takes a few seconds.\n\n### 1. Pick a subject\n\nFrom the home page, choose one of the six subjects — Maths, Physics, Chemistry, Biology, Social Science or Hindi. Each subject page lists every question in that subject.\n\n### 2. Browse or search\n\n- Use **Questions** in the top menu to see everything at once, filtered by subject.\n- Use **Search** (top bar or the search box on the home page) to find a specific topic — for example \u201cphotosynthesis\u201d, \u201cquadratic\u201d or \u201csandhi\u201d.\n\n### 3. Open a question\n\nClick any question card to read the question in full, along with its answers. Verified answers are marked with a green badge.\n\n### 4. Go back anytime\n\nEvery page has a **\u2190 Back** button and a breadcrumb trail (for example *Home \u203a Maths \u203a Question*), so you always know where you are and how to return.\n\n> Tip: the **\u2630** menu (mobile) and the top navigation bar keep the same four destinations everywhere: Home, Questions, Subjects and Search.',
      status: 'published'
    }
  ];

  for (const p of PAGES) {
    await run(ins, [p.title, p.slug, p.body, p.status]);
  }
  console.log(`[pages] ${PAGES.length} default pages inserted (empty database only)`);
}

/** Returns the current number of pages. */
async function qOneEmptyCheck() {
  const row = await q('SELECT COUNT(*)::int AS n FROM pages');
  return row.length ? row[0].n : 0;
}

module.exports = { ensureDefaultPages };
