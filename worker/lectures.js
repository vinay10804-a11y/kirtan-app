// The Lectures test section (owner, 25 Oct 2026), kept private with one shared password.
// The page (site/lectures/) is public but holds no lectures: the list (R2
// lectures/catalog.json, made by tools/lectures.mjs) comes from here only with the cookie
// that the right password earns. The password is the Worker secret LECTURES_PASSWORD;
// changing it (`wrangler secret put LECTURES_PASSWORD`) also signs everyone out, since the
// cookie is an HMAC of it. The audio itself streams from the Saranagati Library.
//
//   POST /api/lectures/login   { password } → sets the cookie (90 days)
//   POST /api/lectures/logout
//   GET  /api/lectures          → the lecture list (304 when the ETag sent still matches), or 401
//   GET  /api/lectures/transcript/<id> → a lecture's AI transcript (tools/transcribe.mjs), or 401/404
//   GET  /lecture-audio/<the library's path> → a lecture's MP3, passed through so the app can save it
//
// Disciple meetings (owner, 1 Nov 2026): the library's private dm/ folder, as a part of Lectures
// with a password of its own, the library's own password for that folder. The Worker secret
// DM_LOGIN is the library's login for it, "<user name>:<password>"; the section's password is the
// part after the colon (or DM_PASSWORD, if that's ever set to give the section a different one).
// The list (R2 lectures/dm-catalog.json) is made by tools/lectures.mjs from the library's public
// index; the recordings come through here with the login, so the login never reaches the app.
//
//   POST /api/lectures/dm/login   { password } → sets the dm cookie (90 days)
//   POST /api/lectures/dm/logout
//   GET  /api/lectures/dm          → the list of disciple meetings, or 401
//   GET  /dm-audio/<path in the library's dm/ folder> → a recording, fetched with the login

const COOKIE = 'lectures';
const LIBRARY = 'https://www.saranagati-library.net/';
const enc = new TextEncoder();

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const cookie = (value, maxAge, name = COOKIE) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function sign(secret, label) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(label));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const pass = env => sign(env.LECTURES_PASSWORD, 'kirtan-app lectures v1');
// The library login, "<user>:<password>", forgiving how it was typed into the dashboard (owner,
// 2 Nov 2026): spaces or a line break around it, or the user name typed twice ("gurudas:gurudas:…",
// when the box already held "gurudas:").
function dmLogin(env) {
  const login = (env.DM_LOGIN || '').trim();
  const at = login.indexOf(':');
  if (at < 1) return null;
  const user = login.slice(0, at).trim();
  let password = login.slice(at + 1).trim();
  while (password.startsWith(`${user}:`)) password = password.slice(user.length + 1).trim();
  return password ? { user, password } : null;
}
const dmPassword = env => env.DM_PASSWORD?.trim() || dmLogin(env)?.password || '';

