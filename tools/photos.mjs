// Copies photos from the "photos of sns" folder (beside the project, or on the Desktop) into site/photos/,
// resized for the web, and writes site/photos.json. Uses macOS `sips`, which
// also handles iPhone HEIC files. Without that folder the current photos stay.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/photos');
const desktop = path.join(os.homedir(), 'Desktop');
const IMAGE = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;

const folder = [path.resolve(ROOT, '..'), desktop, path.join(desktop, 'KC')]
  .flatMap(d => (fs.existsSync(d) ? fs.readdirSync(d).map(n => path.join(d, n)) : []))
  .find(p => /^photos of sns$/i.test(path.basename(p)) && fs.statSync(p).isDirectory());

if (!folder || process.platform !== 'darwin') {
  console.log('No "photos of sns" folder found, keeping the current photos.');
  process.exit(0);
}

const files = fs.readdirSync(folder).filter(f => IMAGE.test(f)).sort();
if (!files.length) {
  console.log(`"${folder}" has no images, keeping the current photos.`);
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const sips = (...args) => execFileSync('sips', args, { encoding: 'utf8' });
const photos = files.map((f, i) => {
  const n = String(i + 1).padStart(2, '0');
  const src = path.join(folder, f);
  const big = path.join(OUT, `photo-${n}.jpg`);
  const thumb = path.join(OUT, `photo-${n}-thumb.jpg`);
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1600', src, '--out', big);
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '78', '-Z', '600', src, '--out', thumb);
  const dims = sips('-g', 'pixelWidth', '-g', 'pixelHeight', big);
  const w = Number(dims.match(/pixelWidth: (\d+)/)[1]);
  const h = Number(dims.match(/pixelHeight: (\d+)/)[1]);
  // Put a name in the file name ("gour krishna 1.jpg", "sns smiling.jpg") to use
  // that photo for the person's section.
  const person = /g[ao]u?r|gopal|radhanath/i.test(f) ? 'Radhanath Swami & Gour Krishna'
    : /sns|sac?h?inandana|swami/i.test(f) ? 'Sacinandana Swami' : undefined;
  return { src: `photos/photo-${n}.jpg`, thumb: `photos/photo-${n}-thumb.jpg`, w, h, person };
});

fs.writeFileSync(path.join(ROOT, 'site/photos.json'), JSON.stringify(photos, null, 1));
console.log(`Added ${photos.length} photos from "${folder}".`);
