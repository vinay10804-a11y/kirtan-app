// Sacinandana Swami and Gour Krishna Kirtans: a small offline-capable audio app.
// No framework: hash routes render HTML strings into #view, and one delegated
// click handler drives everything through data-action attributes.

const AUDIO_CACHE = 'kirtan-audio';
const ARTIST_ORDER = ['Sacinandana Swami', 'Gour Krishna'];
const TYPE_ORDER = ['Mahamantra', 'Bhajans'];
const JAPA_ORDER = ['Guided Japa', 'Japa Inspirations', 'Living Name Meditations'];
const JAPA_TABS = { 'Japa Inspirations': 'Inspirations', 'Living Name Meditations': 'Living Name' };
const JAPA_ABOUT = {
  'Guided Japa': 'Full sessions in which Sacinandana Swami guides you through chanting your rounds. Tap a session to watch it here.',
  'Japa Inspirations': 'Short talks and reflections from Sacinandana Swami to bring fresh attention to your chanting. They play here from SoundCloud.',
  'Living Name Meditations': 'Guided meditations from The Living Name, Sacinandana Swami’s book on chanting with attention and feeling. They play here from SoundCloud.',
};
// What one item of a SoundCloud japa collection is called ("25 meditations").
const JAPA_UNIT = { 'Living Name Meditations': 'meditation', 'Japa Inspirations': 'talk' };
// Short labels for the plain tiles shown when a recording has no cover art.
const INITIALS = { 'Sacinandana Swami': 'SS', 'Gour Krishna': 'GK' };
const SPEEDS = [1, 1.25, 1.5, 0.75];
const LENGTHS = [
  { label: 'Under 20 min', max: 20 * 60 },
  { label: '20–45 min', max: 45 * 60 },
  { label: '45–90 min', max: 90 * 60 },
  { label: 'Over 90 min', max: Infinity },
];

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const view = $('#view');
const audio = $('#audio');

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`kk.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(`kk.${key}`, JSON.stringify(value)); } catch {}
  },
};

const S = {
  tracks: [],
  byId: new Map(),
  bySrc: new Map(),
  photos: [],
  videos: [],
  lyrics: [],
  favs: new Set(store.get('favs', [])),
  theme: store.get('theme', 'auto'), // 'auto' follows the device; or 'light' / 'dark'
  playlists: store.get('playlists', []), // [{ id, name, ids: [track ids] }], kept on this device
  played: new Set(store.get('played', [])),
  positions: store.get('positions', {}),
  history: store.get('history', []),
  stats: store.get('stats', { seconds: 0, since: Date.now() }),
  speed: store.get('speed', 1),
  loop: store.get('loop', false),
  saved: new Set(),
  downloads: new Map(), // id → { progress, ctrl }
  dlQueue: [],
  lists: {},
  queue: [],
  qi: -1,
  current: null,
  sleep: null,
  blobUrl: null,
  query: '',
  installEvent: null,
};

/* ---------------- helpers ---------------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = s => norm(s).replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const icon = (name, cls = '') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || byTitle(a, b);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const isOnline = () => navigator.onLine !== false;
const ytThumb = (id, size = 'hqdefault') => `https://i.ytimg.com/vi/${id}/${size}.jpg`;
const ytLink = id => `https://www.youtube.com/watch?v=${id}`;
// Japa entries are YouTube videos unless marked as SoundCloud tracks.
const isSC = v => v.source === 'soundcloud';
const vidLink = v => (isSC(v) ? v.url : ytLink(v.id));
const vidThumb = (v, size) => (isSC(v) ? v.thumb : ytThumb(v.id, size));
const vidSite = v => (isSC(v) ? 'SoundCloud' : 'YouTube');
function embedSrc(v) {
  if (!isSC(v)) return `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0`;
  const q = new URLSearchParams({ url: v.url, auto_play: 'true', visual: 'false', color: '#3a8487',
    show_comments: 'false', show_reposts: 'false', show_teaser: 'false', show_user: 'false' });
  return `https://w.soundcloud.com/player/?${q}`;
}

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m === 60) return `${h + 1} h`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(1, m)} min`;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtHours(sec) {
  const h = sec / 3600;
  return h < 1 ? fmtDur(sec) : `${h < 10 ? h.toFixed(1) : Math.round(h)} hours`;
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtWhen(ts) {
  const day = 86400000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - day) return 'Yesterday';
  return fmtDate(ts);
}
function fmtMB(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

// Cover art embedded in the file, else a photo tagged with the artist, else none.
function artFor(t) {
  if (!t) return null;
  return t.cover || personPhoto(t.artist);
}
function personPhoto(name) {
  return S.photos.find(p => p.person === name)?.thumb || null;
}
function tile(label) {
  return `<span class="tile" aria-hidden="true">${esc(label)}</span>`;
}
function initialsFor(name) {
  return INITIALS[name] || name.split(/\s+/).filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('').slice(0, 2);
}
function artHTML(t) {
  const src = artFor(t);
  if (src) return `<img src="${esc(src)}" alt="">`;
  return tile(t.section === 'japa' ? 'Japa' : initialsFor(t.artist));
}
function collectionArt(name) {
  const src = personPhoto(name);
  return src ? `<img src="${esc(src)}" alt="">` : tile(initialsFor(name));
}
function collectionName(t) {
  return t.section === 'japa' ? `${t.type} · Sacinandana Swami` : t.artist;
}

// In-page confirmation, since native browser dialogs are clunky and blocked in some views.
function ask(text, yes) {
  const dlg = $('#confirm-dialog');
  $('#confirm-text').textContent = text;
  $('#confirm-yes').textContent = yes;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(resolve => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true }));
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------- data ---------------- */

async function loadJSON(url, fallback) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch {
    return fallback;
  }
}

async function loadData() {
  const [catalog, photos, videos, lyrics] = await Promise.all([
    loadJSON('catalog.json', { tracks: [] }),
    loadJSON('photos.json', []),
    loadJSON('videos.json', []),
    loadJSON('lyrics.json', []),
  ]);
  S.tracks = catalog.tracks || [];
  S.photos = photos;
  S.videos = videos;
  S.lyrics = lyrics.map(l => ({ ...l, re: new RegExp(l.match, 'i') }));
  for (const t of S.tracks) {
    S.byId.set(t.id, t);
    S.bySrc.set(new URL(t.src, location.href).pathname, t);
  }
  if ('caches' in window) {
    try {
      const cache = await caches.open(AUDIO_CACHE);
      for (const req of await cache.keys()) {
        const t = S.bySrc.get(new URL(req.url).pathname);
        if (t) S.saved.add(t.id);
        // A copy no longer in the catalog (e.g. replaced by a smaller format) only takes up space.
        else if (S.tracks.length) await cache.delete(req);
      }
    } catch {}
  }
}

const kirtans = () => S.tracks.filter(t => t.section !== 'japa');
const japa = () => S.tracks.filter(t => t.section === 'japa');

function orderBy(values, preferred) {
  return [...new Set(values)].sort((a, b) => {
    const ia = preferred.indexOf(a), ib = preferred.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}
const artists = () => orderBy(kirtans().map(t => t.artist), ARTIST_ORDER);
const japaCollections = () => orderBy([...S.videos.map(v => v.collection), ...japa().map(t => t.type)], JAPA_ORDER);

// How a kirtan list can be browsed: each mode groups tracks and orders the groups.
const MODES = {
  year: {
    label: 'Year',
    key: t => (t.year ? String(t.year) : 'Undated'),
    order: (a, b) => (a === 'Undated') - (b === 'Undated') || b.localeCompare(a),
    within: (a, b) => (a.place || '').localeCompare(b.place || '') || byTitle(a, b),
    opts: { place: true },
  },
  place: {
    label: 'Place',
    key: t => t.place || 'Other',
    order: (a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b),
    within: (a, b) => (b.year || 0) - (a.year || 0) || byTitle(a, b),
    opts: { year: true },
  },
  length: {
    label: 'Length',
    key: t => LENGTHS.find(l => (t.duration || 0) < l.max).label,
    order: (a, b) => LENGTHS.findIndex(l => l.label === a) - LENGTHS.findIndex(l => l.label === b),
    within: (a, b) => (a.duration || 0) - (b.duration || 0),
    opts: { year: true, place: true },
  },
};
const JAPA_MODE = { ...MODES.year, within: byDate, opts: { date: true } };

/* ---------------- rendering pieces ---------------- */

function dlButton(t) {
  const d = S.downloads.get(t.id);
  if (S.saved.has(t.id)) {
    return `<button class="icon-btn dl saved" data-action="download" data-id="${t.id}" aria-label="Saved offline. Tap to remove.">${icon('check')}</button>`;
  }
  if (d) {
    const c = 2 * Math.PI * 9;
    return `<button class="icon-btn dl" data-action="download" data-id="${t.id}" aria-label="Saving, ${Math.round(d.progress * 100)}%. Tap to cancel.">
      <svg class="ring" viewBox="0 0 22 22"><circle class="bg" cx="11" cy="11" r="9"/><circle class="fg" cx="11" cy="11" r="9" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - d.progress)}"/></svg></button>`;
  }
  return `<button class="icon-btn dl" data-action="download" data-id="${t.id}" aria-label="Save offline">${icon('download')}</button>`;
}

