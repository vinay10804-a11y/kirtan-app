// A person's favourites and playlists in a form that two devices can merge:
// every favourite and every playlist carries the time it last changed (`at`),
// and for each one the later change wins. A deleted playlist stays as a small
// marker ({ deleted: true }) so a device that hasn't heard yet can't bring it back.
// Used by the app (app.js) and by the server (worker/api.js).
//
//   { favs:      { <track id>: { on: true|false, at } },
//     playlists: { <playlist id>: { name, ids: [track ids], created, at, deleted? } },
//     positions: { <track id>: { pos: seconds (0 = finished or started again), at } },
//     last:      { id: <track id>, at } }   // what was playing last, on any device

const MAX_FAVS = 5000;
const MAX_PLAYLISTS = 300;
const MAX_TRACKS = 1000;
const MAX_POSITIONS = 500;

// Keeps only well-formed entries, so a broken or hostile payload can't be stored.
export function cleanLibrary(lib) {
  const out = { favs: {}, playlists: {}, positions: {}, last: null };
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
  for (const [k, v] of Object.entries(lib?.positions || {}).slice(0, MAX_POSITIONS)) {
    if (id(k) && v && typeof v === 'object') out.positions[k] = { pos: num(v.pos), at: num(v.at) };
  }
  if (lib?.last && id(lib.last.id)) out.last = { id: lib.last.id, at: num(lib.last.at) };
  return out;
}

export function mergeLibrary(a, b) {
  const x = cleanLibrary(a), y = cleanLibrary(b);
  const later = (p = {}, q = {}) => {
    const out = { ...p };
    for (const [k, v] of Object.entries(q)) if (!out[k] || v.at >= out[k].at) out[k] = v;
    return out;
  };
  return {
    favs: later(x.favs, y.favs),
    playlists: later(x.playlists, y.playlists),
    positions: later(x.positions, y.positions),
    last: !x.last ? y.last : !y.last ? x.last : y.last.at >= x.last.at ? y.last : x.last,
  };
}
