// Uploads the audio the catalog needs from build/audio/ to the R2 bucket, under
// the same path the app plays it from (e.g. media/<file>). Files sent on a
// previous run are tracked in build/uploaded.json and skipped.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'build/audio');
const CATALOG = path.join(ROOT, 'site/catalog.json');
const LEDGER = path.join(ROOT, 'build/uploaded.json');
const BUCKET = 'kirtans';
const WRANGLER = path.join(ROOT, 'node_modules/.bin/wrangler');

const TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };

function put(key, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(WRANGLER, ['r2', 'object', 'put', `${BUCKET}/${key}`,
      '--file', file, '--content-type', TYPES[path.extname(file)] || 'application/octet-stream',
      '--cache-control', 'public, max-age=31536000, immutable', '--remote'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.slice(-400)))));
  });
}

async function main() {
  let uploaded = {};
  try { uploaded = JSON.parse(await fs.readFile(LEDGER, 'utf8')); } catch {}

  // A track whose file isn't in build/audio was uploaded earlier and its local
  // copy deleted to save space, so there's nothing to send for it.
  const { tracks = [] } = JSON.parse(await fs.readFile(CATALOG, 'utf8'));
  const todo = tracks.map(t => ({ key: t.src, file: path.join(AUDIO, path.basename(t.src)) }))
    .filter(x => !uploaded[x.key] && existsSync(x.file));
  console.log(`${tracks.length} recordings, ${todo.length} to upload`);

  let done = 0, failed = 0, next = 0;
  async function worker() {
    while (next < todo.length) {
      const { key, file } = todo[next++];
      try {
        await put(key, file);
        uploaded[key] = Date.now();
        await fs.writeFile(LEDGER, JSON.stringify(uploaded));
      } catch (e) {
        failed++;
        console.error(`\n  ✗ ${key}: ${e.message.trim()}`);
      }
      done++;
      process.stdout.write(`\r  ${done}/${todo.length} uploaded`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (todo.length) process.stdout.write('\n');
  if (failed) {
    console.error(`${failed} uploads failed. Re-run ./publish.sh to retry just those.`);
    process.exit(1);
  }
}

main();