function trackMeta(t, opts = {}) {
  const parts = [];
  if (opts.source) parts.push(esc(t.section === 'japa' ? t.type : t.artist));
  if (opts.year && t.year) parts.push(t.year);
  if (opts.place && (t.place || t.album)) parts.push(esc(t.place || t.album));
  if (opts.date && t.date) parts.push(fmtDate(t.date));
  if (opts.when) parts.push(fmtWhen(opts.when));
  const pos = S.positions[t.id];
  parts.push(pos && t.duration ? `<span class="left">${fmtDur(t.duration - pos)} left</span>` : fmtDur(t.duration));
  if (!pos && S.played.has(t.id)) parts.push(`<span class="played">${icon('tick')}Played</span>`);
  return parts.join(' · ');
}

function trackRow(t, i, listKey, opts = {}) {
  const current = S.current === t.id;
  const off = !isOnline() && !S.saved.has(t.id);
  return `<li class="track${current ? ' playing' : ''}${off ? ' off' : ''}" data-id="${t.id}" data-i="${i}" data-list="${listKey}" data-opts='${JSON.stringify(opts)}'>
    <button class="track-main" data-action="play" data-id="${t.id}" data-list="${listKey}">
      <span class="track-num">${current ? '<span class="eq"><i></i><i></i><i></i></span>' : i + 1}</span>
      <span class="track-text"><span class="track-title">${esc(t.title)}</span><span class="track-meta">${trackMeta(t, opts)}</span></span>
    </button>
    ${dlButton(t)}
    <button class="icon-btn more" data-action="track-menu" data-id="${t.id}" aria-label="More options">${icon('more')}</button>
  </li>`;
}

function trackList(tracks, listKey, opts) {
  S.lists[listKey] = tracks.map(t => t.id);
  return `<ul class="tracks">${tracks.map((t, i) => trackRow(t, i, listKey, opts)).join('')}</ul>`;
}

function saveListButton(listKey) {
  const ids = S.lists[listKey] || [];
  if (!('caches' in window) || !ids.length) return '';
  const left = ids.filter(id => !S.saved.has(id)).length;
  if (!left) return `<span class="text-btn done">Saved offline</span>`;
  return `<button class="text-btn" data-action="save-list" data-list="${listKey}">Save ${left === ids.length ? 'all' : left} offline</button>`;
}

