// AI transcripts of lectures, made on the owner's Mac with Whisper (mlx-whisper and the
// large-v3-turbo model). Owner's choices, 26 Oct 2026: a test on nine 2026 lectures, then every
// English lecture, kept on GitHub too so they can be used elsewhere one day.
//
// It runs on its own for days, so Claude needn't be open:
//  - closing the lid puts the Mac to sleep and simply pauses it; it carries on when the Mac wakes
//    (a download cut off meanwhile is tried again);
//  - it only works on mains power: on battery it waits for the charger, and while plugged in the
//    Mac is kept awake (caffeinate -s, started by the .command files);
//  - after a restart, double-click "Resume transcripts" in the Lecture transcripts folder
//    ("Stop transcripts" stops it; either way it carries on from where it was).
// Each lecture is downloaded from the Saranagati Library (the next one while this one is being
// transcribed), transcribed, and its MP3 deleted.
//
//   node tools/transcribe.mjs --english                 # every English lecture not yet done, newest first
//   node tools/transcribe.mjs --hours 10 [--year 2026]  # the newest English ones, up to 10 hours of audio
//   node tools/transcribe.mjs <id> <id> …               # particular lectures (ids from the lecture list)
//   … --upload                                          # put each online as it's done (R2), mark them in the
//                                                       # app's lecture list and save to GitHub every 25
//   node tools/transcribe.mjs --tidy [--upload]         # tidy the transcripts already made again (see tidy())
//
// Where things go:
//   ../Lecture transcripts.nosync/  beside the project: the private GitHub repo
//     vinay10804-a11y/lecture-transcripts (".nosync" keeps iCloud off its thousands of files)
//       json/<id>.json          { model, lang, made, segments: [[start, end, "text"], …] } (seconds)
//       srt/<year>/<date> <title>.srt   the same as subtitles, for other platforms and editors
//       lectures.json           every lecture (title, date, verse, place, language, length, url, tx)
//       Progress.txt            how far it has got, for the owner
//   R2 lectures/transcripts/<id>.json, which worker/lectures.js hands out only with the Lectures password.
//   tools/lecture-transcripts.json: which ids are transcribed and online (ids only), so
//     tools/lectures.mjs marks them (`tx`) and the app shows a Transcript button.
// Transcripts never go in this repo or site/: it's public, and the lectures are copyright
// SacinandanaSwami.com.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.resolve(ROOT, '../Lecture transcripts.nosync');
const WORK = path.join(ROOT, 'build/transcribe-work'); // MP3s and Whisper's own output, briefly
const LOCK = path.join(WORK, 'running.pid');
const DONE = path.join(ROOT, 'tools/lecture-transcripts.json');
const BATCH = 25; // lectures between saves to GitHub and updates of the app's lecture list
const MODEL = 'mlx-community/whisper-large-v3-turbo';
const LANG = { English: 'en', German: 'de', Russian: 'ru', Croatian: 'hr', Serbian: 'sr', Bosnian: 'bs', Hungarian: 'hu',
  Italian: 'it', Spanish: 'es', Slovenian: 'sl', Hindi: 'hi', Tamil: 'ta', Macedonian: 'mk', Turkish: 'tr', Lithuanian: 'lt', Portuguese: 'pt' };
// Only steers the first 30 seconds (each stretch is transcribed on its own, see whisper()), but helps there.
const PROMPT = 'A lecture by Sacinandana Swami. Krishna, Radharani, Caitanya Mahaprabhu, Nityananda, Srila Prabhupada, '
  + 'Srimad-Bhagavatam, Bhagavad-gita, Vrindavan, Govardhan, japa, kirtan, Hare Krishna maha-mantra, bhakti.';
const UA = { 'User-Agent': 'Kirtan app transcripts (private)' };
const wrangler = path.join(ROOT, 'node_modules/.bin/wrangler');

