// The Lectures test section (owner, 25 Oct 2026): Sacinandana Swami's lectures from the
// Saranagati Library (https://www.saranagati-library.net), listed in the app but played
// straight from the library, so nothing is copied or stored on Cloudflare except the list.
//
//   node tools/lectures.mjs            # reads the library's year folders → build/lectures.json
//   node tools/lectures.mjs --upload   # …and puts the list in R2 (kirtans/lectures/catalog.json)
//
// The list is private: it lives in R2, not in site/, and the Worker only hands it out after
// the Lectures password (see worker/lectures.js). File names look like
//   2025.12.16_SSNS_SB3.14.9_The-ultimate-formula-in-Krishna-Consciousness_BM_EN.mp3
//   date       speaker verse   title                                         place lang

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build/lectures.json');
const LENGTHS = path.join(ROOT, 'tools/lecture-lengths.json'); // { id: seconds }, so only new lectures are measured
const LIBRARY = 'https://www.saranagati-library.net/';
const UA = { 'User-Agent': 'Kirtan app lecture list (private test)' };
const LANGUAGES = {
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
// Place codes we're sure of; the rest aren't shown until the owner says what they mean.
const PLACES = { GD: 'Goloka Dham', RD: 'Radhadesh', NV: 'New Vrindaban', NY: 'New York', GRC: 'Govardhan Retreat Center',
  ZG: 'Zagreb', LJ: 'Ljubljana', BEO: 'Belgrade' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.text();
      if (res.status === 404) return '';
    } catch {}
    await sleep(1000 * (i + 1));
  }
  throw new Error(`Couldn't read ${url}`);
}

// An Apache folder listing: each line has the file link, its date and its size ("59M").
function listing(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a href="([^"?/][^"]*?\.mp3)">[^<]*<\/a>\s+(\S+ \S+)\s+(\S+)/gi)) {
    out.push({ file: decodeURIComponent(m[1]), url: new URL(m[1], base).href, size: m[3] });
  }
  return out;
}

const words = s => s.replace(/--/g, ' – ').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

// Reads a file name into its parts; returns null for files that don't follow the pattern.
function parse(file) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})_([^_]+)_(.+)\.mp3$/i.exec(file);
  if (!m) return null;
  const [, y, mo, d, speakers, rest] = m;
  if (!/^SSNS/i.test(speakers)) return null; // Sacinandana Swami's lectures only
  const parts = rest.split('_');
  // The language is the last part ("EN"; "EN-DE" when translated); a place code there means none given.
  const tongue = /^([A-Z]{2})(?:-([A-Z]{2}))?(?:edit)?$/i.exec(parts.at(-1) || '');
  const lang = tongue && LANGUAGES[tongue[1].toUpperCase()] ? (parts.pop(), tongue[1].toUpperCase()) : '';
  const into = lang && tongue[2] ? LANGUAGES[tongue[2].toUpperCase()] : '';
  const place = parts.length > 1 && /^[A-Z0-9]{1,6}$/.test(parts.at(-1)) ? parts.pop() : '';
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
    place: PLACES[place] || '',
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
  return { b: Buffer.from(await res.arrayBuffer()), total: Number(/\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1]) };
}
async function lengthOf(url) {
  let { b, total } = await bytes(url, 0, 4095);
  if (!b || !total) return 0;
  let start = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') {
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
  const head = b.toString('latin1', i, i + 200);
  const x = Math.max(head.indexOf('Xing'), head.indexOf('Info'));
  if (x > 0 && b[i + x + 7] & 1) return Math.round(b.readUInt32BE(i + x + 8) * (ver === 3 ? 1152 : 576) / rate);
  return Math.round((total - start - i) * 8 / (kbps * 1000));
}

async function measure(lectures) {
  const known = JSON.parse(await fs.readFile(LENGTHS, 'utf8').catch(() => '{}'));
  const todo = lectures.filter(l => !known[l.id]);
  let done = 0;
  const worker = async () => {
    for (let l; (l = todo.shift());) {
      known[l.id] = await lengthOf(l.url).catch(() => 0) || undefined;
      if (++done % 100 === 0) {
        process.stdout.write(`\r  measured ${done} lectures, ${todo.length} to go`);
        await fs.writeFile(LENGTHS, JSON.stringify(known));
      }
    }
  };
  if (todo.length) {
    await Promise.all([1, 2, 3, 4].map(worker)); // four at a time, to go easy on the library
    process.stdout.write('\n');
  }
  const ids = new Set(lectures.map(l => l.id));
  const kept = Object.fromEntries(Object.entries(known).filter(([id, s]) => ids.has(id) && s));
  await fs.writeFile(LENGTHS, `${JSON.stringify(kept, null, 0).replace(/,"/g, ',\n"')}\n`);
  for (const l of lectures) if (kept[l.id]) l.dur = kept[l.id];
  const missing = lectures.filter(l => !l.dur).length;
  if (missing) console.log(`  ${missing} lectures' lengths couldn't be read (they'll be learnt when played)`);
}

async function main() {
  const home = await page(LIBRARY);
  const years = [...new Set([...home.matchAll(/href="\/(\d{4})\/"/g)].map(m => m[1]))].sort();
  const seen = new Map();
  for (const y of years) {
    const base = `${LIBRARY}${y}/`;
    for (const f of listing(await page(base), base)) if (!seen.has(f.file)) seen.set(f.file, f);
    process.stdout.write(`\r  read ${y} (${seen.size} files so far)`);
    await sleep(150);
  }
  // Files listed only on the home page (the newest ones).
  for (const f of listing(home, LIBRARY)) if (!seen.has(f.file)) seen.set(f.file, f);
  process.stdout.write('\n');

  const lectures = [];
  let skipped = 0;
  for (const f of seen.values()) {
    const info = parse(f.file);
    if (!info) { skipped++; continue; }
    const { lang, ...rest } = info;
    lectures.push({ id: createHash('sha1').update(f.file).digest('hex').slice(0, 12), url: f.url, ...rest });
  }
  await measure(lectures);
  // Lectures with an AI transcript (tools/transcribe.mjs) get a Transcript button in the app.
  const transcribed = JSON.parse(await fs.readFile(path.join(ROOT, 'tools/lecture-transcripts.json'), 'utf8').catch(() => '{}'));
  for (const l of lectures) if (transcribed[l.id]) l.tx = 1;
  // …and those with the same talk on YouTube a Video button (tools/youtube-links.mjs).
  const videos = JSON.parse(await fs.readFile(path.join(ROOT, 'tools/youtube-links.json'), 'utf8').catch(() => '{}')).lectures || {};
  for (const l of lectures) if (videos[l.id]) l.yt = videos[l.id];
  lectures.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  const byLang = {};
  for (const l of lectures) byLang[l.language] = (byLang[l.language] || 0) + 1;
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), source: LIBRARY, lectures }));
  console.log(`Lectures: ${lectures.length} (${Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}); ${skipped} other files left out → ${path.relative(ROOT, OUT)}`);

  if (process.argv.includes('--upload')) {
    const r = spawnSync(path.join(ROOT, 'node_modules/.bin/wrangler'),
      ['r2', 'object', 'put', 'kirtans/lectures/catalog.json', '--file', OUT, '--content-type', 'application/json', '--remote'],
      { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Upload failed: ${(r.stderr || r.stdout).slice(-400)}`);
    console.log('Uploaded the lecture list to R2 (kirtans/lectures/catalog.json).');
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
