/* DoubtIQ — shared UI components & helpers. */
'use strict';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(String(iso).replace(' ', 'T') + 'Z').getTime();
  if (isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateFull(iso) {
  if (!iso) return '';
  const t = new Date(String(iso).replace(' ', 'T') + 'Z').getTime();
  if (isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}

/* Robust form-field readers (named access `form.x` fails in some parsers). */
function fval(form, name) {
  const el = form.querySelector(`[name="${name}"]`);
  return el ? el.value : '';
}
function fchk(form, name) {
  const el = form.querySelector(`[name="${name}"]`);
  if (!el) return false;
  // Robust across parsers: use the checked property OR the presence of the
  // `checked` attribute (some DOM implementations don't sync the attribute).
  try {
    if (el.checked === true) return true;
  } catch (e) { /* fall through */ }
  if (el.hasAttribute && el.hasAttribute('checked')) return true;
  if (el.getAttribute && el.getAttribute('checked') !== null) return true;
  return false;
}

function toast(msg, type) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.innerHTML = (type === 'error' ? I.info : I.check) + `<span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, 2600);
}

function subjectChip(subject, extra) {
  const name = subject && (subject.subject_name || subject.name) || '';
  const color = subject && (subject.subject_color || subject.color) || '';
  return `<span class="chip subject" style="--sc:${esc(color)}">${esc(name)}</span>`;
}

/** Small topic/tag chips (only where present — never show empty chips). */
function topicChips(topics) {
  if (!topics || !topics.length) return '';
  return `<div class="topic-chips" aria-label="Topics">${topics.slice(0, 3).map((t) => `<span class="topic-chip">${esc(t)}</span>`).join('')}</div>`;
}

function questionCard(q) {
  const href = `#/questions/${encodeURIComponent(q.slug || q.id)}`;
  const topics = Array.isArray(q.topics) ? q.topics : [];
  return `
  <a class="qcard card" href="${href}">
    <div class="meta">
      ${subjectChip(q)}
      <span class="m">${I.clock}<span>${timeAgo(q.created_at)}</span></span>
    </div>
    <h3>${esc(q.title)}</h3>
    ${q.excerpt ? `<div class="excerpt">${esc(q.excerpt)}</div>` : ''}
    ${topics.length ? topicChips(topics) : ''}
  </a>`;
}

function subjectCard(s) {
  return `
  <a class="card subject-card" href="#/subjects/${esc(s.slug)}" style="--sc:${esc(s.color)}">
    <div class="top">
      <span class="subject-icon">${subjectIcon(s.icon)}</span>
      <div>
        <h3>${esc(s.name)}</h3>
        <div class="tagline">${esc(s.tagline)}</div>
      </div>
    </div>
    <div class="desc">${esc(s.description)}</div>
    <div class="foot">
      <span class="count">${s.question_count || 0} question${s.question_count === 1 ? '' : 's'}</span>
      <span class="go">Browse ${I.arrowRight}</span>
    </div>
  </a>`;
}

function emptyState(title, sub, icon, actions) {
  const acts = actions && actions.length
    ? `<div class="empty-actions">${actions.map((a) => `<a class="btn ${a.primary ? 'btn-primary' : 'btn-ghost'} btn-sm" href="${esc(a.href || '#')}">${a.label}</a>`).join('')}</div>`
    : '';
  return `
  <div class="empty card">
    <div class="empty-icon">${icon || I.search}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(sub || '')}</p>
    ${acts}
  </div>`;
}

function skeletonList(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += '<div class="skeleton sk-card"></div>';
  return `<div class="sk-list">${out}</div>`;
}

/** Reading-page skeleton: header block + answer lines (no layout shift). */
function skeletonQuestion() {
  return `
  <div class="q-reader" aria-busy="true">
    <div class="skeleton" style="height:120px;border-radius:var(--radius)"></div>
    <div class="skeleton" style="height:14px;width:38%;margin-top:22px;border-radius:7px"></div>
    <div class="skeleton" style="height:180px;margin-top:12px;border-radius:var(--radius)"></div>
    <div class="skeleton" style="height:14px;width:30%;margin-top:26px;border-radius:7px"></div>
    <div class="skeleton" style="height:140px;margin-top:12px;border-radius:var(--radius)"></div>
  </div>`;
}

/* ------------------------------------------------ markdown-lite renderer */
function renderMd(src) {
  const text = esc(src || '');
  const lines = text.split('\n');
  const out = [];
  let i = 0;

  const inline = (s) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = rows
        .map((r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()))
        // skip the markdown separator row like |---|---|
        .filter((row) => !row.every((c) => /^:?-{2,}:?$/.test(c)));
      const header = (cells[0] || []).map((c) => inline(c));
      let html = '<table><thead><tr>' + header.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
      for (const row of cells.slice(1)) {
        html += '<tr>' + header.map((_, idx) => `<td>${row[idx] ? inline(row[idx]) : ''}</td>`).join('') + '</tr>';
      }
      out.push(html + '</tbody></table>');
      continue;
    }

    if (/^\s*(?:[-*•])\s+/.test(line)) {
      // Accept "- ", "* " and pasted "• " bullets so copied text keeps its bullets.
      const items = [];
      while (i < lines.length && /^\s*(?:[-*•])\s+/.test(lines[i])) { items.push(inline(lines[i].replace(/^\s*(?:[-*•])\s+/, ''))); i++; }
      out.push('<ul>' + items.map((it) => `<li>${it}</li>`).join('') + '</ul>');
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))); i++; }
      out.push('<ol>' + items.map((it) => `<li>${it}</li>`).join('') + '</ol>');
      continue;
    }

    if (/^\s*###?\s+/.test(line)) {
      out.push(`<p class="md-h"><strong>${inline(line.replace(/^\s*###?\s+/, ''))}</strong></p>`);
      i++;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*(\||[-*•]\s|\d+[.)]\s|#{1,3}\s)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    if (para.length) {
      const joined = para.join('<br>');
      out.push(`<p>${inline(joined)}</p>`);
    } else {
      i++;
    }
  }
  return out.join('');
}

