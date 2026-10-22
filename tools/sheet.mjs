// The owner's list of kirtans in Excel, "Kirtans list.xlsx", and the "Thumbnails"
// folder, both beside the project (in ~/Desktop/SNS Kirtan Platform). The build
// reads the sheet first (edits and thumbnails), applies it to the catalog, then
// writes the sheet again with every kirtan, new ones included, and a small
// preview of the picture each one shows in the app.
//
// What the owner can change in the sheet:
//   Kirtan, Artist, Type, Year, Place  – replace what the file name gave
//                                          (a "-" in Place means no place)
//   Thumbnail   – a picture's file name in the Thumbnails folder; or leave it
//                 empty and name the picture after the kirtan's number (12.jpg)
//   Show in app – "No" hides a kirtan without deleting it
// The ID column links a row to its recording; sorting or reordering rows is fine.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHEET = path.resolve(ROOT, '..', 'Kirtans list.xlsx');
export const THUMBS = path.resolve(ROOT, '..', 'Thumbnails');
const COVERS = path.join(ROOT, 'site/covers');
const PREVIEWS = path.join(ROOT, 'build/previews');
const PHOTOS = path.join(ROOT, 'site/photos.json');

const ARTISTS = ['Sacinandana Swami', 'Gour Krishna'];
const TYPES = ['Mahamantra', 'Bhajans'];
const IMAGE = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;

const COLUMNS = [
  { key: 'no', header: 'No.', width: 6 },
  { key: 'picture', header: 'Picture', width: 11 },
  { key: 'title', header: 'Kirtan', width: 44 },
  { key: 'artist', header: 'Artist', width: 19 },
  { key: 'type', header: 'Type', width: 13 },
  { key: 'year', header: 'Year', width: 8 },
  { key: 'place', header: 'Place', width: 20 },
  { key: 'thumbnail', header: 'Thumbnail', width: 22 },
  { key: 'show', header: 'Show in app', width: 12 },
  { key: 'file', header: 'Original file', width: 48 },
  { key: 'id', header: 'ID (don’t change)', width: 19 },
];

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const cellText = cell => {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) return clean(v.richText.map(r => r.text).join(''));
  if (typeof v === 'object' && 'text' in v) return clean(v.text);
  if (typeof v === 'object' && 'result' in v) return clean(v.result);
  return clean(v);
};

// Reads the sheet into id → { title, artist, type, year, place, thumbnail, show }.
// Returns null when there's no sheet yet.
async function readSheet() {
  if (!existsSync(SHEET)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SHEET);
  const ws = wb.getWorksheet('Kirtans') || wb.worksheets[0];
  const col = {};
  ws.getRow(1).eachCell((cell, n) => {
    const h = cellText(cell).toLowerCase();
    const c = COLUMNS.find(c => h.startsWith(c.header.toLowerCase().slice(0, 5)));
    if (c) col[c.key] = n;
  });
  if (!col.id) throw new Error(`"${path.basename(SHEET)}" has no ID column, so its rows can't be matched to recordings.`);
  const rows = new Map();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = cellText(row.getCell(col.id));
    if (!id) return;
    const get = k => (col[k] ? cellText(row.getCell(col[k])) : '');
    rows.set(id, { title: get('title'), artist: get('artist'), type: get('type'), year: get('year'), place: get('place'), thumbnail: get('thumbnail'), show: get('show') });
  });
  return rows;
}

// The changes a row makes to what the file name gave. Unknown artists or types
// and odd years are ignored, with a note.
function editsFrom(row, auto, warn) {
  const over = {};
  if (row.title && row.title !== auto.title) over.title = row.title;
  if (row.artist) {
    const a = ARTISTS.find(x => x.toLowerCase() === row.artist.toLowerCase());
    if (!a) warn(`artist "${row.artist}" isn't Sacinandana Swami or Gour Krishna`);
    else if (a !== auto.artist) over.artist = a;
  }
  if (row.type) {
    const t = TYPES.find(x => x.toLowerCase() === row.type.toLowerCase());
    if (!t) warn(`type "${row.type}" isn't Mahamantra or Bhajans`);
    else if (t !== auto.type) over.type = t;
  }
  if (row.year) {
    const y = Number(row.year);
    if (!Number.isInteger(y) || y < 1950 || y > 2100) warn(`year "${row.year}" isn't a year`);
    else if (y !== auto.year) over.year = y;
  }
  if (row.place === '-') over.place = null;
  else if (row.place && row.place !== auto.place) over.place = row.place;
  if (/^(no|n|hide|hidden)$/i.test(row.show)) over.hidden = true;
  return over;
}

async function thumbnailFiles() {
  if (!existsSync(THUMBS)) return null;
  return (await fs.readdir(THUMBS)).filter(f => IMAGE.test(f) && !f.startsWith('.'));
}

