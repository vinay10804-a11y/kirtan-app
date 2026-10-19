// Works out section, artist, type, place, year and a clean title from a file's
// path inside the Kirtans folder. Tune the patterns here if a track lands in
// the wrong place, then re-run the build.
//
//   Kirtans/Japa/<Collection>/...   → section "japa", type = collection name
//   Kirtans/<anything else>         → section "kirtan", type = Mahamantra | Bhajans
//
// Only Sacinandana Swami and Gour Krishna appear in the app; a kirtan that
// matches neither gets artist null and the build lists it as skipped.

import path from 'node:path';

export const ARTISTS = [
  // `pattern` decides who a file belongs to; `name` is what gets cut out of a title
  // (narrower, so "He Govinda, He Gopal" keeps its "Gopal").
  { name: 'Sacinandana Swami', pattern: /s[ae]?c?h?i\s*nandana(\s*swami|\s*maharaj)?|sacinandan|\bS\.?N\.?S\.?\b|\bS\.?S\.?\b/i,
    strip: /(?:HH\s+)?s[ae]?c?h?i\s*nandana(?:\s*swami|\s*maharaj)?|\bSNS\b/i },
  { name: 'Gour Krishna', pattern: /g[ao]u?ra?\s*kr?i?s?h?na|\bgour\b|\bgaur\b|gopal(\s*kr?i?s?h?na)?|radhanath(\s*swami)?|\bR\.?N\.?S\.?\b|\bG\.?K\.?\b/i,
    strip: /g[ao]u?ra?[\s-]*kr?i?s?h?na(?:\s*(?:prabhu|dasa?))?|\bGK\b/i },
];

// Order the Japa collections appear in the app; unknown folders sort after.
export const JAPA_COLLECTIONS = ['Guided Japa', 'Japa Inspirations', 'Living Name Meditations'];

// Holy places and temples that show up in kirtan titles and folder names.
// More specific names come first ("New Vrindaban" before "Vrindavan").
const PLACES = [
  ['New Vrindaban', /new\s*vrinda?[bv]an/i],
  ['Vrindavan', /vr[iṛ]?n?d[aā]v[aā]na?|vrindaban|brindavan|krishna\s*balaram\s*mandir|madan\s*mohan\s*temple/i],
  ['Mayapur', /m[aā]y[aā]pura?/i],
  ['Govardhan', /gov[ae]rdh?ana?|kusum\s*sarovara?|haridev|mansi\s*ganga/i],
  ['Radha Kunda', /r[aā]dh[aā][\s-]*ku[nṇ][dḍ]a/i],
  ['Jagannath Puri', /jagannath[a]?\s*puri|\bpuri\b/i],
  ['Navadvip', /nava?dv[iī]pa?|nabadwip/i],
  ['Mumbai', /mumbai|bombay|chowpatty|juhu/i],
  ['Pune', /\bpune\b/i],
  ['Delhi', /\bdelhi\b/i],
  ['London', /london|bhaktivedanta\s*manor/i],
  ['Radhadesh', /radhadesh/i],
  ['Simhachalam', /simhachalam/i],
  ['Berlin', /\bberlin\b/i],
  ['Bahrain', /bahrain/i],
  ['Switzerland', /switzerland/i],
  ['Goloka Dham', /goloka\s*dham/i],
  ['Gita Nagari', /gita\s*nagari/i],
];

const MAHAMANTRA = /hare\s*kr?i?s?h?n|maha\s*-?\s*mantra|mahamantra|\bH\.?K\.?\b|hari\s*-?\s*n[aā]m/i;
const BHAJAN = /bhajan/i;
// Named songs and prayers are bhajans; any other kirtan is a mahamantra kirtan.
const BHAJAN_SONG = /bhajan|astaka?m|prayers?|jaya\s*radha\s*madhava|emona\s*durmati|\bnitai\b|doya\s*koro|karuna\s*koro|mama\s*mana\s*mandire|radharaman\s*kaho|\bhe\s*govinda|jaya\s*jaya\s*radhe|sakhi\s*he/i;
const YEAR = /(?:^|\D)(19[89]\d|20[0-4]\d)(?!\d)/g;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})\s+/;
// A filename part that is only a date: "2019", "12-2022", "28-11-2023" or "051219" (ddmmyy).
const DATE_PART = /^(?:(?:\d{1,2}[-.\/])?\d{1,2}[-.\/])?(?:19|20)\d\d$|^\d{6}$/;
const DMY = /(?:^|\|)\s*(\d{2})-(\d{2})-((?:19|20)\d\d)\s*(?:\||$)/;
const DMY_SHORT = /(?:^|\|)\s*\d{4}(\d{2})\s*(?:\||$)/;

export function isSpeech(rel) {
  return /^japa$/i.test(rel.split(path.sep)[0]);
}

