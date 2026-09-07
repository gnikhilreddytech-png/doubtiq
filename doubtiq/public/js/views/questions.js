/* DoubtIQ — All questions view (#/questions): every question, filter by
 * subject, sort by recency or popularity. */
'use strict';

const QuestionsView = {
  state: { subject: 'all', sort: 'recent' },

  async render() {
    const [subjectsData, data] = await Promise.all([
      API.get('/api/subjects'),
      API.get(`/api/questions?subject=${this.state.subject}&sort=${this.state.sort}&limit=100`)
    ]);
    const subjects = subjectsData.subjects || [];
    const questions = data.questions || [];

    const chips = `<button class="filter-btn ${this.state.subject === 'all' ? 'active' : ''}" data-subj="all">All subjects</button>` +
      subjects.map((s) =>
        `<button class="filter-btn ${this.state.subject === s.slug ? 'active' : ''}" data-subj="${esc(s.slug)}">${esc(s.name)}</button>`
      ).join('');

    const sorts = `
      <button class="filter-btn ${this.state.sort === 'recent' ? 'active' : ''}" data-sort="recent">Most recent</button>
      <button class="filter-btn ${this.state.sort === 'popular' ? 'active' : ''}" data-sort="popular">Most viewed</button>`;

    return `
    ${navRail('#/', 'Back to home', [{ label: 'Home', href: '#/' }, { label: 'Questions' }])}
    <div class="section-head" style="margin-bottom:16px">
      <div>
        <h1 class="page-title-lg">All questions</h1>
        <p class="page-sub-lg">${questions.length} question${questions.length === 1 ? '' : 's'} across every subject.</p>
      </div>
    </div>
    <div class="toolbar" style="margin-bottom:20px">
      <div class="filter-row" data-role="subj-filters">${chips}</div>
      <div class="grow"></div>
      <div class="filter-row" data-role="sort-filters">${sorts}</div>
    </div>
    <div data-role="qlist">
      ${questions.length
        ? `<div class="qlist">${questions.map(questionCard).join('')}</div>`
        : emptyState('No questions here yet', 'Questions published by the editorial team will appear in this view.', I.book)}
    </div>`;
  },

  mount(el) {
    const subjRow = el.querySelector('[data-role="subj-filters"]');
    const sortRow = el.querySelector('[data-role="sort-filters"]');
    const list = el.querySelector('[data-role="qlist"]');

    const refresh = async () => {
      list.innerHTML = skeletonList(3);
      try {
        const data = await API.get(`/api/questions?subject=${QuestionsView.state.subject}&sort=${QuestionsView.state.sort}&limit=100`);
        list.innerHTML = data.questions.length
          ? `<div class="qlist">${data.questions.map(questionCard).join('')}</div>`
          : emptyState('No questions here yet', 'No questions match this view.', I.book);
      } catch (err) {
        toast(err.message, 'error');
        list.innerHTML = '';
      }
    };

    subjRow.addEventListener('click', (e) => {
      const b = e.target.closest('[data-subj]');
      if (!b || b.classList.contains('active')) return;
      QuestionsView.state.subject = b.dataset.subj;
      subjRow.querySelectorAll('.filter-btn').forEach((x) => x.classList.toggle('active', x === b));
      refresh();
    });

    sortRow.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]');
      if (!b || b.classList.contains('active')) return;
      QuestionsView.state.sort = b.dataset.sort;
      sortRow.querySelectorAll('.filter-btn').forEach((x) => x.classList.toggle('active', x === b));
      refresh();
    });
  }
};
