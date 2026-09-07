/* DoubtIQ Admin — shell, session gate, router, modal helpers. */
'use strict';

const Admin = {
  state: { user: null },

  /* ------------------------------------------------------------ boot */
  async boot() {
    // Theme (storage-safe: sandboxed previews can throw on localStorage)
    let saved = null;
    try { saved = localStorage.getItem('doubtiq-theme'); } catch (e) { saved = null; }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));

    // Stale-cache self-heal: if this page is running older JS than the
    // server, reload once so the user never fights a cached login loop.
    checkBuildVersion();

    // Global: Escape closes the top-most open modal.
    if (!this._escBound) {
      this._escBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this._modalStack && this._modalStack.length) {
          const top = this._modalStack[this._modalStack.length - 1];
          if (top) this.closeModal(top);
        }
      });
    }

    // Session gate — verifies a stored token OR cookie session.
    try {
      const d = await API.get('/api/admin/auth/me');
      if (!d.user) throw new Error('unauth');
      this.state.user = d.user;
      this.renderShell();
    } catch (err) {
      if (err.status === 401 || err.status === 403 || err.message === 'unauth') {
        setAdminToken(null); // stale token — drop it
        this.renderLogin();
      } else {
        document.getElementById('admin-root').innerHTML = `
          <div class="login-wrap"><div class="login-card">
            <h1>Cannot reach server</h1>
            <p class="sub">${esc(err.message)}</p>
          </div></div>`;
      }
    }
  },

  /* Verify the session is really gone before showing login — prevents a
   * single flaky 401 (e.g. a request that lost its token) from kicking a
   * signed-in admin back to the login page. */
  async verifySessionOrLogin() {
    try {
      const d = await API.get('/api/admin/auth/me');
      if (d && d.user) {
        this.state.user = d.user;
        this.route(true); // session is fine — re-render instead of logging out
        return;
      }
      throw new Error('unauth');
    } catch (e) {
      setAdminToken(null);
      this.renderLogin();
    }
  },

  /* ------------------------------------------------------------ login */
  renderLogin() {
    const root = document.getElementById('admin-root');
    root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <a class="brand" href="/">
          <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="2.4"/></svg></span>
          <span class="brand-word" style="font-size:19px">Doubt<span>IQ</span></span>
        </a>
        <h1>Admin dashboard</h1>
        <p class="sub">Sign in to manage the content library.</p>
        <form data-role="login-form" novalidate>
          <div class="field"><label for="a-user">Username</label><input class="input" id="a-user" name="username" value="admin" autocomplete="username" required></div>
          <div class="field"><label for="a-pass">Password</label><input class="input" type="password" id="a-pass" name="password" autocomplete="current-password" required></div>
          <div class="login-error" data-role="login-error" hidden aria-live="assertive"></div>
          <button class="btn btn-primary btn-block" type="submit">Sign in</button>
        </form>
      </div>
    </div>`;

    const errorBox = root.querySelector('[data-role="login-error"]');
    const form = root.querySelector('[data-role="login-form"]');
    const showError = (msg) => {
      errorBox.textContent = msg;
      errorBox.hidden = false;
      toast(msg, 'error');
    };

    // One submit handler for BOTH paths: pressing Enter in a field and
    // clicking "Sign in" both fire this submit event — identical behavior.
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); // never let the browser do a native form reload
      e.stopPropagation();
      const btn = form.querySelector('button[type=submit]');
      if (btn.disabled) return; // guard against double submission
      errorBox.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const d = await API.post('/api/admin/auth/login', { username: fval(form, 'username'), password: fval(form, 'password') });
        // Persist the session token BEFORE rendering the shell, so every
        // subsequent admin request is authenticated even without cookies.
        // setAdminToken never throws; the try/catch is pure defense-in-depth.
        try { setAdminToken(d.token || ''); } catch (e) { /* token also lives in memory */ }
        this.state.user = d.user;
        this.renderShell();
      } catch (err) {
        setAdminToken(null);
        const msg = err.status === 401
          ? 'Invalid username or password — check the credentials below.'
          : (err.message || 'Unable to sign in.');
        showError(msg);
        btn.disabled = false;
        btn.textContent = 'Sign in';
        form.querySelector('input[name=password]')?.focus();
      }
    });

    // Focus the password field for speed.
    setTimeout(() => { try { form.querySelector('input[name=password]').focus(); } catch (e) { /* ignore */ } }, 80);
  },

  /* ------------------------------------------------------------ shell */
  renderShell() {
    const root = document.getElementById('admin-root');
    root.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-side">
        <a class="brand" href="#/overview">
          <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="2.4"/></svg></span>
          <span class="brand-word" style="font-size:17px">Doubt<span>IQ</span></span>
        </a>
        <nav data-role="nav">
          <a href="#/overview" data-route="overview">${I.grid} Overview</a>
          <a href="#/questions" data-route="questions">${I.book} Questions</a>
          <a href="#/subjects" data-route="subjects">${I.layers} Subjects</a>
          <a href="#/settings" data-route="settings">${I.cog} Settings</a>
          <div class="sep"></div>
          <a href="/">${I.external} View student site</a>
        </nav>
        <div class="side-foot">
          <a href="#" data-role="logout">${I.logout} Sign out</a>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span>${this.state.user ? esc(this.state.user.display_name) : 'Admin'}</span>
            <button class="icon-btn" style="width:30px;height:30px;border-radius:8px" data-role="theme-toggle" title="Toggle theme">${I.moon}</button>
          </div>
        </div>
      </aside>
      <main class="admin-main">
        <div class="admin-topbar">
          <span style="font-size:12.5px;font-weight:650;color:var(--ink-3);background:var(--bg-sunken);padding:4px 10px;border-radius:99px;border:1px solid var(--line)">Admin</span>
          <div class="who">
            <span class="avatar" style="width:30px;height:30px;font-size:11px">${this.state.user ? esc(initials(this.state.user.display_name)) : 'A'}</span>
            <span>${this.state.user ? esc(this.state.user.display_name) : 'Administrator'}</span>
          </div>
        </div>
        <div id="admin-view"></div>
      </main>
    </div>`;

    // Nav click → route
    root.querySelector('[data-role="nav"]').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-route]');
      if (a) {
        root.querySelectorAll('[data-role="nav"] a').forEach((x) => x.classList.remove('active'));
        a.classList.add('active');
      }
    });

    root.querySelector('[data-role="logout"]').addEventListener('click', async (e) => {
      e.preventDefault();
      try { await API.post('/api/admin/auth/logout'); } catch (err) { /* ignore */ }
      setAdminToken(null);       // drop the persisted token
      this.state.user = null;
      this.renderLogin();
    });

    const tbtn = root.querySelector('[data-role="theme-toggle"]');
    if (tbtn) tbtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('doubtiq-theme', next); } catch (e) { /* storage-safe */ }
      tbtn.innerHTML = next === 'dark' ? I.sun : I.moon;
    });

    // One hashchange listener only (avoid duplicate listeners if the shell
    // is ever re-rendered, which would double-fire route()).
    if (!this._hashBound) {
      this._hashBound = true;
      window.addEventListener('hashchange', () => this.route());
    }
    try {
      if (!location.hash || !location.hash.startsWith('#/')) history.replaceState(null, '', '#/overview');
    } catch (e) { /* history may be restricted in sandboxed iframes — ignore */ }
    this.route();
  },

  /* ------------------------------------------------------------ router */
  route(force) {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const seg = parts[0] || 'overview';
    const viewEl = document.getElementById('admin-view');
    if (!viewEl) return;

    document.querySelectorAll('[data-role="nav"] a[data-route]').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === seg);
    });

    this.revealActivePill();
    if (!force) window.scrollTo({ top: 0 });
    // Live timers only belong to the page being shown.
    Admin.stopLive();
    viewEl.innerHTML = skeletonList(4);

    const fail = (err) => {
      if (err.status === 401 || err.status === 403) {
        // Verify with the server before logging out: a single request that
        // lost its token must NOT bounce a valid session back to login.
        return this.verifySessionOrLogin();
      }
      viewEl.innerHTML = `
        <div class="empty card"><div class="empty-icon">${I.info}</div>
        <h3>Something went wrong</h3><p>${esc(err.message)}</p>
        <div style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-role="retry">Retry</button></div></div>`;
      viewEl.querySelector('[data-role="retry"]')?.addEventListener('click', () => this.route(true));
    };

    // Full-screen question editor routes.
    if (seg === 'questions' && parts[1] === 'new') {
      return AdminQuestions.renderEditor(null)
        .then((html) => { viewEl.innerHTML = html; AdminQuestions.mountEditor(viewEl, null); })
        .catch(fail);
    }
    if (seg === 'questions' && parts[1] === 'edit' && parts[2]) {
      const id = parseInt(parts[2], 10);
      if (!isNaN(id)) {
        return AdminQuestions.renderEditor(id)
          .then((html) => { viewEl.innerHTML = html; AdminQuestions.mountEditor(viewEl, id); })
          .catch(fail);
      }
    }

    const map = {
      overview: AdminOverview,
      questions: AdminQuestions,
      subjects: AdminSubjects,
      settings: AdminSettings
    };
    const View = map[seg] || AdminOverview;
    View.render()
      .then((html) => {
        viewEl.innerHTML = html;
        if (View.mount) View.mount(viewEl);
      })
      .catch(fail);
  },

  /* Keep the active nav pill visible when the pill strip overflows:
   * scroll ONLY the nav container's own horizontal axis so the current
   * page's pill stays in view on narrow screens. No-op when everything
   * already fits (and never touches the vertical desktop sidebar). */
  revealActivePill() {
    try {
      const nav = document.querySelector('.admin-side nav');
      if (!nav) return;
      if (nav.scrollWidth <= nav.clientWidth + 1) return; // fits — nothing to do
      const active = nav.querySelector('a.active');
      if (!active) return;
      const navBox = nav.getBoundingClientRect();
      const pillBox = active.getBoundingClientRect();
      if (pillBox.left < navBox.left) {
        nav.scrollLeft += pillBox.left - navBox.left - 1;
      } else if (pillBox.right > navBox.right) {
        nav.scrollLeft += pillBox.right - navBox.right + 1;
      }
    } catch (e) { /* non-critical */ }
  },

  /* ----------------------------------------------------- live timers */
  stopLive() {
    if (Admin._liveTimer) { clearInterval(Admin._liveTimer); Admin._liveTimer = null; }
  },

  /* ------------------------------------------------------------ modals */
  modal(html, opts = {}) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop admin-modal';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    // Content lives in a scroll container so tall forms (question + answer,
    // subject editor) always fit the viewport; actions stick to the bottom.
    backdrop.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}"><div class="modal-scroll" tabindex="-1">${html}</div></div>`;
    document.body.appendChild(backdrop);
    if (!this._modalStack) this._modalStack = [];
    this._modalStack.push(backdrop);
    document.body.classList.add('modal-open');
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.closeModal(backdrop);
      const cancel = e.target.closest('[data-role="cancel"]');
      if (cancel) this.closeModal(backdrop);
    });
    backdrop.querySelectorAll('[data-role="modal-close"]').forEach((btn) =>
      btn.addEventListener('click', () => this.closeModal(backdrop)));
    const first = backdrop.querySelector('input, select, textarea, button.swatch, button.icon-choice');
    if (first) setTimeout(() => first.focus(), 30);
    return backdrop;
  },

  modalCloseBtn() {
    return '<button class="icon-btn" data-role="modal-close" aria-label="Close" style="width:32px;height:32px;border-radius:9px">' + I.close + '</button>';
  },

  closeModal(modal) {
    if (!modal) return;
    if (this._modalStack) {
      const i = this._modalStack.indexOf(modal);
      if (i > -1) this._modalStack.splice(i, 1);
    }
    modal.dispatchEvent(new CustomEvent('dqi:close'));
    modal.remove();
    if (!this._modalStack || !this._modalStack.length) document.body.classList.remove('modal-open');
  },

  confirm(message) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => { if (!done) { done = true; resolve(val); } };
      const backdrop = this.modal(`
        <div class="modal-head"><h3>Are you sure?</h3>${this.modalCloseBtn()}</div>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.6">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-role="cancel">Cancel</button>
          <button class="btn btn-danger" data-role="ok">${I.trash} Confirm</button>
        </div>`);
      backdrop.querySelector('[data-role="ok"]').addEventListener('click', () => {
        finish(true);
        this.closeModal(backdrop);
      });
      // X, backdrop click and Escape all close via closeModal → dqi:close.
      backdrop.addEventListener('dqi:close', () => finish(false));
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop || e.target.closest('[data-role="modal-close"],[data-role="cancel"]')) finish(false);
      });
    });
  }
};

document.addEventListener('DOMContentLoaded', () => Admin.boot());
