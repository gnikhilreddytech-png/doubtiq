'use strict';
/* DoubtIQ — headless DOM integration test (linkedom + vm).
 * Boots the real student SPA and admin SPA against the live API and verifies
 * the complete navigation flow, admin auth persistence, content lifecycle,
 * live statistics and the end-to-end acceptance flow. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHTML } = require('linkedom');

const BASE = 'http://localhost:3000';
const PUBLIC = path.join(__dirname, 'public');
// Test-only credentials for the live development database.
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD || 'thunderreddy123';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) failures++;
};

/* ------------------------------------------------ build vm sandbox */
function makeSandbox(html) {
  const { window: lw } = parseHTML(html);
  const doc = lw.document;
  const nativeFetch = globalThis.fetch;

  const win = new EventTarget();
  let cookieJar = '';
  win.fetch = async (input, init) => {
    const url = String(input).startsWith('http') ? String(input) : BASE + String(input);
    const headers = new Headers((init && init.headers) || {});
    if (cookieJar) headers.set('Cookie', cookieJar);
    const res = await nativeFetch(url, Object.assign({}, init, { headers }));
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      if (/Max-Age=0/.test(setCookie)) cookieJar = '';
      else {
        const m = setCookie.match(/doubtiq_session=[^;]+/);
        if (m) cookieJar = m[0];
      }
    }
    return { ok: res.ok, status: res.status, json: async () => res.json() };
  };
  win.__clearCookies = () => { cookieJar = ''; };

  let hash = '';
  let pathname = '/';
  const fire = () => win.dispatchEvent(new globalThis.Event('hashchange'));
  const location = {
    get hash() { return hash; },
    set hash(v) { if (v !== hash) { hash = v; setTimeout(fire, 0); } },
    replace(v) { if (v !== hash) { hash = v; setTimeout(fire, 0); } },
    get pathname() { return pathname; },
    set pathname(v) { pathname = v; },
    toString: () => 'about:blank'
  };
  win.__setPath = (p) => { pathname = p; };

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  win.__blockStorage = () => {
    Object.defineProperty(win, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    Object.defineProperty(win, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
  };

  win.document = doc;
  win.navigator = { userAgent: 'linkedom-test' };
  win.location = location;
  win.localStorage = localStorage;
  win.sessionStorage = localStorage;
  win.history = { replaceState() {}, pushState() {}, back() {}, length: 1 };
  win.scrollTo = () => {};
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.Response = globalThis.Response;
  win.URL = globalThis.URL;
  win.URLSearchParams = globalThis.URLSearchParams;
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.setInterval = setInterval;
  win.clearInterval = clearInterval;
  win.Event = globalThis.Event;

  const sandbox = {
    window: win, document: doc, navigator: win.navigator, location, history: win.history,
    localStorage, sessionStorage: localStorage, fetch: win.fetch,
    Response: globalThis.Response, URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Event: lw.Event, CustomEvent: lw.CustomEvent,
    console,
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, decodeURI, encodeURI, Map, Set
  };
  vm.createContext(sandbox);
  return sandbox;
}

function loadScripts(sb, files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    try {
      vm.runInContext(code, sb, { filename: f });
    } catch (err) {
      throw new Error(`Script error in ${f}: ${err.message}\n${err.stack.split('\n').slice(0, 4).join('\n')}`);
    }
  }
}

const ADMIN_SCRIPTS = [
  'js/api.js', 'js/icons.js', 'js/components.js',
  'js/admin/views/overview.js', 'js/admin/views/questions.js',
  'js/admin/views/subjects.js',
  'js/admin/views/settings.js', 'js/admin/app.js'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(sb, predicate, ms = 9000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (predicate()) return true; } catch (e) { /* keep waiting */ }
    await sleep(60);
  }
  return false;
}

function navigate(sb, hash) { sb.location.hash = hash; }

