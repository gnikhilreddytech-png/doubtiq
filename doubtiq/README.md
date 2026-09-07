# DoubtIQ

A production-ready, full-stack educational Q&A platform. Students browse a
**curated, read-only library** of questions and answers organised by six
subjects; a secure **admin dashboard** manages every piece of content.

> **DoubtIQ is not an AI platform.** There is no AI, no question-asking, no
> answer-writing, no accounts, no comments and no community features for
> students — only a fast, minimal, premium reading experience.

---

## Stack

- **Backend:** Node.js + Express + **PostgreSQL** hosted on **Supabase**
  (node-postgres `pg`, async throughout)
- **Frontend:** Hand-written SPA (no framework, no build step, no CDN) —
  vanilla JS with a small hash router and a full design system in CSS
- **Auth:** Admin-only sessions (PostgreSQL-backed tokens, `HttpOnly` `SameSite`
  cookies, scrypt password hashing, login rate limiting). Students need no
  account and never see a sign-in.
- **Search:** PostgreSQL full-text search over the existing
  `questions.search_vector` tsvector column (trigger + GIN index) with a LIKE
  fallback for partial words and non-English (Hindi) queries
- **Security:** strict Content-Security-Policy, no inline scripts, escaped
  output everywhere, parameterised SQL throughout, rate-limited login
- **SEO:** every published question has a unique, permanent
  `/questions/<slug>` URL with server-rendered crawlable HTML (title, meta
  description, canonical, Open Graph, JSON-LD Question + BreadcrumbList).
  Dynamic `sitemap.xml` (published questions + subjects only), `robots.txt`,
  numeric-ID URLs 301-redirect to their canonical slug, and direct path URLs
  work after refresh / in incognito / without login.

## Quick start

Requirements: Node.js ≥ 18 and a Supabase PostgreSQL connection string.

```bash
npm install
cp .env.example .env      # then edit .env and paste your DATABASE_URL
npm start                 # → http://localhost:3000
```

The application connects to the **existing Supabase PostgreSQL database**
(schema and data already migrated — it never creates, migrates or seeds it).
Set `DATABASE_URL` (or put it in `.env`, which is git-ignored). The admin
account and the six core subjects already exist in that database from the
migration; change the admin password afterwards in Admin → Settings.

| Area | URL | Access |
|---|---|---|
| Student site | `/` | public, no account needed |
| Admin dashboard | `/admin` | admin credentials only |

Scripts: `npm start`, `npm run backup`, `npm run export`, `npm run reset-stats`.
(`npm run migrate` and `npm run reset` are legacy-guards: migrate no-ops on
PostgreSQL, and reset refuses to wipe the Supabase database.)

> **Right after your first migration to Supabase, run `npm run reset-stats`**
> once. If the old SQLite database (or pre-release testing) left fake demo
> view counts, a duplicated live-view feed or test activity entries behind,
> this zeroes every view statistic so the admin dashboard and public view
> counts start honestly at 0. Questions, answers, subjects, pages, users and
> settings are never touched.

## The subjects

Exactly six:

- Maths · Physics · Chemistry · Biology · Social Science · Hindi
- URLs: `/subjects/maths`, `/subjects/physics`, …, `/subjects/hindi`
- Hindi content is in Hindi; all other content is in English. The UI is English.

## Where the data lives

Everything lives in the **Supabase PostgreSQL database** named by
`DATABASE_URL`:

```
Tables: subjects · users · questions · answers · bookmarks · pages
        sessions · activity_log · question_views · settings
Plus:   questions.search_vector (tsvector + trigger + GIN index for FTS)
```

- **Connection:** `pg` connection pool (see `data/db.js`). TLS is enabled
  automatically for non-local hosts (Supabase).
- **No runtime writes to the schema:** the app only ever inserts/updates/
  deletes *rows* through the normal API. Table/column names are preserved
  exactly.
- **Backups** are handled by Supabase (Point-in-Time Recovery, or `pg_dump`
  against your connection string). `npm run backup` is retained only as a
  legacy helper for local SQLite archives.
- **Readable export:** `npm run export` regenerates
  `data/doubtiq-content.md` and `data/doubtiq-content.json` from PostgreSQL.

## Navigation (student site)

- **Primary nav:** Home · Questions · Subjects · Search
- Every inner page has a visible **← Back** button (returns to the exact
  previous page) and **breadcrumbs** (`Home › Maths › Question`).
- Browser back works naturally; no dead links or loops.
- Flow: `Home → Subject → Question list → Question → Answer`.

## Student permissions (view-only)

Students **can**: browse subjects/questions, read answers, search (including
topics), sort, filter by subject, switch light/dark mode.

Students **cannot**: ask questions, submit answers, comment, vote, create
accounts, or sign in. No such UI exists.

## Admin capabilities

- **Overview (live)** — stat cards, live view feed and per-subject counts
  that refresh automatically every few seconds