const args = process.argv.slice(2);
const english = args.includes('--english');
const hours = Number(args[args.indexOf('--hours') + 1]) || 0;
const year = Number(args[args.indexOf('--year') + 1]) || 0;
const upload = args.includes('--upload');
const retidy = args.includes('--tidy');
const ids = args.filter(a => /^[0-9a-f]{12}$/.test(a));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clock = s => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), ...a);
// Runs a program without blocking (downloads and uploads carry on meanwhile).
const run = (cmd, argv, opts = {}) => new Promise(resolve => {
  const p = spawn(cmd, argv, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const keep = d => { out = (out + d).slice(-4000); };
  p.stdout.on('data', keep);
  p.stderr.on('data', keep);
  p.on('close', status => resolve({ status, out }));
  p.on('error', err => resolve({ status: -1, out: String(err) }));
});

// Singing (kirtan, prayers) comes out as runs of "Oh", "I kiss", "Kissing"…, or as one line of
// a word over and over ("Hare, Hare, Hare…" for 30 seconds): a run of five or more one- or
// two-word lines, or a long line that's mostly one word, becomes one "♪ Singing ♪" line
// (next to each other, they're one), and lone "Oh"s and "Mm"s go.
const FILLER = /^(oh+|ah+|o|mm+|hmm+|uh|um|la)[.!?,]*$/i;
const SINGING = '♪ Singing ♪';
function looped(text) {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (words.length < 24) return false; // the whole maha-mantra once is 16 words, and may be spoken
  const n = {};
  for (const w of words) n[w] = (n[w] || 0) + 1;
  return Math.max(...Object.values(n)) / words.length > 0.4;
}
function tidy(segs) {
  segs = segs.map(s => (looped(s[2]) ? [s[0], s[1], SINGING] : s));
  const tiny = s => s[2] === SINGING || s[2].split(/\s+/).length <= 2;
  const out = [];
  for (let i = 0; i < segs.length;) {
    let j = i;
    while (j < segs.length && tiny(segs[j])) j++;
    if (j - i >= 5) {
      out.push([segs[i][0], segs[j - 1][1], SINGING]);
      i = j;
      continue;
    }
    if (!FILLER.test(segs[i][2])) out.push(segs[i]);
    i++;
  }
  return out.filter((s, i) => {
    const before = out[i - 1];
    if (s[2] !== SINGING || before?.[2] !== SINGING) return true;
    before[1] = s[1]; // joined to the singing line before
    return false;
  });
}

// The same lines as subtitles (SRT), which other platforms and video editors read.
const stamp = s => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = segs => segs.map(([a, b, text], i) => `${i + 1}\n${stamp(a)} --> ${stamp(b)}\n${text}\n`).join('\n');
let srtNames = new Map(); // id → file name (date and title; a short id is added where two would match)
function nameFiles(lectures) {
  const base = l => `${l.date} ${l.title}`.replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 140);
  const seen = {};
  for (const l of lectures) seen[base(l)] = (seen[base(l)] || 0) + 1;
  srtNames = new Map(lectures.map(l => [l.id, seen[base(l)] > 1 ? `${base(l)} (${l.id.slice(0, 4)})` : base(l)]));
}
const jsonFile = id => path.join(DIR, 'json', `${id}.json`);

async function save(l, t) {
  await fs.mkdir(path.join(DIR, 'json'), { recursive: true });
  await fs.writeFile(jsonFile(l.id), JSON.stringify(t));
  const file = path.join(DIR, 'srt', String(l.year), `${srtNames.get(l.id)}.srt`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, srt(t.segments));
}

// Whisper's own output (it writes NaN for some scores, which JSON doesn't allow), or null.
async function whisperOutput(file) {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const raw = text && JSON.parse(text.replace(/:\s*-?(NaN|Infinity)\b/g, ': null'));
  return raw?.segments?.length && !Array.isArray(raw.segments[0]) ? raw : null;
}

// Downloads, tried again (up to an hour or so) when the connection is gone, e.g. just after
// the Mac wakes.
async function download(l) {
  const mp3 = path.join(WORK, `${l.id}.mp3`);
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(l.url, { headers: UA });
      if (res.status === 404) return new Error('the library no longer has this file');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(mp3));
      return mp3;
    } catch (err) {
      if (i === 8) return new Error(`download failed: ${err.message}`);
      await sleep(Math.min(15 * 60, 30 * 2 ** (i - 1)) * 1000);
    }
  }
}