// A picture from the Thumbnails folder, made square (600 px) for the app.
// The file name carries a hash of the picture, so a changed picture is a new URL.
async function makeCover(t, file) {
  const src = path.join(THUMBS, file);
  const hash = createHash('sha1').update(await fs.readFile(src)).digest('hex').slice(0, 8);
  const name = `u-${t.id}-${hash}.jpg`;
  const out = path.join(COVERS, name);
  if (!existsSync(out)) {
    const tmp = `${out}.part.jpg`;
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', src, '--out', tmp], { stdio: 'ignore' });
    const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', tmp], { encoding: 'utf8' });
    const w = Number(dims.match(/pixelWidth: (\d+)/)[1]), h = Number(dims.match(/pixelHeight: (\d+)/)[1]);
    const side = Math.min(w, h);
    execFileSync('sips', ['--cropToHeightWidth', String(side), String(side), tmp], { stdio: 'ignore' });
    execFileSync('sips', ['-Z', '600', tmp, '--out', out], { stdio: 'ignore' });
    await fs.rm(tmp, { force: true });
  }
  return `covers/${name}`;
}

// Applies the sheet (or, without one, the edits saved last time) to the tracks,
// numbers new kirtans, and sets thumbnails. Changes the tracks in place.
export async function applySheet(tracks) {
  const notes = [];
  const rows = await readSheet().catch(err => { notes.push(`Couldn't read the sheet: ${err.message}`); return null; });
  const files = await thumbnailFiles();
  const findFile = name => {
    if (!files || !name) return null;
    const n = name.toLowerCase();
    return files.find(f => f.toLowerCase() === n) || files.find(f => f.toLowerCase().replace(IMAGE, '') === n.replace(IMAGE, '')) || null;
  };

  // Numbers stay with their kirtan; new kirtans get the next ones (the first time,
  // in a tidy order: artist, type, year, title).
  const order = (a, b) => ARTISTS.indexOf(a.artist) - ARTISTS.indexOf(b.artist) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type)
    || (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title, undefined, { numeric: true });
  let next = Math.max(0, ...tracks.map(t => t.no || 0)) + 1;
  for (const t of tracks.filter(t => !t.no).sort(order)) t.no = next++;

  let edited = 0, pictures = 0;
  for (const t of tracks) {
    const auto = { title: t.title, artist: t.artist, type: t.type, year: t.year, place: t.place };
    const row = rows?.get(t.id);
    const warn = msg => notes.push(`No. ${t.no} (${auto.title}): ${msg}`);
    const over = row ? editsFrom(row, auto, warn) : { ...(t.over || {}) };
    delete t.hidden;
    Object.assign(t, over);
    if (Object.keys(over).length) { t.over = over; edited++; } else delete t.over;

    // Thumbnail: the file named in the sheet, else one named after the number.
    if (t.ownCover === undefined) t.ownCover = t.custom ? null : (t.cover || null);
    const wanted = row ? row.thumbnail : t.thumbFile;
    const file = findFile(wanted) || (!wanted && files ? files.find(f => f.replace(IMAGE, '') === String(t.no)) : null);
    if (file) {
      t.cover = await makeCover(t, file);
      t.custom = true;
      t.thumbFile = file;
      pictures++;
    } else if (row && !row.thumbnail && t.custom) {
      // The thumbnail was cleared in the sheet: back to the recording's own art.
      t.cover = t.ownCover || undefined;
      delete t.custom;
      delete t.thumbFile;
    } else if (wanted && !file && t.custom && files) {
      notes.push(`No. ${t.no} (${t.title}): no "${wanted}" in the Thumbnails folder, so its current picture stays`);
    }
    if (!t.cover) delete t.cover;
  }

  // Pictures no longer used by any kirtan.
  const used = new Set(tracks.map(t => t.cover).filter(Boolean).map(c => path.basename(c)));
  for (const f of await fs.readdir(COVERS).catch(() => [])) {
    if (f.startsWith('u-') && !used.has(f)) await fs.rm(path.join(COVERS, f), { force: true });
  }

  console.log(rows
    ? `Sheet: ${edited} kirtans with edits, ${pictures} with your own thumbnail${tracks.some(t => t.hidden) ? `, ${tracks.filter(t => t.hidden).length} hidden` : ''}`
    : `No "${path.basename(SHEET)}" yet: making one.`);
  for (const n of notes) console.log(`  ! ${n}`);
}

