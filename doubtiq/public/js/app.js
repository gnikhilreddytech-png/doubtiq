/* DoubtIQ — student SPA: shell, theme, router, navigation.
 * Design: extremely simple navigation (Home · Questions · Subjects · Search),
 * always-visible back buttons + breadcrumbs, and natural browser back.
 * No accounts, no sign-in, no bookmarks — students are view-only.
 */
'use strict';

const NotFoundView = {
  async render() {
    return navRail('#/', 'Back to home', [{ label: 'Home', href: '#/' }]) +
      emptyState(
        'Page not found',
        'The page you are looking for doesn\u2019t exist. It may have been moved or removed.',
        I.info,
        [
          { label: 'Browse all questions', href: '#/questions', primary: true },
          { label: 'Explore subjects', href: '#/subjects' }
        ]
      );
  }
};

const App = {
  state: { subjects: [] },
  navStack: [],
  lastHash: null,
  backing: false,

  /* ------------------------------------------------------------ boot */
  async boot() {
    // Theme (storage-safe — sandboxed previews can throw on localStorage)
    let saved = null;
    try { saved = localStorage.getItem('doubtiq-theme'); } catch (e) { saved = null; }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.applyTheme(saved || (prefersDark ? 'dark' : 'light'));

    // Subjects (nav + footer + filters)
    try { this.state.subjects = (await API.get('/api/subjects')).subjects || []; }
    catch (e) { this.state.subjects = []; }

    // Stale-cache self-heal (admin builds only matter here, but keep it cheap)
    checkBuildVersion();

    // Restore in-session back stack (survives reloads within the tab)
    try { this.navStack = JSON.parse(sessionStorage.getItem('dq-stack') || '[]') || []; }
    catch (e) { this.navStack = []; }

    this.populateFooter();
    this.renderChrome();

    // Global delegation: back buttons + drawer links (survives re-renders)
    document.addEventListener('click', (e) => {
      const back = e.target.closest('[data-back]');
      if (back) { e.preventDefault(); App.back(back.dataset.back); return; }
      const drawerLink = e.target.closest('.menu-drawer a');
      if (drawerLink) App.closeDrawer();
    });

    // Escape closes the mobile drawer (bound once at boot).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') App.closeDrawer();
    });

    window.addEventListener('hashchange', () => this.route());

    // Direct path URLs (e.g. /questions/newtons-second-law, /subjects/maths,
    // /search, /page/about) work after refresh / in incognito / without login:
    // convert the pathname into the equivalent hash route before routing.
    if (!location.hash) {
      let converted = '#/';
      try {
        const p = window.location.pathname || '';
        if (p === '/search') converted = '#/search';
        else if (p === '/questions' || p === '/subjects') converted = '#' + p;
        else {
          const m = p.match(/^\/(questions|subjects|page)\/([^/]+)$/);
          if (m) converted = `#/${m[1]}/${m[2]}`;
        }
      } catch (e) { /* pathname unavailable */ }
      try { history.replaceState(null, '', converted); } catch (e) { /* restricted */ }
      // Ensure the router sees the converted hash even where replaceState is
      // unavailable (e.g. some sandboxed previews).
      if (location.hash !== converted) location.hash = converted;
    }
    this.route();
  },

  /* ------------------------------------------------------------ theme */
  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('doubtiq-theme', theme); } catch (e) { /* storage-safe */ }
  },

  /* ------------------------------------------------------------ chrome */
  async populateFooter() {
    const foot = document.getElementById('footer-subjects');
    if (foot && this.state.subjects.length) {
      foot.innerHTML = this.state.subjects
        .map((s) => `<li><a href="#/subjects/${esc(s.slug)}">${esc(s.name)}</a></li>`)
        .join('');
    }
    const pagesFoot = document.getElementById('footer-pages');
    if (pagesFoot) {
      try {
        const data = await API.get('/api/pages');
        const pages = data.pages || [];
        if (pages.length) {
          pagesFoot.innerHTML = pages
            .map((p) => `<li><a href="#/page/${esc(p.slug)}">${esc(p.title)}</a></li>`)
            .join('');
        } else {
          pagesFoot.innerHTML = '<li>No pages yet</li>';
        }
      } catch (e) { /* footer pages are optional */ }
    }
    const year = document.getElementById('foot-year');
    if (year) year.textContent = new Date().getFullYear();
  },

  renderChrome() {
    const html = `
    <a class="skip-link" href="#view">Skip to content</a>
    <header class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="#/" aria-label="DoubtIQ home">
          <span class="brand-mark">${I.spark}</span>
          <span class="brand-word">Doubt<span>IQ</span></span>
        </a>
        <nav class="nav" aria-label="Primary">
          <a href="#/" data-nav="home">Home</a>
          <a href="#/questions" data-nav="questions">Questions</a>
          <a href="#/subjects" data-nav="subjects">Subjects</a>
        </nav>
        <form class="top-search" data-role="top-search" role="search" aria-label="Search">
          <label class="ts-icon" for="top-search-input" aria-hidden="true" title="Search">${I.search}</label>
          <input type="search" id="top-search-input" name="q" placeholder="Search questions…" aria-label="Search questions" autocomplete="off">
          <div class="ts-suggest" data-role="ts-suggest" hidden></div>
        </form>
        <div class="topbar-actions">
          <button class="icon-btn" data-role="theme-toggle" title="Toggle light / dark mode" aria-label="Toggle light / dark mode">${I.moon}</button>
          <button class="icon-btn menu-btn" data-role="menu-open" title="Menu" aria-label="Open menu">${I.menu}</button>
        </div>
      </div>
    </header>
    <div class="menu-drawer" data-role="drawer" aria-hidden="true">
      <div class="sheet">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span class="brand-word" style="font-size:17px">Doubt<span>IQ</span></span>
          <button class="icon-btn" data-role="menu-close" aria-label="Close menu">${I.close}</button>
        </div>
        <a href="#/" data-nav="home">${I.home} Home</a>
        <a href="#/questions" data-nav="questions">${I.book} Questions</a>
        <a href="#/subjects" data-nav="subjects">${I.grid} Subjects</a>
        <div class="m-footer">
          DoubtIQ — a curated Q&amp;A library.<br>
          Questions and answers are published by the editorial team.
        </div>
      </div>
    </div>`;

    document.querySelector('.topbar')?.remove();
    document.querySelector('.menu-drawer')?.remove();
    document.body.insertAdjacentHTML('afterbegin', html);
    this.bindChrome();
  },

  bindChrome() {
    // Theme toggle (re-renders chrome so the icon reflects the new theme)
    document.querySelector('[data-role="theme-toggle"]')?.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      this.applyTheme(next);
      this.renderChrome();
    });

    // Topbar search — live suggestions as you type + Enter navigates.
    const tsForm = document.querySelector('[data-role="top-search"]');
    const tsInput = tsForm ? tsForm.querySelector('input[name="q"]') : null;
    const tsSuggest = document.querySelector('[data-role="ts-suggest"]');
    if (tsForm && tsInput && tsSuggest) {
      const doSubmit = () => {
        const q = tsInput.value.trim();
        // Empty search: stay put, focus the box — never redirect to a
        // "nothing typed" page.
        if (!q) { tsInput.focus(); showSearchHint(tsSuggest); return; }
        location.hash = `#/search?q=${encodeURIComponent(q)}`;
      };

      tsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        tsSuggest.hidden = true;
        doSubmit();
      });

      initLiveSearch({
        input: tsInput,
        box: tsSuggest,
        wrapSelector: '.top-search',
        debounceMs: 180,
        max: 6,
        loadingHtml: '<div class="ts-empty">Searching…</div>',
        fetch: (q) => API.get(`/api/search?q=${encodeURIComponent(q)}&limit=6`),
        itemHtml: (r) => `
          <a class="ts-item" href="#/questions/${encodeURIComponent(r.slug || r.id)}" role="option">
            <span class="ts-item-title">${esc(r.title)}</span>
            <span class="ts-item-meta">${esc(r.subject_name)}${r.topics && r.topics.length ? ' · ' + esc(r.topics.slice(0, 2).join(', ')) : ''}</span>
          </a>`,
        footerHtml: (q) => `<a class="ts-all" href="#/search?q=${encodeURIComponent(q)}">See all results →</a>`,
        noResultsHtml: (q) => `<div class="ts-empty">No results found for “${esc(q)}” — try different keywords.</div>`,
        errorHtml: () => '<div class="ts-empty">Search is unavailable right now — try again.</div>',
        onEnter: doSubmit
      });
    }

    // Mobile drawer
    document.querySelector('[data-role="menu-open"]')?.addEventListener('click', () => this.openDrawer());
    document.querySelector('[data-role="menu-close"]')?.addEventListener('click', () => this.closeDrawer());
    document.querySelector('.menu-drawer')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('menu-drawer')) this.closeDrawer();
    });
  },

  openDrawer() {
    document.querySelector('.menu-drawer')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  closeDrawer() {
    document.querySelector('.menu-drawer')?.classList.remove('open');
    document.body.style.overflow = '';
  },

  /* ------------------------------------------------------ nav history */
  parseHash(input) {
    const raw = (input || location.hash).replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    const params = {};
    if (queryPart) {
      for (const pair of queryPart.split('&')) {
        const [k, v] = pair.split('=');
        if (k) params[k] = decodeURIComponent(v || '');
      }
    }
    return { segments, params };
  },

  pushStack(hash) {
    this.navStack.push(hash);
    if (this.navStack.length > 40) this.navStack.shift();
    try { sessionStorage.setItem('dq-stack', JSON.stringify(this.navStack)); } catch (e) { /* ignore */ }
  },

  popStack() {
    const h = this.navStack.pop() || null;
    try { sessionStorage.setItem('dq-stack', JSON.stringify(this.navStack)); } catch (e) { /* ignore */ }
    return h;
  },

  /**
   * Back: return to the exact previous page when we know it (in-app stack),
   * otherwise fall back to a sensible context page (deep links / fresh tabs).
   */
  back(fallbackHash) {
    this.backing = true;
    setTimeout(() => { this.backing = false; }, 80);

    let target = this.popStack();
    let guard = 0;
    while (target && (target === location.hash) && guard++ < 6) target = this.popStack();
    const go = target || fallbackHash || '#/';

    if (go === location.hash) {
      // Nothing sensible to go back to — re-render current page.
      this.route(true);
      return;
    }
    location.hash = go;
  },

  /* ------------------------------------------------------------ router */
  route(force) {
    const view = document.getElementById('view');
    if (!view) return;

    const newHash = location.hash || '#/';
    const { segments, params } = this.parseHash(newHash);

    // Legacy routes → Questions (never trap or confuse)
    if (segments[0] === 'recent' || segments[0] === 'profile' || segments[0] === 'bookmarks') {
      location.replace('#/questions');
      return;
    }

    // Record where we came from (unless we're already going back)
    const prev = this.lastHash;
    if (!this.backing && prev !== null && prev !== newHash) this.pushStack(prev);
    this.lastHash = newHash;

    // Resolve view
    let View = null;
    let viewParams = params;
    let title = 'DoubtIQ — Curated Questions & Answers';
    let metaDesc = 'A curated Q&A library across Maths, Physics, Chemistry, Biology, Social Science and Hindi. Browse questions, read clear answers.';

    if (segments.length === 0) { View = HomeView; }
    else if (segments[0] === 'questions' && !segments[1]) { View = QuestionsView; title = 'All questions · DoubtIQ'; }
    else if (segments[0] === 'questions' && segments[1]) {
      View = QuestionView; viewParams = { ...params, slug: segments[1] }; title = 'Question · DoubtIQ';
    }
    else if (segments[0] === 'subjects' && !segments[1]) { View = SubjectsView; title = 'Subjects · DoubtIQ'; }
    else if (segments[0] === 'subjects' && segments[1]) {
      View = SubjectView; viewParams = { ...params, slug: segments[1] };
      const subj = this.state.subjects.find((s) => s.slug === segments[1]);
      title = subj ? `${subj.name} · DoubtIQ` : 'Subject · DoubtIQ';
      if (subj) metaDesc = subj.tagline;
    }
    else if (segments[0] === 'search') { View = SearchView; title = 'Search · DoubtIQ'; }
    else if (segments[0] === 'page' && segments[1]) { View = PageView; viewParams = { ...params, slug: segments[1] }; title = 'DoubtIQ'; }
    else { View = NotFoundView; title = 'Page not found · DoubtIQ'; metaDesc = 'The page you are looking for does not exist.'; }

    document.title = title;
    const robots = (View === SearchView) ? 'noindex, follow' : 'index, follow';
    this.setMeta(title, metaDesc, location.hash, robots);
    this.setActiveNav(segments);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    // Lightweight page transition (question pages get a reading skeleton)
    view.classList.remove('view-in');
    void view.offsetWidth;
    view.innerHTML = (View === QuestionView) ? skeletonQuestion() : skeletonList(4);
    view.classList.add('view-in');

    View.render(viewParams)
      .then((html) => {
        view.classList.remove('view-in');
        view.innerHTML = html;
        void view.offsetWidth;
        view.classList.add('view-in');
        if (View.mount) View.mount(view, viewParams);
      })
      .catch((err) => {
        view.innerHTML = `
          <div class="empty card" style="margin-top:20px">
            <div class="empty-icon">${I.info}</div>
            <h3>Something went wrong</h3>
            <p>${esc(err.message || 'Unable to load this page.')}</p>
            <div style="margin-top:16px"><button class="btn btn-ghost" data-role="retry">Try again</button></div>
          </div>`;
        view.querySelector('[data-role="retry"]')?.addEventListener('click', () => this.route(true));
      });
  },

  /** Update <title>, meta description, canonical + Open Graph tags. */
  setMeta(title, description, hash, robots) {
    // Create-or-update a meta tag. The identity attribute (name/property) is
    // ALWAYS set on creation so the element is findable later — otherwise
    // duplicates would accumulate invisibly.
    const ensureMeta = (identityAttr, identityVal, contentVal) => {
      let el = document.querySelector(`meta[${identityAttr}="${identityVal}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(identityAttr, identityVal);
        document.head.appendChild(el);
      }
      el.setAttribute('content', contentVal);
    };
    const clean = String(hash || '').replace(/^#/, '');
    const origin = location.origin || (location.protocol + '//' + location.host);
    const canonical = `${origin}/${clean}`.replace(/\/+$/, '/');
    ensureMeta('name', 'description', description);
    ensureMeta('property', 'og:title', title);
    ensureMeta('property', 'og:description', description);
    ensureMeta('property', 'og:url', canonical);
    ensureMeta('property', 'og:type', 'website');
    // Internal search pages stay out of Google's index; everything else is
    // fully indexable.
    ensureMeta('name', 'robots', robots || 'index, follow');
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = canonical;
  },

  setActiveNav(segments) {
    let key = null;
    if (!segments.length) key = 'home';
    else if (segments[0] === 'questions') key = 'questions';
    else if (segments[0] === 'subjects') key = 'subjects';
    else if (segments[0] === 'search') key = 'search';
    document.querySelectorAll('.nav a[data-nav], .menu-drawer a[data-nav]').forEach((a) => {
      const active = a.dataset.nav === key;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.boot());
