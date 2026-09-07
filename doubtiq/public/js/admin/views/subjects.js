/* DoubtIQ Admin — Subjects (six core subjects + any the admin adds) */
'use strict';

const SUBJECT_COLORS = ['#3d4fe3', '#0d9488', '#7c3aed', '#059669', '#d97706', '#e11d48', '#b45309', '#2563eb', '#db2777', '#0891b2', '#475569'];
const COLOR_NAMES = {
  '#3d4fe3': 'Indigo', '#0d9488': 'Teal', '#7c3aed': 'Violet', '#059669': 'Emerald',
  '#d97706': 'Amber', '#e11d48': 'Rose', '#b45309': 'Orange', '#2563eb': 'Blue',
  '#db2777': 'Pink', '#0891b2': 'Cyan', '#475569': 'Slate'
};
const SUBJECT_ICON_KEYS = ['sigma', 'atom', 'flask', 'dna', 'globe', 'devanagari', 'book', 'bulb', 'chart', 'users', 'shield', 'spark'];
const ICON_LABELS = {
  sigma: 'Sigma', atom: 'Atom', flask: 'Flask', dna: 'DNA', globe: 'Globe',
  devanagari: 'Devanagari', book: 'Book', bulb: 'Idea', chart: 'Chart',
  users: 'People', shield: 'Shield', spark: 'Spark'
};

function subjectSlugify(str) {
  return String(str || '').toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Colour picker markup: clickable swatches + selected summary. */
function colorPickerMarkup(selected) {
  const cur = SUBJECT_COLORS.includes(selected) ? selected : SUBJECT_COLORS[0];
  const swatches = SUBJECT_COLORS.map((c) => {
    const on = c === cur ? ' selected' : '';
    return `<button type="button" class="swatch${on ? ' selected' : ''}" data-value="${c}" style="--sw:${c}" title="${esc(COLOR_NAMES[c] || c)}" aria-label="${esc(COLOR_NAMES[c] || c)} (${c})" aria-pressed="${on ? 'true' : 'false'}">${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>' : ''}</button>`;
  }).join('');
  const name = COLOR_NAMES[cur] || cur;
  return `
    <div class="colour-picker" data-role="colour-picker">
      <input type="hidden" name="color" value="${cur}">
      <div class="swatches" role="radiogroup" aria-label="Subject colour">${swatches}</div>
      <div class="picker-hint" data-role="colour-summary">Selected: <span class="cname">${esc(name)}</span> <span class="chex">· ${cur.toUpperCase()}</span></div>
    </div>`;
}

/** Icon picker markup: real DoubtIQ SVG icons as selectable buttons. */
function iconPickerMarkup(selected) {
  const cur = SUBJECT_ICON_KEYS.includes(selected) ? selected : SUBJECT_ICON_KEYS[0];
  const btns = SUBJECT_ICON_KEYS.map((k) => {
    const on = k === cur ? ' selected' : '';
    const label = ICON_LABELS[k] || k;
    return `<button type="button" class="icon-choice${on}" data-value="${k}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${on ? 'true' : 'false'}">${subjectIcon(k)}</button>`;
  }).join('');
  return `
    <div class="icon-picker" data-role="icon-picker">
      <input type="hidden" name="icon" value="${cur}">
      <div class="icon-choices" role="radiogroup" aria-label="Subject icon">${btns}</div>
      <div class="picker-hint" data-role="icon-summary">Selected: <span class="iname">${esc(ICON_LABELS[cur] || cur)}</span></div>
    </div>`;
}

function bindPickers(modal) {
  // Colour
  const cp = modal.querySelector('[data-role="colour-picker"]');
  if (cp) {
    const hidden = cp.querySelector('input[name="color"]');
    const summary = cp.querySelector('[data-role="colour-summary"]');
    cp.querySelector('.swatches').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      cp.querySelectorAll('.swatch').forEach((b) => {
        const on = b === sw;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>';
        else b.innerHTML = '';
      });
      const val = sw.dataset.value;
      hidden.value = val;
      summary.querySelector('.cname').textContent = COLOR_NAMES[val] || val;
      summary.querySelector('.chex').textContent = '· ' + val.toUpperCase();
    });
  }
  // Icon
  const ip = modal.querySelector('[data-role="icon-picker"]');
  if (ip) {
    const hidden = ip.querySelector('input[name="icon"]');
    const summary = ip.querySelector('[data-role="icon-summary"]');
    ip.querySelector('.icon-choices').addEventListener('click', (e) => {
      const btn = e.target.closest('.icon-choice');
      if (!btn) return;
      ip.querySelectorAll('.icon-choice').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const val = btn.dataset.value;
      hidden.value = val;
      summary.querySelector('.iname').textContent = ICON_LABELS[val] || val;
    });
  }
}