// Groups tracks by a browse mode, each group with its own "Save all offline".
function groupedList(tracks, keyPrefix, mode) {
  const groups = new Map();
  for (const t of tracks) {
    const k = mode.key(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const ordered = [];
  const html = [...groups.keys()].sort(mode.order).map(k => {
    const list = groups.get(k).sort(mode.within);
    ordered.push(...list);
    const key = `${keyPrefix}:${slug(k)}`;
    const body = trackList(list, key, mode.opts);
    return `<section class="group">
      <div class="group-head"><h3>${esc(k)}<small>${list.length}</small></h3>${saveListButton(key)}</div>
      ${body}
    </section>`;
  }).join('');
  S.lists[keyPrefix] = ordered.map(t => t.id);
  return html;
}

function playActions(listKey) {
  if (!S.lists[listKey]?.length) return '';
  return `<div class="actions">
    <button class="btn" data-action="play-list" data-list="${listKey}">${icon('play')}Play</button>
    <button class="btn ghost" data-action="shuffle" data-list="${listKey}">${icon('shuffle')}Shuffle</button>
  </div>`;
}

function topbar() {
  return `<header class="topbar"><a class="topbar-title" href="#/">Sacinandana Swami and Gour Krishna <b>Kirtans</b></a>
    <button class="icon-btn theme-toggle" data-action="theme-toggle" aria-label="Switch between light and dark">${icon('moon', 'show-light')}${icon('sun', 'show-dark')}</button></header>`;
}

/* ---------------- light and dark ---------------- */

const isDark = () => S.theme === 'dark' || (S.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
function applyTheme() {
  const root = document.documentElement;
  if (S.theme === 'light' || S.theme === 'dark') root.dataset.theme = S.theme;
  else delete root.dataset.theme;
  root.classList.toggle('is-dark', isDark());
  // The phone's status bar matches the app.
  for (const m of $$('meta[name="theme-color"]')) m.content = isDark() ? '#0e2427' : '#eeecd9';
}
function setTheme(theme) {
  S.theme = theme;
  store.set('theme', theme);
  applyTheme();
  for (const b of $$('[data-action="theme"]')) b.setAttribute('aria-current', b.dataset.theme === theme);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
applyTheme();

function appearance() {
  const opt = (key, label) => `<button class="chip" data-action="theme" data-theme="${key}" aria-current="${S.theme === key}">${label}</button>`;
  return `<section class="appearance"><h3>Appearance</h3>
    <div class="chips">${opt('auto', 'Automatic')}${opt('light', 'Light')}${opt('dark', 'Dark')}</div>
    <p class="note">Automatic follows your phone or computer.</p></section>`;
}

function tabs(items, active) {
  return `<nav class="tabs">${items.map(it => `<a href="${it.href}" aria-current="${it.key === active}">${esc(it.label)}</a>`).join('')}</nav>`;
}

function chip(href, label, active) {
  return `<a class="chip" href="${href}" aria-current="${active}">${esc(label)}</a>`;
}

function entryLink(href, art, title, sub) {
  return `<a href="${href}">${art}<span class="entry-name">${esc(title)}</span><small>${esc(sub)}</small>${icon('right')}</a>`;
}

/* ---------------- views ---------------- */

function homeView() {
  const last = S.byId.get(store.get('last'));
  const lastPos = last && S.positions[last.id];
  const names = artists();
  const allJapa = japa();
  const recent = S.tracks.filter(t => t.added).sort((a, b) => b.added - a.added).slice(0, 5);

  const kirtanLinks = names.map(a => {
    const n = kirtans().filter(t => t.artist === a).length;
    return entryLink(`#/kirtans/${slug(a)}`, collectionArt(a), a, plural(n, 'kirtan'));
  }).join('');
  const japaLinks = japaCollections().map(c => {
    const vids = S.videos.filter(v => v.collection === c).length;
    const n = vids || allJapa.filter(t => t.type === c).length;
    const art = `<span class="tile" aria-hidden="true">${icon(vids ? 'play' : 'beads')}</span>`;
    const sc = S.videos.some(v => v.collection === c && isSC(v));
    return entryLink(`#/japa/${slug(c)}`, art, c, plural(n, sc ? JAPA_UNIT[c] || 'recording' : vids ? 'video' : 'session'));
  }).join('');

  return `${topbar()}
    <div class="hero"><img src="art/card-1.webp" alt="The Hare Kṛṣṇa mahāmantra written into a wave"></div>
    <p class="intro">Kirtan and japa with Sacinandana Swami and Gour Krishna. Listen here, or save recordings to play without internet.</p>
    ${last && lastPos ? `<section class="section"><h2>Continue listening</h2><div class="rows">
      <button class="row" data-action="resume" data-id="${last.id}">
        ${artHTML(last)}<span class="row-text"><span class="row-title">${esc(last.title)}</span>
        <span class="row-sub">${esc(collectionName(last))} · ${fmtDur(last.duration - lastPos)} left</span></span>${icon('play')}
      </button></div></section>` : ''}
    <section class="section entries">
      <div class="entry">
        <a class="entry-head" href="#/kirtans"><h2>Kirtans</h2>${icon('right')}</a>
        <p>Mahamantra kirtans and bhajans led by Sacinandana Swami and Gour Krishna. Browse by year, place or length, and save any kirtan to play offline.</p>
        <div class="entry-links">${kirtanLinks || '<p class="muted">Kirtans appear here once they’re published.</p>'}</div>
      </div>
      <div class="entry">
        <a class="entry-head" href="#/japa"><h2>Japa</h2>${icon('right')}</a>
        <p>Chant your rounds with Sacinandana Swami. Guided japa sessions play here from YouTube; Japa Inspirations and Living Name meditations play here from SoundCloud.</p>
        <div class="entry-links">${japaLinks || '<p class="muted">Japa sessions appear here once they’re published.</p>'}</div>
      </div>
    </section>
    ${recent.length ? `<section class="section"><h2>Recently added</h2>${trackList(recent, 'recent', { source: true, year: true })}</section>` : ''}
    ${installSection()}
    <details class="howto">
      <summary>How to use this site</summary>
      <ul>
        <li><b>Play:</b> tap any kirtan. It keeps playing while you browse and when your phone is locked.</li>
        <li><b>Offline:</b> tap ${icon('download')} next to a kirtan, or <b>Save all offline</b> on a year or place. Saved kirtans play without internet.</li>
        <li><b>Chanting japa:</b> open the player and tap <b>Loop</b> to repeat one kirtan while you chant your rounds.</li>
        <li><b>Sleep timer</b> in the player stops playback after 15 minutes to an hour.</li>
        <li><b>Find something:</b> use Search for a title, place or year, such as “Vrindavan” or “2019”.</li>
      </ul>
    </details>`;
}

function kirtansView(artistSlug, typeSlug, modeKey, valueSlug) {
  const names = artists();
  if (!names.length) return `<h1 class="page-title">Kirtans</h1>${emptyCatalog()}`;
  const artist = names.find(a => slug(a) === artistSlug) || names.find(a => slug(a) === store.get('artist')) || names[0];
  store.set('artist', slug(artist));

  const ts = kirtans().filter(t => t.artist === artist);
  const types = orderBy(ts.map(t => t.type), TYPE_ORDER);
  const type = types.find(x => slug(x) === typeSlug) || types[0];
  const inType = ts.filter(t => t.type === type);

  const modes = Object.keys(MODES).filter(k => k !== 'place' || new Set(inType.map(t => t.place).filter(Boolean)).size >= 2);
  const mode = modes.includes(modeKey) ? modeKey : 'year';
  const m = MODES[mode];
  const values = [...new Set(inType.map(m.key))].sort(m.order);
  const value = values.find(v => slug(v) === valueSlug);
  const list = value ? inType.filter(t => m.key(t) === value) : inType;

  const base = `#/kirtans/${slug(artist)}/${slug(type)}`;
  const key = `k:${slug(artist)}:${slug(type)}:${mode}:${value ? slug(value) : 'all'}`;
  const groups = groupedList(list, key, m);

  return `<h1 class="page-title">Kirtans</h1>
    ${names.length > 1 ? `<nav class="switch" aria-label="Artist">${names.map(a => `<a href="#/kirtans/${slug(a)}" aria-current="${a === artist}">${esc(a)}</a>`).join('')}</nav>` : ''}
    ${tabs(types.map(x => ({ key: x, label: `${x} · ${ts.filter(t => t.type === x).length}`, href: `#/kirtans/${slug(artist)}/${slug(x)}` })), type)}
    <div class="filters">
      <div class="modes" role="group" aria-label="Browse by"><span>Browse by</span>${modes.map(k => `<a href="${base}/${k}" aria-current="${k === mode}">${MODES[k].label}</a>`).join('')}</div>
      <div class="chips">${chip(`${base}/${mode}`, 'All', !value)}${values.map(v => chip(`${base}/${mode}/${slug(v)}`, v, v === value)).join('')}</div>
    </div>
    <div class="list-head"><p class="page-sub">${plural(list.length, type === 'Bhajans' ? 'bhajan' : 'kirtan')} · ${fmtHours(sum(list, t => t.duration))}</p>${playActions(key)}</div>
    ${groups}`;
}

function emptyCatalog() {
  return `<div class="empty">No recordings yet. Run <code>./publish.sh</code> on your Mac to add everything from your Kirtans folder.</div>`;
}

function japaView(colSlug) {
  const audioTracks = japa();
  const header = `<h1 class="page-title">Japa</h1><p class="page-sub">Chant your rounds with Sacinandana Swami</p>`;
  const cols = japaCollections();
  if (!cols.length) {
    return `${header}<div class="empty">The guided japa sessions, Japa Inspirations and Living Name meditations download when you run <code>./publish.sh</code> on your Mac.</div>`;
  }
  const col = cols.find(c => slug(c) === colSlug) || cols[0];
  const tabBar = tabs(cols.map(c => ({ key: c, label: JAPA_TABS[c] || c, href: `#/japa/${slug(c)}` })), col);
  const about = JAPA_ABOUT[col] ? `<p class="about">${esc(JAPA_ABOUT[col])}</p>` : '';
  const key = `japa:${slug(col)}`;
  const videos = S.videos.filter(v => v.collection === col);

  if (videos.some(isSC)) {
    // SoundCloud tracks: one list in the order of the set, each playing in place.
    const list = videos.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    return `${header}${tabBar}${about}
      <div class="list-head"><p class="page-sub">${plural(list.length, JAPA_UNIT[col] || 'recording')} · ${fmtHours(sum(list, v => v.duration))}</p></div>
      <ul class="tracks sc-list">${list.map(scRow).join('')}</ul>`;
  }

  if (videos.length) {
    // Offline audio copies, matched to their video by YouTube id.
    const byYt = new Map(audioTracks.filter(t => t.yt).map(t => [t.yt, t]));
    const groups = new Map();
    for (const v of videos) {
      const y = v.date ? v.date.slice(0, 4) : 'Undated';
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(v);
    }
    const ordered = [];
    const html = [...groups.keys()].sort(MODES.year.order).map(y => {
      const list = groups.get(y).sort(byDate);
      ordered.push(...list);
      return `<section class="group">
        <div class="group-head"><h3>${y}<small>${list.length}</small></h3></div>
        <div class="videos">${list.map(v => videoCard(v, byYt.get(v.id), key)).join('')}</div>
      </section>`;
    }).join('');
    S.lists[key] = ordered.map(v => byYt.get(v.id)?.id).filter(Boolean);
    return `${header}${tabBar}${about}
      <div class="list-head"><p class="page-sub">${plural(videos.length, 'video')} · ${fmtHours(sum(videos, v => v.duration))}</p>${playActions(key)}</div>
      ${html}`;
  }

  const list = audioTracks.filter(t => t.type === col);
  const groups = groupedList(list, key, JAPA_MODE);
  return `${header}${tabBar}${about}
    <div class="list-head"><p class="page-sub">${plural(list.length, 'session')} · ${fmtHours(sum(list, t => t.duration))}</p>${playActions(key)}</div>
    ${groups}`;
}

function videoCard(v, track, listKey) {
  const meta = [v.date && fmtDate(v.date), v.duration && fmtDur(v.duration)].filter(Boolean);
  if (track && S.played.has(track.id)) meta.push(`<span class="played">${icon('tick')}Played</span>`);
  // Tapping the picture (with its play button) or the title opens the video in
  // the app's YouTube player. Nothing else to choose.
  return `<article class="video">
    <button class="thumb" data-action="video" data-vid="${esc(v.id)}" aria-label="Play ${esc(v.title)}">
      <img src="${ytThumb(v.id)}" alt="" loading="lazy" onerror="this.remove()">
      ${v.duration ? `<span class="thumb-dur">${fmtClock(v.duration)}</span>` : ''}
      <span class="thumb-play">${icon('play')}</span>
    </button>
    <button class="video-title" data-action="video" data-vid="${esc(v.id)}">${esc(v.title)}</button>
    <span class="video-meta">${meta.join(' · ')}</span>
  </article>`;
}

// A SoundCloud track (a Living Name meditation or a Japa Inspiration): tapping it
// opens SoundCloud's player under the title. Its artwork, when it has one, is the thumbnail.
function scRow(v) {
  const thumb = v.thumb ? `<img class="sc-thumb" src="${esc(v.thumb.replace('-t300x300.', '-large.'))}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<li class="sc-item">
    <button class="track sc-track embed-btn" data-action="embed" data-vid="${esc(v.id)}">
      ${thumb}<span class="track-text"><span class="track-title">${esc(v.title)}</span><span class="track-meta">${fmtDur(v.duration)}</span></span>
      <span class="sc-play" aria-hidden="true"><span class="when-closed">${icon('play')}</span><span class="when-open">${icon('x')}</span></span>
    </button>
    <div class="embed-slot sc-slot" data-embed="${esc(v.id)}"></div>
  </li>`;
}

function videoRow(v) {
  const meta = [v.collection, v.date && fmtDate(v.date), v.duration && fmtDur(v.duration)].filter(Boolean).join(' · ');
  const inner = `<span class="vrow-thumb"><img src="${esc(vidThumb(v, 'mqdefault'))}" alt="" loading="lazy" onerror="this.remove()">${icon('play')}</span>
    <span class="vrow-text"><span class="track-title">${esc(v.title)}</span><span class="track-meta">${esc(meta)} · ${vidSite(v)}</span></span>`;
  // YouTube videos open in the app's player; SoundCloud tracks open their Japa tab.
  return isSC(v)
    ? `<a class="vrow" href="#/japa/${slug(v.collection)}">${inner}</a>`
    : `<button class="vrow" data-action="video" data-vid="${esc(v.id)}">${inner}</button>`;
}

/* ---------------- the YouTube player for Guided Japa ---------------- */

// YouTube chooses the picture quality from the player's size on screen and the
// connection; it no longer lets sites force one. So the player is as large as
// the screen allows, asks for HD (vq, which YouTube may honour), and allows full
// screen, where YouTube switches to its best quality.
function openVideo(vid) {
  const v = S.videos.find(x => x.id === vid && !isSC(x));
  if (!v) return;
  if (!isOnline()) return toast('Connect to the internet to watch');
  audio.pause();
  closeEmbed();
  const q = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', modestbranding: '1', vq: 'hd1080' });
  $('#video-frame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?${q}" title="${esc(v.title)}"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  $('#video-title').textContent = v.title;
  $('#video-meta').textContent = [v.collection, v.date && fmtDate(v.date), v.duration && fmtDur(v.duration)].filter(Boolean).join(' · ');
  $('#video-yt').href = ytLink(v.id);
  $('#video-dialog').showModal();
}
// Closing the player stops the video.
$('#video-dialog').addEventListener('close', () => { $('#video-frame').innerHTML = ''; });

/* ---------------- YouTube and SoundCloud players in the page ---------------- */

// One embedded player at a time; starting another, or the app's own player, closes it.
let openEmbed = null;
function closeEmbed() {
  if (!openEmbed) return;
  openEmbed.slot.innerHTML = openEmbed.html;
  openEmbed.slot.classList.remove('playing');
  openEmbed.btn?.classList.remove('open');
  openEmbed = null;
}
function playEmbed(vid) {
  const v = S.videos.find(x => x.id === vid);
  const slot = view.querySelector(`.embed-slot[data-embed="${CSS.escape(vid)}"]`);
  if (!v || !slot) return;
  if (openEmbed?.slot === slot) return closeEmbed();
  closeEmbed();
  if (!isOnline()) return toast(`Connect to the internet to play from ${vidSite(v)}`);
  audio.pause();
  const btn = view.querySelector(`.embed-btn[data-vid="${CSS.escape(vid)}"]`);
  openEmbed = { slot, btn, html: slot.innerHTML };
  slot.classList.add('playing');
  btn?.classList.add('open');
  slot.innerHTML = `<iframe src="${esc(embedSrc(v))}" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="eager"></iframe>`;
}

function searchView() {
  return `<h1 class="page-title">Search</h1>
    <div class="search">${icon('search')}<input id="q" type="search" placeholder="Title, place, year or japa" value="${esc(S.query)}" autocomplete="off" enterkeyhint="search" aria-label="Search"></div>
    <div id="results">${searchResults()}</div>`;
}

function searchSuggestions() {
  const count = new Map();
  for (const t of kirtans()) if (t.place) count.set(t.place, (count.get(t.place) || 0) + 1);
  const places = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p);
  const years = [...new Set(kirtans().map(t => t.year).filter(Boolean))].sort((a, b) => b - a).slice(0, 4).map(String);
  const extra = S.tracks.some(t => t.type === 'Bhajans') ? ['Bhajans'] : [];
  return [...places, ...years, ...extra, ...(japaCollections().length ? ['Guided Japa'] : [])];
}

function searchResults() {
  const q = norm(S.query.trim());
  if (!q) {
    const sugg = searchSuggestions();
    if (!S.tracks.length && !S.videos.length) return emptyCatalog();
    return sugg.length ? `<div class="suggest"><h2>Try</h2><div class="chips wrap">${sugg.map(s =>
      `<button class="chip" data-action="suggest" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : '';
  }
  const words = q.split(/\s+/);
  const match = text => { const hay = norm(text); return words.every(w => hay.includes(w)); };
  const hits = S.tracks.filter(t => match(`${t.title} ${t.album || ''} ${t.place || ''} ${t.artist} ${t.type} ${t.year || ''} ${t.type === 'Mahamantra' ? 'hare krishna kirtan' : ''}`)).slice(0, 150);
  const vids = S.videos.filter(v => match(`${v.title} ${v.collection} ${(v.date || '').slice(0, 4)} japa`));
  if (!hits.length && !vids.length) return `<p class="empty">Nothing found for “${esc(S.query)}”. Try a shorter word, a place or a year.</p>`;
  const k = hits.filter(t => t.section !== 'japa');
  const j = hits.filter(t => t.section === 'japa');
  return [
    k.length ? `<section class="group"><div class="group-head"><h3>Kirtans<small>${k.length}</small></h3></div>${trackList(k, 'search:k', { source: true, year: true, place: true })}</section>` : '',
    vids.length ? `<section class="group"><div class="group-head"><h3>Japa videos<small>${vids.length}</small></h3></div><div class="vrows">${vids.map(videoRow).join('')}</div></section>` : '',
    j.length ? `<section class="group"><div class="group-head"><h3>Japa audio<small>${j.length}</small></h3></div>${trackList(j, 'search:j', { source: true, date: true })}</section>` : '',
  ].join('');
}

function libraryView(tab = 'favourites', sub) {
  const tabItems = [
    { key: 'favourites', label: 'Favourites', href: '#/library/favourites' },
    { key: 'playlists', label: 'Playlists', href: '#/library/playlists' },
    { key: 'saved', label: 'Saved offline', href: '#/library/saved' },
    { key: 'history', label: 'History', href: '#/library/history' },
  ];
  let body = '';

  if (tab === 'favourites') {
    const list = [...S.favs].map(id => S.byId.get(id)).filter(Boolean);
    body = list.length ? `<div class="group">${trackList(list, 'favs', { source: true, year: true })}</div>`
      : `<p class="empty">Tap <b>Favourite</b> in the player to keep a kirtan here.</p>`;
  }

  if (tab === 'playlists' && sub) return playlistView(sub);
  if (tab === 'playlists') {
    const rows = S.playlists.map(p => {
      const list = p.ids.map(id => S.byId.get(id)).filter(Boolean);
      const art = list[0] ? artHTML(list[0]) : tile('');
      return entryLink(`#/library/playlists/${p.id}`, art, p.name,
        `${plural(list.length, 'kirtan')}${list.length ? ` · ${fmtHours(sum(list, t => t.duration))}` : ''}`);
    }).join('');
    body = `<div class="actions" style="margin-top:16px"><button class="btn" data-action="pl-new">${icon('plus')}New playlist</button></div>
      ${rows ? `<div class="rows" style="margin-top:16px">${rows}</div>`
        : `<p class="empty">Make your own playlists, for japa, for the morning, for travelling. Tap <b>New playlist</b>, or tap ${icon('more')} next to any kirtan and choose <b>Add to playlist</b>.</p>`}`;
  }

  if (tab === 'saved') {
    const list = S.tracks.filter(t => S.saved.has(t.id));
    const size = sum(list, t => t.size);
    body = list.length ? `<p class="page-sub" style="margin-top:16px">${plural(list.length, 'recording')} · ${fmtMB(size)} on this device
        · <button class="text-btn" data-action="remove-all">Remove all</button></p>
        <div class="group" style="margin-top:12px">${trackList(list, 'saved', { source: true, year: true })}</div>`
      : `<p class="empty">Nothing saved yet. Tap ${icon('download')} next to any kirtan, or <b>Save all offline</b> on a year, to listen without internet.</p>`;
    body += installNote();
  }

  if (tab === 'history') {
    const seen = new Set();
    const recent = S.history.filter(h => S.byId.has(h.id) && !seen.has(h.id) && seen.add(h.id)).slice(0, 60);
    S.lists.history = recent.map(h => h.id);
    body = S.stats.seconds > 30
      ? `<p class="note"><b>${fmtHours(S.stats.seconds)}</b> listened since ${fmtDate(S.stats.since)} · ${plural(S.history.length, 'session')}</p>`
      : `<p class="note">Your listening time and recently played kirtans will show here.</p>`;
    if (recent.length) {
      body += `<div class="group" style="margin-top:14px"><ul class="tracks">${recent.map((h, i) => trackRow(S.byId.get(h.id), i, 'history', { source: true, when: h.at })).join('')}</ul></div>
        <p class="note"><button class="text-btn" data-action="clear-history">Clear history</button></p>`;
    }
  }

  return `<h1 class="page-title">Library</h1>${tabs(tabItems, tab)}${body}${appearance()}`;
}

// One playlist: play or shuffle it, save it offline, rename or delete it. Each
// kirtan's "⋯" menu here can also move it up or down, or take it out.
function playlistView(id) {
  const p = playlistById(id);
  if (!p) return `<h1 class="page-title">Playlist</h1><p class="empty">This playlist isn’t on this device. <a href="#/library/playlists">See your playlists</a></p>`;
  const list = p.ids.map(x => S.byId.get(x)).filter(Boolean);
  const key = `pl:${p.id}`;
  const tracks = trackList(list, key, { source: true, year: true, pl: p.id });
  return `<a class="back" href="#/library/playlists">${icon('left')}Playlists</a>
    <h1 class="page-title">${esc(p.name)}</h1>
    <div class="list-head"><p class="page-sub">${plural(list.length, 'kirtan')}${list.length ? ` · ${fmtHours(sum(list, t => t.duration))}` : ''}</p>${playActions(key)}</div>
    <p class="pl-tools">${saveListButton(key)}<button class="text-btn" data-action="pl-rename" data-pl="${p.id}">Rename</button><button class="text-btn" data-action="pl-delete" data-pl="${p.id}">Delete playlist</button></p>
    ${list.length ? `<div class="group">${tracks}</div>` : `<p class="empty">Nothing here yet. Tap ${icon('more')} next to any kirtan, or in the player, and choose <b>Add to playlist</b>.</p>`}`;
}

// Home page: how to install the site as an app on an iPhone or a laptop, in Safari
// or Chrome. Hidden when it's already open as an installed app.
function installSection() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const steps = list => `<ol>${list.map(x => `<li>${x}</li>`).join('')}</ol>`;
  const share = `<b>Share</b> ${icon('share')}`;
  const quick = S.installEvent
    ? `<p class="install-now"><button class="btn" data-action="install">${icon('download')}Install the app now</button></p>` : '';
  return `<section class="section install">
    <h2>Use it as an app</h2>
    <p class="install-why">Install it once and it opens from its own icon, like any app. Kirtans you save there play with no internet, even on the Underground.</p>
    ${quick}
    <div class="install-grid">
      <div class="install-card">
        <h3>iPhone</h3>
        <h4>Safari</h4>
        ${steps([`Tap ${share} (the square with an arrow). If you can’t see it, tap <b>⋯</b> first.`,
          'Scroll down and tap <b>Add to Home Screen</b>.',
          'Make sure <b>Open as Web App</b> is on, then tap <b>Add</b>.'])}
        <h4>Chrome</h4>
        ${steps([`Tap ${share} at the right of the address bar.`,
          'Tap <b>Add to Home Screen</b>, then <b>Add</b>.'])}
      </div>
      <div class="install-card">
        <h3>Laptop</h3>
        <h4>Chrome (Mac or Windows)</h4>
        ${steps(['Click the install icon at the right end of the address bar (a screen with a small arrow), then <b>Install</b>.',
          'No icon? Click <b>⋮</b> at the top right, then <b>Cast, save and share</b> → <b>Install page as app</b>.'])}
        <h4>Safari (Mac)</h4>
        ${steps(['In the menu bar, click <b>File</b> → <b>Add to Dock</b>.',
          'Click <b>Add</b>. The app is now in your Dock and Applications folder.'])}
      </div>
    </div>
    <p class="install-tip">Then open the app from its new icon and save your kirtans there: things saved in the browser stay in the browser.</p>
  </section>`;
}

function installNote() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  if (S.installEvent) {
    return `<p class="note">Install the app for the most reliable offline listening. <button class="text-btn" data-action="install">Install</button></p>`;
  }
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return `<p class="note">On iPhone, add this site to your Home Screen first so saved kirtans are kept: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>`;
  }
  return '';
}

function notFound() {
  return `<p class="empty">This page doesn’t exist. <a href="#/">Go home</a></p>`;
}

/* ---------------- router ---------------- */

let lastViewKey = null;

// Which "page" a link is on: filters and tabs inside the Kirtans page count as the same page.
function viewKeyFor(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return parts[0] === 'kirtans' ? parts.slice(0, 3).join('/') : parts[0] || '';
}

// Going somewhere new draws the page at once and fades it up (.page-enter);
// filters and tabs inside a page switch instantly, keeping your place.
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [section = '', a, b, c, d] = parts;
  openEmbed = null; // the page is re-rendered, which removes any embedded player
  let html;
  switch (section) {
    case '': html = homeView(); break;
    case 'kirtans': html = kirtansView(a, b, c, d); break;
    case 'japa': html = japaView(a); break;
    case 'search': html = searchView(); break;
    case 'library': html = libraryView(a, b); break;
    case 'play': html = homeView(); break;
    default: html = notFound();
  }
  const navKey = section === 'play' || !section ? 'home' : section;
  for (const link of $$('[data-nav]')) {
    link.toggleAttribute('aria-current', false);
    if (link.dataset.nav === navKey) link.setAttribute('aria-current', 'page');
  }
  const offline = isOnline() ? '' : `<p class="offline-note">You’re offline. Saved recordings still play.</p>`;
  // Changing a filter or tab within the same list keeps your place on the page.
  const viewKey = viewKeyFor(location.hash);
  const enter = viewKey !== lastViewKey && lastViewKey !== null ? ' page-enter' : '';
  view.innerHTML = `<div class="page${enter}">${offline}${html}</div>`;

  if (viewKey !== lastViewKey) window.scrollTo(0, 0);
  lastViewKey = viewKey;
  $('.chips [aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });

  const q = $('#q');
  if (q) {
    q.addEventListener('input', () => {
      S.query = q.value;
      $('#results').innerHTML = searchResults();
    });
    if (matchMedia('(hover: hover)').matches) q.focus();
  }

  // Shared links (#/play/<id>) open that recording in the player, ready to play.
  if (section === 'play' && S.byId.has(a)) {
    S.queue = [a];
    S.qi = 0;
    load(a, { autoplay: false });
    openPlayer();
  }
}

// Re-draw the rows for one track wherever it appears, without re-rendering the page.
function refreshTrack(id) {
  const t = S.byId.get(id);
  if (!t) return;
  for (const li of $$(`.track[data-id="${id}"]`)) {
    li.outerHTML = trackRow(t, Number(li.dataset.i), li.dataset.list, JSON.parse(li.dataset.opts || '{}'));
  }
  for (const btn of $$(`.video[data-track="${id}"] .dl`)) btn.outerHTML = dlButton(t);
  for (const btn of $$('[data-action="save-list"], .text-btn.done')) {
    const list = btn.dataset.list || btn.closest('.group')?.querySelector('.track')?.dataset.list;
    if (list) btn.outerHTML = saveListButton(list);
  }
  if (id === S.current) updatePlayerButtons();
}

/* ---------------- player ---------------- */

function openPlayer() {
  $('#player').hidden = false;
  document.body.style.overflow = 'hidden';
}
// Slides the player down (unless it was already swiped away, or motion is reduced).
function closePlayer({ instant = false } = {}) {
  const player = $('#player');
  if (player.hidden || player.classList.contains('closing')) return;
  const done = () => {
    player.classList.remove('closing');
    player.hidden = true;
    $('.player-inner').style.transform = '';
    document.body.style.overflow = '';
  };
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  player.classList.add('closing');
  setTimeout(done, 260);
}

async function sourceFor(t) {
  if (S.saved.has(t.id) && 'caches' in window) {
    try {
      const res = await (await caches.open(AUDIO_CACHE)).match(t.src);
      if (res) {
        if (S.blobUrl) URL.revokeObjectURL(S.blobUrl);
        S.blobUrl = URL.createObjectURL(await res.blob());
        return S.blobUrl;
      }
    } catch {}
  }
  return t.src;
}

async function load(id, { autoplay = true } = {}) {
  const t = S.byId.get(id);
  if (!t) return;
  if (!isOnline() && !S.saved.has(id)) {
    toast('You’re offline and this one isn’t saved');
    return;
  }
  const prev = S.current;
  S.current = id;
  S.sessionListened = 0;
  S.counted = false;
  store.set('last', id);
  audio.src = await sourceFor(t);
  audio.loop = S.loop;
  audio.defaultPlaybackRate = audio.playbackRate = S.speed;

  const resumeAt = S.positions[id];
  audio.addEventListener('loadedmetadata', () => {
    audio.playbackRate = S.speed;
    if (resumeAt && resumeAt > 10 && resumeAt < (t.duration || audio.duration) - 10) audio.currentTime = resumeAt;
  }, { once: true });

  if (autoplay) audio.play().catch(() => {});
  updateNowPlaying();
  if (prev) refreshTrack(prev);
  refreshTrack(id);
}

function playFrom(listKey, id) {
  const list = S.lists[listKey] || [id];
  S.queue = list.slice();
  S.qi = Math.max(0, S.queue.indexOf(id));
  if (S.current === id && audio.src) return togglePlay();
  load(id);
}

function togglePlay() {
  if (!S.current) return;
  if (audio.paused) {
    if (!audio.src) return load(S.current);
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

function next() {
  if (S.qi < S.queue.length - 1) {
    S.qi++;
    load(S.queue[S.qi]);
  }
}

function prev({ restart = true } = {}) {
  if ((restart && audio.currentTime > 5) || S.qi <= 0) {
    audio.currentTime = 0;
    return;
  }
  S.qi--;
  load(S.queue[S.qi]);
}

/* ---------------- swipe between recordings ---------------- */

// Like Spotify: drag the artwork (or the mini player) left for the next recording
// and right for the previous one. Short or mostly vertical drags spring back.
function swipeable(el) {
  let start = null, dx = 0, sideways = null, swiped = false;
  const canGo = d => (d < 0 ? S.qi < S.queue.length - 1 : S.qi > 0);
  const reset = () => { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; };

  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !S.current) return;
    start = { x: e.clientX, y: e.clientY };
    dx = 0;
    sideways = null;
  });
  el.addEventListener('pointermove', e => {
    if (!start) return;
    dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (sideways === null && Math.hypot(dx, dy) > 10) sideways = Math.abs(dx) > Math.abs(dy) * 1.2;
    if (!sideways) return;
    el.style.transition = 'none';
    // Resist at the ends of the queue, so it's clear there's nothing further.
    el.style.transform = `translateX(${canGo(dx) ? dx : dx / 4}px)`;
  });
  const end = () => {
    if (!start) return;
    start = null;
    if (!sideways) return reset();
    swiped = true;
    if (Math.abs(dx) < Math.min(90, el.offsetWidth / 4) || !canGo(dx)) {
      el.style.transition = 'transform .2s ease-out';
      el.style.transform = '';
      return;
    }
    const dir = dx < 0 ? -1 : 1;
    el.style.transition = 'transform .18s ease-in, opacity .18s ease-in';
    el.style.transform = `translateX(${dir * el.offsetWidth}px)`;
    el.style.opacity = '0';
    setTimeout(() => {
      dir < 0 ? next() : prev({ restart: false });
      // The new recording slides in from the other side.
      el.style.transition = 'none';
      el.style.transform = `translateX(${-dir * 40}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = 'transform .22s ease-out, opacity .22s ease-out';
        el.style.transform = '';
        el.style.opacity = '';
      }));
    }, 180);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // A swipe on the mini player shouldn't also open the full player.
  el.addEventListener('click', e => {
    if (!swiped) return;
    swiped = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  el.addEventListener('pointerdown', () => { swiped = false; }, true);
}
swipeable($('#player-swipe'));
swipeable($('.mini-open'));

function seekBy(sec) {
  if (!S.current) return;
  audio.currentTime = Math.max(0, Math.min((audio.duration || 0) - 1, audio.currentTime + sec));
}

function updateNowPlaying() {
  const t = S.byId.get(S.current);
  if (!t) return;
  $('#mini').hidden = false;
  $('#mini-art').innerHTML = artHTML(t);
  $('#mini-title').textContent = t.title;
  $('#mini-sub').textContent = collectionName(t);
  $('#player-art').innerHTML = artHTML(t);
  $('#player-swipe').style.transform = '';
  $('#player-title').textContent = t.title;
  $('#player-sub').textContent = [collectionName(t), t.year, t.section !== 'japa' && t.place].filter(Boolean).join(' · ');
  $('#player-context').textContent = t.section === 'japa' ? 'Japa' : t.type;

  renderLyricsCard(t);

  updatePlayerButtons();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: collectionName(t),
      album: 'Sacinandana Swami and Gour Krishna Kirtans',
      artwork: [{ src: new URL(artFor(t) || 'icons/icon-512.png', location.href).href, sizes: '512x512' }],
    });
  }
}

/* ---------------- bhajan lyrics ---------------- */

// Mahamantra kirtans need no lyrics. A bhajan listed in lyrics.json gets a card
// naming the song and its author, which opens a panel over the player: the words
// from lyrics.json when it holds them, otherwise the song's kksongs.org page shown
// inside the panel. Other bhajans get a search link.
const lyricsFor = t => (t?.type === 'Bhajans' ? S.lyrics.find(l => l.re.test(t.title)) : null);

function renderLyricsCard(t) {
  const box = $('#player-lyrics');
  box.hidden = t.type !== 'Bhajans';
  if (box.hidden) return;
  const l = lyricsFor(t);
  if (!l) {
    const q = encodeURIComponent(`${t.title.split(' · ')[0]} bhajan lyrics translation`);
    box.innerHTML = `<a class="lyrics-link" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Find lyrics and translation</a>`;
    return;
  }
  const by = [l.author, l.language].filter(Boolean).join(' · ');
  const inner = `<span class="lyrics-text"><span class="lyrics-label">Lyrics and translation</span>
      <span class="lyrics-name">${esc(l.name)}</span><span class="lyrics-by">${esc(by)}</span></span>${icon('right')}`;
  box.innerHTML = `<button class="lyrics-card" data-action="lyrics">${inner}</button>`;
}

function openLyrics() {
  const l = lyricsFor(S.byId.get(S.current));
  if (!l) return;
  const dialog = $('#lyrics-dialog');
  $('#lyrics-name').textContent = l.name;
  $('#lyrics-by').textContent = [l.author, l.language].filter(Boolean).join(' · ');
  const web = !l.verses?.length;
  dialog.classList.toggle('web', web);
  if (web) {
    if (!isOnline()) return toast('Connect to the internet to see the lyrics');
    $('#lyrics-body').innerHTML = `<iframe src="${esc(l.link)}" title="Lyrics and translation of ${esc(l.name)}"></iframe>
      <p class="lyrics-credit">From <a href="${esc(l.link)}" target="_blank" rel="noopener">kksongs.org</a></p>`;
    dialog.showModal();
    return;
  }
  $('#lyrics-body').innerHTML = l.verses.map((v, i) => `<section class="verse">
      <span class="verse-n">${i + 1}</span>
      ${v.text ? `<p class="verse-text">${esc(v.text).replace(/\n/g, '<br>')}</p>` : ''}
      ${v.translation ? `<p class="verse-tr">${esc(v.translation)}</p>` : ''}
    </section>`).join('') + (l.link ? `<p class="lyrics-source"><a href="${esc(l.link)}" target="_blank" rel="noopener">Word-for-word meanings on kksongs.org</a></p>` : '');
  $('#lyrics-dialog').showModal();
}

function updatePlayerButtons() {
  const t = S.byId.get(S.current);
  if (!t) return;
  const fav = $('#player-fav');
  fav.classList.toggle('on', S.favs.has(t.id));
  fav.setAttribute('aria-pressed', S.favs.has(t.id));
  fav.querySelector('span').textContent = S.favs.has(t.id) ? 'Favourited' : 'Favourite';

  const dl = $('#player-dl');
  const d = S.downloads.get(t.id);
  dl.classList.toggle('on', S.saved.has(t.id));
  dl.querySelector('use').setAttribute('href', S.saved.has(t.id) ? '#i-check' : '#i-download');
  dl.querySelector('span').textContent = S.saved.has(t.id) ? 'Saved' : d ? `Saving ${Math.round(d.progress * 100)}%` : 'Save offline';

  const loop = $('#loop-btn');
  loop.classList.toggle('on', S.loop);
  loop.setAttribute('aria-pressed', S.loop);
  loop.querySelector('span').textContent = S.loop ? 'Looping' : 'Loop';

  $('#speed-label').textContent = `${S.speed}× speed`;

  const upNext = $('#up-next');
  const nextTrack = S.byId.get(S.queue[S.qi + 1]);
  upNext.hidden = !nextTrack || S.loop;
  if (nextTrack) $('#up-next-title').textContent = nextTrack.title;
}

function setPlayingClass() {
  const playing = !audio.paused;
  document.body.classList.toggle('is-playing', playing);
  document.body.classList.toggle('is-paused', !playing);
  for (const b of $$('[data-action="toggle"]')) b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function markPlayed(id) {
  if (S.played.has(id)) return;
  S.played.add(id);
  store.set('played', [...S.played]);
  refreshTrack(id);
}

let lastTick = null;
let lastSave = 0;
audio.addEventListener('play', () => { lastTick = performance.now(); setPlayingClass(); closeEmbed(); });
audio.addEventListener('pause', () => { lastTick = null; savePosition(); setPlayingClass(); });
audio.addEventListener('timeupdate', () => {
  const t = S.byId.get(S.current);
  if (!t) return;
  const dur = audio.duration || t.duration || 0;
  const cur = audio.currentTime;

  // Listening stats: count only real playback time, not seeks.
  if (lastTick !== null && !audio.paused) {
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (dt > 0 && dt < 3) {
      S.stats.seconds += dt;
      S.sessionListened += dt;
      if (!S.counted && S.sessionListened >= 30) {
        S.counted = true;
        S.history.unshift({ id: t.id, at: Date.now() });
        S.history.length = Math.min(S.history.length, 300);
        store.set('history', S.history);
      }
    }
  }
  if (dur > 60 && cur / dur > 0.95) markPlayed(t.id);
  if (Date.now() - lastSave > 5000) savePosition();

  const pct = dur ? (cur / dur) * 100 : 0;
  $('#mini-bar').style.width = `${pct}%`;
  if (!scrubbing) showPosition(cur, dur);
  if ('mediaSession' in navigator && dur && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(cur, dur), playbackRate: audio.playbackRate }); } catch {}
  }
});
audio.addEventListener('ended', () => {
  markPlayed(S.current);
  delete S.positions[S.current];
  store.set('positions', S.positions);
  refreshTrack(S.current);
  if (S.sleep?.end) {
    setSleep('off');
    return;
  }
  next();
});
audio.addEventListener('error', () => {
  if (S.current) toast(isOnline() || S.saved.has(S.current) ? 'Couldn’t play this recording' : 'You’re offline and this one isn’t saved');
});

function savePosition() {
  lastSave = Date.now();
  store.set('stats', S.stats);
  const t = S.byId.get(S.current);
  if (!t || !audio.currentTime) return;
  const dur = audio.duration || t.duration;
  if (audio.currentTime > 10 && audio.currentTime < dur - 20) S.positions[t.id] = Math.floor(audio.currentTime);
  else delete S.positions[t.id];
  store.set('positions', S.positions);
}

// The progress bar, like Spotify's: tap anywhere on it to jump there, or press
// and drag. The bar thickens and the times follow your finger; the recording
// only moves when you let go. The touch area is much taller than the line.
let scrubbing = false;
let scrubTo = 0;
const scrub = $('#scrub');
const scrubDur = () => audio.duration || S.byId.get(S.current)?.duration || 0;
function showPosition(cur, dur) {
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  scrub.style.setProperty('--pct', `${pct}%`);
  scrub.setAttribute('aria-valuemax', Math.floor(dur));
  scrub.setAttribute('aria-valuenow', Math.floor(cur));
  scrub.setAttribute('aria-valuetext', `${fmtClock(cur)} of ${fmtClock(dur)}`);
  $('#t-cur').textContent = fmtClock(cur);
  $('#t-left').textContent = `-${fmtClock(dur - cur)}`;
}
function scrubAt(e) {
  const r = scrub.getBoundingClientRect();
  scrubTo = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * scrubDur();
  showPosition(scrubTo, scrubDur());
}
scrub.addEventListener('pointerdown', e => {
  if (!S.current || !scrubDur()) return;
  scrubbing = true;
  try { scrub.setPointerCapture(e.pointerId); } catch {} // keep following the finger off the bar
  scrub.classList.add('dragging');
  scrubAt(e);
});
scrub.addEventListener('pointermove', e => { if (scrubbing) scrubAt(e); });
scrub.addEventListener('pointerup', e => {
  if (!scrubbing) return;
  scrubAt(e);
  audio.currentTime = scrubTo;
  scrubbing = false;
  scrub.classList.remove('dragging');
});
scrub.addEventListener('pointercancel', () => {
  scrubbing = false;
  scrub.classList.remove('dragging');
  showPosition(audio.currentTime, scrubDur());
});

// Swipe down on the top of the player to close it, like Spotify.
(function swipeDownToClose() {
  const head = $('#player-head');
  const sheet = $('.player-inner');
  let y0 = null, dy = 0;
  head.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || e.target.closest('button')) return;
    y0 = e.clientY;
    dy = 0;
    try { head.setPointerCapture(e.pointerId); } catch {}
    sheet.style.transition = 'none';
  });
  head.addEventListener('pointermove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    sheet.style.transition = 'transform .2s ease-out';
    if (dy <= 110) sheet.style.transform = '';
    if (dy > 110) {
      // Carry on down from where the finger left it, then close.
      sheet.style.transition = 'transform .2s ease-in';
      sheet.style.transform = 'translateY(100%)';
      setTimeout(() => closePlayer({ instant: true }), 200);
    }
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
})();

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    previoustrack: prev,
    nexttrack: next,
    seekbackward: () => seekBy(-15),
    seekforward: () => seekBy(30),
    seekto: e => { audio.currentTime = e.seekTime; },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { ms.setActionHandler(action, fn); } catch {}
  }
}

async function shareTrack(id = S.current) {
  const t = S.byId.get(id);
  if (!t) return;
  const url = `${location.origin}${location.pathname}#/play/${t.id}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: t.title, text: `${t.title} · ${collectionName(t)}`, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    toast('Couldn’t copy the link on this device');
  }
}

/* ---------------- favourites, playlists and the queue ---------------- */

function toggleFav(id) {
  const on = !S.favs.has(id);
  on ? S.favs.add(id) : S.favs.delete(id);
  store.set('favs', [...S.favs]);
  if (id === S.current) updatePlayerButtons();
  toast(on ? 'Added to Favourites' : 'Removed from Favourites');
  if (location.hash.startsWith('#/library/favourites') || location.hash === '#/library') route();
}

const playlistById = id => S.playlists.find(p => p.id === id);
function savePlaylists() { store.set('playlists', S.playlists); }
function newPlaylist(name) {
  const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ids: [] };
  S.playlists.push(p);
  savePlaylists();
  return p;
}
function addToPlaylist(p, id) {
  if (!p.ids.includes(id)) p.ids.push(id);
  savePlaylists();
  toast(`Added to ${p.name}`);
  if (location.hash.startsWith('#/library/playlists')) route();
}
function removeFromPlaylist(p, id) {
  if (!p) return;
  p.ids = p.ids.filter(x => x !== id);
  savePlaylists();
  toast(`Removed from ${p.name}`);
  if (location.hash.startsWith('#/library/playlists')) route();
}
function movePlaylistItem(p, id, dir) {
  const i = p ? p.ids.indexOf(id) : -1;
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.ids.length) return;
  [p.ids[i], p.ids[j]] = [p.ids[j], p.ids[i]];
  savePlaylists();
  route();
}

