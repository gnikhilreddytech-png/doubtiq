/* DoubtIQ — Subject detail view: /subjects/:slug */
'use strict';

const SubjectView = {
  async render(params) {
    const data = await API.get(`/api/subjects/${encodeURIComponent(params.slug)}/questions?sort=recent`);
    if (data.error) throw new Error(data.error);
    const { subject, questions } = data;

    const sortBtns = (active) => `
      <div class="filter-row" data-role="sort-row" role="group" aria-label="Sort questions">
        <button class="filter-btn ${active === 'recent' ? 'active' : ''}" data-sort="recent">Most recent</button>
        <button class="filter-btn ${active === 'popular' ? 'active' : ''}" data-sort="popular">Most viewed</button>
      </div>`;

    return `
    ${navRail('#/subjects', 'All subjects', [
      { label: 'Home', href: '#/' },
      { label: subject.name }
    ])}

    <section class="card subject-hero">
      <span class="subject-icon subject-hero-icon" style="--sc:${esc(subject.color)}">${subjectIcon(subject.icon)}</span>
      <div class="subject-hero-info">
        <h1>${esc(subject.name)}</h1>
        <div class="subject-hero-tagline">${esc(subject.tagline)}</div>
        <p class="subject-hero-desc">${esc(subject.description)}</p>
      </div>
      <div class="subject-hero-count">
        <b>${questions.length}</b>
        <span>question${questions.length === 1 ? '' : 's'}</span>
      </div>
    </section>

    <div class="toolbar">
      <div class="grow">
        <h2 class="list-heading">Questions in ${esc(subject.name)}</h2>
      </div>
      ${sortBtns('recent')}
    </div>

    <div data-role="qlist">
      ${questions.length ? `<div class="qlist">${questions.map(questionCard).join('')}</div>` : emptyState('No questions yet', `Questions for ${esc(subject.name)} will appear here once published.`, I.book)}
    </div>`;
  },

  mount(el, params) {
    const row = el.querySelector('[data-role="sort-row"]');
    if (!row) return;
    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-sort]');
      if (!btn || btn.classList.contains('active')) return;
      row.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const list = el.querySelector('[data-role="qlist"]');
      list.innerHTML = skeletonList(3);
      try {
        const data = await API.get(`/api/subjects/${encodeURIComponent(params.slug)}/questions?sort=${btn.dataset.sort}`);
        list.innerHTML = data.questions.length
          ? `<div class="qlist">${data.questions.map(questionCard).join('')}</div>`
          : emptyState('No questions yet', 'No questions in this view.');
      } catch (err) { toast(err.message, 'error'); }
    });
  }
};
