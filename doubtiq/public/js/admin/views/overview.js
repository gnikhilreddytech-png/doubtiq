/* DoubtIQ Admin — Overview (live) */
'use strict';

const AdminOverview = {
  async render() {
    const d = await API.get('/api/admin/overview');
    return AdminOverview.build(d);
  },

  build(d) {
    const c = d.counts;

    const cards = [
      { key: 'questions_published', label: 'Published questions', icon: I.book },
      { key: 'views', label: 'Total views', icon: I.eye },
      { key: 'subjects', label: 'Subjects', icon: I.grid },
      { key: 'questions_unpublished', label: 'Draft questions', icon: I.clock }
    ].map((x) => `<div class="stat-card">
        <div class="ic">${x.icon}</div>
        <b data-live="${x.key}">${fmt(c[x.key] ?? 0)}</b><span>${x.label}</span>
      </div>`).join('');

    const distMax = Math.max(1, ...d.subjectDist.map((s) => s.n));
    const dist = d.subjectDist.map((s) => `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:5px">
          <span><span class="legend-dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</span>
          <span style="color:var(--ink-3)" data-live-dist="${esc(s.slug)}">${s.n} question${s.n === 1 ? '' : 's'}</span>
        </div>
        <div style="height:7px;background:var(--bg-sunken);border-radius:99px;overflow:hidden">
          <div data-bar="${esc(s.slug)}" style="width:${Math.round((s.n / distMax) * 100)}%;height:100%;background:${esc(s.color)};border-radius:99px;transition:width .5s ease"></div>
        </div>
      </div>`).join('');

    return `
    <h1 class="page-title">Overview <span class="live-badge"><span class="live-dot"></span>LIVE</span></h1>
    <p class="page-sub">Everything below updates automatically every few seconds. <span data-live-ts style="color:var(--ink-3);font-size:12.5px"></span></p>

    <div class="stat-grid">${cards}</div>

    <div class="two-col">
      <div class="panel">
        <div class="panel-head"><h2>Live activity</h2><div class="spacer"></div><span style="font-size:12px;color:var(--ink-3)">updates every 4s</span></div>
        <div class="panel-body activity-mini" data-role="live-views">${AdminOverview.viewsHtml(d.recentViews || [])}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Questions per subject</h2></div>
        <div class="panel-body" data-role="dist">${dist}</div>
      </div>
    </div>`;
  },

  viewsHtml(views) {
    if (!views || !views.length) return '<div class="act"><div class="t">No views yet — open a question on the student site.</div></div>';
    return views.map((v) => `
      <div class="act">
        <div class="t"><span class="live-dot small"></span> <b>${esc(v.title)}</b> <span style="color:var(--ink-3)">viewed</span></div>
        <time>${timeAgo(v.viewed_at)}</time>
      </div>`).join('');
  },

  /** Live polling: refresh numbers + activity without re-rendering the page. */
  mount(el) {
    Admin.stopLive();
    const tick = async () => {
      try {
        const d = await API.get('/api/admin/overview');
        el.querySelectorAll('[data-live]').forEach((n) => {
          const v = d.counts[n.dataset.live] ?? 0;
          if (Number(n.textContent.replace(/[^0-9]/g, '')) !== v) {
            n.textContent = fmt(v);
            n.classList.add('pulse-once');
            setTimeout(() => n.classList.remove('pulse-once'), 600);
          }
        });
        const feed = el.querySelector('[data-role="live-views"]');
        if (feed) feed.innerHTML = AdminOverview.viewsHtml(d.recentViews || []);
        const ts = el.querySelector('[data-live-ts]');
        if (ts) ts.textContent = 'Last updated ' + new Date().toLocaleTimeString();
      } catch (e) { /* server hiccup — keep the last data */ }
    };
    Admin._liveTimer = setInterval(tick, 4000);
  }
};
