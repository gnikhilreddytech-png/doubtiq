'use strict';

/**
 * DoubtIQ — application server.
 * Express + PostgreSQL (Supabase via pg). Serves the student SPA, the admin
 * dashboard, the JSON API, and SEO (robots/sitemap/crawler SSR). No build
 * step. DATABASE_URL must point at the existing Supabase database.
 */

const path = require('path');
const express = require('express');
const { init } = require('../data/db');
const { requireAdmin } = require('./auth');
const seo = require('./seo');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');

/* ------------------------------------------------------------ middleware */

app.use(express.json({ limit: '1mb' }));

// Lean security headers.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"
  );
  next();
});

/** Wrap an async handler so rejections reach the error middleware below. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ API */

const publicApi = require('../routes/public');
app.use('/api', publicApi.router);

// Admin area — auth endpoints are unguarded, everything else requires an
// active admin session.
const adminApi = require('../routes/admin');
app.use('/api/admin/auth', adminApi.authRouter);
app.use('/api/admin', requireAdmin, adminApi.router);

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'DoubtIQ' }));
app.get('/api/version', (req, res) => res.json({ version: '30' }));

// API 404 (JSON, never a blank page)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------------------------------------------------------- static assets */

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, {
  index: false,
  maxAge: '1h',
  setHeaders(res, filePath) {
    // HTML is served via sendHtml below (no-cache); assets get a short cache.
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));

const sendHtml = (res, file) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(file, { cacheControl: false });
};

/* ------------------------------------------------------------------- SEO */

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(seo.robots());
});

app.get('/sitemap.xml', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'max-age=3600');
  res.type('application/xml').send(await seo.sitemap());
}));

/* -------------------------------------------------------------- pages */

app.get('/', (req, res) => sendHtml(res, path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (req, res) => sendHtml(res, path.join(PUBLIC_DIR, 'admin.html')));
app.get('/search', (req, res) => {
  if (seo.isCrawler(req)) return seo.renderSearchPage(req, res);
  sendHtml(res, path.join(PUBLIC_DIR, 'index.html'));
});

// Clean public URLs. Crawlers & social scrapers get indexable HTML; normal
// browsers get the SPA shell (same URL, progressive enhancement).
app.get('/questions/:slug', ah(async (req, res) => {
  const { findPublishedQuestion } = require('../routes/public');
  // Avoid duplicate URLs: a numeric ID that maps to a real question is
  // 301-redirected to its canonical slug URL (SEO best practice).
  if (/^\d+$/.test(req.params.slug)) {
    const q = await findPublishedQuestion(req.params.slug);
    if (q && q.slug) {
      return res.redirect(301, `/questions/${encodeURIComponent(q.slug)}`);
    }
  }
  if (seo.isCrawler(req)) return await seo.renderQuestion(req, res, req.params.slug);
  sendHtml(res, path.join(PUBLIC_DIR, 'index.html'));
}));

app.get('/subjects/:slug', ah(async (req, res) => {
  if (seo.isCrawler(req)) return await seo.renderSubject(req, res, req.params.slug);
  sendHtml(res, path.join(PUBLIC_DIR, 'index.html'));
}));

app.get('/page/:slug', (req, res) => sendHtml(res, path.join(PUBLIC_DIR, 'index.html')));

/* --------------------------------------------------------------- errors */

// API 500s → JSON (never a blank page). Malformed request bodies → 400.
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError) && err.status === 400) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Page 500s → friendly HTML.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Something went wrong — DoubtIQ</title></head><body style="font-family:system-ui,sans-serif;background:#f5f6f8;color:#0e1524;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>500</h1><p>Something went wrong on our side. Please try again.</p><a style="color:#3d4fe3" href="/">← Back to DoubtIQ</a></div></body></html>');
});

// Unknown routes → SPA shell (hash router shows the friendly 404 view), or
// a plain 404 for crawlers.
app.use((req, res) => {
  if (seo.isCrawler(req)) return res.status(404).type('html').send(seo.notFoundHtml ? seo.notFoundHtml() : 'Not found');
  sendHtml(res, path.join(PUBLIC_DIR, 'index.html'));
});

/* ----------------------------------------------------------------- listen */

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

init()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`DoubtIQ running → http://${HOST}:${PORT}`);
      console.log(`  Student site : http://localhost:${PORT}/`);
      console.log(`  Admin panel  : http://localhost:${PORT}/admin`);
    });
  })
  .catch((err) => {
    console.error('');
    console.error('DoubtIQ failed to start because the PostgreSQL connection could not be initialised.');
    console.error(err && err.message ? err.message : err);
    console.error('Set DATABASE_URL to your Supabase connection string (see .env.example), then start again.');
    console.error('');
    process.exit(1);
  });
