// The Lectures test section (owner, 25 Oct 2026), kept private with one shared password.
// The page (site/lectures/) is public but holds no lectures: the list (R2
// lectures/catalog.json, made by tools/lectures.mjs) comes from here only with the cookie
// that the right password earns. The password is the Worker secret LECTURES_PASSWORD;
// changing it (`wrangler secret put LECTURES_PASSWORD`) also signs everyone out, since the
// cookie is an HMAC of it. The audio itself streams from the Saranagati Library.
//
//   POST /api/lectures/login   { password } → sets the cookie (90 days)
//   POST /api/lectures/logout
//   GET  /api/lectures          → the lecture list, or 401

const COOKIE = 'lectures';
const enc = new TextEncoder();

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function pass(env) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.LECTURES_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('kirtan-app lectures v1'));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  if (url.pathname === '/api/lectures' && request.method === 'GET') {
    const sent = /(?:^|;\s*)lectures=([0-9a-f]+)/.exec(request.headers.get('Cookie') || '')?.[1] || '';
    if (!same(sent, good)) return json({ error: 'Password needed' }, 401);
    const list = await env.AUDIO.get('lectures/catalog.json');
    if (!list) return json({ error: 'No lecture list yet' }, 404);
    return new Response(list.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  }
  return json({ error: 'Not found' }, 404);
}