// In-page prompt for a playlist name; resolves to the trimmed name, or null.
function askName(title, value, save) {
  const dlg = $('#name-dialog');
  const input = $('#name-input');
  $('#name-title').textContent = title;
  $('#name-save').textContent = save;
  input.value = value;
  input.placeholder = 'For example: Morning japa';
  dlg.returnValue = '';
  dlg.showModal();
  input.focus();
  return new Promise(resolve => dlg.addEventListener('close', () =>
    resolve(dlg.returnValue === 'save' && input.value.trim() ? input.value.trim().slice(0, 60) : null), { once: true }));
}

// The "⋯" menu for a kirtan, like Spotify's. Inside a playlist it can also move
// the kirtan or take it out of that playlist.
function openTrackMenu(id, row) {
  const t = S.byId.get(id);
  if (!t) return;
  const pl = row ? JSON.parse(row.dataset.opts || '{}').pl : null;
  const p = pl && playlistById(pl);
  const item = (action, ic, label, extra = '') => `<button value="${action}" data-action="${action}" data-id="${t.id}" ${extra}>${icon(ic)}<span>${label}</span></button>`;
  const i = p ? p.ids.indexOf(id) : -1;
  $('#track-menu').innerHTML = `<h3 class="menu-title">${esc(t.title)}<small>${esc(collectionName(t))}</small></h3>
    ${S.current && S.current !== id ? item('play-next', 'next', 'Play next') + item('add-queue', 'queue', 'Add to queue') : ''}
    ${item('add-to-playlist', 'playlist', 'Add to playlist')}
    ${item('toggle-fav', 'heart', S.favs.has(id) ? 'Remove from Favourites' : 'Add to Favourites')}
    ${'caches' in window ? item('download', S.saved.has(id) ? 'check' : 'download', S.saved.has(id) ? 'Remove offline copy' : 'Save offline') : ''}
    ${p && i > 0 ? item('pl-move', 'up', 'Move up', `data-pl="${p.id}" data-dir="-1"`) : ''}
    ${p && i < p.ids.length - 1 ? item('pl-move', 'down', 'Move down', `data-pl="${p.id}" data-dir="1"`) : ''}
    ${p ? item('pl-remove', 'x', `Remove from ${esc(p.name)}`, `data-pl="${p.id}"`) : ''}
    ${item('share-track', 'share', 'Share')}
    <button value="cancel" class="muted">Cancel</button>`;
  $('#track-dialog').showModal();
}