// A small square picture for the sheet's Picture column (cached in build/previews).
async function preview(src) {
  if (!src || !existsSync(src)) return null;
  const st = await fs.stat(src);
  const out = path.join(PREVIEWS, `${createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)}.jpg`);
  if (!existsSync(out)) {
    await fs.mkdir(PREVIEWS, { recursive: true });
    const tmp = `${out}.part.jpg`;
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '75', src, '--out', tmp], { stdio: 'ignore' });
    const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', tmp], { encoding: 'utf8' });
    const side = Math.min(Number(dims.match(/pixelWidth: (\d+)/)[1]), Number(dims.match(/pixelHeight: (\d+)/)[1]));
    execFileSync('sips', ['--cropToHeightWidth', String(side), String(side), tmp], { stdio: 'ignore' });
    execFileSync('sips', ['-Z', '120', tmp, '--out', out], { stdio: 'ignore' });
    await fs.rm(tmp, { force: true });
  }
  return out;
}

// Writes the sheet: one row per kirtan, in number order, with a preview of the
// picture the app shows, dropdowns for Artist, Type and Show in app, and a
// "How to use" tab.
export async function writeSheet(tracks) {
  const photos = existsSync(PHOTOS) ? JSON.parse(await fs.readFile(PHOTOS, 'utf8')) : [];
  const personThumb = name => photos.find(p => p.person === name)?.thumb;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kirtan app';
  const ws = wb.addWorksheet('Kirtans', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24585C' } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;

  const list = tracks.filter(t => t.section !== 'japa').sort((a, b) => a.no - b.no);
  for (const t of list) {
    const row = ws.addRow({
      no: t.no, title: t.title, artist: t.artist, type: t.type, year: t.year ?? '',
      place: t.place ?? '', thumbnail: t.thumbFile || '', show: t.hidden ? 'No' : 'Yes',
      file: t.rel || '', id: t.id,
    });
    row.height = 48;
    row.alignment = { vertical: 'middle', wrapText: true };
    for (const k of ['file', 'id']) row.getCell(k).font = { color: { argb: 'FF8F938F' }, size: 10 };
    const pic = await preview(t.cover ? path.join(ROOT, 'site', t.cover) : personThumb(t.artist) ? path.join(ROOT, 'site', personThumb(t.artist)) : null).catch(() => null);
    if (pic) {
      const img = wb.addImage({ buffer: await fs.readFile(pic), extension: 'jpeg' });
      ws.addImage(img, { tl: { col: 1.1, row: row.number - 1 + 0.08 }, ext: { width: 60, height: 60 }, editAs: 'oneCell' });
    } else {
      row.getCell('picture').value = t.artist === 'Gour Krishna' ? 'GK' : 'SS';
      row.getCell('picture').alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }
  const last = list.length + 1;
  const pick = (key, values) => {
    const letter = ws.getColumn(key).letter;
    for (let r = 2; r <= last + 200; r++) {
      ws.getCell(`${letter}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${values.join(',')}"`] };
    }
  };
  pick('artist', ARTISTS);
  pick('type', TYPES);
  pick('show', ['Yes', 'No']);
  ws.autoFilter = { from: 'A1', to: { row: last, column: COLUMNS.length } };

  const help = wb.addWorksheet('How to use');
  help.getColumn(1).width = 110;
  [
    ['How to use this list', true],
    ['Every kirtan in the app has a row. Edit, save, close Excel, then ask Claude to publish (or run ./publish.sh).', false],
    ['', false],
    ['Change a title, artist, type, year or place', true],
    ['Type over it in the row. Type a dash (-) in Place for no place. The Artist, Type and Show in app columns have dropdowns.', false],
    ['', false],
    ['Give a kirtan its own thumbnail', true],
    [`Put the picture in the "Thumbnails" folder next to this file (${THUMBS}).`, false],
    ['Either name the picture after the kirtan\'s number (for No. 12: 12.jpg, 12.png or 12.heic), or type the picture\'s file name in its Thumbnail cell.', false],
    ['Square pictures look best; others are trimmed to a square from the middle. To go back to the original picture, clear the Thumbnail cell (and remove a numbered file).', false],
    ['', false],
    ['Add new kirtans', true],
    ['Put the recordings in the Kirtans folder and publish. They get the next numbers and appear at the bottom of this list.', false],
    ['', false],
    ['Hide a kirtan', true],
    ['Choose "No" in Show in app. It stays in this list and comes back if you choose "Yes".', false],
    ['', false],
    ['Please don\'t change', true],
    ['The ID column: it links each row to its recording. Sorting or filtering rows is fine. The Picture column is a preview and is redrawn on every publish.', false],
  ].forEach(([text, bold]) => {
    const r = help.addRow([text]);
    r.font = bold ? { bold: true, size: 13, color: { argb: 'FF24585C' } } : { size: 12 };
    r.alignment = { wrapText: true, vertical: 'top' };
  });

  try {
    await wb.xlsx.writeFile(SHEET);
    console.log(`Sheet updated: ${SHEET} (${list.length} kirtans)`);
  } catch (err) {
    console.log(`  ! Couldn't save "${path.basename(SHEET)}" (${err.code || err.message}). If it's open in Excel, close it and publish again.`);
  }
}