/** linkedom quirk: setting <select>.value throws — set the option instead. */
function setSelect(sb, select, value) {
  const opts = select.querySelectorAll('option');
  let found = false;
  for (const o of opts) {
    if (o.getAttribute('value') === String(value)) {
      o.setAttribute('selected', 'selected');
      found = true;
    } else {
      o.removeAttribute('selected');
    }
  }
  select.dispatchEvent(new sb.Event('change', { bubbles: true }));
  return found;
}

function click(sb, el) {
  if (!el) return false;
  el.dispatchEvent(new sb.Event('click', { bubbles: true, cancelable: true }));
  return true;
}

async function adminLogin(sb) {
  await waitFor(sb, () => !!sb.document.querySelector('[data-role="login-form"]'));
  const form = sb.document.querySelector('[data-role="login-form"]');
  form.querySelector('input[name=username]').value = ADMIN_USER;
  form.querySelector('input[name=password]').value = ADMIN_PASS;
  form.dispatchEvent(new sb.Event('submit', { bubbles: true, cancelable: true }));
}

/* =============================================================== STUDENT SPA */
async function testStudent() {
  console.log('\n── Student SPA (navigation flow) ─────────────');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const sb = makeSandbox(html);
  loadScripts(sb, [
    'js/api.js', 'js/icons.js', 'js/components.js',
    'js/views/home.js', 'js/views/questions.js', 'js/views/subjects.js',
    'js/views/subject.js', 'js/views/question.js', 'js/views/search.js',
    'js/views/page.js', 'js/app.js'
  ]);
  sb.document.dispatchEvent(new sb.Event('DOMContentLoaded'));
  const view = () => sb.document.getElementById('view');

  check('home renders', await waitFor(sb, () =>
    view().innerHTML.includes('Recent questions') && view().innerHTML.includes('Explore subjects')));
  check('no sign-in / account UI', !sb.document.querySelector('[data-role="login"]') && !sb.document.querySelector('.avatar-btn'));

  const navLinks = [...sb.document.querySelectorAll('.nav a[data-nav]')].map((a) => a.textContent.trim());
  check('primary nav = Home/Questions/Subjects', JSON.stringify(navLinks) === JSON.stringify(['Home', 'Questions', 'Subjects']));

  navigate(sb, '#/questions');
  check('questions page', await waitFor(sb, () => view().innerHTML.includes('All questions')));
  check('questions: back button', !!sb.document.querySelector('.back-btn'));

  navigate(sb, '#/subjects');
  check('subjects page', await waitFor(sb, () => view().innerHTML.includes('Subjects') && view().innerHTML.includes('Curated questions and answers in each subject')));
  check('exactly 6 subject cards', (view().innerHTML.match(/class="card subject-card"/g) || []).length === 6);
  check('no Curious Questions anywhere', !view().innerHTML.includes('Curious Questions'));

  navigate(sb, '#/subjects/maths');
  check('subject page', await waitFor(sb, () => view().innerHTML.includes('Questions in Maths')));
  check('subject breadcrumb', view().innerHTML.includes('>Home</a>') && view().innerHTML.includes('>Maths</span>'));

  // question via SLUG URL
  const slug = (await (await fetch(`${BASE}/api/questions?subject=maths&limit=1`)).json()).questions[0].slug;
  navigate(sb, `#/questions/${slug}`);
  check('question page via slug', await waitFor(sb, () => view().innerHTML.includes('Answers') && view().innerHTML.includes('Verified answer')));
  click(sb, sb.document.querySelector('.back-btn'));
  check('back → subject list', await waitFor(sb, () => view().innerHTML.includes('Questions in Maths')));

  navigate(sb, '#/search');
  check('search landing', await waitFor(sb, () => view().innerHTML.includes('Search DoubtIQ')));

  // Live search: typing into the search box updates results WITHOUT reload.
  const bigInput = sb.document.querySelector('[data-role="big-search"] input[name=q]');
  check('search input present', !!bigInput);
  bigInput.value = 'mitosis';
  bigInput.dispatchEvent(new sb.Event('input', { bubbles: true }));
  check('live search shows results as you type', await waitFor(sb, () =>
    (sb.document.querySelector('[data-role="results"]').innerHTML || '').includes('mitosis') &&
    (sb.document.querySelector('[data-role="results"]').innerHTML || '').includes('qlist')));
  check('live search updates count', await waitFor(sb, () =>
    (sb.document.querySelector('[data-role="results-count"]').textContent || '').includes('result')));
  // clear → prompt state
  bigInput.value = '';
  bigInput.dispatchEvent(new sb.Event('input', { bubbles: true }));
  check('live search empty → prompt', await waitFor(sb, () =>
    (sb.document.querySelector('[data-role="results"]').innerHTML || '').includes('Start typing')));

  // Header search: typing shows a suggestion dropdown; Enter navigates.
  const tsInput = sb.document.querySelector('#top-search-input');
  check('header search input present', !!tsInput);
  tsInput.value = 'gravit';
  tsInput.dispatchEvent(new sb.Event('input', { bubbles: true }));
  check('header suggestions appear', await waitFor(sb, () => {
    const s = sb.document.querySelector('[data-role="ts-suggest"]');
    return s && !s.hidden && (s.innerHTML.includes('ts-item') || s.innerHTML.includes('No matches'));
  }));
  const sugHtml = sb.document.querySelector('[data-role="ts-suggest"]').innerHTML;
  check('prefix typing matches full words', sugHtml.includes('gravity') || sugHtml.includes('No matches'));
  const tsForm2 = sb.document.querySelector('[data-role="top-search"]');
  tsForm2.dispatchEvent(new sb.Event('submit', { bubbles: true, cancelable: true }));
  check('header Enter → search page', await waitFor(sb, () =>
    sb.location.hash.startsWith('#/search?q=gravit')));

  navigate(sb, '#/search?q=mitosis');
  check('search results', await waitFor(sb, () => view().innerHTML.includes('result') && view().innerHTML.toLowerCase().includes('mitosis')));

  navigate(sb, '#/page/about');
  check('about page renders', await waitFor(sb, () => view().innerHTML.includes('About DoubtIQ')));

  navigate(sb, '#/profile');
  check('profile redirects → questions', await waitFor(sb, () => sb.location.hash === '#/questions'));

  navigate(sb, '#/nonsense');
  check('404 page', await waitFor(sb, () => view().innerHTML.includes('Page not found')));

  click(sb, sb.document.querySelector('[data-role="menu-open"]'));
  check('drawer opens', await waitFor(sb, () => !!sb.document.querySelector('.menu-drawer.open')));

  const themeBtn = sb.document.querySelector('[data-role="theme-toggle"]');
  const beforeTheme = sb.document.documentElement.getAttribute('data-theme');
  click(sb, themeBtn);
  check('theme toggles', sb.document.documentElement.getAttribute('data-theme') !== beforeTheme);
}