function openPlaylistPicker(id) {
  const t = S.byId.get(id);
  if (!t) return;
  $('#playlist-menu').innerHTML = `<h3 class="menu-title">Add to playlist<small>${esc(t.title)}</small></h3>
    <button value="new" data-action="pl-create-add" data-id="${id}">${icon('plus')}<span>New playlist</span></button>
    ${S.playlists.map(p => `<button value="pl" data-action="pl-toggle" data-pl="${p.id}" data-id="${id}" class="${p.ids.includes(id) ? 'in' : ''}">
      ${icon(p.ids.includes(id) ? 'check' : 'playlist')}<span>${esc(p.name)}</span><small>${p.ids.length}</small></button>`).join('')}
    <button value="cancel" class="muted">Cancel</button>`;
  $('#playlist-dialog').showModal();
}

// Play next: straight after the current recording. Add to queue: at the end.
function playNext(id) {
  if (!S.current) return playOnly(id);
  S.queue.splice(S.qi + 1, 0, id);
  updatePlayerButtons();
  toast('Plays next');
}
function addToQueue(id) {
  if (!S.current) return playOnly(id);
  S.queue.push(id);
  updatePlayerButtons();
  toast('Added to the queue');
}
function playOnly(id) {
  S.queue = [id];
  S.qi = 0;
  load(id);
}
function jumpTo(qi) {
  if (!S.queue[qi]) return;
  S.qi = qi;
  load(S.queue[qi]);
  renderQueue();
}
function removeFromQueue(qi) {
  if (qi <= S.qi) return;
  S.queue.splice(qi, 1);
  renderQueue();
  updatePlayerButtons();
}

