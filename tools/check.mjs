// Checks that fixes made for the owner are still in place, so a later edit can't
// quietly undo one (it has happened). publish.sh runs this before deploying.
//
//   node tools/check.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('site/index.html'), css = read('site/styles.css'), app = read('site/app.js'), sw = read('site/sw.js');

const checks = [
  // Opening with no signal (22 Oct): no index.html in the cache, page fallback with a timeout.
  ['App opens offline: sw.js never caches index.html', !/SHELL = \[[^\]]*'index\.html'/.test(sw)],
  ['App opens offline: pages fall back to the cached ./ after a timeout', sw.includes('async function openPage') && sw.includes('unredirected')],
  // Fonts are stored with the app, not loaded from Google.
  ['Font is self-hosted: no Google Fonts link in index.html', !html.includes('fonts.googleapis.com')],
  ['Font is self-hosted: @font-face rules in styles.css', /@font-face \{ font-family: 'EB Garamond'/.test(css)],
  ['Font is self-hosted: font files are pre-cached', sw.includes('fonts/eb-garamond-latin.woff2')],
  // A page only ever runs with its own styling and code.
  ['Versioned assets: index.html loads styles.css?v= and app.js?v=', /styles\.css\?v=/.test(html) && /app\.js\?v=/.test(html)],
  ['Versioned assets: sw.js caches and serves them', sw.includes('styles.css?v=${VERSION}') && sw.includes("searchParams.has('v')")],
  // Cover pictures offline (22 Oct).
  ['Covers offline: saved and played kirtans keep their cover (keepArt)', (app.match(/keepArt\(/g) || []).length >= 4 && app.includes("ART_CACHE = 'kirtan-art'")],
  ['Covers offline: a missing picture falls back to the initials tile', app.includes('data-fallback')],
  // Audio and features.
  ['Audio is served from media/ (AAC)', sw.includes('media|audio')],
  ['Saved offline copies no longer in the catalog are cleaned up', app.includes('only takes up space')],
  ['Lyrics open inside the app', app.includes('kksongs.org page shown') || app.includes("dialog.classList.toggle('web'")],
  ['Guided Japa plays in the in-app YouTube player', app.includes('function openVideo') && html.includes('id="video-dialog"')],
  ['Install the app button near the top of Home', app.includes('install-cta')],
  ['Playlists, ⋯ menu and queue', app.includes('function playlistView') && app.includes('function openTrackMenu') && app.includes('function openQueue')],
  ['Playlists: Add kirtans sheet, Edit order, multi-select picker', app.includes('function openAddKirtans') && app.includes("case 'pl-edit'") && app.includes('function renderPicker')],
  ['Playlist name box stays clear of the iPhone keyboard', css.includes('dialog.menu.name-menu')],
  ['Swipe down anywhere on the player closes it', app.includes("player.addEventListener('touchmove'")],
  ['Kirtans list.xlsx: build reads and rewrites the sheet (edits, thumbnails, hidden)', read('tools/build.mjs').includes('applySheet(tracks)') && read('tools/build.mjs').includes('writeSheet(tracks)')],
  ['Kirtans hidden in the sheet stay out of the app', app.includes('.filter(t => !t.hidden)')],
  ['Accounts: server answers /api/* (worker/api.js) with the D1 database', read('worker/index.js').includes("startsWith('/api/')") && read('wrangler.jsonc').includes('"binding": "DB"')],
  ['Accounts: passwords become a key on the device; only the key is sent', app.includes('function passwordKey') && app.includes('iterations: 600000')],
  ['Accounts: sign-in card in Library, and favourites/playlists sync', app.includes('function accountCard') && app.includes('async function syncNow')],
  ['Accounts: sync replies merge with newer local changes (no lost edits)', app.includes('applyLibrary(mergeLibrary(library, localLibrary()))')],
  ['Accounts: the service worker never caches /api/', sw.includes("url.pathname.startsWith('/api/')) return")],
  ['Light / dark appearance', app.includes('function setTheme') && html.includes("localStorage.getItem('kk.theme')")],
  ['Laptop-only light/dark switch hidden on phones', /\.theme-toggle\.side \{ display: none; \}/.test(css)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed: a fix has been undone. Restore it before publishing.`);
  process.exit(1);
}