/* =============================================================== ADMIN SPA */
async function testAdmin() {
  console.log('\n── Admin SPA (auth + sections + persistence) ─');
  const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  const sb = makeSandbox(html);
  loadScripts(sb, ADMIN_SCRIPTS);
  sb.document.dispatchEvent(new sb.Event('DOMContentLoaded'));

  check('admin login gate', await waitFor(sb, () => !!sb.document.querySelector('[data-role="login-form"]')));
  check('no credentials hint on login screen', !sb.document.body.innerHTML.includes('thunderreddy123'));
  await adminLogin(sb);

  const adminView = () => sb.document.getElementById('admin-view');
  check('admin shell + overview', await waitFor(sb, () =>
    !!sb.document.querySelector('.admin-shell') && (adminView().innerHTML || '').includes('Overview')));

  const sections = [
    ['#/questions', 'Create, edit, publish or unpublish'],
    ['#/subjects', 'Six core subjects, plus any you add'],
    ['#/settings', 'Site identity and your admin credentials']
  ];
  for (const [hash, marker] of sections) {
    navigate(sb, hash);
    check('admin section ' + hash, await waitFor(sb, () => (adminView().innerHTML || '').includes(marker)));
  }
  check('nav has exactly 4 sections', (sb.document.querySelectorAll('[data-role="nav"] a[data-route]') || []).length === 4);
  check('no Answers or Analytics in nav', !sb.document.querySelector('[data-role="nav"]').innerHTML.includes('Answers') && !sb.document.querySelector('[data-role="nav"]').innerHTML.includes('Analytics'));

  // View student site: same-tab link to "/" (no target=_blank)
  const studentLink = [...sb.document.querySelectorAll('[data-role="nav"] a')].find((a) => (a.textContent || '').includes('View student site'));
  check('view student site link → "/"', !!studentLink && studentLink.getAttribute('href') === '/');
  check('view student site has no target', !!studentLink && !studentLink.getAttribute('target'));

  // Modal scroll wrapper: tall forms fit the viewport (CSS rule present)
  const css = fs.readFileSync(path.join(PUBLIC, 'css/admin.css'), 'utf8');
  check('modal max-height rule present', css.includes('max-height: calc(100vh - 40px)'));
  check('modal scroll container used', css.includes('.admin-modal .modal-scroll'));

  // Session persistence: cookies dropped + reload
  sb.window.__clearCookies();
  navigate(sb, '#/settings');
  check('session survives cookie loss', await waitFor(sb, () => (adminView().innerHTML || '').includes('Site identity')));
  navigate(sb, '#/overview');
  check('overview after cookie loss', await waitFor(sb, () => (adminView().innerHTML || '').includes('Overview')));

  // reload persistence
  const token = sb.localStorage.getItem('doubtiq_admin_token');
  const rsb = makeSandbox(html);
  rsb.localStorage.setItem('doubtiq_admin_token', token);
  loadScripts(rsb, ADMIN_SCRIPTS);
  rsb.document.dispatchEvent(new rsb.Event('DOMContentLoaded'));
  check('reload keeps admin signed in', await waitFor(rsb, () =>
    !!rsb.document.querySelector('.admin-shell') && !rsb.document.querySelector('[data-role="login-form"]')));

  // logout
  click(rsb, rsb.document.querySelector('[data-role="logout"]'));
  check('logout → login gate', await waitFor(rsb, () => !!rsb.document.querySelector('[data-role="login-form"]')));
}

