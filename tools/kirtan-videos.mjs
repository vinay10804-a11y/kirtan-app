// The kirtans' YouTube videos, in a spreadsheet the owner (or a helper) can fill in, like the talks'
// sheet (owner, 23 Nov 2026: "those kirtans that have videos on YouTube … an option to watch in a
// small icon; make a spreadsheet like you did for lectures"). A kirtan with a link gets a small
// video button in the app, and Watch video in its ⋯ menu and in the player.
//
//   node tools/kirtan-videos.mjs --make-sheet <file.xlsx>   # every kirtan, with Claude's first attempt
//   node tools/kirtan-videos.mjs --from-sheet <file.xlsx>   # the sheet's links → tools/youtube-links.json
//
// Kirtans' videos are on many channels (the festivals', Sacinandana Swami's, Gour Krishna's hosts'),
// so the first attempt came from a YouTube search for each kirtan, checked by eye (title, day, year,
// place, length): tools/kirtan-videos.json holds it ("attempt": kirtan id → video, "sure" or not)
// and the videos found ("videos"). Once a sheet has been read, the kirtans' links come only from it
// (`kirtansFrom: "sheet"` in youtube-links.json); tools/build.mjs puts them in the catalog as `yt`.
// publish.sh reads the sheet before every build, so a link added there is online after a publish.

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'site/catalog.json');
const FOUND = path.join(ROOT, 'tools/kirtan-videos.json');
const LINKS = path.join(ROOT, 'tools/youtube-links.json');
export const SHEET = path.resolve(ROOT, '..', 'Kirtans – YouTube links.xlsx');
const TAB = 'Kirtans', VIDEOS_TAB = 'Videos found';

const ytId = s => /(?:youtu\.be\/|[?&]v=|\/(?:live|shorts|embed)\/)([A-Za-z0-9_-]{11})/.exec(String(s || ''))?.[1] || (/^[A-Za-z0-9_-]{11}$/.test(String(s || '').trim()) ? String(s).trim() : null);
const watch = id => `https://www.youtube.com/watch?v=${id}`;
const clock = sec => (sec ? `${Math.round(sec / 60)} min` : '');
const ARTISTS = ['Sacinandana Swami', 'Gour Krishna'];

async function kirtans() {
  const { tracks } = JSON.parse(await fs.readFile(CATALOG, 'utf8'));
  return tracks.filter(t => t.section === 'kirtan' && !t.hidden)
    .sort((a, b) => ARTISTS.indexOf(a.artist) - ARTISTS.indexOf(b.artist) || (b.year || 0) - (a.year || 0) || (a.no || 0) - (b.no || 0));
}

