/* DoubtIQ Admin — Settings */
'use strict';

const AdminSettings = {
  async render() {
    const data = await API.get('/api/admin/settings');
    const s = data.settings || {};
    return `
    <h1 class="page-title">Settings</h1>
    <p class="page-sub">Site identity and your admin credentials.</p>

    <div class="two-col">
      <div class="panel">
        <div class="panel-head"><h2>Site identity</h2></div>
        <div class="panel-body">
          <form data-role="site-form">
            <div class="field">
              <label>Site name</label>
              <input class="input" name="site_name" value="${esc(s.site_name || 'DoubtIQ')}">
            </div>
            <div class="field">
              <label>Tagline</label>
              <input class="input" name="site_tagline" value="${esc(s.site_tagline || '')}">
              <div class="hint">Used across the student site.</div>
            </div>
            <div class="modal-actions">
              <button type="submit" class="btn btn-primary">Save settings</button>
            </div>
          </form>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Admin password</h2></div>
        <div class="panel-body">
          <form data-role="pwd-form">
            <div class="field">
              <label>Current password</label>
              <input class="input" type="password" name="current" autocomplete="current-password" required>
            </div>
            <div class="field">
              <label>New password</label>
              <input class="input" type="password" name="next" autocomplete="new-password" minlength="8" required>
              <div class="hint">At least 8 characters.</div>
            </div>
            <div class="modal-actions">
              <button type="submit" class="btn btn-primary">Change password</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="readonly-note">
      ${I.shield}
      <span><strong>Guard rails.</strong> Students are strictly view-only: there is no “Ask a question” or “Write an answer” anywhere on the student site. Only signed-in admins can create or change content.</span>
    </div>`;
  },

  mount(el) {
    el.querySelector('[data-role="site-form"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await API.put('/api/admin/settings', { settings: { site_name: fval(form, 'site_name'), site_tagline: fval(form, 'site_tagline') } });
        toast('Settings saved');
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
    });

    el.querySelector('[data-role="pwd-form"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await API.put('/api/admin/me/password', { current: fval(form, 'current'), next: fval(form, 'next') });
        toast('Password changed');
        form.reset();
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
    });
  }
};
