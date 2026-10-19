// Offline support: the app shell is cached so the site opens without a
// connection, and saved recordings (put in AUDIO_CACHE by app.js) are served
// from the device, including the byte-range requests audio players make.

const VERSION = '922abdd40c';
const SHELL_CACHE = `shell-${VERSION}`;
const AUDIO_CACHE = 'kirtan-audio';
const RUNTIME_CACHE = 'runtime';

const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'catalog.json', 'photos.json', 'videos.json', 'lyrics.json',
  'art/card-1.webp',
  'icons/icon-192.png', 'icons/favicon.png', 'apple-touch-icon.png',
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

  if (url.origin === location.origin && url.pathname.startsWith('/audio/')) {
    event.respondWith(audioResponse(req, url));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin === location.origin && DATA.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$|(^|\.)ytimg\.com$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
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
