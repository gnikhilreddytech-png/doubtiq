/* DoubtIQ — Home view */
'use strict';

const HomeView = {
  async render(params) {
    const [subjectsData, recentData] = await Promise.all([
      API.get('/api/subjects'),
      API.get('/api/questions/recent?limit=6')
    ]);
    const subjects = subjectsData.subjects || [];
    const recent = recentData.questions || [];

    const chips = subjects.map((s) =>
      `<a class="chip subject" style="--sc:${esc(s.color)}" href="#/subjects/${esc(s.slug)}">${esc(s.name)}</a>`
    ).join('');

    return `
    <section class="hero">
      <div class="container">
        <span class="eyebrow">${I.spark} A curated Q&A library</span>
        <h1>Every doubt, answered <em>clearly.</em></h1>
        <p class="lede">High-quality questions and well-explained answers, organised by subject — written, reviewed and easy to understand.</p>

        <form class="hero-search" data-role="hero-search" role="search">
          <div class="field">${I.search}<input type="search" name="q" placeholder="Search questions, e.g. photosynthesis, quadratic, sandhi…" aria-label="Search questions" autocomplete="off">
            <div class="hero-suggest" data-role="hero-suggest" hidden></div>
          </div>
          <button class="btn btn-primary" type="submit">Search</button>
        </form>

        <div class="hero-chips">
          <span class="hint">Browse by subject:</span>
          ${chips}
        </div>

        <div class="hero-cta">
          <a class="btn btn-ghost" href="#/questions">Browse all questions ${I.arrowRight}</a>
          <a class="btn btn-soft" href="#/subjects">Explore subjects</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2>Recent questions</h2>
          <a class="more" href="#/questions">View all ${I.arrowRight}</a>
        </div>
        ${recent.length ? `<div class="qlist">${recent.map(questionCard).join('')}</div>` : emptyState('No questions yet', 'Questions published by the editorial team will appear here.')}
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2>Explore subjects</h2>
        </div>
        <div class="subject-grid">${subjects.map(subjectCard).join('')}</div>
      </div>
    </section>`;
  },

  mount(el) {
    const form = el.querySelector('[data-role="hero-search"]');
    if (!form) return;
    const input = form.querySelector('input[name=q]');
    const suggest = form.querySelector('[data-role="hero-suggest"]');

    // Submit → full search page; empty submit stays put with a hint.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = fval(form, 'q').trim();
      if (!q) { input.focus(); showSearchHint(suggest); return; }
      if (suggest) suggest.hidden = true;
      location.hash = `#/search?q=${encodeURIComponent(q)}`;
    });

    // Live suggestions as the student types each letter.
    if (input && suggest) {
      initLiveSearch({
        input,
        box: suggest,
        wrapSelector: '.hero-search',
        debounceMs: 180,
        max: 6,
        loadingHtml: '<div class="ts-empty">Searching…</div>',
        fetch: (q) => API.get(`/api/search?q=${encodeURIComponent(q)}&limit=6`),
        itemHtml: (r) => `
          <a class="ts-item" href="#/questions/${encodeURIComponent(r.slug || r.id)}" role="option">
            <span class="ts-item-title">${esc(r.title)}</span>
            <span class="ts-item-meta">${esc(r.subject_name)}</span>
          </a>`,
        footerHtml: (q) => `<a class="ts-all" href="#/search?q=${encodeURIComponent(q)}">See all results →</a>`,
        noResultsHtml: (q) => `<div class="ts-empty">No results found for “${esc(q)}” — try different keywords.</div>`,
        errorHtml: () => '<div class="ts-empty">Search is unavailable right now — try again.</div>',
        onEnter: () => {
          const q = input.value.trim();
          if (!q) { input.focus(); showSearchHint(suggest); return; }
          location.hash = `#/search?q=${encodeURIComponent(q)}`;
        }
      });
    }
  }
};