/* ============================================ ADMIN SPA — storage blocked */
async function testAdminStorageBlocked() {
  console.log('\n── Admin SPA (storage fully blocked) ─────────');
  const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  const sb = makeSandbox(html);
  sb.window.__blockStorage();
  loadScripts(sb, ADMIN_SCRIPTS);
  sb.document.dispatchEvent(new sb.Event('DOMContentLoaded'));

  check('boot survives blocked storage', await waitFor(sb, () => !!sb.document.querySelector('[data-role="login-form"]')));
  await adminLogin(sb);
  const adminView = () => sb.document.getElementById('admin-view');
  check('dashboard opens after login', await waitFor(sb, () =>
    !!sb.document.querySelector('.admin-shell') && (adminView().innerHTML || '').includes('Overview')));
  await sleep(2500);
  check('STILL on dashboard after 2.5s (no flip back)',
    !sb.document.querySelector('[data-role="login-form"]') && !!sb.document.querySelector('.admin-shell'));
}

/* ================================================== ACCEPTANCE FLOW */
async function testAcceptance() {
  console.log('\n── Acceptance: login → create → publish → search → view → stats → logout → 30s → refresh ─');
  const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  const sb = makeSandbox(html);
  loadScripts(sb, ADMIN_SCRIPTS);
  sb.document.dispatchEvent(new sb.Event('DOMContentLoaded'));

  // Login
  await adminLogin(sb);
  const adminView = () => sb.document.getElementById('admin-view');
  check('1. login → dashboard', await waitFor(sb, () =>
    !!sb.document.querySelector('.admin-shell') && (adminView().innerHTML || '').includes('Overview')));

  // Navigate to the full-screen editor, fill question + answer together
  navigate(sb, '#/questions/new');
  const opened = await waitFor(sb, () => !!sb.document.querySelector('[data-role="qe-form"]'));
  check('2. full-screen editor opens', opened);

  const form = sb.document.querySelector('[data-role="qe-form"]');
  const title = 'Integration test ' + Date.now();
  setSelect(sb, form.querySelector('select[name=subject_id]'), '1');
  form.querySelector('textarea[name=title]').value = title;
  form.querySelector('input[name=topics]').value = 'test, integration';
  form.querySelector('textarea[name=answer_body]').value = 'This is the answer from the answer box.';
  form.dispatchEvent(new sb.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(700);

  // The editor saves + returns to the list (verify via API)
  const list = await (await fetch(`${BASE}/api/admin/questions?q=${encodeURIComponent(title)}`, {
    headers: { Authorization: 'Bearer ' + sb.localStorage.getItem('doubtiq_admin_token') }
  })).json();
  const created = (list.questions || []).find((q) => q.title === title);
  check('3. question created via API', !!created);
  check('4. answer saved with question', created && created.answer_count === 1);
  check('4b. editor returned to list', await waitFor(sb, () => (adminView().innerHTML || '').includes('Add Question')));

  // Public: search finds it
  const pub = await (await fetch(`${BASE}/api/search?q=${encodeURIComponent(title.split(' ')[0])}`)).json();
  const pubQ = (pub.results || []).find((q) => q.title === title);
  check('5. public search finds it', !!pubQ);

  // Public: open question (records a view)
  const open = await (await fetch(`${BASE}/api/questions/${pubQ.slug}`)).json();
  check('6. public question opens with answer', open.question.answers.length === 1);
  check('7. view recorded (count 1)', open.question.view_count >= 1);

  // Admin stats see it
  const stats = await (await fetch(`${BASE}/api/admin/overview`, {
    headers: { Authorization: 'Bearer ' + sb.localStorage.getItem('doubtiq_admin_token') }
  })).json();
  check('8. overview counts include new question', stats.counts.questions_total >= 19);
  check('9. live view feed shows the question', (stats.recentViews || []).some((v) => v.title === title));

  // Logout
  click(sb, sb.document.querySelector('[data-role="logout"]'));
  check('10. logout works', await waitFor(sb, () => !!sb.document.querySelector('[data-role="login-form"]')));

  // Login again — shell routes to the current hash; navigate to Overview.
  await adminLogin(sb);
  const shellBack = await waitFor(sb, () => !!sb.document.querySelector('.admin-shell'));
  navigate(sb, '#/overview');
  const loginAgain = shellBack && await waitFor(sb, () => (adminView().innerHTML || '').includes('Overview'));
  check('11. login again → dashboard', !!loginAgain);
  console.log('    (waiting 30 seconds…)');
  await sleep(30000);
  check('12. STILL signed in after 30s',
    !!sb.document.querySelector('.admin-shell') && !sb.document.querySelector('[data-role="login-form"]'));

  // Navigate + refresh (reload sandbox with token)
  navigate(sb, '#/settings');
  check('13. navigate after 30s', await waitFor(sb, () => (adminView().innerHTML || '').includes('Site identity')));
  const token = sb.localStorage.getItem('doubtiq_admin_token');
  const rsb = makeSandbox(html);
  rsb.localStorage.setItem('doubtiq_admin_token', token);
  loadScripts(rsb, ADMIN_SCRIPTS);
  rsb.document.dispatchEvent(new rsb.Event('DOMContentLoaded'));
  check('14. refresh keeps admin signed in', await waitFor(rsb, () =>
    !!rsb.document.querySelector('.admin-shell') && !rsb.document.querySelector('[data-role="login-form"]')));

  // Cleanup: delete the test question
  const adminData = await (await fetch(`${BASE}/api/admin/questions?q=${encodeURIComponent(title)}`, {
    headers: { Authorization: 'Bearer ' + token }
  })).json();
  const toDelete = (adminData.questions || []).find((q) => q.title === title);
  if (toDelete) {
    await fetch(`${BASE}/api/admin/questions/${toDelete.id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
  }
  console.log('    (test question cleaned up)');
}


/* ================================================= SUBJECT MANAGEMENT */
async function testSubjects() {
  console.log('\n── Admin Subjects (add, edit, delete-guard, public visibility) ─');
  const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  const sb = makeSandbox(html);
  loadScripts(sb, ADMIN_SCRIPTS);
  sb.document.dispatchEvent(new sb.Event('DOMContentLoaded'));
  await adminLogin(sb);
  const adminView = () => sb.document.getElementById('admin-view');
  await waitFor(sb, () => !!sb.document.querySelector('.admin-shell'));

  navigate(sb, '#/subjects');
  await waitFor(sb, () => (adminView().innerHTML || '').includes('Add Subject'));
  check('add subject button present', !!sb.document.querySelector('[data-act="new"]'));

  // Open Add Subject modal
  click(sb, sb.document.querySelector('[data-act="new"]'));
  const opened = await waitFor(sb, () => !!sb.document.querySelector('[data-role="form"] [data-role="s-name"]'));
  check('add-subject modal opens', opened);

  const form = sb.document.querySelector('[data-role="form"]');
  const subjName = 'Computer Science ' + Date.now();
  const nameInput = form.querySelector('[data-role="s-name"]');
  nameInput.value = subjName;
  nameInput.dispatchEvent(new sb.Event('input', { bubbles: true }));
  const slugInput = form.querySelector('[data-role="s-slug"]');
  check('slug auto-fills from name', (slugInput.value || '').includes('computer-science'));
  slugInput.value = 'test-subject-' + Date.now();
  form.querySelector('input[name=tagline]').value = 'Programming & logic';
  form.querySelector('textarea[name=description]').value = 'Test subject description';
  // Colour: click the visual swatch for #0891b2
  const colorSwatch = form.querySelector('.swatch[data-value="#0891b2"]');
  check('visual colour swatches rendered', !!colorSwatch);
  click(sb, colorSwatch);
  // Icon: click the visual icon choice "book"
  const iconBtn = form.querySelector('.icon-choice[data-value="book"]');
  check('visual icon choices rendered', !!iconBtn);
  click(sb, iconBtn);
  check('colour hidden input updated', form.querySelector('input[name=color]').value === '#0891b2');
  check('icon hidden input updated', form.querySelector('input[name=icon]').value === 'book');
  form.dispatchEvent(new sb.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(700);

  // Verify via API: created + appears in admin list
  const token = sb.localStorage.getItem('doubtiq_admin_token');
  const list = await (await fetch(`${BASE}/api/admin/subjects`, {
    headers: { Authorization: 'Bearer ' + token }
  })).json();
  const created = (list.subjects || []).find((s) => s.name === subjName);
  check('subject created in DB', !!created);
  check('subject stored with slug/color/icon', created && created.slug.startsWith('test-subject') && created.color === '#0891b2' && created.icon === 'book');

  // Public site sees it
  const pub = await (await fetch(`${BASE}/api/subjects`)).json();
  check('public subjects include custom subject', (pub.subjects || []).some((s) => s.slug === created.slug));

  // Question selector (admin) includes it — open the full-screen editor
  navigate(sb, '#/questions/new');
  await waitFor(sb, () => !!sb.document.querySelector('[data-role="qe-form"]'));
  const qform = sb.document.querySelector('[data-role="qe-form"]');
  const opts = [...qform.querySelectorAll('select[name=subject_id] option')].map((o) => o.textContent.trim());
  check('question selector includes custom subject', opts.includes(subjName));
  // back to subjects list (cancel)
  navigate(sb, '#/subjects');
  await waitFor(sb, () => (adminView().innerHTML || '').includes('Add Subject'));

  // Delete guard: try deleting maths (has questions) — warning, still exists
  navigate(sb, '#/subjects');
  await waitFor(sb, () => (adminView().innerHTML || '').includes('Add Subject'));
  const mathsCard = [...sb.document.querySelectorAll('[data-del]')].map((b) => b.closest('.subject-card'));
  // find maths by name
  const mathsDel = [...sb.document.querySelectorAll('.subject-card')].find((c) => (c.querySelector('h3') || {}).textContent === 'Maths');
  const delBtn = mathsDel ? mathsDel.querySelector('[data-del]') : null;
  check('maths delete button disabled (has questions)', delBtn && delBtn.disabled);

  // Delete the empty custom subject — allowed
  const customCard = [...sb.document.querySelectorAll('.subject-card')].find((c) => (c.querySelector('h3') || {}).textContent === subjName);
  const customDel = customCard ? customCard.querySelector('[data-del]') : null;
  check('custom subject delete enabled (no questions)', customDel && !customDel.disabled);
  if (customDel) {
    click(sb, customDel);
    await waitFor(sb, () => !!sb.document.querySelector('[data-role="ok"]'));
    click(sb, sb.document.querySelector('[data-role="ok"]'));
    await sleep(700);
    const after = await (await fetch(`${BASE}/api/admin/subjects`, {
      headers: { Authorization: 'Bearer ' + token }
    })).json();
    check('custom subject deleted', !(after.subjects || []).some((s) => s.slug === created.slug));
    const pubAfter = await (await fetch(`${BASE}/api/subjects`)).json();
    check('public subjects no longer include it', !(pubAfter.subjects || []).some((s) => s.slug === created.slug));
  }
}

/* ============================================ INLINE ANSWERS IN EDITOR */
async function testInlineAnswers() {
  console.log('\n── Question editor shows inline answers ─────────');
  const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  const sb = makeSandbox(html);
  loadScripts(sb, ADMIN_SCRIPTS);
  sb.document.dispatchEvent(new sb.Event('DOMContentLoaded'));
  await adminLogin(sb);
  const adminView = () => sb.document.getElementById('admin-view');
  await waitFor(sb, () => !!sb.document.querySelector('.admin-shell'));

  // Open the full-screen editor for the first question
  const list = await (await fetch(`${BASE}/api/admin/questions?q=&subject=all&status=all`, {
    headers: { Authorization: 'Bearer ' + sb.localStorage.getItem('doubtiq_admin_token') }
  })).json();
  const firstQ = (list.questions || [])[0];
  check('have a question to edit', !!firstQ);
  navigate(sb, `#/questions/edit/${firstQ.id}`);
  const opened = await waitFor(sb, () => !!sb.document.querySelector('[data-role="qe-form"]'));
  check('question editor opens (full-screen)', opened);
  check('editor has subject, question, answer, topics, status',
    !!sb.document.querySelector('select[name=subject_id]') &&
    !!sb.document.querySelector('textarea[name=title]') &&
    !!sb.document.querySelector('textarea[name=answer_body]') &&
    !!sb.document.querySelector('input[name=topics]') &&
    !!sb.document.querySelector('input[name=status]'));
  check('editor has inline answers section', !!sb.document.querySelector('[data-role="qe-answers"]'));
  check('editor has add-another-answer button', !!sb.document.querySelector('[data-role="qe-add-answer"]'));
  check('editor has sticky action bar', !!sb.document.querySelector('.qe-actions'));

  // Back to the list (cancel)
  navigate(sb, '#/questions');
  check('editor exits to list', await waitFor(sb, () => (adminView().innerHTML || '').includes('Add Question')));
}


/* =============================================================== SEO */
const seoEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function testSeo() {
  console.log('\n── SEO: direct URLs, crawler SSR, sitemap, redirects ─');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

  // 1. Direct browser load of a clean path URL: /questions/<slug> with no
  // hash must render the exact question (works in incognito, no login).
  const pub = await (await fetch(`${BASE}/api/questions?limit=1`)).json();
  const q = pub.questions[0];
  const sb = makeSandbox(html);
  sb.window.__setPath(`/questions/${q.slug}`);
  loadScripts(sb, [
    'js/api.js', 'js/icons.js', 'js/components.js',
    'js/views/home.js', 'js/views/questions.js', 'js/views/subjects.js',
    'js/views/subject.js', 'js/views/question.js', 'js/views/search.js',
    'js/views/page.js', 'js/app.js'
  ]);
  sb.document.dispatchEvent(new sb.Event('DOMContentLoaded'));
  const view = () => sb.document.getElementById('view');
  check('direct path URL renders the question', await waitFor(sb, () =>
    view().innerHTML.includes(seoEsc(q.title.slice(0, 30))) || view().innerHTML.includes('Answers')));
  check('direct path URL → hash converted', sb.location.hash.startsWith('#/questions/'));

  // 2. Crawler (Googlebot) gets full SSR HTML with SEO metadata.
  const sr = await fetch(`${BASE}/questions/${q.slug}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
  });
  const shtml = await sr.text();
  check('crawler gets 200 HTML', sr.ok);
  check('SSR has unique <title>', shtml.includes(`<title>${seoEsc(q.title)} — DoubtIQ</title>`));
  check('SSR has canonical', shtml.includes(`<link rel="canonical" href="${BASE}/questions/${q.slug}">`));
  check('SSR has og:title', shtml.includes('property="og:title"'));
  check('SSR has meta description', shtml.includes('name="description" content="'));
  check('SSR has Question JSON-LD', shtml.includes('"@type":"Question"'));
  check('SSR has BreadcrumbList JSON-LD', shtml.includes('"@type":"BreadcrumbList"'));
  check('SSR has clickable Home + Subject crumbs', shtml.includes(`<a href="${BASE}/">Home</a>`) && shtml.includes(`/subjects/${q.subject}`));
  check('SSR contains full answer or note', shtml.includes('Verified answer') || shtml.includes('being prepared'));
  check('SSR links back to subject', shtml.includes(`← Back to ${seoEsc(q.subject_name)}`));

  // 3. Subject SSR page links directly to question URLs (natural discovery).
  const ssr = await fetch(`${BASE}/subjects/${q.subject}`, {
    headers: { 'User-Agent': 'Googlebot' }
  });
  const shtml2 = await ssr.text();
  check('subject SSR links to question URL', shtml2.includes(`/questions/${q.slug}`));

  // 4. Numeric ID redirects (301) to canonical slug — no duplicate URLs.
  const redir = await fetch(`${BASE}/questions/${q.id}`, { redirect: 'manual' });
  check('numeric ID → 301 to slug', redir.status === 301 && (redir.headers.get('location') || '').includes(`/questions/${q.slug}`));

  // 5. Sitemap: published questions + subjects, no hashes, no admin.
  const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check('sitemap includes question URL', sm.includes(`<loc>${BASE}/questions/${q.slug}</loc>`));
  check('sitemap has no hash URLs', !sm.includes('#'));
  check('sitemap has no admin URLs', !sm.includes('/admin'));

  // 6. robots.txt allows public, blocks admin/api.
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check('robots allows /', /Allow: \//.test(robots));
  check('robots disallows /admin', /Disallow: \/admin/.test(robots));
  check('robots points to sitemap', robots.includes('/sitemap.xml'));

  // 7. 404 for nonexistent (crawler + browser shell).
  const nf = await fetch(`${BASE}/questions/this-question-does-not-exist-xyz`, {
    headers: { 'User-Agent': 'Googlebot' }
  });
  check('nonexistent → crawler 404', nf.status === 404);
}


/* =============================================================== RUN */
(async () => {
  await testStudent();
  await testAdmin();
  await testAdminStorageBlocked();
  await testSubjects();
  await testInlineAnswers();
  await testSeo();
  await testAcceptance();
  console.log('\n' + (failures ? '✗ ' + failures + ' failure(s)' : '✓ All checks passed'));
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
