// AI transcripts of lectures, made on the owner's Mac with Whisper (mlx-whisper and the
// large-v3-turbo model; owner's choice, 26 Oct 2026, starting with a test on the newest 2026
// lectures). It runs on its own, so Claude needn't be open: keep the Mac awake and plugged in.
// Each lecture is downloaded from the Saranagati Library, transcribed, and its MP3 deleted.
//
//   node tools/transcribe.mjs --hours 10        # the newest English lectures not yet done, up to 10 hours of audio
//   … --year 2026                               # only that year's
//   node tools/transcribe.mjs <id> <id> …       # particular lectures (ids from build/lectures.json)
//   … --upload                                  # then put the transcripts in R2 and mark them in the lecture list
//   node tools/transcribe.mjs --tidy            # tidy the transcripts already made again (see tidy())
//
// Transcripts are private: they're kept in build/transcripts/<id>.json (never in git; the repo
// is public) and in R2 at lectures/transcripts/<id>.json, which worker/lectures.js hands out
// only with the Lectures password. tools/lecture-transcripts.json lists which lectures have one
// (ids only), so tools/lectures.mjs marks them (`tx`) and the app shows a Transcript button.
// File format: { model, lang, made, segments: [[start, end, "text"], …] } (seconds).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = path.join(ROOT, 'build/lectures.json');
const OUT = path.join(ROOT, 'build/transcripts');
const DONE = path.join(ROOT, 'tools/lecture-transcripts.json');
const MODEL = 'mlx-community/whisper-large-v3-turbo';
const LANG = { English: 'en', German: 'de', Russian: 'ru', Croatian: 'hr', Serbian: 'sr', Bosnian: 'bs', Hungarian: 'hu',
  Italian: 'it', Spanish: 'es', Slovenian: 'sl', Hindi: 'hi', Tamil: 'ta', Macedonian: 'mk', Turkish: 'tr', Lithuanian: 'lt', Portuguese: 'pt' };
// Only steers the first 30 seconds (each stretch is transcribed on its own, see below), but helps there.
const PROMPT = 'A lecture by Sacinandana Swami. Krishna, Radharani, Caitanya Mahaprabhu, Nityananda, Srila Prabhupada, '
  + 'Srimad-Bhagavatam, Bhagavad-gita, Vrindavan, Govardhan, japa, kirtan, Hare Krishna maha-mantra, bhakti.';
const wrangler = path.join(ROOT, 'node_modules/.bin/wrangler');

const args = process.argv.slice(2);
const hours = Number(args[args.indexOf('--hours') + 1]) || 0;
const year = Number(args[args.indexOf('--year') + 1]) || 0;
const upload = args.includes('--upload');
const retidy = args.includes('--tidy');
const ids = args.filter(a => /^[0-9a-f]{12}$/.test(a));
const clock = s => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const log = (...a) => console.log(new Date().toTimeString().slice(0, 5), ...a);

// Singing (kirtan, prayers) comes out as runs of "Oh", "I kiss", "Kissing"…: a run of five or
// more one- or two-word lines becomes one "♪ Singing ♪" line, and lone "Oh"s and "Mm"s go.
const FILLER = /^(oh+|ah+|o|mm+|hmm+|uh|um|la)[.!?,]*$/i;
const SINGING = '♪ Singing ♪';
function tidy(segs) {
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
  return out;
}

