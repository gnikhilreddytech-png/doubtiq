'use strict';

/**
 * DoubtIQ — SEO helpers (PostgreSQL).
 * Serves indexable, semantic HTML to crawlers and social scrapers for
 * public pages (question, subject), plus robots.txt, sitemap.xml and
 * JSON-LD structured data. Normal browsers keep the SPA unchanged.
 */

const { q, qOne } = require('../data/db');
const { findPublishedQuestion } = require('../routes/public');

const SITE_URL = (process.env.SITE_URL || 'https://doubtiq-1.onrender.com').replace(/\/+$/, '');

const BOT_RE = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|facebookexternalhit|facebot|twitterbot|whatsapp|linkedinbot|pinterest|embedly|discordbot|telegrambot|semrushbot|ahrefsbot|petalbot|applebot|ia_archiver|archive\.org|prerender|preview|curl|wget|python-requests|python-urllib|go-http-client|axios/i;

function isCrawler(req) {
  const ua = req.headers['user-agent'] || '';
  if (BOT_RE.test(ua)) return true;
  if (req.query && req.query._escaped_fragment_ !== undefined) return true;
  return false;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mdToText(md) {
  return String(md || '')
    .replace(/[*#`>]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseDoc({ title, description, canonical, ogType = 'website', jsonLd = [], body = '' }) {
  const meta = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escHtml(title)}</title>`,
    `<meta name="description" content="${escHtml(description)}">`,
    `<link rel="canonical" href="${escHtml(canonical)}">`,
    `<meta property="og:type" content="${ogType}">`,
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:url" content="${escHtml(canonical)}">`,
    `<meta property="og:site_name" content="DoubtIQ">`,
    '<meta name="twitter:card" content="summary">',
    '<meta name="robots" content="index, follow">'
  ].join('\n  ');
  const ld = jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n  ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${meta}
  ${ld}
  <style>
    :root{color-scheme:light dark}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;line-height:1.65;color:#0e1524;background:#f5f6f8}
    .wrap{max-width:760px;margin:0 auto;padding:32px 20px 60px}
    .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;color:#0e1524;text-decoration:none;margin-bottom:26px}
    .brand span{color:#3d4fe3}
    .crumb{font-size:13px;color:#8a94a6;margin-bottom:18px}
    .crumb a{color:#4b5568;text-decoration:none}
    .crumb a:hover{color:#3d4fe3}
    h1{font-size:26px;letter-spacing:-.02em;margin:6px 0 10px;line-height:1.3}
    .meta{font-size:13px;color:#8a94a6;display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}
    .card{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:26px}
    .answer{border-top:1px solid #e4e7ec;padding:20px 0}
    .answer:first-of-type{border-top:0}
    .author{font-weight:700;font-size:14px;margin-bottom:6px}
    .verified{color:#0f9d6e;font-weight:700;font-size:12.5px;margin-left:8px}
    .qa{color:#4b5568}
    .qa p{margin:0 0 12px}
    ul,ol{padding-left:22px}
    .back{margin-top:26px}
    .back a{color:#3d4fe3;font-weight:600;text-decoration:none}
    .qlist{display:flex;flex-direction:column;gap:12px}
    .qitem{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:18px 20px;display:block;color:inherit;text-decoration:none}
    .qitem:hover{border-color:#b9c0cc}
    .qitem b{font-size:15.5px}
    .qitem .sub{font-size:12.5px;color:#8a94a6;margin-top:4px}
    @media (prefers-color-scheme:dark){body{background:#0b0f1a;color:#e8edf6}.card,.qitem{background:#121827;border-color:#202a3d}.brand{color:#e8edf6}.qa{color:#9aa7bd}}
  </style>
</head>
<body>
  <div class="wrap">
    <a class="brand" href="${SITE_URL}/"><span class="mark">◆</span> Doubt<span>IQ</span></a>
    ${body}
  </div>
</body>
</html>`;
}

function breadcrumbJson(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url
    }))
  };
}

/* ---------------------------------------------------------- question page */

async function renderQuestion(req, res, ref) {
  const qrow = await findPublishedQuestion(ref);
  if (!qrow) return res.status(404).type('html').send(notFoundHtml());

  const answers = await q(`
    SELECT author, body, is_verified, created_at FROM answers
    WHERE question_id = $1 AND status = 'published'
    ORDER BY is_verified DESC, created_at ASC
  `, [qrow.id]);

  const url = `${SITE_URL}/questions/${encodeURIComponent(qrow.slug || qrow.id)}`;
  const title = `${qrow.title} — DoubtIQ`;
  const bodyText = mdToText(qrow.body || '');
  const firstAnswerText = answers.length ? mdToText(answers[0].body) : '';
  const desc = (bodyText || firstAnswerText || `${qrow.answer_count} answer${qrow.answer_count === 1 ? '' : 's'} in ${qrow.subject_name}.`).slice(0, 155);

  const jsonLd = [
    breadcrumbJson([
      { name: 'Home', url: `${SITE_URL}/` },
      { name: qrow.subject_name, url: `${SITE_URL}/subjects/${qrow.subject_slug || qrow.subject}` },
      { name: qrow.title, url }
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'Question',
      name: qrow.title,
      text: qrow.body || qrow.title,
      url,
      inLanguage: 'en',
      datePublished: qrow.created_at,
      dateModified: qrow.updated_at || qrow.created_at,
      author: { '@type': 'Organization', name: 'DoubtIQ' },
      about: { '@type': 'Thing', name: qrow.subject_name },
      acceptedAnswer: answers.filter((a) => a.is_verified).length ? {
        '@type': 'Answer',
        text: mdToText(answers.find((a) => a.is_verified).body).slice(0, 1000),
        author: { '@type': 'Organization', name: 'DoubtIQ' }
      } : undefined,
      suggestedAnswer: answers.filter((a) => !a.is_verified).slice(0, 10).map((a) => ({
        '@type': 'Answer',
        text: mdToText(a.body).slice(0, 500),
        author: { '@type': 'Person', name: a.author }
      }))
    }
  ];

  const answersHtml = answers.length
    ? answers.map((a) => `
      <div class="answer">
        <div class="author">${escHtml(a.author)}${a.is_verified ? '<span class="verified">✔ Verified answer</span>' : ''}</div>
        <div class="qa">${mdToHtml(a.body)}</div>
      </div>`).join('')
    : '<p class="qa">Answers are being prepared by the editorial team.</p>';

  const body = `
    <nav class="crumb">
      <a href="${SITE_URL}/">Home</a> ›
      <a href="${SITE_URL}/subjects/${escHtml(qrow.subject_slug || qrow.subject)}">${escHtml(qrow.subject_name)}</a> ›
      <span>${escHtml(qrow.title.length > 60 ? qrow.title.slice(0, 60) + '…' : qrow.title)}</span>
    </nav>
    <div class="card">
      <div class="meta">
        <span>${escHtml(qrow.subject_name)}</span>
      </div>
      <h1>${escHtml(qrow.title)}</h1>
      ${qrow.body ? `<div class="qa" style="margin-top:10px">${mdToHtml(qrow.body)}</div>` : ''}
      <div class="meta" style="margin-top:14px">
        <span>${qrow.view_count} views</span>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      ${answersHtml}
    </div>
    <div class="back"><a href="${SITE_URL}/subjects/${escHtml(qrow.subject_slug || qrow.subject)}">← Back to ${escHtml(qrow.subject_name)}</a></div>`;
  const doc = baseDoc({ title, description: desc, canonical: url, ogType: 'article', jsonLd, body });
  res.type('html').send(doc);
}

/* ----------------------------------------------------------- subject page */

async function renderSubject(req, res, slug) {
  const subject = await qOne('SELECT * FROM subjects WHERE slug = $1', [slug]);
  if (!subject) return res.status(404).type('html').send(notFoundHtml());

  const questions = await q(`
    SELECT q.* FROM questions q
    WHERE q.subject_id = $1 AND q.status = 'published'
    ORDER BY q.created_at DESC
  `, [subject.id]);

  const url = `${SITE_URL}/subjects/${escHtml(subject.slug)}`;
  const title = `${subject.name} — Questions & Answers | DoubtIQ`;
  const desc = `${subject.tagline} — ${questions.length} curated question${questions.length === 1 ? '' : 's'} and answers.`;

  const jsonLd = [
    breadcrumbJson([
      { name: 'Home', url: `${SITE_URL}/` },
      { name: subject.name, url }
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${subject.name} questions`,
      url,
      description: subject.description
    }
  ];

  const list = questions.length
    ? questions.map((qrow) => `
      <a class="qitem" href="${SITE_URL}/questions/${encodeURIComponent(qrow.slug || qrow.id)}">
        <b>${escHtml(qrow.title)}</b>
        <div class="sub">${qrow.view_count} views · ${timeAgo(qrow.created_at)}</div>
      </a>`).join('')
    : '<p class="qa">No questions published yet in this subject.</p>';

  const body = `
    <nav class="crumb"><a href="${SITE_URL}/">Home</a> › <span>${escHtml(subject.name)}</span></nav>
    <div class="card">
      <h1>${escHtml(subject.name)}</h1>
      <div class="meta"><span>${escHtml(subject.tagline)}</span></div>
      <p class="qa" style="margin-top:8px">${escHtml(subject.description)}</p>
    </div>
    <h2 style="margin:22px 0 10px;font-size:17px">Questions</h2>
    <div class="qlist">${list}</div>
    <div class="back"><a href="${SITE_URL}/">← Back to home</a></div>`;
  const doc = baseDoc({ title, description: desc, canonical: url, jsonLd, body });
  res.type('html').send(doc);
}

function notFoundHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found — DoubtIQ</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f6f8;color:#0e1524;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1>404</h1><p>This page does not exist.</p><a style="color:#3d4fe3" href="${SITE_URL}/">← Back to DoubtIQ</a></div>
</body></html>`;
}

function mdToHtml(md) {
  const text = escHtml(md || '');
  const blocks = text.split('\n');
  let html = '';
  let inList = false;
  for (let line of blocks) {
    const li = line.match(/^\s*(?:[-*•])\s+(.*)/);
    const p = line.trim();
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${li[1]}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (p) html += `<p>${p}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function timeAgo(iso) {
  const t = new Date(String(iso).replace(' ', 'T') + 'Z').getTime();
  if (isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* ------------------------------------------------------------- sitemap */

async function sitemap() {
  // Only real, crawlable paths: home, every public subject, every published
  // question (slug URL). Drafts, deleted questions and admin pages are never
  // included.
  const urls = [`${SITE_URL}/`];
  for (const s of await q('SELECT slug FROM subjects ORDER BY position')) {
    urls.push(`${SITE_URL}/subjects/${s.slug}`);
  }
  for (const qrow of await q("SELECT slug, id FROM questions WHERE status = 'published'")) {
    urls.push(`${SITE_URL}/questions/${encodeURIComponent(qrow.slug || qrow.id)}`);
  }
  const body = urls.map((u) => `  <url><loc>${escHtml(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

/** Search result pages: noindex,follow so queries never create indexable
 * URLs, while question/subject pages stay fully indexable. */
function renderSearchPage(req, res) {
  const qq = String(req.query.q || '').trim();
  const title = qq ? `Search: ${qq.slice(0, 60)} — DoubtIQ` : 'Search — DoubtIQ';
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${SITE_URL}/search">
</head>
<body style="font-family:system-ui,sans-serif;background:#f5f6f8;color:#0e1524;margin:0">
  <div style="max-width:640px;margin:0 auto;padding:48px 20px">
    <p><a href="${SITE_URL}/" style="color:#3d4fe3;font-weight:600;text-decoration:none">← DoubtIQ</a></p>
    <h1>${qq ? 'Search results' : 'Search DoubtIQ'}</h1>
    <p style="color:#4b5568">Search results are generated in your browser — this page is intentionally not indexed by search engines. Open it in a browser to search questions and answers.</p>
  </div>
</body>
</html>`;
  res.type('html').send(doc);
}

function robots() {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

module.exports = { isCrawler, renderQuestion, renderSubject, renderSearchPage, sitemap, robots, notFoundHtml, SITE_URL };
