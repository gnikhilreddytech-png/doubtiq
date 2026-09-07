/* DoubtIQ Admin — Questions
 * List view + full-screen Create/Edit editor (`#/questions/new`,
 * `#/questions/edit/<id>`). Question and answer are written together;
 * nothing important is ever hidden below the viewport (sticky action bar).
 */
'use strict';

let Q_VIEW = { q: '', subject: 'all', status: 'all' };

const AdminQuestions = {
  /* ---------------------------------------------------------- list view */
  async render() {
    const [subjectsData, listData] = await Promise.all([
      API.get('/api/admin/subjects'),
      API.get(`/api/admin/questions?q=${encodeURIComponent(Q_VIEW.q)}&subject=${Q_VIEW.subject}&status=${Q_VIEW.status}`)
    ]);
    const subjects = subjectsData.subjects || [];
    const rows = listData.questions || [];

    const statusChip = (s) => s === 'published'
      ? '<span class="badge green">Published</span>'
      : '<span class="badge amber">Draft</span>';

    const rowsHtml = rows.length ? rows.map((q) => `
      <tr>
        <td class="cell-title">
          <b class="q-title-text">${esc(q.title)}</b>
          <div class="sub">${esc(q.subject_name)} · ${timeAgo(q.created_at)} · ${fmt(q.view_count)} views · ${q.answer_count} answer${q.answer_count === 1 ? '' : 's'}</div>
        </td>
        <td class="cell-status">${statusChip(q.status)}</td>
        <td class="cell-actions">
          <div class="row-actions">
            <button class="mini-btn" data-act="edit" data-id="${q.id}">${I.pencil} Edit</button>
            <button class="mini-btn ${q.status === 'published' ? 'amber' : 'green'}" data-act="toggle" data-id="${q.id}">${q.status === 'published' ? 'Unpublish' : 'Publish'}</button>
            <button class="mini-btn red" data-act="del" data-id="${q.id}">${I.trash}</button>
          </div>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="3" style="text-align:center;color:var(--ink-3);padding:30px">No questions match your filters.</td></tr>';

    const subjectOpts = subjects.map((s) =>
      `<option value="${s.slug}" ${Q_VIEW.subject === s.slug ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

    return `
    <h1 class="page-title">Questions</h1>
    <p class="page-sub">Create, edit, publish or unpublish questions — the question and its answer are written together in one editor.</p>

    <div class="panel">
      <div class="panel-head" style="gap:10px">
        <input class="input" style="width:220px" data-role="q-search" placeholder="Search title or body…" value="${esc(Q_VIEW.q)}">
        <select class="select" data-role="q-subject" style="width:160px">
          <option value="all">All subjects</option>${subjectOpts}
        </select>
        <select class="select" data-role="q-status" style="width:140px">
          <option value="all" ${Q_VIEW.status === 'all' ? 'selected' : ''}>Any status</option>
          <option value="published" ${Q_VIEW.status === 'published' ? 'selected' : ''}>Published</option>
          <option value="unpublished" ${Q_VIEW.status === 'unpublished' ? 'selected' : ''}>Draft</option>
        </select>
        <div class="spacer"></div>
        <a class="btn btn-primary btn-sm" href="#/questions/new">${I.plus} Add Question</a>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Question</th><th>Status</th><th></th></tr></thead>
        <tbody data-role="rows">${rowsHtml}</tbody>
      </table></div>
    </div>`;
  },

  mount(el) {
    el.querySelector('[data-role="q-search"]').addEventListener('input', debounce(() => {
      Q_VIEW.q = el.querySelector('[data-role="q-search"]').value.trim();
      Admin.route(true);
    }, 350));
    el.querySelector('[data-role="q-subject"]').addEventListener('change', (e) => { Q_VIEW.subject = e.target.value; Admin.route(true); });
    el.querySelector('[data-role="q-status"]').addEventListener('change', (e) => { Q_VIEW.status = e.target.value; Admin.route(true); });

    el.querySelector('[data-role="rows"]').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;

      if (act === 'new') { location.hash = '#/questions/new'; return; }
      if (act === 'edit') { location.hash = `#/questions/edit/${id}`; return; }
      if (act === 'toggle') {
        btn.disabled = true;
        const q = (await API.get(`/api/admin/questions?q=&subject=all&status=all`)).questions.find((x) => x.id === Number(id));
        const next = q.status === 'published' ? 'unpublished' : 'published';
        await API.put(`/api/admin/questions/${id}/status`, { status: next });
        toast(`Question ${next === 'published' ? 'published' : 'moved to draft'}`);
        Admin.route(true);
      }
      if (act === 'del') {
        const ok = await Admin.confirm('Delete this question permanently? Its answers will be removed too.');
        if (!ok) return;
        await API.del(`/api/admin/questions/${id}`);
        toast('Question deleted');
        Admin.route(true);
      }
    });
  },

  /* ------------------------------------------- full-screen question editor */
  async renderEditor(id) {
    const subjects = (await API.get('/api/admin/subjects')).subjects || [];
    let q = null;
    let answers = [];
    if (id) {
      const data = await API.get(`/api/admin/questions?q=&subject=all&status=all`);
      q = data.questions.find((x) => x.id === id) || null;
      if (q) {
        const ad = await API.get(`/api/admin/questions/${q.id}/answers`);
        answers = ad.answers || [];
      }
    }
    if (id && !q) throw new Error('Question not found');

    const subjectOpts = ['<option value="">Select subject…</option>']
      .concat(subjects.map((s) => `<option value="${s.id}" ${q && q.subject_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`))
      .join('');

    // Editing: load the most relevant answer into the form by default.
    let primary = null;
    if (answers.length) {
      primary = answers.find((a) => a.is_verified) || answers[0];
    }

    const answersListHtml = q ? `
      <div class="qe-block" data-role="qe-answers-block">
        <h2>Answers on this question</h2>
        <p class="hint" style="margin-top:-4px">Select an answer to edit it in the form below, or delete it. To add a new one, click “Add another answer”.</p>
        <div class="inline-answers" data-role="qe-answers">
          ${answers.length ? answers.map((a) => `
            <div class="ia-row" data-answer-id="${a.id}">
              <div class="ia-info">
                <b>${esc(a.author)}</b>
                ${a.is_verified ? '<span class="badge green">Verified</span>' : '<span class="badge amber">Not verified</span>'}
                <span class="badge ${a.status === 'published' ? 'green' : 'amber'}">${a.status}</span>
                <div class="ia-preview">${esc(a.body.slice(0, 220))}${a.body.length > 220 ? '…' : ''}</div>
              </div>
              <div class="row-actions">
                <button type="button" class="mini-btn" data-ans-edit="${a.id}">${I.pencil} Edit</button>
                <button type="button" class="mini-btn red" data-ans-del="${a.id}">${I.trash}</button>
              </div>
            </div>`).join('')
          : '<p class="hint" style="margin:2px 0 4px">No answers yet — write the first one below.</p>'}
        </div>
      </div>` : '';

    const published = !q || q.status === 'published';

    // The answer box is a rich-text area that mirrors the hidden markdown
    // field. Existing markdown answers are rendered into it up-front.
    const answerMd = primary ? primary.body : '';
    const answerHtml = answerMd && String(answerMd).trim() ? renderMd(answerMd) : '';

    return `
    <div class="qe-editor">
      <div class="qe-head">
        <a class="btn btn-ghost btn-sm" href="#/questions" data-role="qe-cancel">${I.back} Back to questions</a>
        <h1 class="page-title" style="margin:14px 0 0">${q ? 'Edit question' : 'New question'}</h1>
        <p class="page-sub" style="margin-top:2px">${q ? 'Update the question and its answer below.' : 'Write the question and its answer together — both are saved in one go.'}</p>
      </div>

      <form class="qe-form" data-role="qe-form">
        <input type="hidden" name="answer_id" value="${primary ? primary.id : ''}">

        <div class="qe-block">
          <div class="qe-grid">
            <div class="field">
              <label>Subject *</label>
              <select class="select" name="subject_id" required>${subjectOpts}</select>
            </div>
            <div class="field">
              <label>Status</label>
              <div class="qe-status">
                <label class="switch-row">
                  <input type="checkbox" name="status" id="qe-status" ${published ? 'checked' : ''}>
                  <span>Publish immediately</span>
                </label>
                <span class="hint" style="display:block">Uncheck to save as a draft.</span>
              </div>
            </div>
          </div>
        </div>

        <div class="qe-block">
          <div class="field">
            <label>Question *</label>
            <textarea class="textarea qe-question" name="title" required maxlength="300" rows="2" placeholder="e.g. Why is the area of a circle πr²?">${q ? esc(q.title) : ''}</textarea>
          </div>
          <div class="field" style="margin-top:16px">
            <label>Answer *</label>
            <div class="qe-toolbar" role="toolbar" aria-label="Answer formatting" data-role="md-toolbar">
              <button type="button" class="qe-tbtn" data-md="bold" title="Bold  (Ctrl/Cmd + B)"><b>B</b></button>
            </div>
            <div class="qe-rich" contenteditable="true" data-role="md-rich" data-placeholder="Write the full answer here — select text and press B (or Ctrl/Cmd + B) to make it bold. Bold text, bullet points and spacing you paste from another page are preserved automatically." spellcheck="true">${answerHtml}</div>
            <textarea class="textarea qe-answer" name="answer_body" data-role="md-input" tabindex="-1" aria-hidden="true" style="display:none">${primary ? esc(primary.body) : ''}</textarea>
            <span class="hint">Click <b>B</b> (or press Ctrl/Cmd + B) to make the selected text <b>bold</b>. Formatting pasted from another page — bold, bullets, spacing — is preserved automatically.</span>
          </div>
          <div class="qe-grid" style="margin-top:16px">
            <div class="field">
              <label>Answer author</label>
              <input class="input" name="answer_author" maxlength="100" placeholder="Author" value="${primary ? esc(primary.author) : 'Author'}">
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <div class="check-row" style="height:100%;align-items:center">
                <input type="checkbox" name="answer_verified" id="qe-verified" ${!primary || primary.is_verified ? 'checked' : ''}>
                <label for="qe-verified" style="cursor:pointer">Verified answer</label>
              </div>
            </div>
          </div>
        </div>

        <div class="qe-block">
          <div class="field">
            <label>Topics / tags (optional, comma-separated)</label>
            <input class="input" name="topics" maxlength="500" placeholder="e.g. algebra, equations, proofs" value="${q ? esc(q.topics || '') : ''}">
            <span class="hint">Used by search to find this question by topic.</span>
          </div>
        </div>

        ${answersListHtml}

        ${q ? '<button type="button" class="btn btn-soft btn-sm" data-role="qe-add-answer" style="margin-bottom:14px">' + I.plus + ' Add another answer</button>' : ''}

        <div class="qe-actions">
          <a class="btn btn-ghost" href="#/questions" data-role="qe-cancel-2">Cancel</a>
          <button type="submit" class="btn btn-primary" data-role="qe-save">${published ? 'Save & Publish' : 'Save as draft'}</button>
        </div>
      </form>
    </div>`;
  },

  mountEditor(el, id) {
    const form = el.querySelector('[data-role="qe-form"]');
    if (!form) return;

    // Formatting toolbar + smart paste for the answer box (bold, italic,
    // lists; preserves formatting copied from other pages).
    initMdEditor(form);
    const answerRich = form.querySelector('[data-role="md-rich"]');
    const answerTa = form.querySelector('textarea[name="answer_body"]');

    /* ---- unsaved-changes guard (refresh / close / in-app nav) ---- */
    let dirty = false;
    const markDirty = () => { dirty = true; };
    ['title', 'answer_body', 'topics', 'answer_author', 'answer_verified', 'status', 'subject_id'].forEach((n) => {
      const f = form.querySelector(`[name="${n}"]`);
      if (f) { f.addEventListener('input', markDirty); f.addEventListener('change', markDirty); }
    });
    const clearDirty = () => { dirty = false; };
    const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    const editorHash = location.hash || '#/questions/new';
    let suppressing = false;
    const navGuard = () => {
      if (suppressing || !dirty) return;
      let stay = false;
      try { stay = !window.confirm('You have unsaved changes in this question. Leave anyway?'); }
      catch (_) { stay = false; }
      if (stay) {
        suppressing = true;
        try { history.replaceState(null, '', editorHash); } catch (_) {}
        location.hash = editorHash;
        setTimeout(() => { suppressing = false; }, 0);
      }
    };
    window.addEventListener('hashchange', navGuard);
    // Explicit Cancel / Back links should not prompt.
    el.querySelectorAll('[data-role="qe-cancel"], [data-role="qe-cancel-2"]').forEach((c) => {
      c.addEventListener('click', clearDirty);
    });

    const saveBtn = el.querySelector('[data-role="qe-save"]');
    const statusBox = form.querySelector('input[name="status"]');
    const isPublished = () => fchk(form, 'status');
    const updateLabel = () => {
      saveBtn.textContent = isPublished() ? 'Save & Publish' : 'Save as draft';
    };
    statusBox.addEventListener('change', updateLabel);

    // Add another answer: clear the answer fields so save creates a new one.
    const addBtn = el.querySelector('[data-role="qe-add-answer"]');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        form.querySelector('input[name="answer_id"]').value = '';
        setAnswerEditor(answerRich, answerTa, '');
        form.querySelector('input[name="answer_author"]').value = 'Author';
        form.querySelector('input[name="answer_verified"]').checked = true;
        answerRich.focus();
        toast('Writing a new answer — save to add it');
        window.scrollTo({ top: answerRich.offsetTop - 90, behavior: 'smooth' });
      });
    }

    // Answer list actions (edit loads into the form; delete removes).
    const answersBlock = el.querySelector('[data-role="qe-answers-block"]');
    if (answersBlock) {
      answersBlock.addEventListener('click', async (e) => {
        const edit = e.target.closest('[data-ans-edit]');
        const del = e.target.closest('[data-ans-del]');
        if (edit) {
          const aid = Number(edit.dataset.ansEdit);
          try {
            const ad = await API.get(`/api/admin/questions/${id}/answers`);
            const a = (ad.answers || []).find((x) => x.id === aid);
            if (a) {
              form.querySelector('input[name="answer_id"]').value = a.id;
              setAnswerEditor(answerRich, answerTa, a.body);
              form.querySelector('input[name="answer_author"]').value = a.author;
              form.querySelector('input[name="answer_verified"]').checked = !!a.is_verified;
              toast('Answer loaded — edit and save');
              window.scrollTo({ top: answerRich.offsetTop - 90, behavior: 'smooth' });
            }
          } catch (err) { toast(err.message, 'error'); }
          return;
        }
        if (del) {
          const aid = Number(del.dataset.ansDel);
          const ok = await Admin.confirm('Delete this answer permanently?');
          if (!ok) return;
          try {
            await API.del(`/api/admin/answers/${aid}`);
            toast('Answer deleted');
            clearDirty();
            Admin.route(true); // re-render the editor fresh
          } catch (err) { toast(err.message, 'error'); }
        }
      });
    }

    // Save: question (+ answer for create; answer update/add for edit).
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = fval(form, 'title').trim();
      const answerBody = fval(form, 'answer_body').trim();
      if (!title) return toast('Question title is required', 'error');
      if (!answerBody) return toast('Answer is required — write the answer to the question', 'error');
      if (!fval(form, 'subject_id')) return toast('Choose a subject', 'error');

      const qStatus = isPublished() ? 'published' : 'unpublished';
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const body = {
          subject_id: Number(fval(form, 'subject_id')),
          title,
          // No separate "details" field in this editor — leave any existing
          // question body untouched on edit (server COALESCE handles it).
          topics: fval(form, 'topics').trim(),
          status: qStatus
        };

        if (!id) {
          // Create question + answer together.
          body.answer_body = answerBody;
          body.answer_author = fval(form, 'answer_author').trim() || 'Author';
          body.answer_verified = fchk(form, 'answer_verified');
          await API.post('/api/admin/questions', body);
          toast(qStatus === 'published' ? 'Question + answer published' : 'Question + answer saved as draft');
        } else {
          // Update question.
          await API.put(`/api/admin/questions/${id}`, body);
          // Update/create the answer currently loaded in the form.
          const answerId = fval(form, 'answer_id');
          const answerPayload = {
            author: fval(form, 'answer_author').trim() || 'Author',
            body: answerBody,
            is_verified: fchk(form, 'answer_verified'),
            status: qStatus
          };
          if (answerId) await API.put(`/api/admin/answers/${answerId}`, answerPayload);
          else await API.post('/api/admin/answers', { question_id: id, ...answerPayload });
          toast(qStatus === 'published' ? 'Question + answer saved & published' : 'Question + answer saved as draft');
        }
        clearDirty();
        window.removeEventListener('beforeunload', beforeUnload);
        location.hash = '#/questions';
      } catch (err) {
        toast(err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isPublished() ? 'Save & Publish' : 'Save as draft';
      }
    });
  },

};

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ====================================================================
 * Answer editor — Bold + smart paste (rich text)
 * --------------------------------------------------------------------
 * The answer box is a light rich-text area, so when you select text and
 * press B it becomes BOLD right away (no raw ** markers). The rich area
 * is mirrored into the hidden textarea[name="answer_body"] as the plain
 * markdown the rest of the app already understands — storage, public
 * rendering, SSR/SEO and the sitemap are completely unchanged. Content
 * pasted from another page (bold, bullets, spacing) keeps its formatting.
 * ================================================================== */

