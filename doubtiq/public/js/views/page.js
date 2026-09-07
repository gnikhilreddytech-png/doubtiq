/* DoubtIQ — Custom page view: /page/:slug (About, How to use, etc.) */
'use strict';

const PageView = {
  async render(params) {
    const data = await API.get(`/api/pages/${encodeURIComponent(params.slug)}`);
    if (data.error) throw new Error(data.error);
    const page = data.page;

    return `
    ${navRail('#/', 'Back to home', [{ label: 'Home', href: '#/' }, { label: page.title }])}
    <article class="card q-head page-reader">
      <h1 class="page-title-lg">${esc(page.title)}</h1>
      <div class="page-meta">Last updated ${timeAgo(page.updated_at)}</div>
      <div class="page-body">${mdBlock(page.body)}</div>
    </article>`;
  }
};
