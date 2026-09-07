/* DoubtIQ — Question detail view: /questions/:slug (the reading experience) */
'use strict';

const QuestionView = {
  async render(params) {
    const data = await API.get(`/api/questions/${encodeURIComponent(params.slug)}`);
    const q = data.question;
    const topics = Array.isArray(q.topics) ? q.topics : [];

    // Related questions from the same subject.
    let related = [];
    try {
      const r = await API.get(`/api/subjects/${encodeURIComponent(q.subject)}/questions?sort=popular`);
      related = (r.questions || []).filter((x) => x.id !== q.id).slice(0, 4);
    } catch (e) { /* ignore */ }

    const answersHtml = q.answers.length ? q.answers.map((a) => `
      <article class="answer ${a.is_verified ? 'verified' : ''}">
        <div class="a-head">
          <span class="a-avatar" aria-hidden="true">${esc(initials(a.author))}</span>
          <div class="a-who">
            <b>${esc(a.author)}</b>
            <span>${a.is_verified ? '<span class="a-verified">' + I.checkCircle + ' Verified answer</span>' : 'Answer'}</span>
          </div>
        </div>
        <div class="a-body">${renderMd(a.body)}</div>
      </article>`).join('')
      : emptyState('No answer yet', 'The editorial team is preparing a clear answer for this question.', I.message);

    // SEO: question-specific title + description (also updates canonical).
    if (typeof App !== 'undefined' && App.setMeta) {
      const excerpt = (q.body || (q.answers[0] && q.answers[0].body) || '')
        .replace(/[*#`>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155);
      App.setMeta(
        `${q.title} — DoubtIQ`,
        excerpt || `A question in ${q.subject_name} with a clear, curated answer.`,
        `#/questions/${encodeURIComponent(q.slug || q.id)}`
      );
    }

    return `
    ${navRail(`#/subjects/${esc(q.subject)}`, `Back to ${q.subject_name}`, [
      { label: 'Home', href: '#/' },
      { label: q.subject_name, href: `#/subjects/${esc(q.subject)}` },
      { label: q.title }
    ])}

    <div class="q-reader">
      <article class="card q-head">
        <div class="q-tags">
          ${subjectChip(q)}
          ${topicChips(topics)}
        </div>
        <h1>${esc(q.title)}</h1>
        <div class="q-meta" aria-label="Question details">
          <span class="m">${I.clock}<span>Asked ${timeAgo(q.created_at)}</span></span>
        </div>
        ${q.body ? `<div class="q-body">${mdBlock(q.body)}</div>` : ''}
        <div class="q-views-line" aria-label="Views">${I.eye} <span>${fmt(q.view_count)} views</span></div>
      </article>

      <section class="answers" aria-labelledby="answers-heading">
        <h2 id="answers-heading">Answers</h2>
        ${answersHtml}
      </section>

      ${related.length ? `
      <section class="related" aria-label="Related questions">
        <h2>More in ${esc(q.subject_name)}</h2>
        <div class="qlist">${related.map(questionCard).join('')}</div>
      </section>` : ''}
    </div>`;
  },

  mount(el, params) {
    /* Reading page — no interactions needed. */
  }
};