/** Apply bold to the current selection inside the rich answer box. */
function applyBold(rich, ta) {
  try { rich.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  let applied = false;
  try { applied = document.execCommand && document.execCommand('bold'); } catch (e) { applied = false; }
  if (!applied) applied = boldSelectionFallback();
  syncRichToField(rich, ta);
  return applied;
}

/** Manual fallback for browsers where execCommand('bold') is unavailable. */
function boldSelectionFallback() {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    const b = document.createElement('b');
    range.surroundContents(b);
    const r = document.createRange();
    r.selectNodeContents(b);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  } catch (e) { return false; }
}

/** True when the rich editor holds any real content (incl. formatting). */
function hasRichContent(rich) {
  if (!rich) return false;
  if (rich.querySelector('b, strong, i, em, ul, ol, table')) return true;
  return !!(rich.textContent || '').trim();
}

/** Mirror the rich editor into the hidden markdown field. */
function syncRichToField(rich, ta) {
  if (!ta || !rich) return;
  let md = '';
  if (hasRichContent(rich)) {
    // Walk the live editor DOM directly so saved markdown always mirrors
    // exactly what the admin sees (no string re-parsing edge cases).
    const converted = htmlToMd('', rich);
    md = converted == null ? '' : String(converted);
  }
  // If the editor holds only empty tags/whitespace, clear it so the
  // placeholder text shows again and nothing is stored.
  if (!md.trim() && !(rich.textContent || '').trim() && !rich.querySelector('b, strong, i, em, ul, ol, table')) {
    if (rich.innerHTML !== '') rich.innerHTML = '';
    md = '';
  }
  if (ta.value !== md) {
    ta.value = md;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Set both the rich editor and its hidden markdown field to `md`. */
function setAnswerEditor(rich, ta, md) {
  const text = String(md || '');
  if (ta) ta.value = text;
  if (rich) rich.innerHTML = text.trim() ? renderMd(text) : '';
}

/**
 * Convert HTML content into the markdown-lite dialect the app renders:
 * **bold**, *italic*, "- "/"1. " lists (nested ones indented), | tables |,
 * paragraphs and line spacing.
 *
 *  - `html`  : an HTML string (pasted from another site / Word / Docs).
 *  - `givenRoot` : optional DOM node to read instead of parsing a string.
 *                  The answer box passes its own element here so the saved
 *                  markdown always mirrors exactly what is on screen.
 * Returns null when nothing can be parsed (caller keeps default behaviour).
 */
function htmlToMd(html, givenRoot) {
  let root = givenRoot || null;
  let doc = null;
  if (!root) {
    const DP = typeof DOMParser !== 'undefined' ? DOMParser : null;
    if (!DP) return null;
    try { doc = new DP().parseFromString(String(html || ''), 'text/html'); } catch (err) { return null; }
    if (!doc) return null;
    // Real browsers wrap pasted fragments in <body>. Some DOM parsers
    // (and our tests) hand back the fragment directly — handle both.
    root = doc.body;
    if (!root || !root.firstChild) root = doc.documentElement || doc;
    if (!root) return null;
  }

  const elems = (n) => Array.prototype.filter.call((n && n.childNodes) || [], (c) => c.nodeType === 1);
  const nodes = (n) => Array.prototype.slice.call((n && n.childNodes) || []);

  /* Inline content (bold/italic/code wrappers, text, <br>). */
  function inline(node) {
    if (node.nodeType === 3) return node.nodeValue;               // text
    if (node.nodeType !== 1) return '';
    const tag = node.nodeName.toUpperCase();
    if (tag === 'BR') return '\n';
    let inner = '';
    for (const c of nodes(node)) inner += inline(c);
    if (tag === 'B' || tag === 'STRONG') return inner ? `**${inner}**` : '';
    if (tag === 'I' || tag === 'EM') return inner ? `*${inner}*` : '';
    if (tag === 'CODE') return inner ? `\`${inner}\`` : '';
    // a, u, s, strike, del, font, span, mark, sub, sup, small → keep text only
    return inner;
  }

  const trimLine = (l) => String(l).replace(/\s+$/g, '');
  const flatInline = (node) => String(inline(node)).split('\n').map((l) => trimLine(l)).filter((l) => l.trim() !== '');

  /* Returns an array of markdown lines for a block element. */
  function blockLines(node, depth) {
    const tag = node.nodeName.toUpperCase();
    const pad = '    '.repeat(depth);
    const out = [];

    if (tag === 'UL' || tag === 'OL') {
      const ordered = tag === 'OL';
      let n = 1;
      for (const li of elems(node)) {
        if (li.nodeName.toUpperCase() !== 'LI') continue;
        let first = '';
        const nested = [];
        for (const c of nodes(li)) {
          if (c.nodeType === 1 && (c.nodeName.toUpperCase() === 'UL' || c.nodeName.toUpperCase() === 'OL')) nested.push(c);
          else first += inline(c);
        }
        const firstLines = first.split('\n').map(trimLine).filter((l) => l.trim() !== '');
        const marker = ordered ? `${n}. ` : '- ';
        n += 1;
        if (firstLines.length) {
          out.push(pad + marker + firstLines.join('\n' + pad + ' '.repeat(marker.length)));
        } else {
          out.push(pad + marker.trimEnd());
        }
        for (const sub of nested) for (const ln of blockLines(sub, depth + 1)) out.push(ln);
      }
      return out;
    }

    if (tag === 'TABLE') {
      let trs = [];
      try { trs = Array.from(node.querySelectorAll('tr')); }
      catch (err) { trs = elems(node).filter((c) => c.nodeName.toUpperCase() === 'TR'); }
      if (trs.length >= 2) {
        const cells = (tr) => elems(tr)
          .filter((c) => /^T[HD]$/.test(c.nodeName.toUpperCase()))
          .map((cd) => flatInline(cd).join(' ') || ' ');
        const head = cells(trs[0]);
        const rowMd = (arr) => `| ${arr.join(' | ')} |`;
        out.push(rowMd(head));
        out.push(`| ${head.map(() => '---').join(' | ')} |`);
        for (const tr of trs.slice(1)) out.push(rowMd(cells(tr)));
        return out;
      }
      // Degenerate table → plain text lines.
    }

    if (/^H[1-6]$/.test(tag)) {
      for (const l of flatInline(node)) out.push(pad + `**${l}**`);
      return out;
    }

    if (tag === 'PRE') {
      for (const l of String(node.textContent || '').split('\n')) out.push(l);
      return out;
    }

    // Generic block (p, div, li, td, section, blockquote, …).
    let hasBlockChild = false;
    const pieces = [];
    for (const c of nodes(node)) {
      if (c.nodeType === 3) { pieces.push(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const ct = c.nodeName.toUpperCase();
      if (ct === 'UL' || ct === 'OL' || ct === 'TABLE' || ct === 'P' || ct === 'DIV' || /^H[1-6]$/.test(ct)) {
        hasBlockChild = true;
        break;
      }
      pieces.push(inline(c));
    }
    if (!hasBlockChild) {
      const joined = pieces.join('').split('\n').map(trimLine).filter((l) => l.trim() !== '');
      if (joined.length) for (const l of joined) out.push(l);
      return out;
    }
    // Mixed block: separate children, add blank lines between blocks.
    for (const c of nodes(node)) {
      if (c.nodeType === 3) { const t = trimLine(c.nodeValue); if (t.trim()) out.push(t); continue; }
      if (c.nodeType !== 1) continue;
      const sub = blockLines(c, depth);
      if (sub.length) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        for (const l of sub) out.push(l);
      }
    }
    return out;
  }

  const ct = root.nodeName.toUpperCase();
  const wrapper = (ct === 'BODY' || ct === 'HTML' || ct === 'DIV' || ct === 'SECTION' || ct === 'ARTICLE' || ct === 'MAIN' || ct === 'HEADER' || ct === 'FOOTER' || ct === 'BLOCKQUOTE' || ct === 'FORM');
  const isBlockEl = (c) => c && c.nodeType === 1 &&
    ['P', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'TR', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'SECTION', 'ARTICLE'].indexOf(c.nodeName.toUpperCase()) !== -1;

  // Group the wrapper's children into segments: consecutive inline items
  // (text + <b>/<i>/<br> — what a contenteditable produces for a typed line
  // that contains bold runs, e.g. "Hello <b>bold</b> world") become ONE
  // paragraph; block elements each become their own segment.
  const collect = () => {
    const segs = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const joined = cur.map(inline).join('').split('\n')
        .map(trimLine).filter((l) => l.trim() !== '');
      if (joined.length) segs.push(joined);
      cur = [];
    };
    for (const c of nodes(root)) {
      if (c.nodeType === 3) { cur.push(c); continue; }
      if (c.nodeType !== 1) continue;
      if (isBlockEl(c)) { flush(); const sub = blockLines(c, 0); if (sub.length) segs.push(sub); }
      else cur.push(c);
    }
    flush();
    const out = [];
    for (const seg of segs) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      for (const l of seg) out.push(l);
    }
    return out;
  };

  let lines = [];
  if (!wrapper) {
    // Parser handed us a single content element (e.g. <ul>, <table>, <h2>).
    lines = blockLines(root, 0);
  } else {
    lines = collect();
  }

  // Collapse repeated blank lines; trim edges and trailing spaces.
  const cleaned = [];
  let blanks = 0;
  for (const l of lines) {
    if (l.trim() === '') { blanks += 1; if (blanks === 1) cleaned.push(''); }
    else { blanks = 0; cleaned.push(trimLine(l)); }
  }
  while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned.join('\n');
}

/** Wire up the rich answer box (Bold via toolbar/Ctrl+B, live sync, paste). */
function initMdEditor(form) {
  const ta = form.querySelector('textarea[name="answer_body"]');
  const rich = form.querySelector('[data-role="md-rich"]');
  if (!ta || !rich) return;
  const wrap = form.querySelector('[data-role="md-toolbar"]');

  // If the rich box was served empty (e.g. after add-another), seed it from
  // the hidden field's markdown so an existing answer stays visible.
  if (!rich.innerHTML.trim() && ta.value.trim()) rich.innerHTML = renderMd(ta.value);

  if (wrap) {
    // Keep the text selection inside the answer box while clicking B.
    wrap.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-md]')) e.preventDefault();
    });
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-md]');
      if (!b || b.getAttribute('data-md') !== 'bold') return;
      applyBold(rich, ta);
    });
  }

  // Keep the hidden markdown field in sync whenever the rich editor changes
  // (typing, bold, native Ctrl/Cmd+B, pasting rich content).
  rich.addEventListener('input', () => syncRichToField(rich, ta));
  rich.addEventListener('blur', () => syncRichToField(rich, ta));
  // If content was pasted, some browsers fire paste after input; syncing on
  // paste too makes the round-trip robust.
  rich.addEventListener('paste', () => setTimeout(() => syncRichToField(rich, ta), 0));
}
