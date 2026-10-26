// Offline support: the app shell is cached so the site opens without a
// connection, and saved recordings (put in AUDIO_CACHE by app.js) are served
// from the device, including the byte-range requests audio players make.
// A slow or dead connection (e.g. on the Underground) falls back to the saved
// copies after a few seconds instead of leaving the app blank.

const VERSION = '6c3cb32103';
const SHELL_CACHE = `shell-${VERSION}`;
const AUDIO_CACHE = 'kirtan-audio';
const RUNTIME_CACHE = 'runtime';

// No 'index.html': it redirects to './', and browsers refuse a redirected
// response when opening a page, which stopped the app opening offline.
const SHELL = [
  './', `styles.css?v=${VERSION}`, `app.js?v=${VERSION}`, 'manifest.webmanifest',
  'catalog.json', 'photos.json', 'videos.json', 'lyrics.json', 'library.js',
  'art/card-1.webp',
  'art/sections/sacinandana-swami.jpg', 'art/sections/gour-krishna-2.jpg', 'art/sections/guided-japa.jpg',
  'art/sections/japa-inspirations.jpg', 'art/sections/living-name-meditations.jpg',
  'icons/icon-192.png', 'icons/favicon.png', 'apple-touch-icon.png',
  'fonts/eb-garamond-latin.woff2', 'fonts/eb-garamond-latin-ext.woff2',
  'fonts/eb-garamond-italic-latin.woff2', 'fonts/eb-garamond-italic-latin-ext.woff2',
];
const DATA = /\/(catalog|photos|videos|lyrics)\.json$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Audio: a saved recording asked for from the device (?offline=1) is served from
  // the cache; everything else streams straight from the network, untouched, which
  // starts sooner and is what iPhones handle best.
  if (url.origin === location.origin && /^\/(stream|media|audio|lecture-audio)\//.test(url.pathname)) {
    if (url.searchParams.has('offline')) event.respondWith(audioResponse(req, url));
    return;
  }
  // Accounts always go to the server, never to a stored copy.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;
  // So does the app's check for a new version (sw.js?fresh=…).
  if (url.origin === location.origin && url.searchParams.has('fresh')) return;
  if (req.mode === 'navigate') {
    event.respondWith(openPage(event, url));
    return;
  }
  // Styling and code carry their version (?v=, stamped by the build into
  // index.html), so a page only ever gets its own: that exact stored copy at
  // once, else the network. A stored copy of another version is never used.
  if (url.origin === location.origin && url.searchParams.has('v') && /\.(js|css)$/.test(url.pathname)) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  // Data, and anything unversioned, comes from the network when it answers;
  // offline it comes from the device.
  if (url.origin === location.origin && (DATA.test(url.pathname) || /\.(js|css|webmanifest)$/.test(url.pathname))) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$|(^|\.)(ytimg|sndcdn)\.com$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

// Rejects if the network hasn't answered in time, so a dead connection
// doesn't keep the app waiting.
function quickly(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

// A cached response that came through a redirect can't open a page; copy it into a plain one.
async function unredirected(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Opening the app: the network if it answers within 3 seconds, otherwise the saved
// page, so the app opens with no signal. Either way the saved page is refreshed
// when the network does answer, so a slow connection still gets the new version
// next time.
async function openPage(event, url) {
  const network = fetch(event.request).then(async res => {
    if (res.ok && url.pathname === '/') (await caches.open(SHELL_CACHE)).put('./', await unredirected(res.clone()));
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  try {
    return await quickly(network, 3000);
  } catch {
    const cached = await caches.match('./');
    return cached ? unredirected(cached) : Response.error();
  }
}

async function networkFirst(req) {
  try {
    const res = await quickly(fetch(req), 4000);
    if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const update = fetch(req).then(async res => {
    if (res.ok || res.type === 'opaque') (await caches.open(cached ? SHELL_CACHE : RUNTIME_CACHE)).put(req, res.clone());
    return res;
  }).catch(() => cached || Response.error());
  return cached || update;
}

async function audioResponse(req, url) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(url.pathname);
  if (!cached) return fetch(req);

  const range = req.headers.get('range');
  if (!range) return cached;

  const blob = await cached.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : blob.size - 1;
  if (m && !m[1] && m[2]) { start = blob.size - Number(m[2]); end = blob.size - 1; }
  end = Math.min(end, blob.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });

  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
