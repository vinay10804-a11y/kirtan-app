// Sacinandana Swami and Gour Krishna Kirtans: a small offline-capable audio app.
// No framework: hash routes render HTML strings into #view, and one delegated
// click handler drives everything through data-action attributes.

import { mergeLibrary } from './library.js';

const AUDIO_CACHE = 'kirtan-audio';
// Cover pictures of saved and recently played kirtans, so they show offline too.
const ART_CACHE = 'kirtan-art';
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
  playlists: store.get('playlists', []), // [{ id, name, ids: [track ids], created, at }]
  // For merging with an account: when each favourite last changed, and deleted playlists.
  favAt: store.get('favAt', {}),
  posAt: store.get('posAt', {}), // when each listening position last changed, for merging
  lastAt: store.get('lastAt', 0),
  plDeleted: store.get('plDeleted', {}),
  user: store.get('user', null), // { email, name } when signed in
  played: new Set(store.get('played', [])),
  positions: store.get('positions', {}),
  history: store.get('history', []),
  stats: store.get('stats', { seconds: 0, since: Date.now() }),
  speed: store.get('speed', 1),
  // What happens when a kirtan ends: 'off' (play the next one), 'one' (loop it),
  // 'once' (stop) or 'all' (play on, and start the list again at the end).
  repeat: store.get('repeat', store.get('loop', false) ? 'one' : 'off'),
  // Shuffle: the rest of the queue plays in a random order; `order` is the list's own
  // order, to go back to when shuffle is turned off.
  shuffle: store.get('shuffle', false),
  order: null,
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
// A picture that can't load (e.g. offline and never stored) becomes the plain
// initials tile instead of a broken image; see the 'error' listener below.
function artHTML(t) {
  const label = t.section === 'japa' ? 'Japa' : initialsFor(t.artist);
  const src = artFor(t);
  return src ? `<img src="${esc(src)}" alt="" data-fallback="${esc(label)}">` : tile(label);
}
function collectionArt(name) {
  const src = personPhoto(name);
  return src ? `<img src="${esc(src)}" alt="" data-fallback="${esc(initialsFor(name))}">` : tile(initialsFor(name));
}
document.addEventListener('error', e => {
  if (e.target.matches?.('img[data-fallback]')) e.target.outerHTML = tile(e.target.dataset.fallback);
  else if (e.target.matches?.('img[data-bg]')) e.target.remove();
}, true);

// Keeps a kirtan's cover picture on the device (no-op offline or if already kept).
async function keepArt(t) {
  const src = t && artFor(t);
  if (!src || !('caches' in window) || !isOnline()) return;
  try {
    const cache = await caches.open(ART_CACHE);
    if (!(await cache.match(src))) await cache.add(src);
  } catch {}
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
  return dialogAnswer(dlg, value => value === 'yes');
}

