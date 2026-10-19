// Writes site/videos.json (title, date, length) for the japa collections, so
// the Japa tab can list them and play them inside the page: YouTube videos for
// Guided Japa and Japa Inspirations, SoundCloud tracks for Living Name.
// Keeps the previous list if YouTube or SoundCloud can't be reached.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/videos.json');
const SOURCES = [
  { collection: 'Guided Japa', args: ['--batch-file', path.join(ROOT, 'tools/guided-japa.txt')] },
  { collection: 'Japa Inspirations', args: ['--batch-file', path.join(ROOT, 'tools/japa-inspirations.txt')] },
  { collection: 'Living Name Meditations', source: 'soundcloud', args: ['https://soundcloud.com/sacinandanaswami/sets/meditations-from-the-living'] },
];

function details(args) {
  return new Promise(resolve => {
    const p = spawn('yt-dlp', ['-j', '--skip-download', '--ignore-errors', '--no-warnings', ...args]);
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
for (const { collection, source, args } of SOURCES) {
  const found = await details(args);
  if (!found.length) {
    const kept = previous.filter(v => v.collection === collection);
    videos.push(...kept);
    console.log(`  ${collection}: couldn't reach ${source === 'soundcloud' ? 'SoundCloud' : 'YouTube'}, kept ${kept.length} from last time`);
    continue;
  }
  found.forEach((v, i) => {
    const d = v.upload_date;
    videos.push({
      id: String(v.id),
      title: v.title,
      collection,
      date: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
      duration: Math.round(v.duration || 0),
      // SoundCloud tracks keep their page link, artwork and order in the set.
      ...(source === 'soundcloud' && {
        source,
        url: v.webpage_url,
        thumb: v.thumbnail?.replace('-original.', '-t300x300.') || null,
        order: v.playlist_index || i + 1,
      }),
    });
  });
  console.log(`  ${collection}: ${found.length} ${source === 'soundcloud' ? 'tracks' : 'videos'}`);
}

await fs.writeFile(OUT, JSON.stringify(videos, null, 1));
