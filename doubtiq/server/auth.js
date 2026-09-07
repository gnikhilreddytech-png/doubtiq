'use strict';

/**
 * DoubtIQ — session auth helpers (PostgreSQL).
 * Sessions are random tokens stored in the sessions table (survive restarts).
 * The client may present the token in one of three ways, so login stays
 * persistent even when cookies are dropped (proxies, embedded previews):
 *   1. `Authorization: Bearer <token>` header   (primary — localStorage)
 *   2. `X-DoubtIQ-Token: <token>` header        (fallback)
 *   3. `doubtiq_session=<token>` httpOnly cookie (secondary channel)
 */

const crypto = require('crypto');
const { run, qOne } = require('../data/db');

const COOKIE_NAME = 'doubtiq_session';
const SESSION_DAYS = 30;

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await run(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expires]
  );
  return token;
}

async function destroySession(token) {
  if (token) await run('DELETE FROM sessions WHERE token = $1', [token]);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

/** Pull the session token from header or cookie, whichever is present. */
function getTokenFromRequest(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const custom = req.headers['x-doubtiq-token'];
  if (custom && typeof custom === 'string' && custom.trim()) return custom.trim();
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

async function getSessionUser(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const row = await qOne(`
    SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at, u.last_active_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > NOW()
  `, [token]);
  if (!row) return null;
  req.sessionToken = token;
  return row;
}

/** Blocks non-admin requests. Async middleware — never leaves a dangling
 * request: every path responds or calls next(). */
async function requireAdmin(req, res, next) {
  try {
    req.user = await getSessionUser(req);
    if (!req.user) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (req.user.status !== 'active') {
      await destroySession(req.sessionToken);
      return res.status(403).json({ error: 'Account disabled' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

function sessionCookie(token, opts = {}) {
  const maxAge = SESSION_DAYS * 86400;
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  requireAdmin,
  getSessionUser,
  createSession,
  destroySession,
  sessionCookie,
  clearCookie,
  parseCookies,
  getTokenFromRequest
};