// Compares without stopping at the first difference, so timing gives nothing away.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function lectures(request, env, url) {
  if (!env.LECTURES_PASSWORD) return json({ error: 'Lectures aren’t set up yet' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Not allowed' }, 403);
  const good = await pass(env);

  if (url.pathname === '/api/lectures/login' && request.method === 'POST') {
    const { password } = await request.json().catch(() => ({}));
    if (typeof password !== 'string' || !same(password.trim().toLowerCase(), env.LECTURES_PASSWORD.toLowerCase())) {
      await new Promise(r => setTimeout(r, 700)); // slows down guessing
      return json({ error: 'That password isn’t right' }, 401);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(good, 60 * 60 * 24 * 90) });
  }
  if (url.pathname === '/api/lectures/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  const signedIn = () => same(/(?:^|;\s*)lectures=([0-9a-f]+)/.exec(request.headers.get('Cookie') || '')?.[1] || '', good);

  if (url.pathname.startsWith('/api/lectures/dm') || url.pathname.startsWith('/dm-audio/')) return meetings(request, env, url);

  // A lecture's MP3 from the library, passed through so the app can keep it for offline
  // listening (owner, 26 Oct 2026): the library's server lets other sites play its files but
  // not save them. Free: nothing is stored here, the Worker only streams it. Only with the
  // password, and only Sacinandana Swami's lectures, so it can't fetch anything else.
  if (url.pathname.startsWith('/lecture-audio/') && request.method === 'GET') {
    if (!signedIn()) return json({ error: 'Password needed' }, 401);
    const file = url.pathname.slice('/lecture-audio/'.length);
    let name = '';
    try { name = decodeURIComponent(file); } catch {}
    if (!/^(\d{4}\/)?\d{4}\.\d{2}\.\d{2}_SSNS[^/]*\.mp3$/i.test(name)) return json({ error: 'Not found' }, 404);
    const range = request.headers.get('Range');
    const res = await fetch(LIBRARY + file, { headers: range ? { Range: range } : {} });
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
      if (res.headers.has(h)) headers.set(h, res.headers.get(h));
    }
    return new Response(res.body, { status: res.status, headers });
  }

  const transcript = /^\/api\/lectures\/transcript\/([0-9a-f]{12})$/.exec(url.pathname);
  if ((url.pathname === '/api/lectures' || transcript) && request.method === 'GET') {
    if (!signedIn()) return json({ error: 'Password needed' }, 401);
    // The app keeps what it fetched and asks with its ETag, so an unchanged file costs a 304.
    const key = transcript ? `lectures/transcripts/${transcript[1]}.json` : 'lectures/catalog.json';
    const file = await env.AUDIO.get(key, { onlyIf: request.headers });
    if (!file) return json({ error: transcript ? 'No transcript for this lecture yet' : 'No lecture list yet' }, 404);
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-cache', ETag: file.httpEtag };
    if (!('body' in file)) return new Response(null, { status: 304, headers });
    return new Response(file.body, { headers });
  }
  return json({ error: 'Not found' }, 404);
}

// The disciple meetings: the same as the lectures above, with their own password and cookie.
async function meetings(request, env, url) {
  const login = dmLogin(env);
  if (!login) return json({ error: 'Disciple meetings aren’t set up yet' }, 503);
  const good = await sign(dmPassword(env), 'kirtan-app disciple meetings v1');

  if (url.pathname === '/api/lectures/dm/login' && request.method === 'POST') {
    const { password } = await request.json().catch(() => ({}));
    if (typeof password !== 'string' || !same(password.trim().toLowerCase(), dmPassword(env).toLowerCase())) {
      await new Promise(r => setTimeout(r, 700)); // slows down guessing
      return json({ error: 'That password isn’t right' }, 401);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(good, 60 * 60 * 24 * 90, 'dm') });
  }
  if (url.pathname === '/api/lectures/dm/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, 'dm') });
  }
  if (!same(/(?:^|;\s*)dm=([0-9a-f]+)/.exec(request.headers.get('Cookie') || '')?.[1] || '', good)) {
    return json({ error: 'Password needed' }, 401);
  }

  if (url.pathname === '/api/lectures/dm' && request.method === 'GET') {
    const file = await env.AUDIO.get('lectures/dm-catalog.json', { onlyIf: request.headers });
    if (!file) return json({ error: 'No list of disciple meetings yet' }, 404);
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-cache', ETag: file.httpEtag };
    if (!('body' in file)) return new Response(null, { status: 304, headers });
    return new Response(file.body, { headers });
  }

  // Only Sacinandana Swami's recordings in the dm/ folder, so the login can't fetch anything else.
  if (url.pathname.startsWith('/dm-audio/') && request.method === 'GET') {
    const file = url.pathname.slice('/dm-audio/'.length);
    let name = '';
    try { name = decodeURIComponent(file); } catch {}
    if (!/^(\d{4}\/)?\d{4}\.\d{2}\.\d{2}_SSNS[^/]*\.mp3$/i.test(name)) return json({ error: 'Not found' }, 404);
    const basic = btoa(String.fromCharCode(...enc.encode(`${login.user}:${login.password}`)));
    const range = request.headers.get('Range');
    const res = await fetch(`${LIBRARY}dm/${file}`, { headers: { Authorization: `Basic ${basic}`, ...(range && { Range: range }) } });
    if (res.status === 401) return json({ error: 'The library login didn’t work' }, 502);
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
      if (res.headers.has(h)) headers.set(h, res.headers.get(h));
    }
    return new Response(res.body, { status: res.status, headers });
  }
  return json({ error: 'Not found' }, 404);
}