// Resolves with a dialog's answer as soon as a button is tapped (its form's
// submit), or when it's dismissed (Esc / back). Doesn't wait for the "close"
// event, which browsers can hold back while a page isn't being drawn.
function dialogAnswer(dlg, read) {
  const form = dlg.querySelector('form');
  return new Promise(resolve => {
    const done = value => {
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('close', onClose);
      resolve(read(value));
    };
    const onSubmit = e => done(e.submitter?.value ?? '');
    const onClose = () => done(dlg.returnValue);
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', onClose);
  });
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
  // Kirtans set to "Show in app: No" in the owner's sheet stay out of the app.
  S.tracks = (catalog.tracks || []).filter(t => !t.hidden);
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
    // Kirtans saved before covers were kept with them get their covers now.
    for (const id of S.saved) keepArt(S.byId.get(id));
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
  return `<li class="track${current ? ' playing' : ''}${off ? ' off' : ''}"${current ? ' aria-current="true"' : ''} data-id="${t.id}" data-i="${i}" data-list="${listKey}" data-opts='${JSON.stringify(opts)}'>
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
    <button class="install-cta" data-action="show-install">
      <span class="install-cta-icon">${icon('download')}</span>
      <span class="install-cta-text">${isInstalled()
        ? '<b>Install on another device</b><small>Steps for iPhone and laptop, in Safari or Chrome</small>'
        : '<b>Install the app</b><small>On your iPhone or laptop: opens from its own icon and works offline</small>'}</span>
      ${icon('right')}
    </button>
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
        <li><b>Install it as an app:</b> <button class="text-btn" data-action="show-install">see the steps for iPhone and laptop</button>.</li>
        <li><b>Play:</b> tap any kirtan. It keeps playing while you browse and when your phone is locked.</li>
        <li><b>Offline:</b> tap ${icon('download')} next to a kirtan, or <b>Save all offline</b> on a year or place. Saved kirtans play without internet.</li>
        <li><b>Chanting japa:</b> open the player, tap <b>Play next</b> and choose <b>Loop this kirtan</b>, so one kirtan plays again and again while you chant your rounds. <b>Play once</b> stops when the kirtan ends.</li>
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

// Searches you've made, newest first, so you can repeat one with a tap.
function rememberSearch(q) {
  q = q.trim();
  if (q.length < 2) return;
  const recent = store.get('searches', []).filter(x => norm(x) !== norm(q));
  store.set('searches', [q, ...recent].slice(0, 8));
}

function searchResults() {
  const q = norm(S.query.trim());
  if (!q) {
    const sugg = searchSuggestions();
    if (!S.tracks.length && !S.videos.length) return emptyCatalog();
    const recent = store.get('searches', []);
    const chips = list => `<div class="chips wrap">${list.map(s => `<button class="chip" data-action="suggest" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    return (recent.length ? `<div class="suggest"><h2>Recent searches <button class="text-btn" data-action="clear-searches">Clear</button></h2>${chips(recent)}</div>` : '')
      + (sugg.length ? `<div class="suggest"><h2>Try</h2>${chips(sugg)}</div>` : '');
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
    // Newest first, like Spotify's Liked Songs.
    const list = [...S.favs].sort((a, b) => (S.favAt[b] || 0) - (S.favAt[a] || 0)).map(id => S.byId.get(id)).filter(Boolean);
    body = list.length ? `<div class="group">${trackList(list, 'favs', { source: true, year: true })}</div>`
      : `<p class="empty">Tap <b>Favourite</b> in the player to keep a kirtan here.</p>`;
  }

  if (tab === 'playlists' && sub) return playlistView(sub);
  if (tab === 'playlists') {
    const rows = S.playlists.map(p => {
      const list = playlistTracks(p);
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
        <p class="note" id="storage-note"></p>
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

  return `<h1 class="page-title">Library</h1>${accountCard()}${tabs(tabItems, tab)}${body}${appearance()}`;
}

// One playlist: its cover, Play / Shuffle, Add kirtans (search and tick them),
// Edit (move up or down, remove, all on the page), save offline, rename, delete.
function playlistView(id) {
  const p = playlistById(id);
  if (!p) return `<h1 class="page-title">Playlist</h1><p class="empty">This playlist isn’t on this device. <a href="#/library/playlists">See your playlists</a></p>`;
  const list = playlistTracks(p);
  const key = `pl:${p.id}`;
  const editing = S.plEdit === p.id && list.length > 0;
  const rows = editing
    ? `<ul class="tracks pl-edit">${list.map((t, i) => `<li class="track">
        <span class="track-main"><span class="track-num">${i + 1}</span><span class="track-text"><span class="track-title">${esc(t.title)}</span><span class="track-meta">${esc(t.artist)}${t.year ? ` · ${t.year}` : ''}</span></span></span>
        <button class="icon-btn" data-action="pl-move" data-pl="${p.id}" data-id="${t.id}" data-dir="-1" aria-label="Move up" ${i ? '' : 'disabled'}>${icon('up')}</button>
        <button class="icon-btn" data-action="pl-move" data-pl="${p.id}" data-id="${t.id}" data-dir="1" aria-label="Move down" ${i < list.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
        <button class="icon-btn" data-action="pl-remove" data-pl="${p.id}" data-id="${t.id}" aria-label="Remove from playlist">${icon('x')}</button>
      </li>`).join('')}</ul>`
    : trackList(list, key, { source: true, year: true, pl: p.id });
  if (editing) S.lists[key] = list.map(t => t.id);
  return `<a class="back" href="#/library/playlists">${icon('left')}Playlists</a>
    <div class="pl-header">
      <span class="pl-cover">${list[0] ? artHTML(list[0]) : `<span class="tile" aria-hidden="true">${icon('playlist')}</span>`}</span>
      <div><h1 class="page-title">${esc(p.name)}</h1>
        <p class="page-sub">${plural(list.length, 'kirtan')}${list.length ? ` · ${fmtHours(sum(list, t => t.duration))}` : ''}</p></div>
    </div>
    <div class="actions">${list.length ? `<button class="btn" data-action="play-list" data-list="${key}">${icon('play')}Play</button>
      <button class="btn ghost" data-action="shuffle" data-list="${key}">${icon('shuffle')}Shuffle</button>` : ''}
      <button class="btn ghost" data-action="pl-add" data-pl="${p.id}">${icon('plus')}Add kirtans</button></div>
    <p class="pl-tools">${list.length ? `<button class="text-btn" data-action="pl-edit" data-pl="${p.id}">${editing ? 'Done editing' : 'Edit order'}</button>` : ''}${saveListButton(key)}<button class="text-btn" data-action="pl-rename" data-pl="${p.id}">Rename</button><button class="text-btn danger" data-action="pl-delete" data-pl="${p.id}">Delete playlist</button></p>
    ${list.length ? `<div class="group">${rows}</div>`
      : `<p class="empty">Nothing here yet. Tap <b>Add kirtans</b> to choose some, or tap ${icon('more')} next to any kirtan and choose <b>Add to playlist</b>.</p>`}`;
}

const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Home page: how to install the site as an app on an iPhone or a laptop, in Safari
// or Chrome. The "Install the app" button near the top of Home scrolls here.
// Inside the installed app it stays, for installing on another device.
function installSection() {
  const steps = list => `<ol>${list.map(x => `<li>${x}</li>`).join('')}</ol>`;
  const share = `<b>Share</b> ${icon('share')}`;
  const quick = S.installEvent
    ? `<p class="install-now"><button class="btn" data-action="install">${icon('download')}Install the app now</button></p>` : '';
  const why = isInstalled()
    ? 'You’re already using the app. To install it on another phone or computer, open this site there and follow these steps.'
    : 'Install it once and it opens from its own icon, like any app. Kirtans you save there play with no internet, even on the Underground.';
  return `<section class="section install" id="install">
    <h2>Use it as an app</h2>
    <p class="install-why">${why}</p>
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
  if ($('#storage-note')) showStorage();
  lastViewKey = viewKey;
  $('.chips [aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });

  const q = $('#q');
  if (q) {
    let remember;
    q.addEventListener('input', () => {
      S.query = q.value;
      $('#results').innerHTML = searchResults();
      // A search counts as made once you stop typing for a moment.
      clearTimeout(remember);
      remember = setTimeout(() => rememberSearch(q.value), 1500);
    });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { rememberSearch(q.value); q.blur(); } });
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

// How much room is left for saving kirtans on this device (Saved offline tab).
async function showStorage() {
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const note = $('#storage-note');
    if (note && quota) note.textContent = `Room for about ${fmtMB(Math.max(0, quota - usage))} more on this device.`;
  } catch {}
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

// The player is a step in the browser's history, so the phone's back button (or
// back gesture) closes it, as in Spotify, instead of leaving the page.
function openPlayer() {
  if (!$('#player').hidden) return;
  $('#player').hidden = false;
  document.body.style.overflow = 'hidden';
  if (!history.state?.player) history.pushState({ player: true }, '');
}
window.addEventListener('popstate', () => {
  if (!$('#player').hidden) closePlayer({ fromHistory: true });
});
// Slides the player down (unless it was already swiped away, or motion is reduced).
function closePlayer({ instant = false, fromHistory = false } = {}) {
  const player = $('#player');
  if (player.hidden || player.classList.contains('closing')) return;
  if (!fromHistory && history.state?.player) history.back(); // take the player's step back out of history
  const done = () => {
    player.classList.remove('closing');
    player.hidden = true;
    player.style.transition = '';
    player.style.transform = '';
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

// Only the latest load counts: skipping quickly through recordings (or swiping)
// must never leave an earlier one playing, or start one at another's position.
let loadSeq = 0;
async function load(id, { autoplay = true, at } = {}) {
  const t = S.byId.get(id);
  if (!t) return;
  if (!playable(id)) {
    toast('You’re offline and this one isn’t saved');
    return;
  }
  const seq = ++loadSeq;
  const prev = S.current;
  S.current = id;
  S.sessionListened = 0;
  S.counted = false;
  recovery.tries = 0;
  store.set('last', id);
  S.lastAt = Date.now();
  store.set('lastAt', S.lastAt);
  saveQueue();
  updateNowPlaying();
  if (prev && prev !== id) refreshTrack(prev);
  refreshTrack(id);
  const src = await sourceFor(t);
  if (seq !== loadSeq) return; // a newer load started meanwhile
  setBuffering(autoplay);
  audio.src = src;
  audio.loop = S.repeat === 'one';
  audio.defaultPlaybackRate = audio.playbackRate = S.speed;

  const resumeAt = at ?? S.positions[id];
  audio.addEventListener('loadedmetadata', () => {
    if (seq !== loadSeq) return;
    audio.playbackRate = S.speed;
    if (resumeAt && resumeAt > 10 && resumeAt < (t.duration || audio.duration) - 10) audio.currentTime = resumeAt;
  }, { once: true });

  if (autoplay) audio.play().catch(() => setBuffering(false));
  keepArt(t);
}

// Offline, only recordings saved on this device can play.
const playable = id => S.saved.has(id) || isOnline();

// The queue and where you are in it survive closing the app, like Spotify.
function saveQueue() {
  store.set('queue', { ids: S.queue.slice(0, 500), qi: S.qi, order: S.order?.slice(0, 500) || null });
}

function shuffled(ids) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Plays a list from one of its kirtans (or from the start), shuffled if Shuffle is on.
function startList(ids, id = ids[0]) {
  if (S.shuffle) {
    S.order = ids.slice();
    S.queue = [id, ...shuffled(ids.filter(x => x !== id))];
    S.qi = 0;
  } else {
    S.order = null;
    S.queue = ids.slice();
    S.qi = Math.max(0, S.queue.indexOf(id));
  }
  saveQueue();
}

function setShuffle(on) {
  S.shuffle = on;
  store.set('shuffle', on);
  if (on) {
    S.order = S.queue.slice();
    S.queue = [S.queue[S.qi], ...shuffled(S.queue.filter((_, i) => i !== S.qi))].filter(Boolean);
    S.qi = 0;
  } else if (S.order?.includes(S.current)) {
    // Back to the list's order; kirtans added to the queue meanwhile stay up next.
    const added = S.queue.filter(id => !S.order.includes(id));
    S.queue = S.order;
    S.qi = S.queue.indexOf(S.current);
    S.queue.splice(S.qi + 1, 0, ...added);
  }
  if (!on) S.order = null;
  saveQueue();
  updatePlayerButtons();
  if ($('#queue-dialog').open) renderQueue();
  toast(on ? 'Shuffle on' : 'Shuffle off');
}

// A spinner on the play buttons while a recording is loading or buffering.
function setBuffering(on) {
  document.body.classList.toggle('is-buffering', !!on);
}

function playFrom(listKey, id) {
  if (S.current === id && audio.src) return togglePlay();
  startList(S.lists[listKey] || [id], id);
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

// The next (or previous) recording that can play: offline, ones that aren't saved
// are skipped. With Repeat all, the end of the list wraps to the start.
function stepIndex(dir) {
  const n = S.queue.length;
  for (let k = 1; k <= n; k++) {
    let i = S.qi + dir * k;
    if (i < 0 || i >= n) {
      if (S.repeat !== 'all' || dir < 0) return -1;
      i = (i + n) % n;
    }
    if (playable(S.queue[i])) return i;
  }
  return -1;
}

function next() {
  const i = stepIndex(1);
  if (i < 0) return false;
  S.qi = i;
  load(S.queue[i]);
  return true;
}

function prev({ restart = true } = {}) {
  const i = stepIndex(-1);
  if ((restart && audio.currentTime > 5) || i < 0) {
    audio.currentTime = 0;
    return;
  }
  S.qi = i;
  load(S.queue[i]);
}

/* ---------------- swipe between recordings ---------------- */

// Like Spotify: drag the artwork (or the mini player) left for the next recording
// and right for the previous one. Short or mostly vertical drags spring back.
function swipeable(el) {
  let start = null, dx = 0, sideways = null, swiped = false;
  const canGo = d => stepIndex(d < 0 ? 1 : -1) >= 0;
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
  const art = artFor(t);
  $('#player-bg').innerHTML = art ? `<img src="${esc(art)}" alt="" data-bg>` : '';
  $('#player').classList.toggle('no-art', !art);
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
  const isFav = S.favs.has(t.id);
  for (const fav of $$('#player-fav, #mini-fav')) {
    fav.classList.toggle('on', isFav);
    fav.setAttribute('aria-pressed', isFav);
    fav.setAttribute('aria-label', isFav ? 'Remove from Favourites' : 'Add to Favourites');
  }

  const dl = $('#player-dl');
  const d = S.downloads.get(t.id);
  dl.classList.toggle('on', S.saved.has(t.id));
  dl.querySelector('use').setAttribute('href', S.saved.has(t.id) ? '#i-check' : '#i-download');
  dl.querySelector('span').textContent = S.saved.has(t.id) ? 'Saved' : d ? `Saving ${Math.round(d.progress * 100)}%` : 'Save offline';

  // The repeat button in the player and the queue's tile show what happens when this ends.
  const mode = REPEAT[S.repeat] || REPEAT.off;
  for (const rep of $$('#loop-btn, #q-repeat')) {
    rep.classList.toggle('on', S.repeat !== 'off');
    rep.classList.toggle('one', S.repeat === 'one');
    rep.setAttribute('aria-label', `When this kirtan ends: ${mode.label}`);
    rep.querySelector('use').setAttribute('href', `#i-${mode.btn || mode.icon}`);
  }
  $('#q-repeat span').textContent = mode.short;

  for (const b of $$('#shuffle-btn, #q-shuffle')) {
    b.classList.toggle('on', S.shuffle);
    b.setAttribute('aria-pressed', S.shuffle);
  }
  $('#q-speed').classList.toggle('on', S.speed !== 1);
  $('#q-speed span').textContent = `${S.speed}× speed`;
}

// The choices for when a kirtan ends, in the order the menu lists them.
const REPEAT = {
  off: { short: 'Play next', label: 'Play the next kirtan', icon: 'next', btn: 'repeat', toast: 'The next kirtan plays when this one ends' },
  one: { short: 'Loop', label: 'Loop this kirtan', icon: 'repeat', toast: 'This kirtan will play again and again' },
  once: { short: 'Play once', label: 'Play once, then stop', icon: 'once', toast: 'Playback stops when this kirtan ends' },
  all: { short: 'Loop list', label: 'Loop the whole list', icon: 'repeat', toast: 'The list starts again at the end' },
};

function openRepeatMenu() {
  $('#repeat-menu').innerHTML = `<h3 class="menu-title">When this kirtan ends</h3>
    ${Object.entries(REPEAT).map(([value, m]) => `<button value="${value}" class="${value === S.repeat ? 'in' : ''}${value === 'one' ? ' one' : ''}" aria-pressed="${value === S.repeat}">
      ${icon(m.icon)}<span>${m.label}</span>${value === S.repeat ? icon('tick', 'tick') : ''}</button>`).join('')}
    <button value="" class="muted">Cancel</button>`;
  $('#repeat-dialog').showModal();
}

function setRepeat(value) {
  if (!REPEAT[value]) return;
  S.repeat = value;
  audio.loop = value === 'one';
  store.set('repeat', value);
  updatePlayerButtons();
  toast(REPEAT[value].toast);
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
audio.addEventListener('play', () => { lastTick = performance.now(); setPlayingClass(); closeEmbed(); setMediaState(); });
audio.addEventListener('pause', () => { lastTick = null; savePosition(); setPlayingClass(); setBuffering(false); setMediaState(); if (syncDirty) syncNow(); });
audio.addEventListener('waiting', () => { if (!audio.paused) setBuffering(true); });
audio.addEventListener('playing', () => { setBuffering(false); recovery.tries = 0; });
audio.addEventListener('canplay', () => { if (audio.paused) setBuffering(false); });
function setMediaState() {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}
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
  if (cur > 0) recovery.at = cur;
  // The sleep timer is checked here too: timers can be slowed while the phone is locked.
  if (S.sleep?.until && Date.now() >= S.sleep.until) {
    setSleep('off');
    fadeOutAndPause();
  }

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
  S.posAt[S.current] = Date.now();
  store.set('positions', S.positions);
  store.set('posAt', S.posAt);
  syncLater();
  refreshTrack(S.current);
  if (S.sleep?.end) {
    setSleep('off');
    return;
  }
  if (S.repeat === 'once' || !next()) setBuffering(false);
});

// When the connection drops mid-recording (a tunnel, a lift, the Underground),
// carry on from the same moment once it's back, instead of stopping for good.
const recovery = { tries: 0, at: 0, waiting: false };
audio.addEventListener('error', () => {
  const t = S.byId.get(S.current);
  if (!t || audio.error?.code === 1 /* aborted on purpose */) return;
  setBuffering(false);
  if (S.saved.has(t.id) || recovery.tries >= 4) {
    toast('Couldn’t play this recording');
    return;
  }
  recovery.tries++;
  if (!isOnline()) {
    recovery.waiting = true;
    toast('Connection lost. It will carry on when you’re back online.');
    return;
  }
  setTimeout(resumeAfterDrop, 1500 * recovery.tries);
});
function resumeAfterDrop() {
  recovery.waiting = false;
  if (!S.current) return;
  load(S.current, { at: recovery.at || audio.currentTime });
}
window.addEventListener('online', () => { if (recovery.waiting) resumeAfterDrop(); });

function savePosition() {
  lastSave = Date.now();
  store.set('stats', S.stats);
  const t = S.byId.get(S.current);
  if (!t || !audio.currentTime) return;
  const dur = audio.duration || t.duration;
  const before = S.positions[t.id];
  if (audio.currentTime > 10 && audio.currentTime < dur - 20) S.positions[t.id] = Math.floor(audio.currentTime);
  else delete S.positions[t.id];
  if (S.positions[t.id] !== before) {
    S.posAt[t.id] = Date.now();
    store.set('posAt', S.posAt);
    syncLater();
  }
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

// Swipe down anywhere on the player to close it, like Spotify: the whole screen
// follows your finger, and a long or quick swipe closes it (same as the ↓ button).
// Sideways swipes on the artwork still change recording; the progress bar keeps
// its own drag; once the player is scrolled down, swiping scrolls it back first.
(function swipeDownToClose() {
  const player = $('#player');
  let y0 = null, x0 = 0, t0 = 0, dy = 0, mode = null;
  const reset = () => { player.style.transition = 'transform .22s var(--ease-out)'; player.style.transform = ''; };
  player.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.scrub-bar, iframe, dialog')) return;
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
    t0 = performance.now();
    dy = 0;
    mode = null;
  }, { passive: true });
  player.addEventListener('touchmove', e => {
    if (y0 === null) return;
    const ddy = e.touches[0].clientY - y0, ddx = e.touches[0].clientX - x0;
    if (mode === null && Math.hypot(ddx, ddy) > 8) {
      mode = ddy > 0 && Math.abs(ddy) > Math.abs(ddx) * 1.2 && player.scrollTop <= 0 ? 'close' : 'other';
    }
    if (mode !== 'close') return;
    e.preventDefault(); // the player follows the finger instead of the page bouncing
    dy = Math.max(0, ddy);
    player.style.transition = 'none';
    player.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 === null) return;
    const wasClosing = mode === 'close';
    const speed = dy / Math.max(1, performance.now() - t0); // px per ms
    y0 = null;
    mode = null;
    if (!wasClosing) return;
    if (dy > 120 || (dy > 50 && speed > 0.5)) {
      // Carry on down from where the finger left it, then close.
      player.style.transition = 'transform .22s var(--ease-in)';
      player.style.transform = 'translateY(100%)';
      setTimeout(() => closePlayer({ instant: true }), 220);
    } else {
      reset();
    }
  };
  player.addEventListener('touchend', end);
  player.addEventListener('touchcancel', end);
})();

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const handlers = {
    play: () => (audio.src ? audio.play() : S.current && load(S.current)),
    pause: () => audio.pause(),
    stop: () => audio.pause(),
    // Previous/next kirtan on the lock screen and in Control Centre. No 15/30-second
    // skip handlers: iPhones show those instead of next/previous when both are set.
    previoustrack: () => prev(),
    nexttrack: () => next(),
    seekto: e => { audio.currentTime = e.seekTime; },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { ms.setActionHandler(action, fn); } catch {}
  }
}

async function shareTrack(id = S.current) {
  const t = S.byId.get(id);
  if (!t) return;
  // /k/<id> shows the kirtan's title and picture when shared in WhatsApp and the like.
  const url = `${location.origin}/k/${t.id}`;
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
  S.favAt[id] = Date.now();
  store.set('favAt', S.favAt);
  scheduleSync();
  if (id === S.current) updatePlayerButtons();
  toast(on ? 'Added to Favourites' : 'Removed from Favourites');
  if (location.hash.startsWith('#/library/favourites') || location.hash === '#/library') route();
}

const playlistById = id => S.playlists.find(p => p.id === id);
// A playlist's kirtans that are in the app (a removed recording simply drops out).
const playlistTracks = p => p.ids.map(x => S.byId.get(x)).filter(Boolean);
// Saves playlists on this device, noting which ones changed or were deleted so
// an account can merge them with other devices.
let plShape = null;
const shapeOf = p => JSON.stringify([p.name, p.ids]);
function savePlaylists() {
  const now = Date.now();
  plShape ??= new Map();
  for (const p of S.playlists) if (plShape.get(p.id) !== shapeOf(p)) p.at = now;
  for (const id of plShape.keys()) if (!S.playlists.some(p => p.id === id)) S.plDeleted[id] = now;
  plShape = new Map(S.playlists.map(p => [p.id, shapeOf(p)]));
  store.set('playlists', S.playlists);
  store.set('plDeleted', S.plDeleted);
  scheduleSync();
}
function newPlaylist(name) {
  const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ids: [], created: Date.now() };
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
  if (!playlistTracks(p).length) S.plEdit = null;
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
  return dialogAnswer(dlg, value => (value === 'save' && input.value.trim() ? input.value.trim().slice(0, 60) : null));
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
    ${id === S.current ? item('loop', REPEAT[S.repeat]?.icon || 'next', `When it ends: ${(REPEAT[S.repeat] || REPEAT.off).short}`) + item('speed', 'speed', `Playback speed: ${S.speed}×`) : ''}
    ${item('share-track', 'share', 'Share')}
    <button value="cancel" class="muted">Cancel</button>`;
  $('#track-dialog').showModal();
}

// Choose playlists for a kirtan: each tap ticks or unticks one, the menu stays
// open so you can pick several, and Done closes it.
function openPlaylistPicker(id) {
  if (!S.byId.has(id)) return;
  renderPicker(id);
  $('#playlist-dialog').showModal();
}
function renderPicker(id) {
  const t = S.byId.get(id);
  $('#playlist-menu').innerHTML = `<h3 class="menu-title">Add to playlist<small>${esc(t.title)}</small></h3>
    <button type="button" data-action="pl-create-add" data-id="${id}">${icon('plus')}<span>New playlist</span></button>
    ${S.playlists.map(p => {
      const on = p.ids.includes(id);
      return `<button type="button" data-action="pl-toggle" data-pl="${p.id}" data-id="${id}" class="${on ? 'in' : ''}" aria-pressed="${on}">
        ${icon(on ? 'check' : 'playlist')}<span>${esc(p.name)}</span><small>${playlistTracks(p).length}</small></button>`;
    }).join('')}
    <button value="done" class="menu-done">Done</button>`;
}

// "Add kirtans" on a playlist: every kirtan, searchable, each with + / ✓.
function openAddKirtans(plId) {
  const p = playlistById(plId);
  if (!p) return;
  const dlg = $('#add-dialog');
  dlg.dataset.pl = p.id;
  $('#add-title').textContent = `Add to ${p.name}`;
  $('#add-q').value = '';
  renderAddList();
  dlg.showModal();
}
function renderAddList() {
  const p = playlistById($('#add-dialog').dataset.pl);
  if (!p) return;
  const words = norm($('#add-q').value).split(/\s+/).filter(Boolean);
  const list = kirtans()
    .filter(t => words.every(w => norm(`${t.title} ${t.artist} ${t.type} ${t.place || ''} ${t.year || ''}`).includes(w)))
    .sort((a, b) => a.artist.localeCompare(b.artist) || byTitle(a, b));
  $('#add-sub').textContent = `${plural(playlistTracks(p).length, 'kirtan')} in ${p.name}`;
  $('#add-body').innerHTML = list.length ? `<ul class="tracks">${list.slice(0, 200).map(t => {
    const on = p.ids.includes(t.id);
    return `<li class="track add-row">
      <span class="track-main"><span class="track-text"><span class="track-title">${esc(t.title)}</span>
        <span class="track-meta">${esc(t.artist)} · ${esc(t.type)}${t.year ? ` · ${t.year}` : ''} · ${fmtDur(t.duration)}</span></span></span>
      <button class="icon-btn add-toggle${on ? ' in' : ''}" data-action="pl-add-toggle" data-pl="${p.id}" data-id="${t.id}" aria-pressed="${on}" aria-label="Add or remove ${esc(t.title)}">${icon(on ? 'check' : 'plus')}</button>
    </li>`;
  }).join('')}</ul>` : `<p class="empty">No kirtans match “${esc($('#add-q').value)}”.</p>`;
}
$('#add-q').addEventListener('input', renderAddList);
$('#add-dialog').addEventListener('close', () => { if (location.hash.startsWith('#/library/playlists')) route(); });

// Play next: straight after the current recording. Add to queue: at the end.
function playNext(id) {
  if (!S.current) return playOnly(id);
  S.queue.splice(S.qi + 1, 0, id);
  saveQueue();
  updatePlayerButtons();
  toast('Plays next');
}
function addToQueue(id) {
  if (!S.current) return playOnly(id);
  S.queue.push(id);
  saveQueue();
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
  saveQueue();
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
  // Like Spotify's queue: pictures, the playing kirtan on top with a play/pause button.
  const text = (t, meta) => `<span class="q-text"><span class="q-title">${esc(t.title)}</span><span class="q-meta">${esc(meta)}</span></span>`;
  const row = ({ t, qi }) => `<li class="q-row">
      <button class="q-main" data-action="queue-jump" data-qi="${qi}"><span class="q-art">${artHTML(t)}</span>${text(t, `${collectionName(t)} · ${fmtDur(t.duration)}`)}</button>
      <button class="icon-btn" data-action="queue-remove" data-qi="${qi}" aria-label="Remove from the queue">${icon('x')}</button>
    </li>`;
  $('#queue-body').innerHTML = (now ? `<ul class="q-list"><li class="q-row now">
      <span class="q-main"><span class="q-art">${artHTML(now)}</span><span class="q-text"><span class="q-title"><span class="eq"><i></i><i></i><i></i></span>${esc(now.title)}</span>
      <span class="q-meta">${esc(collectionName(now))}</span></span></span>
      <button class="q-play" data-action="toggle" aria-label="Play or pause">${icon('play', 'i-play')}${icon('pause', 'i-pause')}</button></li></ul>` : '')
    + (upcoming.length ? `<h4 class="queue-head">Next up</h4><ul class="q-list">${upcoming.map(row).join('')}</ul>`
      : `<p class="empty">${S.repeat === 'once' ? 'Playback stops when this kirtan ends.' : 'Nothing else is queued.'} Tap ${icon('more')} next to any kirtan and choose <b>Play next</b> or <b>Add to queue</b>.</p>`);
}

/* ---------------- accounts: favourites and playlists on every device ---------------- */

// This device's favourites and playlists in the mergeable form (site/library.js).
function localLibrary() {
  const favs = {};
  for (const id of new Set([...Object.keys(S.favAt), ...S.favs])) favs[id] = { on: S.favs.has(id), at: S.favAt[id] || 0 };
  const playlists = {};
  for (const [id, at] of Object.entries(S.plDeleted)) playlists[id] = { deleted: true, at };
  for (const p of S.playlists) playlists[p.id] = { name: p.name, ids: p.ids, created: p.created || 0, at: p.at || 0 };
  const positions = {};
  for (const id of new Set([...Object.keys(S.posAt), ...Object.keys(S.positions)])) positions[id] = { pos: S.positions[id] || 0, at: S.posAt[id] || 0 };
  const last = store.get('last') ? { id: store.get('last'), at: S.lastAt || 0 } : null;
  return { favs, playlists, positions, last };
}
// Makes this device show a merged library, and keeps it.
function applyLibrary(lib) {
  const before = JSON.stringify(localLibrary());
  S.favs = new Set(Object.entries(lib.favs).filter(([, f]) => f.on).map(([id]) => id));
  S.favAt = Object.fromEntries(Object.entries(lib.favs).map(([id, f]) => [id, f.at]));
  S.plDeleted = Object.fromEntries(Object.entries(lib.playlists).filter(([, p]) => p.deleted).map(([id, p]) => [id, p.at]));
  // Update playlists in place, so code holding one (e.g. while a rename box is
  // open) still holds the playlist the app shows.
  const byId = new Map(S.playlists.map(p => [p.id, p]));
  S.playlists = Object.entries(lib.playlists).filter(([, p]) => !p.deleted)
    .map(([id, p]) => Object.assign(byId.get(id) || { id }, { name: p.name, ids: p.ids, created: p.created, at: p.at }))
    .sort((a, b) => (a.created || 0) - (b.created || 0));
  plShape = new Map(S.playlists.map(p => [p.id, shapeOf(p)]));
  store.set('favs', [...S.favs]);
  store.set('favAt', S.favAt);
  store.set('playlists', S.playlists);
  store.set('plDeleted', S.plDeleted);
  // Listening positions, so a kirtan started on one device continues on another.
  if (lib.positions) {
    for (const [id, p] of Object.entries(lib.positions)) {
      if ((p.at || 0) < (S.posAt[id] || 0) || id === S.current && !audio.paused) continue;
      S.posAt[id] = p.at;
      if (p.pos > 0) S.positions[id] = p.pos; else delete S.positions[id];
    }
    store.set('positions', S.positions);
    store.set('posAt', S.posAt);
  }
  // What was playing last, anywhere: shown in the mini player when nothing has played here yet.
  if (lib.last && lib.last.at > (S.lastAt || 0) && S.byId.has(lib.last.id)) {
    S.lastAt = lib.last.at;
    store.set('lastAt', S.lastAt);
    store.set('last', lib.last.id);
    if (!audio.src) {
      S.current = lib.last.id;
      if (!S.queue.includes(S.current)) S.queue = [S.current];
      S.qi = S.queue.indexOf(S.current);
      updateNowPlaying();
    }
  }
  if (S.current) updatePlayerButtons();
  // Only redraw when something actually changed, so syncing never flickers the page.
  if (JSON.stringify(localLibrary()) === before) return;
  if (location.hash.startsWith('#/library') || location.hash === '' || location.hash === '#/') route();
}

async function apiCall(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    keepalive: path === 'sync',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
  return data;
}

// Sends this device's changes and takes the merged result; quietly retries later
// when offline. Signed-out people keep everything on the device, as before.
let syncTimer = null, syncDirty = store.get('syncDirty', false), changes = 0;
function scheduleSync() {
  changes++; // counted even when signed out, so a sync in flight knows it's out of date
  if (!S.user) return;
  syncDirty = true;
  store.set('syncDirty', true);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 800);
}
// Listening positions change all the time: send them within a minute, or straight
// away when playback pauses or the app is put away (see the listeners below).
function syncLater() {
  if (!S.user) return;
  syncDirty = true;
  store.set('syncDirty', true);
  if (!syncTimer) syncTimer = setTimeout(syncNow, 60000);
}
async function syncNow() {
  clearTimeout(syncTimer);
  syncTimer = null;
  if (!S.user || !isOnline()) return;
  const sentAt = changes;
  try {
    const { library } = await apiCall('sync', { library: localLibrary() });
    // Anything changed on this device while the reply was on its way is newer:
    // merge it in rather than overwrite it, and send it next.
    applyLibrary(mergeLibrary(library, localLibrary()));
    if (changes !== sentAt) return scheduleSync();
    syncDirty = false;
    store.set('syncDirty', false);
  } catch (err) {
    if (err.status === 401) return signedOutHere();
    syncTimer = setTimeout(syncNow, 30000); // network trouble: try again shortly
  }
}
window.addEventListener('online', () => { if (syncDirty) syncNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && syncDirty) syncNow(); });

// At start: check the account, then merge the account's library with this device's.
async function accountStart() {
  if (!isOnline()) return;
  try {
    const { user, library } = await apiCall('me');
    if (!user) { if (S.user) signedOutHere(); return; }
    S.user = user;
    store.set('user', user);
    applyLibrary(mergeLibrary(library, localLibrary()));
    syncNow();
  } catch {}
}
function signedOutHere() {
  S.user = null;
  store.set('user', null);
  if (location.hash.startsWith('#/library')) route();
}

// The password never leaves the device: it becomes a key (PBKDF2-SHA256,
// 600,000 rounds, salted with the email) and only the key is sent.
async function passwordKey(email, password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: enc.encode(`kirtan-app|${email.trim().toLowerCase()}`) }, base, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Library: a card to sign in or create an account, or who's signed in.
function accountCard() {
  if (S.user) {
    const who = S.user.name || S.user.email;
    return `<section class="account-card in">
      <span class="avatar" aria-hidden="true">${esc(who.trim()[0]?.toUpperCase() || '·')}</span>
      <span class="account-text"><b>${esc(who)}</b><small>Favourites and playlists are saved to your account${S.user.name ? ` · ${esc(S.user.email)}` : ''}</small></span>
      <button class="icon-btn" data-action="account-menu" aria-label="Account options">${icon('more')}</button>
    </section>`;
  }
  return `<section class="account-card">
    <span class="account-text"><b>Keep your favourites and playlists safe</b>
      <small>Sign in, or create a free account, and they’re saved and on all your devices.</small></span>
    <span class="account-actions"><button class="btn" data-action="account" data-mode="login">Sign in</button>
      <button class="btn ghost" data-action="account" data-mode="signup">Create account</button></span>
  </section>`;
}

const ACCOUNT_MODES = {
  login: { title: 'Sign in', submit: 'Sign in', pw: 'Password', pwAuto: 'current-password',
    note: 'Forgot your password? Ask the person who runs this site to reset it for you.' },
  signup: { title: 'Create an account', submit: 'Create account', pw: 'Password (at least 8 characters)', pwAuto: 'new-password',
    note: 'We only keep your email, your name, and your favourites and playlists. You can delete your account at any time.' },
  password: { title: 'Change password', submit: 'Change password', pw: 'Current password', pwAuto: 'current-password',
    note: 'Your other devices will need the new password next time.' },
  delete: { title: 'Delete account', submit: 'Delete my account', pw: 'Password', pwAuto: 'current-password',
    note: 'This removes your account and everything saved to it online. This device keeps its favourites and playlists.' },
};
function openAccount(mode) {
  const dlg = $('#account-dialog'), form = $('#account-form');
  form.reset();
  form.dataset.mode = mode;
  const m = ACCOUNT_MODES[mode];
  $('#account-title').textContent = m.title;
  $('#account-submit').textContent = m.submit;
  $('#account-submit').classList.toggle('danger', mode === 'delete');
  $('#pw-label').textContent = m.pw;
  form.password.autocomplete = m.pwAuto;
  $('#account-note').textContent = m.note;
  $('#account-error').textContent = '';
  $('#account-tabs').hidden = !(mode === 'login' || mode === 'signup');
  for (const b of $$('#account-tabs button')) b.setAttribute('aria-current', b.dataset.mode === mode);
  $('#f-name').hidden = mode !== 'signup';
  $('#f-email').hidden = !(mode === 'login' || mode === 'signup');
  $('#f-newpassword').hidden = mode !== 'password';
  form.email.value = S.user?.email || form.email.value;
  if (!dlg.open) dlg.showModal();
  (mode === 'login' || mode === 'signup' ? form.email : form.password).focus();
}

async function submitAccount(e) {
  e.preventDefault();
  const form = $('#account-form'), mode = form.dataset.mode;
  const err = msg => { $('#account-error').textContent = msg; };
  const email = (S.user && (mode === 'password' || mode === 'delete') ? S.user.email : form.email.value).trim().toLowerCase();
  const pw = form.password.value;
  if (!isOnline()) return err('Connect to the internet first.');
  if ((mode === 'login' || mode === 'signup') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Please enter your email address.');
  if (mode === 'signup' && pw.length < 8) return err('Please choose a password of at least 8 characters.');
  if (mode === 'password' && form.newpassword.value.length < 8) return err('Please choose a new password of at least 8 characters.');
  if (!pw) return err('Please enter your password.');
  const btn = $('#account-submit');
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    const key = await passwordKey(email, pw);
    if (mode === 'login' || mode === 'signup') {
      const { user } = await apiCall(mode, { email, name: form.name.value, key });
      S.user = user;
      store.set('user', user);
      $('#account-dialog').close();
      await accountStart(); // merges what this device already had into the account
      toast(mode === 'signup' ? 'Account created. Your favourites and playlists are saved.' : `Signed in. Welcome${user.name ? `, ${user.name}` : ''}!`);
    } else if (mode === 'password') {
      await apiCall('password', { key, newKey: await passwordKey(email, form.newpassword.value) });
      $('#account-dialog').close();
      toast('Password changed');
    } else if (mode === 'delete') {
      await apiCall('delete', { key });
      $('#account-dialog').close();
      signedOutHere();
      toast('Account deleted');
    }
    route();
  } catch (error) {
    err(error.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}
$('#account-form').addEventListener('submit', submitAccount);
$('#account-tabs').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) openAccount(b.dataset.mode); });
$('#account-cancel').addEventListener('click', () => $('#account-dialog').close());
$('#show-pw').addEventListener('change', e => { for (const i of $$('#account-form input[name$="password"]')) i.type = e.target.checked ? 'text' : 'password'; });

async function signOut() {
  if (!(await ask('Sign out? Your favourites and playlists stay saved in your account.', 'Sign out'))) return;
  if (syncDirty) await syncNow();
  try { await apiCall('logout', {}); } catch {}
  // This device forgets the account's library; signing in again brings it back.
  applyLibrary({ favs: {}, playlists: {} });
  for (const k of ['favs', 'favAt', 'playlists', 'plDeleted']) store.set(k, k === 'favs' || k === 'playlists' ? [] : {});
  signedOutHere();
  toast('Signed out');
  route();
}

function openAccountMenu() {
  $('#track-menu').innerHTML = `<h3 class="menu-title">${esc(S.user.name || 'Your account')}<small>${esc(S.user.email)}</small></h3>
    <button value="pw" data-action="account" data-mode="password">${icon('tick')}<span>Change password</span></button>
    <button value="out" data-action="sign-out">${icon('left')}<span>Sign out</span></button>
    <button value="del" data-action="account" data-mode="delete" class="danger">${icon('trash')}<span>Delete account</span></button>
    <button value="cancel" class="muted">Cancel</button>`;
  $('#track-dialog').showModal();
}

/* ---------------- sleep timer ---------------- */

function setSleep(value) {
  if (value === 'off' || !value) S.sleep = null;
  else if (value === 'end') S.sleep = { end: true };
  else S.sleep = { until: Date.now() + Number(value) * 60000 };
  updateSleepLabel();
}

function updateSleepLabel() {
  const left = !S.sleep ? '' : S.sleep.end ? 'End of kirtan' : `${fmtClock((S.sleep.until - Date.now()) / 1000)} left`;
  for (const btn of $$('#sleep-btn, #q-sleep')) {
    btn.classList.toggle('on', !!S.sleep);
    btn.setAttribute('aria-label', S.sleep ? `Sleep timer: ${left}` : 'Sleep timer');
  }
  $('#sleep-label').textContent = S.sleep?.end ? 'End' : left.replace(' left', '');
  $('#q-sleep span').textContent = left || 'Timer';
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
  await keepArt(t);
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
    case 'resume': {
      // Continue listening keeps the list it was playing from, if it's still there.
      if (!S.queue.includes(id)) S.queue = [id];
      S.qi = S.queue.indexOf(id);
      load(id);
      break;
    }
    case 'play-list': {
      // Play is in order (Shuffle next to it is the other way to start a list).
      const ids = S.lists[list] || [];
      if (!ids.length) break;
      S.shuffle = false;
      store.set('shuffle', false);
      startList(ids);
      load(S.queue[0]);
      break;
    }
    case 'shuffle': {
      const ids = S.lists[list] || [];
      if (!ids.length) break;
      S.shuffle = true;
      store.set('shuffle', true);
      startList(ids, ids[Math.floor(Math.random() * ids.length)]);
      load(S.queue[0]);
      break;
    }
    case 'shuffle-toggle': setShuffle(!S.shuffle); break;
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
    case 'loop': openRepeatMenu(); break;
    case 'speed': {
      S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
      audio.defaultPlaybackRate = audio.playbackRate = S.speed;
      store.set('speed', S.speed);
      updatePlayerButtons();
      toast(`Playback speed ${S.speed}×`);
      break;
    }
    case 'share': shareTrack(); break;
    case 'theme': setTheme(el.dataset.theme); break;
    case 'account': setTimeout(() => openAccount(el.dataset.mode)); break;
    case 'account-menu': openAccountMenu(); break;
    case 'sign-out': setTimeout(signOut); break;
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
      if ($('#playlist-dialog').open) renderPicker(id);
      break;
    }
    case 'pl-toggle': {
      const p = playlistById(el.dataset.pl);
      if (p?.ids.includes(id)) removeFromPlaylist(p, id); else if (p) addToPlaylist(p, id);
      if ($('#playlist-dialog').open) renderPicker(id);
      break;
    }
    case 'pl-add': openAddKirtans(el.dataset.pl); break;
    case 'pl-add-toggle': {
      const p = playlistById(el.dataset.pl);
      if (!p) break;
      const on = !p.ids.includes(id);
      on ? p.ids.push(id) : (p.ids = p.ids.filter(x => x !== id));
      savePlaylists();
      el.classList.toggle('in', on);
      el.setAttribute('aria-pressed', on);
      el.innerHTML = icon(on ? 'check' : 'plus');
      $('#add-sub').textContent = `${plural(playlistTracks(p).length, 'kirtan')} in ${p.name}`;
      break;
    }
    case 'pl-edit': S.plEdit = S.plEdit === el.dataset.pl ? null : el.dataset.pl; route(); break;
    case 'pl-remove': removeFromPlaylist(playlistById(el.dataset.pl), id); break;
    case 'pl-move': movePlaylistItem(playlistById(el.dataset.pl), id, Number(el.dataset.dir)); break;
    case 'pl-rename': {
      const old = playlistById(el.dataset.pl);
      const name = old && await askName('Rename playlist', old.name, 'Save');
      const p = playlistById(el.dataset.pl); // the current one, in case a sync arrived meanwhile
      if (name && p) { p.name = name; savePlaylists(); route(); }
      break;
    }
    case 'pl-delete': {
      const p = playlistById(el.dataset.pl);
      if (!p || !(await ask(`Delete the playlist “${p.name}”? The kirtans stay in the app.`, 'Delete'))) return;
      S.playlists = S.playlists.filter(x => x.id !== p.id);
      savePlaylists();
      location.hash = '#/library/playlists';
      break;
    }
    case 'lyrics': openLyrics(); break;
    case 'sleep-menu': $('#sleep-dialog').showModal(); break;
    case 'clear-searches': store.set('searches', []); $('#results').innerHTML = searchResults(); break;
    case 'suggest': {
      S.query = el.dataset.q;
      $('#q').value = S.query;
      $('#results').innerHTML = searchResults();
      break;
    }
    case 'remove-all': {
      if (!(await ask('Remove all saved recordings from this device?', 'Remove all'))) return;
      await caches.delete(AUDIO_CACHE);
      await caches.delete(ART_CACHE);
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
    case 'show-install': {
      const box = $('#install');
      if (!box) { location.hash = '#/'; break; }
      box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      box.classList.remove('flash');
      void box.offsetWidth;
      box.classList.add('flash');
      break;
    }
  }
});

$('#lyrics-dialog').addEventListener('close', () => { $('#lyrics-body').innerHTML = ''; });

$('#repeat-dialog').addEventListener('close', e => {
  setRepeat(e.target.returnValue);
  e.target.returnValue = '';
});

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
  // A shared link (/k/<id>) opens that kirtan in the player.
  const shared = /^\/k\/([A-Za-z0-9_-]+)/.exec(location.pathname);
  if (shared) history.replaceState(null, '', `/#/play/${shared[1]}`);
  await loadData();
  plShape = new Map(S.playlists.map(p => [p.id, shapeOf(p)])); // so the next save only marks real changes
  $('.offline-pill').hidden = isOnline();

  // Show the last recording in the mini player, ready to resume, with the rest
  // of the queue it was playing from.
  const last = store.get('last');
  if (S.byId.has(last) && !location.hash.startsWith('#/play/')) {
    const saved = store.get('queue', null);
    const ids = (saved?.ids || []).filter(id => S.byId.has(id));
    S.current = last;
    S.queue = ids.includes(last) ? ids : [last];
    S.qi = S.queue.indexOf(last);
    S.order = S.shuffle && saved?.order ? saved.order.filter(id => S.byId.has(id)) : null;
    updateNowPlaying();
  }
  route();
  setPlayingClass();
  accountStart();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
