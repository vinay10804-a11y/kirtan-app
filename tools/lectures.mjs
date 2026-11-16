// The Lectures test section (owner, 25 Oct 2026): Sacinandana Swami's lectures from the
// Saranagati Library (https://www.saranagati-library.net), listed in the app but played
// straight from the library, so nothing is copied or stored on Cloudflare except the list.
//
//   node tools/lectures.mjs            # reads the library's year folders → build/lectures.json
//   node tools/lectures.mjs --upload   # …and puts the list in R2 (kirtans/lectures/catalog.json)
//                                      # (and the disciple meetings in kirtans/lectures/dm-catalog.json)
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
import { LIBRARY, UA, NAMES, listing, parse as parseName, lengthOf } from './lecture-parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build/lectures.json');
const DM_OUT = path.join(ROOT, 'build/disciple-meetings.json');
const LENGTHS = path.join(ROOT, 'tools/lecture-lengths.json'); // { id: seconds }, so only new lectures are measured
// Parsing names, places and lengths is in lecture-parse.mjs, shared with the Worker's 6-hourly check
// for new lectures (worker/recent-lectures.js). The library's place list is kept here.
const PLACE_FILE = path.join(ROOT, 'tools/lecture-places.json');
let PLACES = {};
const parse = file => parseName(file, PLACES);
async function placeNames() {
  const saved = JSON.parse(await fs.readFile(PLACE_FILE, 'utf8').catch(() => '{}'));
  const html = await page(`${LIBRARY}help.html`).catch(() => '');
  const text = html.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').split('Locations:')[1] || '';
  const read = {};
  for (const m of text.matchAll(/^\s*([A-Za-z]{1,5}) - (.+?)\s*$/gm)) {
    const [where, country] = m[2].split(/,\s*|\s+-\s+/);
    read[m[1].toUpperCase()] = /^unknown$/i.test(where) ? country : where;
  }
  // A page that couldn't be read (or has changed shape) keeps the last list.
  const found = Object.keys(read).length > 50 ? read : saved;
  if (found === read) await fs.writeFile(PLACE_FILE, `${JSON.stringify(read, Object.keys(read).sort(), 1)}\n`);
  return { ...found, ...NAMES };
}

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

// Disciple meetings (owner, 1 Nov 2026): the library's private dm/ folder, for a part of Lectures
// with its own password. The folder needs the library's login, but its file names are in the
// library's public index of every file (start_url_file.html), so the list is made from that,
// with no login; the recordings come through the Worker, which has the login (/dm-audio/ in
// worker/lectures.js). Their lengths aren't measured (that needs the login): the app learns
// each one when it's played. When the index can't be read, the last list is kept.
async function discipleMeetings() {
  const index = await page(`${LIBRARY}start_url_file.html`).catch(() => '');
  // The newest are in dm/ and in dm/<year>/ as well: one of each, the year folder's.
  const files = new Map();
  for (const m of index.matchAll(/href="https?:\/\/[^/"]+\/dm\/([^"]+?\.mp3)"/gi)) {
    let file;
    try { file = decodeURIComponent(m[1]); } catch { continue; }
    const name = file.split('/').pop();
    if (!files.has(name) || !files.get(name).includes('/')) files.set(name, file);
  }
  if (!files.size) return console.log("Disciple meetings: couldn't read the library's index; the last list is kept");
  const meetings = [];
  for (const [name, file] of files) {
    const info = parse(name);
    if (!info?.year) continue; // one recording has no date (0000.00.00)
    const { lang, ...rest } = info;
    // "DM – Treasures from Vrndavana" is just "Treasures from Vrndavana" here (and "Vyasapuja – DM –
    // Authenticity" "Vyasapuja – Authenticity"); a bare "DM 1" is "Disciple meeting 1".
    rest.title = /^DM( \d+)?$/.test(rest.title) ? `Disciple meeting${rest.title.slice(2)}`
      : rest.title.replace(/^DM(?: –)? (?=\D)/, '').replace(/ – DM – /, ' – ');
    meetings.push({ id: createHash('sha1').update(`dm/${file}`).digest('hex').slice(0, 12), path: encodeURI(file), ...rest });
  }
  meetings.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  await fs.writeFile(DM_OUT, JSON.stringify({ generated: new Date().toISOString(), lectures: meetings }));
  console.log(`Disciple meetings: ${meetings.length} → ${path.relative(ROOT, DM_OUT)}`);
}

async function main() {
  PLACES = await placeNames();
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
  await discipleMeetings();
  console.log(`Lectures: ${lectures.length} (${Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}); ${skipped} other files left out → ${path.relative(ROOT, OUT)}`);

  if (process.argv.includes('--upload')) {
    const r = spawnSync(path.join(ROOT, 'node_modules/.bin/wrangler'),
      ['r2', 'object', 'put', 'kirtans/lectures/catalog.json', '--file', OUT, '--content-type', 'application/json', '--remote'],
      { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Upload failed: ${(r.stderr || r.stdout).slice(-400)}`);
    console.log('Uploaded the lecture list to R2 (kirtans/lectures/catalog.json).');
    if (await fs.access(DM_OUT).then(() => true, () => false)) {
      const dm = spawnSync(path.join(ROOT, 'node_modules/.bin/wrangler'),
        ['r2', 'object', 'put', 'kirtans/lectures/dm-catalog.json', '--file', DM_OUT, '--content-type', 'application/json', '--remote'],
        { cwd: ROOT, encoding: 'utf8' });
      if (dm.status !== 0) throw new Error(`Upload failed: ${(dm.stderr || dm.stdout).slice(-400)}`);
      console.log('Uploaded the disciple meetings to R2 (kirtans/lectures/dm-catalog.json).');
    }
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
