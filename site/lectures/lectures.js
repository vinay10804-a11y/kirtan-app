// The Lectures test page (owner, 25 Oct 2026): Sacinandana Swami's lectures from the
// Saranagati Library, browsed by year, language and search, and played straight from the
// library. Separate from the app (its own page, storage keys "lect.*", no service-worker
// caching of audio); the list only arrives after the password (worker/lectures.js).

const $ = s => document.querySelector(s);
const audio = $('#audio');
const PAGE = 150;
const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const store = {
  get(k, d) { try { const v = localStorage.getItem(`lect.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`lect.${k}`, JSON.stringify(v)); } catch {} },
};
const S = {
  all: [], byId: new Map(), results: [], shown: PAGE,
  lang: store.get('lang', 'English'), year: 'All', q: '',
  current: null, positions: store.get('positions', {}), speed: store.get('speed', 1),
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => { const [y, m, day] = d.split('-'); return [day && String(Number(day)), m && MONTHS[Number(m) - 1], y].filter(Boolean).join(' '); };
const clock = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const meta = l => [fmtDate(l.date), l.ref, l.place, l.with && `with ${l.with}`, l.into ? `${l.language} → ${l.into}` : S.lang === 'All' && l.language].filter(Boolean).join(' · ');
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, ' ');

/* ---------- loading and the password ---------- */

async function load() {
  const res = await fetch('/api/lectures', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
  if (!res) return showGate('No connection. Try again when you’re online.');
  if (res.status === 401) return showGate('');
  if (!res.ok) return showGate('The lectures couldn’t be loaded. Try again later.');
  const data = await res.json();
  S.all = data.lectures;
  S.byId = new Map(S.all.map(l => [l.id, l]));
  for (const l of S.all) l.key = norm(`${l.title} ${l.ref} ${l.date} ${l.year} ${l.place} ${l.with}`);
  $('#gate').hidden = true;
  $('#browse').hidden = false;
  $('#total').textContent = `${S.all.length.toLocaleString()} lectures`;
  fillLanguages();
  render();
  showResume();
}

function showGate(msg) {
  $('#browse').hidden = true;
  $('#gate').hidden = false;
  $('#gate-msg').textContent = msg;
  setTimeout(() => $('#pw').focus(), 50);
}

$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('#gate-msg').textContent = '';
  const res = await fetch('/api/lectures/login', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('#pw').value }),
  }).catch(() => null);
  btn.disabled = false;
  if (res?.ok) { $('#pw').value = ''; load(); return; }
  $('#gate-msg').textContent = res ? (await res.json().catch(() => ({}))).error || 'That didn’t work.' : 'No connection.';
});

$('#signout').addEventListener('click', async () => {
  await fetch('/api/lectures/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  audio.pause();
  $('#bar').hidden = true;
  showGate('');
});

/* ---------- browsing ---------- */

function fillLanguages() {
  const counts = {};
  for (const l of S.all) counts[l.language] = (counts[l.language] || 0) + 1;
  const langs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (S.lang !== 'All' && !counts[S.lang]) S.lang = 'English';
  $('#lang').innerHTML = `<option value="All">All languages</option>` +
    langs.map(l => `<option value="${esc(l)}"${l === S.lang ? ' selected' : ''}>${esc(l)} (${counts[l]})</option>`).join('');
  $('#lang').value = S.lang;
}

function filtered() {
  const words = norm(S.q).split(' ').filter(Boolean);
  return S.all.filter(l => (S.lang === 'All' || l.language === S.lang)
    && (S.year === 'All' || l.year === Number(S.year))
    && words.every(w => l.key.includes(w)));
}

function render() {
  const inLang = S.all.filter(l => S.lang === 'All' || l.language === S.lang);
  const years = [...new Set(inLang.map(l => l.year))].sort((a, b) => b - a);
  if (S.year !== 'All' && !years.includes(Number(S.year))) S.year = 'All';
  $('#years').innerHTML = ['All', ...years].map(y => `<button class="chip" role="tab" data-year="${y}" aria-selected="${String(y) === String(S.year)}">${y}</button>`).join('');
  S.results = filtered();
  S.shown = PAGE;
  $('#count').textContent = `${S.results.length.toLocaleString()} lecture${S.results.length === 1 ? '' : 's'}`;
  drawList();
}

function row(l) {
  const pos = S.positions[l.id];
  const left = pos ? ` · <span class="left">${clock(pos)} listened</span>` : '';
  return `<li><button class="row${l.id === S.current?.id ? ' playing' : ''}" data-id="${l.id}">
    <span class="ic"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/></svg></span>
    <span class="tx"><b>${esc(l.title)}</b><small>${esc(meta(l))}${left}</small></span></button></li>`;
}

function drawList() {
  $('#list').innerHTML = S.results.slice(0, S.shown).map(row).join('');
  $('#more').hidden = S.results.length <= S.shown;
  $('#more').textContent = `Show more (${(S.results.length - S.shown).toLocaleString()} left)`;
}

let typing;
$('#q').addEventListener('input', e => { clearTimeout(typing); typing = setTimeout(() => { S.q = e.target.value; render(); }, 150); });
$('#lang').addEventListener('change', e => { S.lang = e.target.value; store.set('lang', S.lang); render(); });
$('#years').addEventListener('click', e => { const c = e.target.closest('[data-year]'); if (!c) return; S.year = c.dataset.year; render(); });
$('#more').addEventListener('click', () => { S.shown += PAGE; drawList(); });
$('#list').addEventListener('click', e => { const r = e.target.closest('.row'); if (r) play(S.byId.get(r.dataset.id)); });

function showResume() {
  const l = S.byId.get(store.get('last'));
  const pos = l && S.positions[l.id];
  $('#resume').innerHTML = l && pos ? `<button class="resume" data-id="${l.id}"><span class="tx"><small>Continue listening</small><b>${esc(l.title)}</b></span></button>` : '';
}
$('#resume').addEventListener('click', e => { const r = e.target.closest('[data-id]'); if (r) play(S.byId.get(r.dataset.id)); });

/* ---------- the player ---------- */

function play(l) {
  if (!l) return;
  if (S.current?.id === l.id && audio.src) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
  S.current = l;
  store.set('last', l.id);
  audio.src = l.url;
  audio.playbackRate = S.speed;
  const at = S.positions[l.id];
  if (at) audio.addEventListener('loadedmetadata', () => { audio.currentTime = at; }, { once: true });
  audio.play().catch(() => {});
  $('#bar').hidden = false;
  $('#np-title').textContent = l.title;
  $('#np-sub').textContent = meta(l);
  document.body.classList.add('buffering');
  setMeta();
  for (const r of document.querySelectorAll('.row')) r.classList.toggle('playing', r.dataset.id === l.id);
}

function setMeta() {
  if (!('mediaSession' in navigator) || !S.current) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: S.current.title, artist: 'Sacinandana Swami', album: `Lectures · ${fmtDate(S.current.date)}`,
    artwork: [{ src: new URL('/icons/icon-512.png', location.href).href, sizes: '512x512' }],
  });
  const ms = navigator.mediaSession;
  const handlers = {
    play: () => audio.play(), pause: () => audio.pause(),
    // Lectures are long: the lock screen skips back 15 and on 30 seconds.
    seekbackward: () => skip(-15), seekforward: () => skip(30),
    seekto: e => { audio.currentTime = e.seekTime; },
  };
  for (const [a, f] of Object.entries(handlers)) { try { ms.setActionHandler(a, f); } catch {} }
}

function skip(sec) { if (audio.src) audio.currentTime = Math.max(0, Math.min((audio.duration || 0) - 1, audio.currentTime + sec)); }
function savePosition() {
  if (!S.current || !audio.duration) return;
  const t = audio.currentTime;
  if (t > 20 && t < audio.duration - 60) S.positions[S.current.id] = Math.floor(t); else delete S.positions[S.current.id];
  store.set('positions', S.positions);
}

$('#toggle').addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
$('#back15').addEventListener('click', () => skip(-15));
$('#fwd30').addEventListener('click', () => skip(30));
$('#speed').addEventListener('click', () => {
  S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
  audio.playbackRate = S.speed;
  store.set('speed', S.speed);
  $('#speed').textContent = `${S.speed}×`;
});
$('#speed').textContent = `${S.speed}×`;

let dragging = false;
$('#seek').addEventListener('input', () => { dragging = true; $('#t-cur').textContent = clock(($('#seek').value / 1000) * (audio.duration || 0)); });
$('#seek').addEventListener('change', () => { if (audio.duration) audio.currentTime = ($('#seek').value / 1000) * audio.duration; dragging = false; });

let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0;
  if (!dragging) { $('#seek').value = d ? Math.round((audio.currentTime / d) * 1000) : 0; $('#t-cur').textContent = clock(audio.currentTime); }
  if (Date.now() - lastSave > 5000) { lastSave = Date.now(); savePosition(); }
  if ('mediaSession' in navigator && d && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate }); } catch {}
  }
});
audio.addEventListener('loadedmetadata', () => { $('#t-dur').textContent = clock(audio.duration); });
audio.addEventListener('playing', () => { document.body.classList.remove('buffering'); document.body.classList.add('playing-now'); $('#toggle').setAttribute('aria-label', 'Pause'); setMeta(); });
audio.addEventListener('waiting', () => document.body.classList.add('buffering'));
audio.addEventListener('pause', () => { document.body.classList.remove('playing-now', 'buffering'); $('#toggle').setAttribute('aria-label', 'Play'); savePosition(); });
audio.addEventListener('ended', () => { delete S.positions[S.current?.id]; store.set('positions', S.positions); document.body.classList.remove('playing-now'); });
audio.addEventListener('error', () => { document.body.classList.remove('buffering'); if (audio.src) $('#np-sub').textContent = 'This lecture couldn’t be played (the library may be busy). Try again.'; });

load();
