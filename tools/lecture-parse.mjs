// How a lecture's file name in the Saranagati Library becomes a lecture in the app, shared by
// tools/lectures.mjs (the full list, made on the Mac) and worker/recent-lectures.js (the newest
// lectures, checked by Cloudflare every 6 hours). Plain JavaScript, no Node or Worker APIs.
// File names look like
//   2025.12.16_SSNS_SB3.14.9_The-ultimate-formula-in-Krishna-Consciousness_BM_EN.mp3
//   date       speaker verse   title                                         place lang

export const LIBRARY = 'https://www.saranagati-library.net/';
export const UA = { 'User-Agent': 'Kirtan app lecture list (private test)' };

export const LANGUAGES = {
  EN: 'English', DE: 'German', RU: 'Russian', HR: 'Croatian', SR: 'Serbian', BS: 'Bosnian', HU: 'Hungarian',
  HI: 'Hindi', TA: 'Tamil', CZ: 'Czech', CS: 'Czech', PL: 'Polish', IT: 'Italian', ES: 'Spanish', FR: 'French',
  NL: 'Dutch', SL: 'Slovenian', SK: 'Slovak', UK: 'Ukrainian', LV: 'Latvian', LT: 'Lithuanian', BG: 'Bulgarian',
  RO: 'Romanian', PT: 'Portuguese', TR: 'Turkish', KZ: 'Kazakh', FI: 'Finnish', SV: 'Swedish', DA: 'Danish',
  SI: 'Slovenian', MK: 'Macedonian',
};
const BOOKS = { SB: 'SB', BG: 'BG', CC: 'CC', NOI: 'NOI', NOD: 'NOD', ISO: 'Iso' };
const CC_PARTS = { ad: 'Adi', adi: 'Adi', m: 'Madhya', ma: 'Madhya', madhya: 'Madhya', an: 'Antya', antya: 'Antya' };
// A verse at the start of the name: "SB3.14.9", "Bg9.14", "Noi7", "Cc.Ad5.204", "CC.M12.135-136".
function verse(s) {
  const cc = /^cc\.?(adi|ad|madhya|ma|m|antya|an)\.?(\d[\d.,-]*)$/i.exec(s);
  if (cc) return `CC ${CC_PARTS[cc[1].toLowerCase()]} ${cc[2]}`;
  const b = /^([a-z]{2,3})\.?(\d[\d.,-]*)$/i.exec(s);
  return b && BOOKS[b[1].toUpperCase()] ? `${BOOKS[b[1].toUpperCase()]} ${b[2]}` : '';
}
// A title that is only a book's initials ("SB") gets the book's name.
const BOOK_NAMES = { SB: 'Srimad-Bhagavatam', BG: 'Bhagavad-gita', CC: 'Caitanya-caritamrta', NOI: 'Nectar of Instruction', NOD: 'Nectar of Devotion' };
// Place codes → names (owner, 1 Nov 2026: lectures should show where they were given). The library's
// help page lists them; tools/lectures.mjs reads it and keeps the last good copy in
// tools/lecture-places.json. NAMES: the app's own spellings (as for kirtans), English names, and
// the library's typos; they win over the help page.
export const NAMES = {
  GD: 'Goloka Dham', NV: 'New Vrindaban', V: 'Vrindavan', GV: 'Govardhan', GR: 'Govardhan', GRC: 'Govardhan Retreat Center',
  NJNK: 'Simhachalam', MP: 'Mayapur', NM: 'New Mayapur', RK: 'Radha Kunda', KK: 'Kurukshetra', JP: 'Jagannatha Puri',
  HI: 'Himalayas', BEO: 'Belgrade', K: 'Cologne', N: 'Nuremberg', W: 'Vienna', BB: 'Böblingen', GO: 'Göttingen',
  TUE: 'Tübingen', GOE: 'Gothenburg', AD: 'Abu Dhabi', BEN: 'Bangalore', BN: 'Bhubaneswar', BEA: 'Beatenberg',
  CSC: 'Croatian Summer Camp', FG: 'Fruška Gora', KL: 'Karlovac', LE: 'Leicester', NS: 'Novi Sad', SO: 'Soho, London',
  JU: 'Juhu, Mumbai', MCC: 'Delphi University', VE: 'The Vedanta, Lincoln', IT: 'Italy',
};