- **Questions** — a **full-screen editor** (`#/questions/new`,
  `#/questions/edit/<id>`) where the question and its answer are written
  together: subject, question, answer (author + verified), topics/tags,
  draft/published status, Cancel, Save & Publish. A sticky action bar keeps
  Save/Cancel always on screen, on desktop and mobile. Editing a question
  shows its existing answers inline with quick edit / add / delete
- **Answers** — add, edit, delete, publish/unpublish, mark verified
- **Subjects** — the six core subjects plus an **Add Subject** button: create
  extra subjects (name, slug, tagline, description, colour, icon) that are
  stored permanently and appear instantly on the public site, in question
  selectors, search filters and statistics. Deleting a subject that contains
  questions is safely blocked
- **Settings** — site name/tagline, admin password change

All admin modals fit the viewport (content scrolls internally, action buttons
stay visible). The sidebar **View student site** link opens the public
homepage in the same tab.

Content created in Admin becomes available on the public site **immediately
after publishing** — no rebuild, no export/import.

## Admin notes

- **Login → Dashboard persists** through waiting, navigating and refreshing;
  logout fully invalidates the session.
- The **View student site** sidebar link navigates to `/` in the same tab
  (no pop-up dependency).
- Editor modals are capped at `100vh - 40px` with an internal scroll area and
  sticky action buttons, so the answer box and Save/Create are never hidden
  on desktop or mobile.

## Security notes

- Passwords hashed with scrypt + per-user salt; login rate-limited
  (10 attempts / 15 min / IP, counter resets on success)
- Session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` when
  `COOKIE_SECURE=1`; the API also accepts the session token via an
  `Authorization` header (in-memory only, never persisted to storage)
- SQL is parameterised everywhere; output is escaped; strict CSP; no inline
  scripts; unknown routes return friendly 404/500 pages, never blank
- No database credentials or session secrets exist in the repo; production
  secrets come from environment variables

## SEO

- **Question URLs** — `/questions/<slug>` (e.g. `/questions/newtons-second-law`).
  Generated once at publish and stable; numeric IDs like `/questions/123`
  301-redirect to the canonical slug so Google never sees duplicate URLs.
- **Crawlable HTML** — crawlers and social scrapers receive a server-rendered
  page with the full question + answers, unique `<title>`, meta description,
  canonical, Open Graph tags and JSON-LD (`Question` + `BreadcrumbList`).
  Browsers receive the same SPA shell, which converts the path URL into the
  matching view — so direct links work after refresh, incognito, and with no
  login.
- **Discovery** — subject pages link directly to question URLs; `sitemap.xml`
  lists every published question and subject (drafts, deleted questions and
  admin pages are never included); `robots.txt` allows public pages and blocks
  `/admin` + `/api`.
- **Publishing** — a question published in Admin is immediately available at
  its public URL, on its subject page, in search, and in the sitemap.
- **404s** — nonexistent/deleted question URLs return a proper `404`.
- Set the `SITE_URL` env var in production so canonical URLs and the sitemap
  use your real domain.

## Tests

Point the tests at a running instance of the app (which itself points at
your PostgreSQL database):

```bash
DATABASE_URL='postgres://…' PORT=3000 npm start &        # 1. start the app

node test-md.js          # markdown renderer unit tests (content checks run
                         # against DATABASE_URL when set)
node test-reliability.js # live reliability audit: create → logout → login →
                         # persist → publish → crawlable → view → stats →
                         # unpublish hides → backup helper → analytics removed
                         #   env: BASE_URL=http://localhost:3000
                         #        TEST_ADMIN_PASSWORD=<admin password>
# node test-dom.js       # (optional) headless DOM integration — requires the
                         # linkedom package, run against a running instance
```

## Production audit (verified)

- **Single source of truth** — the Supabase PostgreSQL database named by
  `DATABASE_URL` holds subjects, questions, answers, views, pages, sessions,
  settings and admin data. The app never creates, migrates or seeds the
  schema at runtime, never modifies existing data at boot, and only changes
  rows through the normal admin/public API.
- **Persistence** — admin-created questions/answers/subjects survive logout →
  login → refresh → server restart → redeploy (verified against PostgreSQL
  with a real question).
- **Backup/restore** — production backups are handled by Supabase
  (Point-in-Time Recovery / `pg_dump`). The old local-file backup helper
  (`npm run backup`) is retained only for legacy SQLite archives.
- **SEO** — every published question has a permanent `/questions/<slug>` URL,
  crawlable question+answer HTML, unique title/meta/canonical/OG, JSON-LD,
  sitemap entry, numeric-ID 301s, and proper 404s. Unpublished/deleted
  questions are immediately removed from the public URL and sitemap.
- **Errors** — all API routes return proper 4xx/5xx JSON (never blank pages);
  malformed JSON bodies return 400.
