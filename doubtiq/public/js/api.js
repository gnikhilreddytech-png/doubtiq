/* DoubtIQ — tiny fetch wrapper. Same-origin only, JSON in/out.
 * Admin sessions: the login token is held IN MEMORY (primary) and mirrored
 * to localStorage + sessionStorage (best-effort). It is sent as an
 * `Authorization: Bearer …` header on every /api/admin request, so the
 * session works even where cookies AND storage are blocked (sandboxed
 * preview iframes, private mode). All storage access is property-safe:
 * in sandboxed iframes even READING `window.localStorage` throws, so every
 * touch goes through try/catch that starts before the property is read.
 */
'use strict';

const ADMIN_TOKEN_KEY = 'doubtiq_admin_token';
const DQ_BUILD = '30';

// In-memory token — the PRIMARY channel. Survives as long as the page is
// open, even if every storage API throws.
let _adminToken = null;

/** Property-safe storage access: returns null if reading throws. */
function storageGet(name) {
  try { return window[name]; } catch (e) { return null; }
}
function safeGet(storage, key) {
  if (!storage) return '';
  try { return storage.getItem(key) || ''; } catch (e) { return ''; }
}
function safeSet(storage, key, value) {
  if (!storage) return;
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch (e) { /* storage unavailable */ }
}

function getAdminToken() {
  if (_adminToken) return _adminToken;
  const stored = safeGet(storageGet('localStorage'), ADMIN_TOKEN_KEY) ||
                 safeGet(storageGet('sessionStorage'), ADMIN_TOKEN_KEY);
  if (stored) _adminToken = stored;
  return _adminToken || '';
}

/** Never throws — the in-memory token is always set first. */
function setAdminToken(token) {
  _adminToken = token || null;
  safeSet(storageGet('localStorage'), ADMIN_TOKEN_KEY, token);
  safeSet(storageGet('sessionStorage'), ADMIN_TOKEN_KEY, token);
}

/** Client build vs server build: force a reload when the browser is running
 * stale cached code (the classic "login loops" cause). The once-guard is a
 * module flag — it works even where sessionStorage is blocked. */
let _buildChecked = false;
async function checkBuildVersion() {
  if (_buildChecked) return;
  _buildChecked = true;
  try {
    const d = await fetch('/api/version');
    const data = await d.json();
    if (data && data.version && String(data.version) !== DQ_BUILD) {
      location.reload(); // fresh HTML loads the matching build; no loop
    }
  } catch (e) { /* server unreachable or version check failed — do nothing */ }
}

const API = {
  async request(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    // Attach the stored admin token to admin API calls.
    if (String(path).startsWith('/api/admin/')) {
      const token = getAdminToken();
      if (token) {
        opts.headers['Authorization'] = 'Bearer ' + token;
        opts.headers['X-DoubtIQ-Token'] = token; // second channel
      }
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new Error('Cannot reach the server. Is it running?');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); }
};
