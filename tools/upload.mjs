// Uploads compressed audio from build/audio/ to the R2 bucket, skipping files
// that were uploaded on a previous run (tracked in build/uploaded.json).

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'build/audio');
const LEDGER = path.join(ROOT, 'build/uploaded.json');
const BUCKET = 'kirtans';
const WRANGLER = path.join(ROOT, 'node_modules/.bin/wrangler');

const TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };

function put(file) {
  const ext = path.extname(file);
  return new Promise((resolve, reject) => {
    const p = spawn(WRANGLER, ['r2', 'object', 'put', `${BUCKET}/audio/${file}`,
      '--file', path.join(AUDIO, file), '--content-type', TYPES[ext] || 'application/octet-stream',
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

  // build/audio may have been deleted to save space; then there's nothing new to send.
  const files = (await fs.readdir(AUDIO).catch(() => [])).filter(f => TYPES[path.extname(f)] && !f.includes('.part'));
  const todo = files.filter(f => !uploaded[f]);
  console.log(`${files.length} audio files, ${todo.length} to upload`);

  let done = 0, failed = 0, next = 0;
  async function worker() {
    while (next < todo.length) {
      const f = todo[next++];
      try {
        await put(f);
        uploaded[f] = Date.now();
        await fs.writeFile(LEDGER, JSON.stringify(uploaded));
      } catch (e) {
        failed++;
        console.error(`\n  ✗ ${f}: ${e.message.trim()}`);
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