function openQueue() {
  renderQueue();
  $('#queue-dialog').showModal();
}
function renderQueue() {
  const now = S.byId.get(S.current);
  const upcoming = S.queue.map((id, qi) => ({ t: S.byId.get(id), qi })).filter(x => x.t && x.qi > S.qi);
  $('#queue-sub').textContent = upcoming.length ? `${plural(upcoming.length, 'kirtan')} up next · ${fmtHours(sum(upcoming, x => x.t.duration))}` : 'Nothing else queued';
  const row = ({ t, qi }) => `<li class="track queue-row">
      <button class="track-main" data-action="queue-jump" data-qi="${qi}">
        <span class="track-text"><span class="track-title">${esc(t.title)}</span><span class="track-meta">${esc(collectionName(t))} · ${fmtDur(t.duration)}</span></span>
      </button>
      <button class="icon-btn" data-action="queue-remove" data-qi="${qi}" aria-label="Remove from the queue">${icon('x')}</button>
    </li>`;
  $('#queue-body').innerHTML = (now ? `<h4 class="queue-head">Now playing</h4><ul class="tracks"><li class="track playing"><span class="track-main"><span class="track-text">
      <span class="track-title">${esc(now.title)}</span><span class="track-meta">${esc(collectionName(now))}</span></span></span></li></ul>` : '')
    + (upcoming.length ? `<h4 class="queue-head">Next</h4><ul class="tracks">${upcoming.map(row).join('')}</ul>`
      : `<p class="empty">When this one ends, playback stops. Tap ${icon('more')} next to any kirtan and choose <b>Play next</b> or <b>Add to queue</b>.</p>`);
}