async function makeSheet(file) {
  const { default: ExcelJS } = await import('exceljs');
  const list = await kirtans();
  const found = JSON.parse(await fs.readFile(FOUND, 'utf8'));
  const links = JSON.parse(await fs.readFile(LINKS, 'utf8').catch(() => '{}'));
  const videos = found.videos || {};
  // Links already in the app (from an earlier sheet) come first, then Claude's attempt.
  const pick = t => (links.kirtansFrom === 'sheet' && links.kirtans?.[t.id] ? { yt: links.kirtans[t.id], sure: true, note: found.attempt?.[t.id]?.note } : found.attempt?.[t.id]);
  const picked = list.map(pick).filter(a => a?.yt);
  const sure = picked.filter(a => a.sure).length;

  const wb = new ExcelJS.Workbook();
  const teal = 'FF2F6B6E', head = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: teal } } };
  const linkFont = { color: { argb: 'FF1155CC' }, underline: true };

  const readMe = wb.addWorksheet('Read me');
  readMe.getColumn(1).width = 110;
  const lines = [
    ['Kirtans and their YouTube videos', { bold: true, size: 15 }],
    [''],
    [`The Kirtans tab lists every kirtan in the app (${list.length}): Sacinandana Swami’s, then Gour Krishna’s, newest first.`],
    ['If a kirtan is on YouTube as a video, paste the video’s link into its “YouTube link” cell (any YouTube link works). Leave it empty when there’s no video. In the app, a kirtan with a link gets a small video button: tapping it pauses the kirtan and plays the video.'],
    [`Claude has made a first attempt: ${picked.length} kirtans have a link already. Claude is confident about ${sure} of them (the same event, day, year and length). The other ${picked.length - sure} say “Check” in the Check column: open the video, and if it’s the same kirtan, clear “Check”; if not, delete the link (or paste the right one). Links still marked “Check” stay out of the app.`],
    ['The same kirtan is often on YouTube more than once (a livestream and an edited video, or the festival’s channel and Maharaja’s). Any of them is fine; the one whose length matches is best.'],
    ['The Videos found tab lists the videos Claude found while searching, with their channel and length, to help with the rest. Its “Linked to” column shows the kirtan each one is linked to.'],
    ['Please don’t change the Kirtan ID column, and don’t sort just one column (sort the whole tab, or use the filter buttons).'],
    ['When it’s done, ask Claude to publish: the app takes its video links from this sheet.'],
  ];
  for (const [text, font] of lines) {
    const row = readMe.addRow([text]);
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (font) row.getCell(1).font = font;
  }

  const ws = wb.addWorksheet(TAB, { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: 'No.', key: 'no', width: 6 }, { header: 'Kirtan', key: 'title', width: 46 }, { header: 'Artist', key: 'artist', width: 18 },
    { header: 'Type', key: 'type', width: 12 }, { header: 'Year', key: 'year', width: 7 }, { header: 'Place', key: 'place', width: 16 },
    { header: 'Length', key: 'len', width: 8 }, { header: 'YouTube link', key: 'yt', width: 46 }, { header: 'Check', key: 'check', width: 8 },
    { header: 'Video on YouTube (Claude’s match)', key: 'vt', width: 64 }, { header: 'Notes', key: 'notes', width: 30 }, { header: 'Kirtan ID', key: 'id', width: 19 },
  ];
  const amber = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE9A8' } };
  for (const t of list) {
    const a = pick(t), v = a && videos[a.yt];
    const row = ws.addRow({
      no: t.no, title: t.title, artist: t.artist, type: t.type, year: t.year || '', place: t.place || '', len: clock(t.duration),
      yt: a?.yt ? watch(a.yt) : '', check: a?.yt && !a.sure ? 'Check' : '',
      vt: v ? [v.title, v.channel, clock(v.duration)].filter(Boolean).join(' · ') : '', notes: a?.note || '', id: t.id,
    });
    if (a?.yt && !a.sure) row.getCell('check').fill = amber;
    row.getCell('id').font = { color: { argb: 'FF888888' } };
  }
  ws.getRow(1).eachCell(c => Object.assign(c, head));
  ws.autoFilter = { from: 'A1', to: 'L1' };

  const vt = wb.addWorksheet(VIDEOS_TAB, { views: [{ state: 'frozen', ySplit: 1 }] });
  vt.columns = [
    { header: 'Video (opens YouTube)', key: 'title', width: 80 }, { header: 'Channel', key: 'channel', width: 26 }, { header: 'Length', key: 'len', width: 8 },
    { header: 'Linked to', key: 'used', width: 46 }, { header: 'Video ID', key: 'id', width: 14 },
  ];
  Object.entries(videos).sort((a, b) => a[1].title.localeCompare(b[1].title)).forEach(([id, v], i) => {
    const r = i + 2;
    const row = vt.addRow({
      title: { text: v.title, hyperlink: watch(id) }, channel: v.channel || '', len: clock(v.duration),
      used: { formula: `IFERROR(INDEX(${TAB}!$B:$B,MATCH("*"&E${r}&"*",${TAB}!$H:$H,0)),"")` }, id,
    });
    row.getCell('title').font = linkFont;
    row.getCell('id').font = { color: { argb: 'FF888888' } };
  });
  vt.getRow(1).eachCell(c => Object.assign(c, head));
  vt.autoFilter = { from: 'A1', to: 'E1' };

  wb.views = [{ activeTab: 1 }];
  await wb.xlsx.writeFile(file);
  console.log(`Wrote ${file}: ${list.length} kirtans, ${picked.length} with a video (${sure} sure, ${picked.length - sure} to check), ${Object.keys(videos).length} videos found.`);
}

// Reads the filled-in sheet: its links become the kirtans' links (an empty cell means no video;
// a link still marked "Check" waits until someone has checked it).
export async function fromSheet(file = SHEET) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(TAB);
  if (!ws) throw new Error(`No "${TAB}" tab in ${path.basename(file)}`);
  const col = {};
  ws.getRow(1).eachCell((c, i) => (col[String(c.value).trim()] = i));
  if (!col['Kirtan ID'] || !col['YouTube link']) throw new Error('The Kirtans tab needs its "Kirtan ID" and "YouTube link" columns.');
  const text = c => (c.value && typeof c.value === 'object' ? c.value.hyperlink || c.value.text || c.value.result || '' : c.value ?? '');
  const ids = new Set((await kirtans()).map(t => t.id));
  const out = {}, problems = [];
  let unchecked = 0;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = String(text(row.getCell(col['Kirtan ID']))).trim();
    const raw = String(text(row.getCell(col['YouTube link']))).trim();
    if (!id || !raw) return;
    if (col.Check && String(text(row.getCell(col.Check))).trim()) return void unchecked++;
    const v = ytId(raw);
    if (!v) return problems.push(`row ${n}: “${raw}” isn’t a YouTube link`);
    if (!ids.has(id)) return problems.push(`row ${n}: no kirtan with the ID ${id}`);
    out[id] = v;
  });
  const links = JSON.parse(await fs.readFile(LINKS, 'utf8').catch(() => '{}'));
  await fs.writeFile(LINKS, `${JSON.stringify({ ...links, kirtansFrom: 'sheet', kirtans: out }, null, 1)}\n`);
  console.log(`Kirtan videos from the sheet: ${Object.keys(out).length} kirtans with a video${unchecked ? ` (${unchecked} still marked “Check” wait)` : ''}`);
  for (const p of problems) console.log(`  ! ${p}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = flag => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] || SHEET : null; };
  const run = arg('--make-sheet') ? makeSheet(arg('--make-sheet'))
    : arg('--from-sheet') ? fromSheet(arg('--from-sheet'))
    : existsSync(SHEET) ? fromSheet(SHEET) : Promise.resolve(console.log(`No "${path.basename(SHEET)}" beside the project; video links unchanged.`));
  run.catch(err => { console.error(err.message || err); process.exit(1); });
}