export function classify(rel, tagTitle = '') {
  const parts = rel.split(path.sep);
  const base = path.basename(rel, path.extname(rel));
  const folders = parts.slice(0, -1);
  const dmy = base.match(DMY);
  const date = base.match(DATE_PREFIX)?.slice(1, 4).join('-') || (dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null);

  const years = [...rel.matchAll(YEAR)].map(m => Number(m[1]));
  const short = base.match(DMY_SHORT);
  const year = date ? Number(date.slice(0, 4)) : years.length ? years[years.length - 1] : short ? 2000 + Number(short[1]) : null;
  const place = placeFor(rel, null);
  // Hand-named files ("Artist | Title | Place | Date") read better than their embedded tags.
  const named = base.includes('|');
  const title = cleanTitle(named ? base : tagTitle || base.replace(DATE_PREFIX, '').replace(/^undated\s+/, ''), place);

  if (isSpeech(rel)) {
    const type = folders[1] || 'Japa';
    // "Guided Japa – Day 3" inside the Guided Japa collection reads better as "Day 3".
    const short = tidy(title.replace(new RegExp(type.replace(/s$/, '') + 's?', 'i'), ' '));
    return { section: 'japa', title: short.length >= 3 ? short : title, artist: 'Sacinandana Swami', type, year, date, album: null, place: null };
  }

  const artist = ARTISTS.find(a => a.pattern.test(rel))?.name || null;

  // A folder explicitly called "Bhajans" wins; then the mahamantra named outright;
  // then a named song; anything else is a mahamantra kirtan.
  const type = folders.some(f => BHAJAN.test(f)) ? 'Bhajans'
    : MAHAMANTRA.test(base) ? 'Mahamantra'
    : BHAJAN_SONG.test(base) ? 'Bhajans'
    : 'Mahamantra';

  // Innermost folder that isn't just the artist, type or year: often an event or album.
  const album = [...folders].reverse().find(f =>
    !ARTISTS.some(a => a.pattern.test(f)) &&
    !BHAJAN.test(f) && !/^\s*(hare\s*kr?i?s?h?na|maha\s*mantra|kirtans?)\s*$/i.test(f) && !/^\s*\d{4}\s*$/.test(f)
  ) || null;

  return { section: 'kirtan', title, artist, type, year, date, album, place: placeFor(rel, album) };
}

// A known holy place named anywhere in the path, else the album/event folder
// name without its year ("2024 Holy Name Retreat" → "Holy Name Retreat").
function placeFor(rel, album) {
  const known = PLACES.find(([, re]) => re.test(rel));
  if (known) return known[0];
  if (!album) return null;
  const name = tidy(album.replace(/(?:^|\s)(19|20)\d\d(?=\s|$)/g, ' ').replace(/[()[\]]/g, ' '));
  return name.length >= 3 ? name : null;
}

function cleanTitle(raw, place = null) {
  if (raw.includes('|')) return pipedTitle(raw, place);
  let t = raw
    .replace(/[_]+/g, ' ')
    .replace(/^\s*\d{1,3}\s*[-.)]\s*/, '')          // leading track number "01 - "
    .replace(/^\s*(?:19|20)\d\d\s*[-–.]?\s+(?=\S{3})/, '')  // leading year "2018 Damodarastakam"
    .replace(/\s*\((official|audio|lyrics?)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')              // [youtube-id] style suffixes
    .replace(/\s{2,}/g, ' ')
    .trim();
  for (const a of ARTISTS) {
    const g = new RegExp(`\\s*(?:with|by|-|–|\\|)?\\s*(?:${a.strip.source})`, 'gi');
    const stripped = tidy(t.replace(g, ' '));
    if (stripped.length >= 3) t = stripped;
  }
  return t || raw;
}

// "Gour Krsna & Manu | Guruvastakam | 31-01-2026" → "Guruvastakam (with Manu)".
// Date-only parts and the part that is just the place are dropped (the app shows
// year and place on their own); a co-singer next to the artist becomes "with …".
function pipedTitle(raw, place) {
  const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
  const withs = [];
  const keep = [];
  for (const p of parts) {
    const artist = ARTISTS.find(a => a.strip.test(p));
    if (artist) {
      const other = p.replace(new RegExp(artist.strip.source, 'gi'), ' ').replace(/^[\s&,]+|[\s&,]+$/g, '').trim();
      if (other) withs.push(other);
    } else if (!DATE_PART.test(p) && !(place && p.toLowerCase() === place.toLowerCase())) {
      keep.push(p);
    }
  }
  if (!keep.length && place) keep.push(place);
  const t = keep.join(' · ') + (withs.length ? ` (with ${withs.join(', ')})` : '');
  return t || raw;
}

// Collapse separators left behind after removing a name, e.g. "Guided Japa  /  / Day 1".
function tidy(s) {
  return s
    .replace(/\s*([\/⧸|–-])\s*(?=[\/⧸|–-])/g, '')
    .replace(/\s*([\/⧸|–-])\s*/g, ' $1 ')
    .replace(/^[\s\/⧸|–\-:,]+|[\s\/⧸|–\-:,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
