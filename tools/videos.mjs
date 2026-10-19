// Writes site/videos.json (title, date, length) for the YouTube japa
// collections, so the Japa tab can show them as video cards linking to YouTube.
// Keeps the previous list if YouTube can't be reached.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/videos.json');
const SOURCES = [
  { collection: 'Guided Japa', list: 'tools/guided-japa.txt' },
  { collection: 'Japa Inspirations', list: 'tools/japa-inspirations.txt' },
];

function details(listFile) {
  return new Promise(resolve => {
    const p = spawn('yt-dlp', ['-j', '--skip-download', '--ignore-errors', '--no-warnings', '--batch-file', path.join(ROOT, listFile)]);
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', () => resolve([]));
    p.on('close', () => resolve(out.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean)));
  });
}

let previous = [];
try { previous = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}

const videos = [];
for (const { collection, list } of SOURCES) {
  const found = await details(list);
  if (!found.length) {
    videos.push(...previous.filter(v => v.collection === collection));
    console.log(`  ${collection}: couldn't reach YouTube, kept ${videos.length} from last time`);
    continue;
  }
  for (const v of found) {
    const d = v.upload_date;
    videos.push({
      id: v.id,
      title: v.title,
      collection,
      date: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
      duration: Math.round(v.duration || 0),
    });
  }
  console.log(`  ${collection}: ${found.length} videos`);
}

await fs.writeFile(OUT, JSON.stringify(videos, null, 1));