async function transcribe(l) {
  const mp3 = path.join(OUT, `${l.id}.mp3`);
  const res = await fetch(l.url, { headers: { 'User-Agent': 'Kirtan app transcripts (private test)' } });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(mp3));
  const started = Date.now();
  // --condition-on-previous-text False: each stretch is transcribed on its own. Otherwise
  // Whisper locks into loops on chanting and kirtan (one word repeated for pages).
  const r = spawnSync('mlx_whisper', [mp3, '--model', MODEL, '--output-format', 'json', '--output-dir', OUT,
    '--condition-on-previous-text', 'False', '--language', LANG[l.language] || 'en', '--initial-prompt', PROMPT, '--verbose', 'False'],
  { encoding: 'utf8', maxBuffer: 1 << 26 });
  await fs.rm(mp3, { force: true });
  if (r.status !== 0) throw new Error(`whisper failed: ${(r.stderr || r.stdout || '').slice(-300)}`);
  const raw = JSON.parse(await fs.readFile(path.join(OUT, `${l.id}.json`), 'utf8'));
  let segments = raw.segments
    .map(s => [Math.round(s.start * 10) / 10, Math.round(s.end * 10) / 10, s.text.trim()])
    .filter(([, , text]) => /[\p{L}\p{N}]/u.test(text)); // music notes and the like aren't words
  segments = tidy(segments);
  await fs.writeFile(path.join(OUT, `${l.id}.json`), JSON.stringify({ model: 'whisper-large-v3-turbo', lang: raw.language, made: new Date().toISOString().slice(0, 10), segments }));
  const took = (Date.now() - started) / 1000;
  log(`done in ${Math.round(took / 60)} min (${(l.dur / took).toFixed(1)}× faster than listening), ${segments.length} lines`);
}

async function main() {
  const { lectures } = JSON.parse(await fs.readFile(LIST, 'utf8'));
  const done = JSON.parse(await fs.readFile(DONE, 'utf8').catch(() => '{}'));
  await fs.mkdir(OUT, { recursive: true });

  if (retidy) {
    for (const id of Object.keys(done)) {
      const file = path.join(OUT, `${id}.json`);
      const t = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null'));
      if (!t) continue;
      const before = t.segments.length;
      t.segments = tidy(t.segments);
      await fs.writeFile(file, JSON.stringify(t));
      log(`tidied ${id}: ${before} → ${t.segments.length} lines`);
    }
  }

  let todo = ids.length ? lectures.filter(l => ids.includes(l.id)) : [];
  if (hours) {
    let total = 0;
    for (const l of lectures) {
      if (done[l.id] || l.language !== 'English' || l.into || !l.dur || (year && l.year !== year) || total + l.dur > hours * 3600) continue;
      todo.push(l);
      total += l.dur;
    }
  }
  todo = todo.filter(l => !done[l.id]);
  const audio = todo.reduce((s, l) => s + (l.dur || 0), 0);
  if (todo.length) log(`Transcribing ${todo.length} lectures, ${clock(audio)} hours of audio`);

  for (const [i, l] of todo.entries()) {
    log(`${i + 1}/${todo.length} ${l.date} ${l.title} (${clock(l.dur)})`);
    try {
      await transcribe(l);
      done[l.id] = new Date().toISOString().slice(0, 10);
      await fs.writeFile(DONE, `${JSON.stringify(done, Object.keys(done).sort(), 1)}\n`);
    } catch (err) {
      log(`  skipped: ${err.message}`);
    }
  }

  if (upload) {
    const put = (key, file) => spawnSync(wrangler, ['r2', 'object', 'put', `kirtans/${key}`, '--file', file, '--content-type', 'application/json', '--remote'],
      { cwd: ROOT, encoding: 'utf8' });
    for (const id of Object.keys(done)) {
      const file = path.join(OUT, `${id}.json`);
      if (!(await fs.stat(file).catch(() => null))) continue;
      const r = put(`lectures/transcripts/${id}.json`, file);
      log(r.status === 0 ? `uploaded ${id}` : `upload of ${id} failed: ${(r.stderr || '').slice(-200)}`);
    }
    // Mark them in the lecture list too (tools/lectures.mjs does the same when it runs).
    for (const l of lectures) if (done[l.id]) l.tx = 1;
    const list = JSON.parse(await fs.readFile(LIST, 'utf8'));
    list.lectures = lectures;
    await fs.writeFile(LIST, JSON.stringify(list));
    const r = put('lectures/catalog.json', LIST);
    log(r.status === 0 ? 'lecture list updated' : `list upload failed: ${(r.stderr || '').slice(-200)}`);
  }
  log('Finished.');
}

main().catch(err => { console.error(err); process.exit(1); });