const AdminSubjects = {
  async render() {
    const data = await API.get('/api/admin/subjects');
    const subjects = data.subjects || [];

    const cards = subjects.map((s) => {
      const deletable = s.question_count === 0;
      return `
      <div class="card subject-card" style="--sc:${esc(s.color)}">
        <div class="top">
          <span class="subject-icon">${subjectIcon(s.icon)}</span>
          <div style="min-width:0;flex:1">
            <h3>${esc(s.name)}</h3>
            <div class="tagline">${esc(s.tagline)}</div>
          </div>
          <div class="top-actions">
            <button class="mini-btn" data-edit="${s.id}" title="Edit subject" aria-label="Edit ${esc(s.name)}">${I.pencil}</button>
            <button class="mini-btn red" data-del="${s.id}" ${deletable ? '' : 'disabled'} title="${deletable ? 'Delete subject' : 'Cannot delete — contains questions'}" aria-label="Delete ${esc(s.name)}">${I.trash}</button>
          </div>
        </div>
        <div class="desc">${esc(s.description)}</div>
        <div class="foot">
          <span class="count">${s.question_count} question${s.question_count === 1 ? '' : 's'} · ${s.answer_count} answer${s.answer_count === 1 ? '' : 's'}</span>
          <span class="slug-chip">/${esc(s.slug)}</span>
        </div>
      </div>`;
    }).join('');

    return `
    <h1 class="page-title">Subjects</h1>
    <div class="admin-subjects-toolbar">
      <p>Six core subjects, plus any you add. New subjects appear instantly on the public site, in question selectors, search filters and statistics.</p>
      <button class="btn btn-primary btn-sm" data-act="new">${I.plus} Add Subject</button>
    </div>
    <div class="subject-grid" data-role="grid">${cards}</div>`;
  },

  mount(el) {
    el.querySelector('[data-act="new"]')?.addEventListener('click', () => AdminSubjects.openEditor(null));
    const grid = el.querySelector('[data-role="grid"]');
    if (!grid) return;

    grid.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return AdminSubjects.openEditor(Number(edit.dataset.edit));

      const del = e.target.closest('[data-del]');
      if (!del || del.disabled) return;
      const id = Number(del.dataset.del);
      const data = await API.get('/api/admin/subjects');
      const s = (data.subjects || []).find((x) => x.id === id);
      if (!s) return;

      if (s.question_count > 0) {
        // Safe warning: never allow deleting a subject that has questions.
        Admin.modal(`
          <div class="modal-head"><h3>Cannot delete subject</h3>${Admin.modalCloseBtn()}</div>
          <p style="font-size:14px;color:var(--ink-2);line-height:1.6">
            “${esc(s.name)}” contains <b>${s.question_count} question${s.question_count === 1 ? '' : 's'}</b>.
            Delete or move those questions first, then try again.
          </p>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-role="cancel">Got it</button>
          </div>`);
        return;
      }

      const ok = await Admin.confirm(`Delete subject “${esc(s.name)}”? This cannot be undone.`);
      if (!ok) return;
      try {
        await API.del(`/api/admin/subjects/${id}`);
        toast('Subject deleted');
        Admin.route(true);
      } catch (err) { toast(err.message, 'error'); }
    });
  },

  /* ------------------------------------------------------- editor modal */
  async openEditor(id) {
    let s = null;
    if (id) {
      const data = await API.get('/api/admin/subjects');
      s = (data.subjects || []).find((x) => x.id === id) || null;
    }

    const modal = Admin.modal(`
      <div class="modal-head"><h3>${s ? `Edit subject — ${esc(s.name)}` : 'Add Subject'}</h3>${Admin.modalCloseBtn()}</div>
      <form data-role="form" novalidate>
        <div class="field">
          <label for="s-name">Subject name *</label>
          <input class="input" id="s-name" name="name" required maxlength="100" placeholder="e.g. Computer Science" value="${s ? esc(s.name) : ''}" data-role="s-name">
        </div>
        <div class="field">
          <label for="s-slug">Slug (URL)</label>
          <input class="input" id="s-slug" name="slug" maxlength="60" placeholder="computer-science" value="${s ? esc(s.slug) : ''}" data-role="s-slug">
          <div class="hint">Auto-filled from the name — lowercase letters, numbers and hyphens only.</div>
        </div>
        <div class="field">
          <label for="s-tagline">Tagline</label>
          <input class="input" id="s-tagline" name="tagline" maxlength="200" placeholder="e.g. Programming · Algorithms · Logic" value="${s ? esc(s.tagline) : ''}">
        </div>
        <div class="field">
          <label for="s-desc">Description</label>
          <textarea class="textarea" id="s-desc" name="description" placeholder="A short description shown on the subject page…">${s ? esc(s.description) : ''}</textarea>
        </div>
        <div class="field">
          <label>Colour</label>
          ${colorPickerMarkup(s ? s.color : SUBJECT_COLORS[0])}
        </div>
        <div class="field">
          <label>Icon</label>
          ${iconPickerMarkup(s ? s.icon : SUBJECT_ICON_KEYS[0])}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-role="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${s ? 'Save subject' : 'Add Subject'}</button>
        </div>
      </form>`, { wide: true });

    bindPickers(modal);

    // Auto-slug from the name until the user edits the slug themselves.
    const nameInput = modal.querySelector('[data-role="s-name"]');
    const slugInput = modal.querySelector('[data-role="s-slug"]');
    let slugTouched = false;
    if (!s) {
      slugInput.addEventListener('input', () => { slugTouched = true; });
      nameInput.addEventListener('input', () => {
        if (!slugTouched) slugInput.value = subjectSlugify(nameInput.value);
      });
    }

    const form = modal.querySelector('[data-role="form"]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      if (btn.disabled) return; // prevent double-submit
      const body = {
        name: fval(form, 'name').trim(),
        slug: fval(form, 'slug').trim() || subjectSlugify(fval(form, 'name')),
        tagline: fval(form, 'tagline').trim(),
        description: fval(form, 'description').trim(),
        color: fval(form, 'color') || SUBJECT_COLORS[0],
        icon: fval(form, 'icon') || SUBJECT_ICON_KEYS[0]
      };
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        if (s) { await API.put(`/api/admin/subjects/${s.id}`, body); toast('Subject updated'); }
        else { await API.post('/api/admin/subjects', body); toast('Subject added'); }
        Admin.closeModal(modal);
        Admin.route(true);
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = s ? 'Save subject' : 'Add Subject'; }
    });
  }
};