/* ---------------- sleep timer ---------------- */

function setSleep(value) {
  if (value === 'off' || !value) S.sleep = null;
  else if (value === 'end') S.sleep = { end: true };
  else S.sleep = { until: Date.now() + Number(value) * 60000 };
  updateSleepLabel();
}

function updateSleepLabel() {
  const btn = $('#sleep-btn');
  const label = $('#sleep-label');
  btn.classList.toggle('on', !!S.sleep);
  if (!S.sleep) label.textContent = 'Sleep timer';
  else if (S.sleep.end) label.textContent = 'End of track';
  else label.textContent = `${fmtClock((S.sleep.until - Date.now()) / 1000)} left`;
}

setInterval(() => {
  if (!S.sleep?.until) return;
  if (Date.now() >= S.sleep.until) {
    fadeOutAndPause();
    setSleep('off');
  } else {
    updateSleepLabel();
  }
}, 1000);

function fadeOutAndPause() {
  const start = audio.volume;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    audio.volume = Math.max(0, start * (1 - step / 20));
    if (step >= 20) {
      clearInterval(timer);
      audio.pause();
      audio.volume = start;
    }
  }, 300);
}

/* ---------------- offline saving ---------------- */

async function askPersistence() {
  try { await navigator.storage?.persist?.(); } catch {}
}

