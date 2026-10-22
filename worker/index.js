// Streams kirtan audio from R2 with HTTP Range support (needed for seeking,
// and by Safari for playback at all), and answers account requests at /api/*
// (worker/api.js). Everything else is a static asset.
// /media/ holds the current AAC files; /audio/ the older MP3s.
import { api } from './api.js';

const AUDIO_PATH = /^\/(media|audio)\//;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    if (AUDIO_PATH.test(url.pathname)) {
      return serveAudio(request, env, decodeURIComponent(url.pathname.slice(1)));
    }
    return env.ASSETS.fetch(request);
  },
};

async function serveAudio(request, env, key) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });

  if (request.method === 'HEAD') {
    const head = await env.AUDIO.head(key);
    if (!head) return new Response('Not found', { status: 404 });
    head.writeHttpMetadata(headers);
    headers.set('ETag', head.httpEtag);
    headers.set('Content-Length', String(head.size));
    return new Response(null, { headers });
  }

  const hasRange = request.headers.has('range');
  const obj = await env.AUDIO.get(key, hasRange ? { range: request.headers } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });

  obj.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'audio/mpeg');
  headers.set('ETag', obj.httpEtag);

  if (hasRange && obj.range) {
    const { offset, length } = resolveRange(obj.range, obj.size);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
}

// R2 reports either {offset, length} or {suffix}; normalise to offset/length.
function resolveRange(range, size) {
  if ('suffix' in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  const length = range.length ?? size - offset;
  return { offset, length };
}