async function whisper(l, mp3) {
  const started = Date.now();
  // --condition-on-previous-text False: each stretch is transcribed on its own. Otherwise
  // Whisper locks into loops on chanting and kirtan (one word repeated for pages).
  const r = await run('mlx_whisper', [mp3, '--model', MODEL, '--output-format', 'json', '--output-dir', WORK,
    '--condition-on-previous-text', 'False', '--language', LANG[l.language] || 'en', '--initial-prompt', PROMPT, '--verbose', 'False']);
  await fs.rm(mp3, { force: true });
  if (r.status !== 0) throw new Error(`whisper failed: ${r.out.slice(-300)}`);
  const took = (Date.now() - started) / 1000;
  log(`  transcribed in ${Math.round(took / 60)} min (${(l.dur / took).toFixed(1)}× faster than listening)`);
  return whisperOutput(path.join(WORK, `${l.id}.json`));
}

function transcript(raw) {
  const segments = raw.segments
    .map(s => [Math.round(s.start * 10) / 10, Math.round(s.end * 10) / 10, s.text.trim()])
    .filter(([, , text]) => /[\p{L}\p{N}]/u.test(text)); // music notes and the like aren't words
  return { model: 'whisper-large-v3-turbo', lang: raw.language, made: today(), segments: tidy(segments) };
}

// Only on mains power: on battery it waits for the charger.
const onMains = () => /AC Power/.test(spawnSync('pmset', ['-g', 'ps'], { encoding: 'utf8' }).stdout || '');
async function waitForMains() {
  if (onMains()) return;
  log('On battery: waiting for the charger');
  while (!onMains()) await sleep(60_000);
  log('Charger connected: carrying on');
}

// Online: each transcript as it's done (one at a time, while the next is transcribed). A lecture
// counts as done once its transcript is online; if that fails, the next run uploads it again.
let done = {};
let uploads = Promise.resolve();
const r2put = (key, file) => run(wrangler, ['r2', 'object', 'put', `kirtans/${key}`, '--file', file, '--content-type', 'application/json', '--remote'], { cwd: ROOT });
function putOnline(id) {
  uploads = uploads.then(async () => {
    for (let i = 1; i <= 4; i++) {
      if ((await r2put(`lectures/transcripts/${id}.json`, jsonFile(id))).status === 0) {
        done[id] = today();
        await fs.writeFile(DONE, `${JSON.stringify(done, Object.keys(done).sort(), 1)}\n`);
        return;
      }
      await sleep(60_000 * i);
    }
    log(`  couldn't put ${id} online (tried again next run)`);
  });
}

// Every 25 lectures (and at the end): the app's lecture list marks the new transcripts, and
// the transcripts folder is saved to GitHub. The list is read afresh each time, so whatever
// else changed in it meanwhile (video links from tools/lecture-videos.mjs, a new
// tools/lectures.mjs run) is kept; only `tx` is this job's.
async function checkpoint(listFile) {
  await uploads;
  const list = JSON.parse(await fs.readFile(listFile, 'utf8'));
  const { lectures } = list;
  for (const l of lectures) if (done[l.id]) l.tx = 1; else delete l.tx;
  await fs.writeFile(listFile, JSON.stringify(list));
  // One lecture per line, so GitHub shows what changed.
  await fs.writeFile(path.join(DIR, 'lectures.json'), `{"source":${JSON.stringify(list.source)},"lectures":[\n${lectures.map(l => JSON.stringify(l)).join(',\n')}\n]}\n`);
  if (upload) {
    const r = await r2put('lectures/catalog.json', listFile);
    log(r.status === 0 ? 'App lecture list updated' : `App lecture list not updated: ${r.out.slice(-200)}`);
  }
  await run('git', ['-C', DIR, 'add', '-A']);
  const c = await run('git', ['-C', DIR, 'commit', '-q', '-m', `Transcripts: ${Object.keys(done).length} lectures`]);
  if (c.status === 0) {
    const p = await run('git', ['-C', DIR, 'push', '-q', 'origin', 'HEAD']);
    log(p.status === 0 ? 'Saved to GitHub' : `Not saved to GitHub this time: ${p.out.slice(-200)}`);
  }
}