function mdBlock(src) {
  return `<div class="md">${renderMd(src)}</div>`;
}

/* ------------------------------------------------------------ navigation */

/** Back button — pops the in-app nav stack; falls back to the given hash.
 * Label is always "Go back" for consistency. */
function backBtn(fallbackHash) {
  return `<button class="back-btn" data-back="${esc(fallbackHash || '#/')}" aria-label="Go back">
    ${I.back}<span>Go back</span>
  </button>`;
}

/** Breadcrumb chain: [{ label, href? }, …] — last item (no href) is current. */
function breadcrumb(items) {
  const parts = [];
  items.forEach((it, i) => {
    if (i > 0) parts.push(I.chevronRight);
    parts.push(it.href
      ? `<a href="${esc(it.href)}">${esc(it.label)}</a>`
      : `<span class="current">${esc(it.label)}</span>`);
  });
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${parts.join('')}</nav>`;
}

/** Standard top-of-page navigation rail: back button + breadcrumb. */
function navRail(backHash, backLabel, crumbs) {
  return `<div class="nav-rail">${backBtn(backHash, backLabel)}${breadcrumb(crumbs)}</div>`;
}

/** Subtle "Type something to search" message shown in a suggestion box when
 * the student submits an empty search (instead of redirecting). */
function showSearchHint(box, message) {
  if (!box) return;
  box.innerHTML = '<div class="ts-empty">' + esc(message || 'Type something to search') + '</div>';
  box.hidden = false;
  clearTimeout(box._hintT);
  box._hintT = setTimeout(() => { box.hidden = true; }, 1800);
}

/* ============================================================ Live search
 * Shared engine for all search inputs (header, hero, search page):
 *  - debounced fetching (no request per keystroke)
 *  - stale-response guard (a slow older request can never overwrite a newer
 *    result — sequence number check)
 *  - loading, error and "no results" states
 *  - keyboard navigation (↑/↓ move, Enter opens, Escape closes)
 *  - closes when clicking outside
 * cfg: { input, box, wrapSelector, debounceMs, fetch(q), itemHtml(r),
 *        footerHtml(q), noResultsHtml(q), onEmptySubmit() }
 */
function initLiveSearch(cfg) {
  const input = cfg.input;
  const box = cfg.box;
  let timer = null;
  let seq = 0;
  let activeIndex = -1;
  let items = [];

  const close = () => {
    box.hidden = true;
    box.innerHTML = '';
    activeIndex = -1;
    items = [];
  };

  const show = (html) => {
    box.innerHTML = html;
    box.hidden = false;
    activeIndex = -1;
    items = [];
  };

  const setActive = () => {
    const els = box.querySelectorAll('.ts-item');
    els.forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
      el.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    });
    if (els[activeIndex]) els[activeIndex].scrollIntoView({ block: 'nearest' });
  };

  const run = async () => {
    const q = input.value.trim();
    const mySeq = ++seq;
    if (!q) { close(); return; }
    if (cfg.loadingHtml) box.innerHTML = cfg.loadingHtml; // keep dropdown open, subtle
    try {
      const data = await cfg.fetch(q);
      if (mySeq !== seq) return; // stale — a newer keystroke happened
      const results = (data.results || []).slice(0, cfg.max || 6);
      if (!results.length) { show(cfg.noResultsHtml(q)); return; }
      items = results;
      box.innerHTML =
        results.map((r, i) => cfg.itemHtml(r, i)).join('') +
        (cfg.footerHtml ? cfg.footerHtml(q) : '');
      box.hidden = false;
      activeIndex = -1;
    } catch (e) {
      if (mySeq !== seq) return;
      show(cfg.errorHtml ? cfg.errorHtml() : '<div class="ts-empty">Search is unavailable right now — try again.</div>');
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, cfg.debounceMs || 180);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const els = box.querySelectorAll('.ts-item');
      if (!els.length) return;
      e.preventDefault();
      if (e.key === 'ArrowDown') activeIndex = (activeIndex + 1) % els.length;
      else activeIndex = (activeIndex - 1 + els.length) % els.length;
      setActive();
      return;
    }
    if (e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        const go = items[activeIndex].slug || items[activeIndex].id;
        close();
        location.hash = `#/questions/${encodeURIComponent(go)}`;
      } else if (cfg.onEnter) {
        cfg.onEnter(); // caller decides (submit or ignore-empty)
      }
    }
  });

  // Clicking a result opens the correct question page. We navigate via the
  // href programmatically (and prevent default) so it works even where an
  // anchor's default navigation is unreliable (embedded previews etc.).
  box.addEventListener('click', (e) => {
    const t = e.target.closest('.ts-item, .ts-all');
    if (!t) return;
    e.preventDefault();
    const href = t.getAttribute('href');
    close();
    if (href && href.startsWith('#/')) location.hash = href;
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest(cfg.wrapSelector)) close();
  });

  return { close, run };
}
