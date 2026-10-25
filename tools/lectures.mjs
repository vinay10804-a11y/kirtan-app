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
const LIBRARY = 'https://www.saranagati-library.net/';
const LANGUAGES = {
  EN: 'English', DE: 'German', RU: 'Russian', HR: 'Croatian', SR: 'Serbian', BS: 'Bosnian', HU: 'Hungarian',
  HI: 'Hindi', TA: 'Tamil', CZ: 'Czech', CS: 'Czech', PL: 'Polish', IT: 'Italian', ES: 'Spanish', FR: 'French',
  NL: 'Dutch', SL: 'Slovenian', SK: 'Slovak', UK: 'Ukrainian', LV: 'Latvian', LT: 'Lithuanian', BG: 'Bulgarian',
  RO: 'Romanian', PT: 'Portuguese', TR: 'Turkish', KZ: 'Kazakh', FI: 'Finnish', SV: 'Swedish', DA: 'Danish',
  SI: 'Slovenian', MK: 'Macedonian',
};
const BOOKS = { SB: 'SB', BG: 'BG', CC: 'CC', NOI: 'NOI', NOD: 'NOD', ISO: 'Iso' };
// Place codes we're sure of; the rest aren't shown until the owner says what they mean.
const PLACES = { GD: 'Goloka Dham', RD: 'Radhadesh', NV: 'New Vrindaban', NY: 'New York', GRC: 'Govardhan Retreat Center',
  ZG: 'Zagreb', LJ: 'Ljubljana', BEO: 'Belgrade' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Kirtan app lecture list (private test)' } });
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
  let ref = '';
  const book = /^([A-Z]{2,3})(\d[\d.,-]*)$/.exec(parts[0] || '');
  if (book && BOOKS[book[1]]) { ref = `${BOOKS[book[1]]} ${book[2]}`; parts.shift(); }
  const others = speakers.replace(/^SSNS-?/i, '');
  const withWhom = others && !/^others$/i.test(others) ? words(others) : '';
  const title = words(parts.join(' ')) || ref || 'Lecture';
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
    lectures.push({ id: createHash('sha1').update(f.file).digest('hex').slice(0, 12), url: f.url, size: f.size, ...info });
  }
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
