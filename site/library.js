// A person's favourites and playlists in a form that two devices can merge:
// every favourite and every playlist carries the time it last changed (`at`),
// and for each one the later change wins. A deleted playlist stays as a small
// marker ({ deleted: true }) so a device that hasn't heard yet can't bring it back.
// Used by the app (app.js) and by the server (worker/api.js).
//
//   { favs:      { <track id>: { on: true|false, at } },
//     playlists: { <playlist id>: { name, ids: [track ids], created, at, deleted? } } }

const MAX_FAVS = 5000;
const MAX_PLAYLISTS = 300;
const MAX_TRACKS = 1000;

// Keeps only well-formed entries, so a broken or hostile payload can't be stored.
export function cleanLibrary(lib) {
  const out = { favs: {}, playlists: {} };
  const num = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
  for (const [k, v] of Object.entries(lib?.favs || {}).slice(0, MAX_FAVS)) {
    if (id(k) && v && typeof v === 'object') out.favs[k] = { on: v.on === true, at: num(v.at) };
  }
  for (const [k, v] of Object.entries(lib?.playlists || {}).slice(0, MAX_PLAYLISTS)) {
    if (!id(k) || !v || typeof v !== 'object') continue;
    out.playlists[k] = v.deleted === true
      ? { deleted: true, at: num(v.at) }
      : {
          name: String(v.name || 'Playlist').slice(0, 60),
          ids: (Array.isArray(v.ids) ? v.ids : []).filter(id).slice(0, MAX_TRACKS),
          created: num(v.created),
          at: num(v.at),
        };
  }
  return out;
}

export function mergeLibrary(a, b) {
  const x = cleanLibrary(a), y = cleanLibrary(b);
  const later = (p = {}, q = {}) => {
    const out = { ...p };
    for (const [k, v] of Object.entries(q)) if (!out[k] || v.at >= out[k].at) out[k] = v;
    return out;
  };
  return { favs: later(x.favs, y.favs), playlists: later(x.playlists, y.playlists) };
}
