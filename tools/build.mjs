// Scans the Kirtans folder, compresses new audio into build/audio/, and writes
// site/catalog.json. Safe to re-run: unchanged files are skipped.
//
// Recordings already in the catalog are online, so they stay on the site even
// when their original is no longer on this Mac (or the folder is gone). Pass
// --forget-missing to drop the ones whose original was deleted.
//
//   node tools/build.mjs [sourceDir] [--forget-missing]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, isSpeech } from './classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Recordings: the argument, else a "Kirtans" folder beside the project, else ~/Desktop/KC/Kirtans.
const SIBLING = path.resolve(ROOT, '..', 'Kirtans');
const ARG = process.argv.slice(2).find(a => !a.startsWith('--'));
const FORGET = process.argv.includes('--forget-missing');
const SRC = path.resolve(ARG || (existsSync(SIBLING) ? SIBLING : path.join(os.homedir(), 'Desktop/KC/Kirtans')));
const OUT = path.join(ROOT, 'build/audio');
const META = path.join(ROOT, 'build/meta.json');
const CATALOG = path.join(ROOT, 'site/catalog.json');
const COVERS = path.join(ROOT, 'site/covers');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma', '.aif', '.aiff', '.mp4', '.webm']);
// Files already at or below the keep bitrate are copied as-is instead of
// re-encoded. Japa sessions are mostly voice, so they get a lighter encode.
const MUSIC = { keep: 200_000, args: ['-ac', '2', '-b:a', '128k'] };
const SPEECH = { keep: 96_000, args: ['-ac', '1', '-b:a', '64k'] };

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => (stdout += d));
    p.stderr.on('data', d => (stderr += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`))));
  });
}

async function probe(file) {
  const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-select_streams', 'a:0', file]));
  const stream = json.streams?.[0] || {};
  return {
    codec: stream.codec_name,
    bitrate: Number(stream.bit_rate || json.format?.bit_rate || 0),
    duration: Number(json.format?.duration || stream.duration || 0),
    tags: json.format?.tags || {},
  };
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// A file's id: its path, size and modification time, so an edited file counts as new.
async function keyFor(file) {
  const stat = await fs.stat(file);
  return createHash('sha1').update(`${path.relative(SRC, file)}|${stat.size}|${Math.floor(stat.mtimeMs)}`).digest('hex').slice(0, 16);
}

async function processFile(file, meta) {
  const rel = path.relative(SRC, file);
  const stat = await fs.stat(file);
  const key = await keyFor(file);

  let info = meta[key];
  if (!info || !(await exists(path.join(OUT, info.file)))) {
    const src = await probe(file);
    const ext = path.extname(file).toLowerCase();
    const profile = isSpeech(rel) ? SPEECH : MUSIC;
    const sameFormat = (src.codec === 'mp3' && ext === '.mp3') || (src.codec === 'aac' && ext === '.m4a');
    const copy = sameFormat && src.bitrate > 0 && src.bitrate <= profile.keep;
    const outExt = copy ? ext : '.mp3';
    const outFile = `${key}${outExt}`;
    const dest = path.join(OUT, outFile);
    const tmp = path.join(OUT, `${key}.part${outExt}`);

    try {
      if (copy) {
        await fs.copyFile(file, tmp);
      } else {
        await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vn', '-map_metadata', '-1',
          ...profile.args, '-ar', '44100', '-c:a', 'libmp3lame', tmp]);
      }
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    await fs.rename(tmp, dest);
    const outStat = await fs.stat(dest);
    const outProbe = await probe(dest);
    info = {
      file: outFile,
      size: outStat.size,
      duration: Math.round(outProbe.duration || src.duration),
      tagTitle: src.tags.title || src.tags.TITLE || '',
      added: Math.floor(stat.birthtimeMs || stat.mtimeMs),
    };
    meta[key] = info;
  }
  if (info.cover === undefined) info.cover = await extractCover(file, key);
  return { key, rel, info };
}

// Saves the cover art embedded in a file (Spotify and YouTube downloads carry
// one) as a 512px square JPEG. Files without art return null.
async function extractCover(file, key) {
  const out = path.join(COVERS, `${key}.jpg`);
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-an', '-map', '0:v:0', '-frames:v', '1',
      '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512', '-q:v', '4', out]);
    return `covers/${key}.jpg`;
  } catch {
    await fs.rm(out, { force: true });
    return null;
  }
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        console.error(`\n  ✗ ${path.relative(SRC, items[i])}: ${err.message}`);
        results[i] = null;
      }
      done++;
      process.stdout.write(`\r  ${done}/${items.length} processed`);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  process.stdout.write('\n');
  return results;
}

// A new version string makes browsers pick up the new app and catalog.
async function stampServiceWorker() {
  const sw = path.join(ROOT, 'site/sw.js');
  const hash = createHash('sha1');
  for (const f of ['index.html', 'styles.css', 'app.js', 'catalog.json', 'photos.json', 'videos.json', 'lyrics.json']) {
    try { hash.update(await fs.readFile(path.join(ROOT, 'site', f))); } catch {}
  }
  const src = await fs.readFile(sw, 'utf8');
  await fs.writeFile(sw, src.replace(/const VERSION = '[^']*';/, `const VERSION = '${hash.digest('hex').slice(0, 10)}';`));
}

// Re-applies the sorting rules to a catalog entry (they may have changed since it
// was built). Entries from before paths were recorded are kept as they are.
function refresh(t) {
  if (!t.rel) return t;
  const c = classify(t.rel, t.tag || '');
  return c.artist ? { ...t, ...c } : null;
}

async function main() {
  // Everything in the current catalog is online: publish.sh uploads before it deploys.
  const previous = (await exists(CATALOG)) ? JSON.parse(await fs.readFile(CATALOG, 'utf8')).tracks || [] : [];
  const online = new Map(previous.map(t => [t.id, t]));
  const haveSrc = await exists(SRC);
  if (!haveSrc && !previous.length) {
    console.error(`Folder not found: ${SRC}`);
    process.exit(1);
  }
  if (!haveSrc) console.log(`No recordings folder at ${SRC}, so nothing new to add.`);
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(COVERS, { recursive: true });
  const meta = (await exists(META)) ? JSON.parse(await fs.readFile(META, 'utf8')) : {};

  const all = haveSrc ? (await walk(SRC)).sort() : [];
  // Only Sacinandana Swami and Gour Krishna belong in the app; list the rest so
  // nothing disappears silently (tools/classify.mjs decides who is who).
  const skipped = all.filter(f => !classify(path.relative(SRC, f)).artist);
  const files = all.filter(f => !skipped.includes(f));
  if (haveSrc) console.log(`Found ${all.length} audio files in ${SRC}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} that aren't by Sacinandana Swami or Gour Krishna:`);
    for (const f of skipped.slice(0, 40)) console.log(`  · ${path.relative(SRC, f)}`);
    if (skipped.length > 40) console.log(`  … and ${skipped.length - 40} more`);
  }

  // Files already online are reused as they are; only new ones are compressed.
  const local = await Promise.all(files.map(async f => ({ file: f, rel: path.relative(SRC, f), key: await keyFor(f) })));
  const reused = local.filter(l => online.has(l.key))
    .map(l => ({ ...online.get(l.key), rel: l.rel, tag: online.get(l.key).tag || meta[l.key]?.tagTitle || undefined }));
  const fresh = local.filter(l => !online.has(l.key)).map(l => l.file);
  const limit = Math.max(1, Math.min(4, os.cpus().length - 1));
  const results = (await pool(fresh, limit, f => processFile(f, meta))).filter(Boolean);
  await fs.writeFile(META, JSON.stringify(meta, null, 1));

  const added = results.map(({ key, rel, info }) => ({
    id: key,
    ...classify(rel, info.tagTitle),
    duration: info.duration,
    size: info.size,
    added: info.added,
    src: `audio/${info.file}`,
    cover: info.cover || undefined,
    yt: rel.match(/\[([A-Za-z0-9_-]{11})\]/)?.[1],
    rel,
    tag: info.tagTitle || undefined,
  }));

  // Online recordings whose original isn't here any more (deleted to save space).
  const localIds = new Set(local.map(l => l.key));
  const localRels = new Set(local.map(l => l.rel));
  const missing = previous.filter(t => !localIds.has(t.id) && !(t.rel && localRels.has(t.rel)));
  const kept = FORGET ? [] : missing;
  if (missing.length) {
    console.log(FORGET
      ? `Removed ${missing.length} recordings whose originals are no longer in ${SRC}.`
      : `Kept ${missing.length} recordings that are online but not in ${SRC}.`);
  }

  const tracks = [...reused, ...kept].map(refresh).filter(Boolean).concat(added);
  const totalMB = tracks.reduce((s, t) => s + t.size, 0) / 1e6;
  await fs.writeFile(CATALOG, JSON.stringify({ generated: new Date().toISOString(), tracks }));
  await stampServiceWorker();
  console.log(`Catalog: ${tracks.length} tracks (${added.length} new), ${(totalMB / 1000).toFixed(2)} GB → site/catalog.json`);

  const summary = {};
  for (const t of tracks) {
    const k = t.section === 'japa' ? `Japa › ${t.type}` : `${t.artist} › ${t.type}`;
    summary[k] = (summary[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(summary).sort()) console.log(`  ${k}: ${n}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