// An Apache folder listing: each line has the file link, its date and its size ("59M").
export function listing(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a href="([^"?/][^"]*?\.mp3)">[^<]*<\/a>\s+(\S+ \S+)\s+(\S+)/gi)) {
    let file;
    try { file = decodeURIComponent(m[1]); } catch { continue; }
    out.push({ file, url: new URL(m[1], base).href, size: m[3] });
  }
  return out;
}

const words = s => s.replace(/--/g, ' – ').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

// Reads a file name into its parts; returns null for files that don't follow the pattern.
// `places` maps place codes to names (help page + NAMES).
export function parse(file, places) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})_([^_]+)_(.+)\.mp3$/i.exec(file);
  if (!m) return null;
  const [, y, mo, d, speakers, rest] = m;
  if (!/^SSNS/i.test(speakers)) return null; // Sacinandana Swami's lectures only
  const parts = rest.split('_');
  // The language is the last part ("EN"; "EN-DE" when translated); a place code there means none given.
  const tongue = /^([A-Z]{2})(?:-([A-Z]{2}))?(?:edit)?$/i.exec(parts.at(-1) || '');
  const lang = tongue && LANGUAGES[tongue[1].toUpperCase()] ? (parts.pop(), tongue[1].toUpperCase()) : '';
  const into = lang && tongue[2] ? LANGUAGES[tongue[2].toUpperCase()] : '';
  const place = parts.length > 1 && (/^[A-Z0-9]{1,6}$/.test(parts.at(-1)) || places[parts.at(-1).toUpperCase()]) ? parts.pop() : '';
  const ref = verse(parts[0] || '');
  if (ref) parts.shift();
  const others = speakers.replace(/^SSNS-?/i, '');
  const withWhom = others && !/^others$/i.test(others) ? words(others) : '';
  // "Retreat1" reads as "Retreat 1"; a title that's only "Part 2" names its verse too.
  let title = words(parts.join(' ')).replace(/([a-z])(\d+)\b/g, '$1 $2');
  if (/^(part|teil) \d+$/i.test(title) && ref) title = `${ref} – ${title}`;
  title = BOOK_NAMES[title] || title || ref || 'Lecture';
  return {
    date: `${y}-${mo}-${d === '00' ? '' : d}`.replace(/-$/, ''),
    year: Number(y),
    title,
    ref,
    with: withWhom,
    place: places[place.toUpperCase()] || '',
    code: place,
    lang,
    language: LANGUAGES[lang] || 'Other',
    ...(into && { into }),
  };
}

// A lecture's length from the first 4 KB of its MP3, without downloading it: the frame count
// in its Xing/Info header when there is one, else (file size − ID3 tag) × 8 ÷ bitrate (the
// library's files are all constant bitrate). 0 when it can't be read.
const KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
async function bytes(url, from, to) {
  const res = await fetch(url, { headers: { ...UA, Range: `bytes=${from}-${to}` } });
  if (res.status !== 206) return {};
  return { b: new Uint8Array(await res.arrayBuffer()), total: Number(/\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1]) };
}
const latin1 = (b, from, to) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));
export async function lengthOf(url) {
  let { b, total } = await bytes(url, 0, 4095);
  if (!b || !total) return 0;
  let start = 0;
  if (latin1(b, 0, 3) === 'ID3') {
    start = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
    if (start > b.length - 300) ({ b } = await bytes(url, start, start + 4095)); else b = b.subarray(start);
    if (!b) return 0;
  }
  let i = 0;
  while (i < b.length - 4 && !(b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0 && (b[i + 2] >> 4) % 15)) i++;
  const ver = (b[i + 1] >> 3) & 3;
  const kbps = KBPS[ver === 3 ? 1 : 2][b[i + 2] >> 4];
  const rate = RATES[ver]?.[(b[i + 2] >> 2) & 3];
  if (!kbps || !rate) return 0;
  const head = latin1(b, i, i + 200);
  const x = Math.max(head.indexOf('Xing'), head.indexOf('Info'));
  const p = i + x + 8;
  if (x > 0 && b[i + x + 7] & 1) return Math.round(((b[p] << 24 >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]) * (ver === 3 ? 1152 : 576) / rate);
  return Math.round((total - start - i) * 8 / (kbps * 1000));
}

// The id the app knows a lecture by: the first 12 hex digits of the SHA-1 of its file name.
export async function lectureId(file) {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(file));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
