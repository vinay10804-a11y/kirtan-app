// Accounts, so favourites and playlists follow a person between devices.
//
//   POST /api/signup   { email, name, key }     → { user }   (and a session cookie)
//   POST /api/login    { email, key }           → { user }
//   POST /api/logout                            → {}
//   GET  /api/me                                → { user, library } or { user: null }
//   POST /api/sync     { library }              → { library }  merged with what's saved
//   POST /api/password { key, newKey }          → {}
//   POST /api/delete   { key }                  → {}           removes the account and its data
//
// `key` is never the password: the app turns the password into a key on the
// person's device (PBKDF2-SHA256, 600,000 rounds, salted with the email), so the
// slow part costs this Worker nothing. Here it's stored as SHA-256(salt + key).

import { mergeLibrary } from '../site/library.js';

const SESSION_DAYS = 365;
const LOCK_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
const fail = (status, message) => json({ error: message }, status);

function sessionCookie(token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function newSession(env, userId) {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * 864e5).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function currentUser(request, env) {
  const token = /(?:^|;\s*)sid=([0-9a-f]{64})/.exec(request.headers.get('Cookie') || '')?.[1];
  if (!token) return null;
  return env.DB.prepare(`SELECT u.id, u.email, u.name, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires > ?`).bind(await sha256(token), Date.now()).first();
}

async function passwordMatches(user, key) {
  const got = enc.encode(await sha256(user.salt + key));
  const want = enc.encode(user.pass_hash);
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}

const publicUser = u => ({ email: u.email, name: u.name });

async function readLibrary(env, userId) {
  const row = await env.DB.prepare('SELECT data FROM libraries WHERE user_id = ?').bind(userId).first();
  return row ? JSON.parse(row.data) : { favs: {}, playlists: {} };
}

export async function api(request, env, url) {
  if (!env.DB) return fail(503, 'Accounts aren’t available right now.');
  const route = url.pathname.replace(/^\/api\//, '');

  if (request.method === 'GET' && route === 'me') {
    const user = await currentUser(request, env);
    return json(user ? { user: publicUser(user), library: await readLibrary(env, user.id) } : { user: null });
  }
  if (request.method !== 'POST') return fail(405, 'Not allowed');
  // Only this site's own pages may change an account.
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return fail(403, 'Not allowed');
  let body;
  try { body = await request.json(); } catch { return fail(400, 'Something went wrong. Please try again.'); }
  const email = String(body.email || '').trim().toLowerCase();

  if (route === 'signup') {
    if (!EMAIL.test(email) || email.length > 200) return fail(400, 'Please enter a valid email address.');
    if (!KEY.test(body.key || '')) return fail(400, 'Something went wrong. Please try again.');
    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (exists) return fail(409, 'There’s already an account with this email. Sign in instead.');
    const id = randomHex(12);
    const salt = randomHex(16);
    const name = String(body.name || '').trim().slice(0, 60);
    await env.DB.prepare('INSERT INTO users (id, email, name, pass_hash, salt, created) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, email, name, await sha256(salt + body.key), salt, Date.now()).run();
    return json({ user: { email, name } }, 200, { 'Set-Cookie': await newSession(env, id) });
  }

  if (route === 'login') {
    const now = Date.now();
    const tries = await env.DB.prepare('SELECT failures, first_at FROM login_attempts WHERE email = ?').bind(email).first();
    if (tries && tries.failures >= LOCK_FAILURES && now - tries.first_at < LOCK_MS) {
      return fail(429, 'Too many wrong passwords. Please wait 15 minutes and try again.');
    }
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!user || !KEY.test(body.key || '') || !(await passwordMatches(user, body.key))) {
      const fresh = !tries || now - tries.first_at >= LOCK_MS;
      await env.DB.prepare(`INSERT INTO login_attempts (email, failures, first_at) VALUES (?, 1, ?)
        ON CONFLICT(email) DO UPDATE SET failures = ${fresh ? 1 : 'failures + 1'}, first_at = ${fresh ? '?2' : 'first_at'}`)
        .bind(email, now).run();
      return fail(401, 'That email and password don’t match an account.');
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
    return json({ user: publicUser(user) }, 200, { 'Set-Cookie': await newSession(env, user.id) });
  }

  const me = await currentUser(request, env);
  if (route === 'logout') {
    if (me) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me.token_hash).run();
    return json({}, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (!me) return fail(401, 'Please sign in again.');

  if (route === 'sync') {
    const merged = mergeLibrary(await readLibrary(env, me.id), body.library || {});
    await env.DB.prepare(`INSERT INTO libraries (user_id, data, updated) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated`)
      .bind(me.id, JSON.stringify(merged), Date.now()).run();
    return json({ library: merged });
  }

  // Changing the password or deleting the account needs the current password.
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
  if (!KEY.test(body.key || '') || !(await passwordMatches(user, body.key))) return fail(401, 'That password isn’t right.');

  if (route === 'password') {
    if (!KEY.test(body.newKey || '')) return fail(400, 'Something went wrong. Please try again.');
    const salt = randomHex(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').bind(await sha256(salt + body.newKey), salt, me.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(me.id, me.token_hash), // sign out other devices
    ]);
    return json({});
  }
  if (route === 'delete') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM libraries WHERE user_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id),
    ]);
    return json({}, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  return fail(404, 'Not found');
}