// Progress.txt, for the owner: how many are done and roughly how long the rest will take.
async function progress(todo, next, secs, audio) {
  const left = todo.slice(next);
  const rate = secs ? audio / secs : 25; // how much faster than listening, so far
  const days = left.reduce((s, l) => s + l.dur, 0) / rate / 86400;
  await fs.writeFile(path.join(DIR, 'Progress.txt'), [
    `Lecture transcripts: ${Object.keys(done).length.toLocaleString('en-GB')} done.`,
    left.length ? `${left.length.toLocaleString('en-GB')} of this run's ${todo.length.toLocaleString('en-GB')} lectures still to do: about ${days < 1 ? `${Math.ceil(days * 24)} hours` : `${days.toFixed(1)} days`} of the Mac working (plugged in, lid open).` : 'This run is finished.',
    `Updated ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`,
    '',
  ].join('\n'));
}

async function main() {
  // One run at a time (Resume may be double-clicked while it's running).
  await fs.mkdir(WORK, { recursive: true });
  const other = Number(await fs.readFile(LOCK, 'utf8').catch(() => 0));
  if (other && other !== process.pid) {
    try { process.kill(other, 0); log('Already running.'); return; } catch {}
  }
  await fs.writeFile(LOCK, String(process.pid));
  process.on('exit', () => { try { if (Number(readFileSync(LOCK, 'utf8')) === process.pid) rmSync(LOCK); } catch {} });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => process.exit(0));
  for (const f of await fs.readdir(WORK)) if (f.endsWith('.mp3')) await fs.rm(path.join(WORK, f)); // cut-off downloads

  // The lecture list: the one tools/lectures.mjs made, else the copy in the transcripts folder.
  const listFile = existsSync(path.join(ROOT, 'build/lectures.json')) ? path.join(ROOT, 'build/lectures.json') : path.join(DIR, 'lectures.json');
  const list = JSON.parse(await fs.readFile(listFile, 'utf8'));
  const { lectures } = list;
  nameFiles(lectures);
  done = JSON.parse(await fs.readFile(DONE, 'utf8').catch(() => '{}'));

  if (retidy) {
    for (const l of lectures) {
      const t = JSON.parse(await fs.readFile(jsonFile(l.id), 'utf8').catch(() => 'null'));
      if (!t) continue;
      t.segments = tidy(t.segments);
      await save(l, t);
      if (upload) putOnline(l.id);
    }
    log('Tidied the transcripts already made');
  }

  let todo = ids.length ? lectures.filter(l => ids.includes(l.id)) : [];
  if (english || hours) {
    let total = 0;
    for (const l of lectures) {
      if (l.language !== 'English' || l.into || !l.dur || (year && l.year !== year)) continue;
      if (hours && total + l.dur > hours * 3600) continue;
      todo.push(l);
      total += l.dur;
    }
  }
  todo = todo.filter(l => !done[l.id]);
  const audioTotal = todo.reduce((s, l) => s + (l.dur || 0), 0);
  if (todo.length) log(`Transcribing ${todo.length} lectures, ${clock(audioTotal)} hours of audio`);

  // The next lecture downloads while this one is transcribed.
  const need = l => l && !existsSync(jsonFile(l.id)) && !existsSync(path.join(WORK, `${l.id}.json`));
  const fetched = new Map();
  const ahead = l => { if (need(l) && !fetched.has(l.id)) fetched.set(l.id, download(l)); };
  let secs = 0, audio = 0;
  for (const [i, l] of todo.entries()) {
    await waitForMains();
    ahead(l);
    ahead(todo[i + 1]);
    log(`${i + 1}/${todo.length} ${l.date} ${l.title} (${clock(l.dur)})`);
    const started = Date.now();
    try {
      if (!existsSync(jsonFile(l.id))) {
        // Whisper's output from a run that stopped short is used again.
        let raw = await whisperOutput(path.join(WORK, `${l.id}.json`));
        if (!raw) {
          const mp3 = await fetched.get(l.id);
          if (mp3 instanceof Error) throw mp3;
          raw = await whisper(l, mp3);
        }
        await save(l, transcript(raw));
        await fs.rm(path.join(WORK, `${l.id}.json`), { force: true });
        secs += (Date.now() - started) / 1000;
        audio += l.dur;
      }
      if (upload) putOnline(l.id);
    } catch (err) {
      log(`  skipped: ${err.message}`);
    }
    fetched.delete(l.id);
    await progress(todo, i + 1, secs, audio);
    if ((i + 1) % BATCH === 0) await checkpoint(listFile);
  }
  await checkpoint(listFile);
  await progress(todo, todo.length, secs, audio);
  log('Finished.');
}

main().catch(err => { console.error(err); process.exit(1); });
