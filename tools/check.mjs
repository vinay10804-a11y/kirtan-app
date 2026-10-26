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
  ['Audio is served from stream/ (levelled AAC) and media/', sw.includes('stream|media|audio')],
  ['Saved offline copies no longer in the catalog are cleaned up', app.includes('only takes up space')],
  ['Lyrics open inside the app', app.includes('kksongs.org page shown') || app.includes("dialog.classList.toggle('web'")],
  ['Guided Japa plays in the in-app YouTube player', app.includes('function openVideo') && html.includes('id="video-dialog"')],
  ['The site is called Sacinandana Swami Central (26 Oct): menu, top bar, title, manifest, share previews', html.includes('<title>Sacinandana Swami Central</title>') && html.includes('Sacinandana Swami <b>Central</b>') && app.includes('Sacinandana Swami <b>Central</b>') && read('site/manifest.webmanifest').includes('"name": "Sacinandana Swami Central"') && read('worker/share.js').includes("'Sacinandana Swami Central'")],
  ['Install button near the top of Home, titled "How to install this website as an app" (26 Oct)', app.includes('install-cta') && app.includes('<b>How to install this website as an app</b>')],
  ['Home intro: welcoming; kirtans by Sacinandana Swami and Gour Krishna, japa and lectures by Sacinandana Swami; listen here or save offline (26 Oct)', app.includes('Immerse yourself in kirtans by Sacinandana&nbsp;Swami and Gour&nbsp;Krishna, and in japa and lectures by Sacinandana&nbsp;Swami.<br>Listen here, or save recordings to play without internet.')],
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
  ['Home page section pictures (Sacinandana Swami, Gour Krishna, the three Japa collections)', app.includes('const SECTION_ART = {') && sw.includes('art/sections/sacinandana-swami.jpg')],
  ['App icon fills the Mac tile: the maskable icon is the edge-to-edge wave', read('site/manifest.webmanifest').includes('icons/maskable-full-512.png')],
  ['Lectures: its own section in the app (menu, Home card), behind a password; the list is only served after it, never from site/', read('worker/lectures.js').includes('LECTURES_PASSWORD') && read('worker/index.js').includes("'/api/lectures'") && app.includes('function lecturesView') && app.includes("const LECT_LIST = '/api/lectures'") && html.includes('data-nav="lectures"')],
  ['Lectures look like Apple Podcasts (show header, Continue listening, Year/Language menus, episode rows, load on scroll) and search forgives spellings', app.includes('function lectureRow') && app.includes('function lectCard') && app.includes('function watchLectureList') && app.includes('function lectNorm') && app.includes('const LECT_ALSO') && css.includes('.lect-show') && app.includes('when-paused')],
  // Lectures audit (25 Oct 2026).
  ['Lecture list kept on the device and fetched again only when it changes (ETag, 304)', app.includes('const LECT_CACHE') && app.includes("'If-None-Match'") && read('worker/lectures.js').includes('onlyIf: request.headers')],
  ['Lecture dates without a day or month read properly (no "Invalid Date"), and no time zone shifts a day', app.includes('function lectDate') && /const ymd = .*\\d\{4\}/.test(app)],
  ['Lecture lengths measured for the whole list (tools/lecture-lengths.json), shown on every row', read('tools/lectures.mjs').includes('async function lengthOf') && app.includes('l.dur ||')],
  ['Lecture search: book names in lectNorm spelling ("srimad"), numbers match whole numbers, keys made in idle time', app.includes('also.map(lectNorm)') && app.includes('const lectHit') && app.includes('function lectKeys')],
  ['Lecture player: back 15 / forward 30, own speed, no Share; lock screen skips for lectures only', html.includes('data-action="back15"') && css.includes('.player.lecture') && app.includes('LECT_SPEEDS') && app.includes("$('#player-share').hidden")],
  ['Search page shows Lectures even when no kirtan matches', !app.includes("if (!hits.length && !vids.length) return")],
  ['Lecture transcripts: follow-along sheet (tap a line to play, search), only with the password, never in site/ or git', html.includes('id="transcript-dialog"') && app.includes('function followTranscript') && read('worker/lectures.js').includes('lectures/transcripts/') && read('.gitignore').includes('build/') && !fs.existsSync(path.join(ROOT, 'site/transcripts'))
    && read('tools/transcribe.mjs').includes("'../Lecture transcripts.nosync'") && read('tools/transcribe.mjs').includes("'--condition-on-previous-text', 'False'")],
  ['Save offline for lectures: through the Worker (/lecture-audio/, password and Sacinandana Swami files only), kept across restarts, transcript kept too, in Library > Saved',
    read('worker/lectures.js').includes("url.pathname.startsWith('/lecture-audio/')") && read('worker/lectures.js').includes('_SSNS') && sw.includes('lecture-audio')
    && app.includes('savedLectures.add(path)') && app.includes('function keepTranscript') && app.includes('lecturesSaved')],
  ['Queue shows at most 100 upcoming; saved queue keeps the stretch around what plays', app.includes('upcoming.slice(0, 100)') && app.includes('Math.max(0, S.qi - 100)')],
  ['Light / dark appearance', app.includes('function setTheme') && html.includes("localStorage.getItem('kk.theme')")],
  ['Laptop-only light/dark switch hidden on phones', /\.theme-toggle\.side \{ display: none; \}/.test(css)],
  // Platform audit (22 Oct): smooth playback, as on SoundCloud and Spotify.
  ['Quick skips: only the latest kirtan tapped starts playing (loadSeq)', app.includes('let loadSeq = 0') && app.includes('if (seq !== loadSeq) return')],
  ['Dropped connection: playback picks up where it stopped', app.includes('const recovery = {') && app.includes('function resumeAfterDrop')],
  ['Offline: next/previous skip kirtans that are not saved', app.includes('function stepIndex') && app.includes('const playable =')],
  ['When a kirtan ends: Play next / Loop / Play once / Loop list (24 Oct)', app.includes('const REPEAT = {') && app.includes("once: { short: 'Play once'") && app.includes("S.repeat === 'once' || !next()") && html.includes('id="repeat-dialog"')],
  ['Next always works: a kirtan plays on through its whole page, and the queue carries on with the artist\'s next kirtans (keepListening)', app.includes('playList: keyPrefix') && app.includes('function keepListening') && app.includes('keepListening();')],
  ['Next starts quickly: the next kirtan\'s start is fetched ahead, unsaved audio streams without the service worker, no play-button flicker', app.includes('function prefetchNext') && sw.includes("url.searchParams.has('offline')) event.respondWith") && app.includes('if (S.switching) return;')],
  ['Kirtans list: kirtans with no picture, or whose picture was deleted in the sheet, get one from Thumbnails/SNS or GK (max 3 uses)', read('tools/sheet.mjs').includes('function allocatePictures') && read('tools/sheet.mjs').includes('MAX_USES = 3')],
  ['The home-screen app reloads itself when a new version is out (checkForUpdate), and a slow start still refreshes the saved page', app.includes('async function checkForUpdate') && sw.includes("url.searchParams.has('fresh')") && sw.includes('event.waitUntil(network.catch')],
  ['Lock screen shows next/previous kirtan, not 15/30-second skips (24 Oct)', app.includes('nexttrack: () => next()') && !app.includes('seekforward:') && !app.includes('seekbackward:')],
  ['Lock-screen buttons are set again on every "playing" (iPhones ignore them set earlier)', /addEventListener\('playing'[\s\S]{0,400}setMediaHandlers\(\)/.test(app)],
  ['Recordings loop and the jump back to the start counts as the end, so the next one starts on a locked iPhone', app.includes('audio.loop = true; // see recordingEnded') && app.includes('function recordingEnded') && app.includes("addEventListener('seeking'")],
  ['Spotify-style player: dark, blurred cover behind, shuffle/prev/play/next/repeat, queue with pictures and tiles (24 Oct)',
    html.includes('id="player-bg"') && html.includes('id="shuffle-btn"') && html.includes('class="queue-tiles"') && app.includes('function setShuffle') && css.includes('.player, #queue-dialog')],
  ['Spotify-style playlists: rows with covers (four-picture mosaic), big cover and round play button, ⋯ menu, pictures beside kirtans (24 Oct)',
    app.includes('function playlistCover') && app.includes('function openPlaylistMenu') && app.includes('class="pl-row"') && app.includes('thumb: true') && css.includes('.pl-mosaic')],
  ['Play, pause and skip icons are solid (fill set on the symbols, not only in CSS)', html.includes('class="fill" fill="currentColor" stroke="none"')],
  ['The playing kirtan is highlighted in every list (24 Oct)', css.includes('.track.playing { background: var(--teal-soft)') && app.includes('<span class="eq">')],
  ['Loading spinner while a kirtan buffers', app.includes('function setBuffering') && css.includes('.is-buffering')],
  ['Queue survives closing the app', app.includes('function saveQueue') && app.includes("store.get('queue'")],
  ['Phone back button closes the player instead of leaving the app', app.includes('history.pushState({ player: true }') && app.includes("addEventListener('popstate'")],
  ['Shared links (/k/<id>) show a preview with title and picture', read('worker/index.js').includes('sharePage(') && read('worker/share.js').includes('og:image') && app.includes('/k/${')],
  ['Recent searches and storage used on the Saved tab', app.includes('function rememberSearch') && app.includes('function showStorage')],
  ['Continue listening across devices (positions sync with the account)', read('site/library.js').includes('positions:') && app.includes('S.posAt')],
  ['Every kirtan levelled to the same loudness', read('tools/build.mjs').includes('TARGET_LUFS') && read('tools/build.mjs').includes('function levelling')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed: a fix has been undone. Restore it before publishing.`);
  process.exit(1);
}
