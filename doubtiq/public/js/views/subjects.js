/* DoubtIQ — Subjects index view */
'use strict';

const SubjectsView = {
  async render() {
    const data = await API.get('/api/subjects');
    const subjects = data.subjects || [];
    return `
    ${navRail('#/', 'Back to home', [{ label: 'Home', href: '#/' }, { label: 'Subjects' }])}
    <div class="section-head" style="margin-bottom:22px">
      <div>
        <h1 class="page-title-lg">Subjects</h1>
        <p class="page-sub-lg">Curated questions and answers in each subject.</p>
      </div>
    </div>
    ${subjects.length ? `<div class="subject-grid">${subjects.map(subjectCard).join('')}</div>` : emptyState('No subjects', 'Subjects will appear here.')}`;
  }
};
