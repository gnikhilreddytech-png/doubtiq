/* DoubtIQ — Search view (live: results update as you type) */
'use strict';

const SearchView = {
  _seq: 0, // guards against stale responses from rapid typing
  async render(params) {
    const q = decodeURIComponent(params.q || '').trim();
    let subjects = [];
    try { subjects = (await API.get('/api/subjects')).subjects || []; } catch (e) { /* ignore */ }

    const chipRow = `
      <div class="filter-row" data-role="subj-filters" role="group" aria-label="Filter by subject">
        <button class="filter-btn ${!params.subject ? 'active' : ''}" data-subj="all">All subjects</button>
        ${subjects.map((s) =>
          `<button class="filter-btn ${params.subject === s.slug ? 'active' : ''}" data-subj="${esc(s.slug)}">${esc(s.name)}</button>`
        ).join('')}
      </div>`;

    const pageHead = (sub) => `
      ${navRail('#/', 'Back to home', [{ label: 'Home', href: '#/' }, { label: 'Search' }])}
      <div class="section-head"><div>
        <h1 class="page-title-lg">Search</h1>
        <p class="page-sub-lg" data-role="results-count">${esc(sub)}</p>
      </div></div>`;

    if (!q) {
      return `
      ${pageHead('Find questions and answers across every subject.')}
      <form class="hero-search" data-role="big-search" style="max-width:none;margin-bottom:20px" role="search">
        <div class="field">${I.search}<input type="search" name="q" placeholder="Try “photosynthesis”, “quadratic”, “French Revolution”…" autocomplete="off" autofocus></div>
        <button class="btn btn-primary" type="submit">Search</button>
        <span class="search-hint">${I.info}<span>Type something to search</span></span>
      </form>
      ${chipRow}
      <div data-role="results" style="margin-top:26px">${emptyState('Search DoubtIQ', 'Start typing above — results appear as you type.', I.search)}</div>`;
    }

    let results = [];
    let error = null;
    try {
      const data = await API.get(`/api/search?q=${encodeURIComponent(q)}&subject=${encodeURIComponent(params.subject || 'all')}`);
      results = data.results || [];
    } catch (e) { error = e.message; }

    const body = error
      ? emptyState('Search failed', error, I.info)
      : results.length
        ? `<div class="qlist">${results.map(questionCard).join('')}</div>`
        : emptyState(
            `No results for “${esc(q)}”`,
            'Try different keywords, or browse a subject directly.',
            I.search,
            [{ label: 'Browse subjects', href: '#/subjects' }, { label: 'Clear search', href: '#/search' }]
          );

    return `
    ${pageHead(`${results.length} result${results.length === 1 ? '' : 's'} for “${esc(q)}”`)}
    <form class="hero-search" data-role="big-search" style="max-width:none;margin-bottom:20px" role="search">
      <div class="field">${I.search}<input type="search" name="q" value="${esc(q)}" autocomplete="off"></div>
      <button class="btn btn-primary" type="submit">Search</button>
      <span class="search-hint">${I.info}<span>Type something to search</span></span>
    </form>
    ${chipRow}
    <div data-role="results" style="margin-top:26px">${body}</div>`;
  },

  mount(el, params) {
    const form = el.querySelector('[data-role="big-search"]');
    const input = form ? form.querySelector('input[name=q]') : null;

    // Enter performs the search; an empty submit stays put with a hint.
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = fval(form, 'q').trim();
      if (!q) {
        input.focus();
        const hint = form.querySelector('.search-hint');
        if (hint) {
          hint.classList.remove('visible');
          void hint.offsetWidth;
          hint.classList.add('visible');
          setTimeout(() => hint.classList.remove('visible'), 2600);
        }
        return;
      }
      location.hash = `#/search?q=${encodeURIComponent(q)}`;
    });

    // Live search: debounced fetch as the student types each letter.
    if (input) {
      let timer = null;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => SearchView.liveSearch(el, input.value.trim(), params.subject), 220);
      });
    }

    const row = el.querySelector('[data-role="subj-filters"]');
    if (row) row.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-subj]');
      if (!btn) return;
      const q = decodeURIComponent(params.q || '').trim() || (input ? input.value : '') || '';
      location.hash = `#/search?q=${encodeURIComponent(q)}${btn.dataset.subj !== 'all' ? `&subject=${btn.dataset.subj}` : ''}`;
    });
  },

  /* Update results in place — no page reload, no history spam.
   * A sequence guard ensures an older (slower) response can never overwrite
   * the results of a newer keystroke. */
  async liveSearch(el, q, subject) {
    const resultsEl = el.querySelector('[data-role="results"]');
    const countEl = el.querySelector('[data-role="results-count"]');
    if (!resultsEl) return;
    const mySeq = ++SearchView._seq;

    if (!q) {
      resultsEl.innerHTML = emptyState('Search DoubtIQ', 'Start typing above — results appear as you type.', I.search);
      if (countEl) countEl.textContent = 'Find questions and answers across every subject.';
      try { history.replaceState(null, '', '#/search'); } catch (e) { /* ignore */ }
      return;
    }

    // Lightweight loading state while fetching.
    resultsEl.innerHTML = skeletonList(3);
    try {
      const data = await API.get(`/api/search?q=${encodeURIComponent(q)}&subject=${encodeURIComponent(subject || 'all')}`);
      if (mySeq !== SearchView._seq) return; // stale response — drop it
      const results = data.results || [];
      // Keep the URL shareable without adding a history entry per keystroke.
      const subj = subject && subject !== 'all' ? `&subject=${subject}` : '';
      try { history.replaceState(null, '', `#/search?q=${encodeURIComponent(q)}${subj}`); } catch (e) { /* ignore */ }

      resultsEl.innerHTML = results.length
        ? `<div class="qlist">${results.map(questionCard).join('')}</div>`
        : emptyState(
            `No results for “${esc(q)}”`,
            'Try different keywords, or browse a subject directly.',
            I.search,
            [{ label: 'Browse subjects', href: '#/subjects' }]
          );
      if (countEl) countEl.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for “${esc(q)}”`;
    } catch (err) {
      if (mySeq !== SearchView._seq) return;
      resultsEl.innerHTML = emptyState('Search failed', err.message, I.info);
    }
  }
};