function queueDownload(id) {
  if (S.saved.has(id) || S.downloads.has(id)) return;
  S.downloads.set(id, { progress: 0 });
  S.dlQueue.push(id);
  refreshTrack(id);
  pumpDownloads();
}

let pumping = false;
async function pumpDownloads() {
  if (pumping) return;
  pumping = true;
  askPersistence();
  while (S.dlQueue.length) {
    const id = S.dlQueue.shift();
    if (!S.downloads.has(id)) continue;
    try {
      await download(id);
    } catch (err) {
      S.downloads.delete(id);
      refreshTrack(id);
      if (err.name !== 'AbortError') {
        toast(err.name === 'QuotaExceededError' ? 'Not enough space on this device' : 'Couldn’t save. Check your connection.');
        if (err.name === 'QuotaExceededError') {
          for (const rest of S.dlQueue.splice(0)) { S.downloads.delete(rest); refreshTrack(rest); }
        }
      }
    }
  }
  pumping = false;
}

async function download(id) {
  const t = S.byId.get(id);
  const ctrl = new AbortController();
  S.downloads.get(id).ctrl = ctrl;
  const res = await fetch(t.src, { signal: ctrl.signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || t.size || 1;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0, lastPaint = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const d = S.downloads.get(id);
    if (!d) throw new DOMException('cancelled', 'AbortError');
    d.progress = Math.min(1, received / total);
    if (performance.now() - lastPaint > 250) {
      lastPaint = performance.now();
      refreshTrack(id);
    }
  }
  const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
  const cache = await caches.open(AUDIO_CACHE);
  await cache.put(t.src, new Response(blob, { headers: { 'Content-Type': blob.type, 'Content-Length': String(blob.size) } }));
  S.saved.add(id);
  S.downloads.delete(id);
  refreshTrack(id);
}

async function removeDownload(id) {
  const t = S.byId.get(id);
  await (await caches.open(AUDIO_CACHE)).delete(t.src);
  S.saved.delete(id);
  refreshTrack(id);
}

async function onDownloadTap(id) {
  if (!('caches' in window)) return toast('Offline saving needs the https version of the site');
  const t = S.byId.get(id);
  const d = S.downloads.get(id);
  if (d) {
    d.ctrl?.abort();
    S.downloads.delete(id);
    S.dlQueue = S.dlQueue.filter(x => x !== id);
    refreshTrack(id);
  } else if (S.saved.has(id)) {
    if (await ask(`Remove “${t.title}” from this device?`, 'Remove')) removeDownload(id);
  } else if (!isOnline()) {
    toast('Connect to the internet to save');
  } else {
    queueDownload(id);
  }
}

/* ---------------- events ---------------- */

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, list } = el.dataset;
  switch (action) {
    case 'play': playFrom(list, id); break;
    case 'resume': S.queue = [id]; S.qi = 0; load(id); break;
    case 'play-list': {
      const ids = S.lists[list] || [];
      if (ids.length) { S.queue = ids.slice(); S.qi = 0; load(ids[0]); }
      break;
    }
    case 'shuffle': {
      const ids = (S.lists[list] || []).slice();
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      if (ids.length) { S.queue = ids; S.qi = 0; load(ids[0]); }
      break;
    }
    case 'embed': playEmbed(el.dataset.vid); break;
    case 'video': openVideo(el.dataset.vid); break;
    case 'toggle': togglePlay(); break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'back15': seekBy(-15); break;
    case 'fwd30': seekBy(30); break;
    case 'open-player': openPlayer(); break;
    case 'close-player': closePlayer(); break;
    case 'download': onDownloadTap(id); break;
    case 'download-current': if (S.current) onDownloadTap(S.current); break;
    case 'save-list': {
      if (!isOnline()) return toast('Connect to the internet to save');
      const ids = (S.lists[list] || []).filter(x => !S.saved.has(x));
      ids.forEach(queueDownload);
      const mb = sum(ids, x => S.byId.get(x).size);
      toast(`Saving ${plural(ids.length, 'recording')} (${fmtMB(mb)})`);
      break;
    }
    case 'fav-current': if (S.current) toggleFav(S.current); break;
    case 'loop': {
      S.loop = !S.loop;
      audio.loop = S.loop;
      store.set('loop', S.loop);
      updatePlayerButtons();
      toast(S.loop ? 'This recording will repeat' : 'Loop off');
      break;
    }
    case 'speed': {
      S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
      audio.defaultPlaybackRate = audio.playbackRate = S.speed;
      store.set('speed', S.speed);
      updatePlayerButtons();
      break;
    }
    case 'share': shareTrack(); break;
    case 'theme': setTheme(el.dataset.theme); break;
    case 'theme-toggle': setTheme(isDark() ? 'light' : 'dark'); break;
    case 'share-track': shareTrack(id); break;
    case 'track-menu': openTrackMenu(el.dataset.current ? S.current : id, el.closest('.track')); break;
    case 'play-next': playNext(id); break;
    case 'add-queue': addToQueue(id); break;
    case 'add-to-playlist': setTimeout(() => openPlaylistPicker(id)); break;
    case 'toggle-fav': toggleFav(id); break;
    case 'queue': openQueue(); break;
    case 'queue-jump': jumpTo(Number(el.dataset.qi)); break;
    case 'queue-remove': removeFromQueue(Number(el.dataset.qi)); break;
    case 'pl-new': {
      const name = await askName('New playlist', '', 'Create');
      if (name) { const p = newPlaylist(name); location.hash = `#/library/playlists/${p.id}`; }
      break;
    }
    case 'pl-create-add': {
      const name = await askName('New playlist', '', 'Create');
      if (name) addToPlaylist(newPlaylist(name), id);
      break;
    }
    case 'pl-toggle': {
      const p = playlistById(el.dataset.pl);
      if (p?.ids.includes(id)) removeFromPlaylist(p, id); else if (p) addToPlaylist(p, id);
      break;
    }
    case 'pl-remove': removeFromPlaylist(playlistById(el.dataset.pl), id); break;
    case 'pl-move': movePlaylistItem(playlistById(el.dataset.pl), id, Number(el.dataset.dir)); break;
    case 'pl-rename': {
      const p = playlistById(el.dataset.pl);
      const name = p && await askName('Rename playlist', p.name, 'Save');
      if (name) { p.name = name; savePlaylists(); route(); }
      break;
    }
    case 'pl-delete': {
      const p = playlistById(el.dataset.pl);
      if (!p || !(await ask(`Delete the playlist “${p.name}”? The kirtans stay in the app.`, 'Delete'))) return;
      S.playlists = S.playlists.filter(x => x !== p);
      savePlaylists();
      location.hash = '#/library/playlists';
      break;
    }
    case 'lyrics': openLyrics(); break;
    case 'sleep-menu': $('#sleep-dialog').showModal(); break;
    case 'suggest': {
      S.query = el.dataset.q;
      $('#q').value = S.query;
      $('#results').innerHTML = searchResults();
      break;
    }
    case 'remove-all': {
      if (!(await ask('Remove all saved recordings from this device?', 'Remove all'))) return;
      await caches.delete(AUDIO_CACHE);
      S.saved.clear();
      route();
      break;
    }
    case 'clear-history': {
      if (!(await ask('Clear your listening history?', 'Clear history'))) return;
      S.history = [];
      S.stats = { seconds: 0, since: Date.now() };
      store.set('history', S.history);
      store.set('stats', S.stats);
      route();
      break;
    }
    case 'install': S.installEvent?.prompt(); S.installEvent = null; break;
  }
});

$('#lyrics-dialog').addEventListener('close', () => { $('#lyrics-body').innerHTML = ''; });

$('#sleep-dialog').addEventListener('close', e => {
  const v = e.target.returnValue;
  if (v) setSleep(v);
  e.target.returnValue = '';
});

// Desktop shortcuts: space play/pause, arrows skip, "/" search, Esc closes the player.
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && S.current) { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft' && S.current) seekBy(-15);
  else if (e.key === 'ArrowRight' && S.current) seekBy(30);
  else if (e.key === '/') { e.preventDefault(); location.hash = '#/search'; }
  else if (e.key === 'Escape' && !$('#player').hidden) closePlayer();
});

function onConnectivity() {
  $('.offline-pill').hidden = isOnline();
  route();
}
window.addEventListener('online', onConnectivity);
window.addEventListener('offline', onConnectivity);
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', savePosition);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvent = e; });

/* ---------------- start ---------------- */

(async function start() {
  await loadData();
  $('.offline-pill').hidden = isOnline();

  // Show the last recording in the mini player, ready to resume.
  const last = store.get('last');
  if (S.byId.has(last) && !location.hash.startsWith('#/play/')) {
    S.current = last;
    S.queue = [last];
    S.qi = 0;
    updateNowPlaying();
  }
  route();
  setPlayingClass();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
