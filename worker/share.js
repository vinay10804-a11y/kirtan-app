// Shared kirtan links, /k/<id>, with a preview: WhatsApp, Messages, Facebook and
// others read the page's Open Graph tags and show the kirtan's title, who leads
// it, and its picture, as SoundCloud links do. The page is the app itself
// (index.html with a <base> so its files load from the root); app.js turns the
// address into #/play/<id> and opens that kirtan in the player.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function duration(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${Math.max(1, m)} min`;
}

export async function sharePage(request, env, url) {
  const id = decodeURIComponent(url.pathname.slice(3)).replace(/[^A-Za-z0-9_-]/g, '');
  const asset = path => env.ASSETS.fetch(new Request(new URL(path, url.origin)));
  const [index, catalog, photos] = await Promise.all([
    asset('/').then(r => r.text()),
    asset('/catalog.json').then(r => r.json()).catch(() => ({ tracks: [] })),
    asset('/photos.json').then(r => r.json()).catch(() => []),
  ]);
  const t = (catalog.tracks || []).find(x => x.id === id && !x.hidden);

  const site = 'Sacinandana Swami';
  const title = t ? t.title : site;
  const description = t
    ? [t.artist, t.type === 'Bhajans' ? 'Bhajan' : 'Mahamantra kirtan', [t.place, t.year].filter(Boolean).join(' '), t.duration && duration(t.duration)].filter(Boolean).join(' · ')
    : 'Kirtans, bhajans and guided japa. Listen online or save for offline.';
  const picture = t?.cover || photos.find(p => p.person === t?.artist)?.src || 'icons/icon-512.png';
  const image = new URL(picture, url.origin).href;

  const tags = `<base href="/">
  <meta property="og:type" content="music.song">
  <meta property="og:site_name" content="${esc(site)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:url" content="${esc(url.href)}">
  <meta name="twitter:card" content="summary">`;
  const html = index
    .replace('<head>', `<head>\n  ${tags}`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(t ? `${title} · ${t.artist}` : site)}</title>`);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
