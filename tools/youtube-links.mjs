// Links lectures and kirtans to the same talk or kirtan on Sacinandana Swami's YouTube channel
// (owner, 30 Oct 2026: "a button towards the YouTube video if someone wants to watch instead of
// just listening; it has to match"). A link is made only when both agree closely:
//   • the title has the same words, in any order ("Taking the Retreat Home / Holy Name Immersion ‘26"
//     = "Holy Name Immersion – Taking the retreat home"), and the same numbers (Part 1 ≠ Part 2);
//   • the video went up within days of the recording (a year in the video's title must agree too),
//     so a talk given every year ("Rama Navami") is matched to the right year;
//   • the lengths aren't wildly different (a 9-minute clip isn't the 80-minute talk).
// Each video is linked to one recording at most, and each recording to one video (the closest
// in length when there are two, e.g. a livestream and its edited upload).
//
//   node tools/youtube-links.mjs            # → tools/youtube-links.json, and `yt` in build/lectures.json
//   node tools/youtube-links.mjs --upload   # …and puts the lecture list in R2 for the app
//   node tools/youtube-links.mjs --show     # prints every link made, to check by eye
//
// The owner then chose to have the links put in by hand (30 Oct 2026: "not all the videos were
// attached; Kartik Inspirations and Above the Clouds are just audio"), in a spreadsheet he can share:
//   node tools/youtube-links.mjs --make-sheet <file.xlsx>   # every English talk, with the links so far
//                                                           # and Claude's guesses, plus the channel's videos
//   node tools/youtube-links.mjs --from-sheet <file.xlsx> [--upload]   # the filled-in links go into the app
// Once a sheet has been read, the lectures' links come only from it (`lecturesFrom: "sheet"`); a
// plain run then only matches kirtans.
//
// Kirtans get theirs (`yt` in site/catalog.json) the next time tools/build.mjs runs. Video dates are
// kept in tools/youtube-videos.json, so a re-run only asks YouTube about new videos.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL = 'https://www.youtube.com/@SacinandanaSwamiYouTube';
const VIDEOS = path.join(ROOT, 'tools/youtube-videos.json');
const LINKS = path.join(ROOT, 'tools/youtube-links.json');
const LIST = path.join(ROOT, 'build/lectures.json');
const CATALOG = path.join(ROOT, 'site/catalog.json');

const ytdlp = args => new Promise(resolve => {
  const p = spawn('yt-dlp', ['--no-warnings', '--ignore-errors', ...args]);
  let out = '';
  p.stdout.on('data', d => (out += d));
  p.on('error', () => resolve(''));
  p.on('close', () => resolve(out));
});

// Title words in one spelling: no accents, quotes or punctuation; Krishna = Krsna, Chaitanya =
// Caitanya (as the app's lecture search spells them); without filler words or the speaker's name.
const NUMS = 'one two three four five six seven eight nine ten'.split(' ');
const STOP = new Set('the of a an and in on to with for by at from is are sacinandana swami maharaja maharaj sns srila live lecture talk class'.split(' '));
function words(title) {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`](\d\d)\b/g, ' ') // the year in "Holy Name Immersion ‘26"
    .replace(/['’‘`]/g, '')
    .replace(/(\d)\.(\d)/g, '$1§$2') // verse numbers keep their dots
    .replace(/[^a-z0-9§]+/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, n => String(NUMS.indexOf(n) + 1)) // "three Doorways" = "3 Doorways"
    .replace(/\bramanavami\b/g, 'rama navami')
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ri/g, 'r').replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/ou/g, 'au').replace(/w/g, 'v')
    .split(' ').filter(w => w && !STOP.has(w) && !/^(19|20)\d\d$/.test(w));
}
// Series whose YouTube uploads are just the audio with a picture: no Video button (owner, 30 Oct 2026).
const AUDIO_ONLY = /^(Kartik Inspirations?|Above the Clouds)\b/i;
const numbers = ws => ws.filter(w => /^\d/.test(w)).sort().join(',');
const titleYear = title => Number(/\b((?:19|20)\d\d)\b/.exec(title)?.[1] || (/['’‘`](\d\d)\b/.exec(title) ? `20${/['’‘`](\d\d)\b/.exec(title)[1]}` : 0));
const days = ymd => Date.parse(`${ymd}T12:00:00Z`) / 864e5;

// The channel's videos and livestreams. Their dates aren't in YouTube's list, so they're asked for
// one video at a time, only for videos whose title matches a recording, and only once.
async function channelVideos(items, all = false) {
  const known = JSON.parse(await fs.readFile(VIDEOS, 'utf8').catch(() => '{}'));
  const listed = new Map();
  // Both lists, or none: a list YouTube didn't send would drop all its links. Tried three times.
  for (const tab of ['videos', 'streams']) {
    let entries = [];
    for (let i = 0; i < 3 && !entries.length; i++) {
      try { entries = JSON.parse(await ytdlp(['--flat-playlist', '-J', `${CHANNEL}/${tab}`])).entries || []; } catch {}
    }
    if (!entries.length) throw new Error(`Couldn’t read the channel’s ${tab} on YouTube. Nothing changed; try again later.`);
    for (const v of entries) listed.set(v.id, v);
  }
  const undated = [...listed.values()].map(v => ({ id: v.id, title: v.title || '', date: '2000-01-01', duration: v.duration || 0, any: true }));
  const likely = new Set(pairs(undated, items).map(p => p.v.id));
  const fresh = [...listed.values()].filter(v => (all || likely.has(v.id)) && !known[v.id]);
  if (fresh.length && !process.argv.includes('--cached')) { // --cached: only the dates already known
    console.log(`  asking YouTube for the dates of ${fresh.length} new videos…`);
    const urls = path.join(ROOT, 'build/youtube-urls.txt');
    await fs.mkdir(path.dirname(urls), { recursive: true });
    await fs.writeFile(urls, fresh.map(v => `https://www.youtube.com/watch?v=${v.id}`).join('\n'));
    const out = await ytdlp(['--skip-download', '--print', '%(id)s\t%(release_date)s\t%(upload_date)s\t%(duration)s\t%(title)s', '--batch-file', urls]);
    for (const line of out.split('\n').filter(Boolean)) {
      const [id, release, upload, duration, ...title] = line.split('\t');
      const d = /^\d{8}$/.test(release) ? release : upload;
      known[id] = { title: title.join('\t'), date: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null, duration: Number(duration) || 0 };
    }
  }
  // Titles can change on YouTube; the latest one counts.
  for (const [id, v] of listed) if (known[id]) known[id].title = v.title || known[id].title;
  await fs.writeFile(VIDEOS, `{\n${Object.keys(known).sort().map(id => `${JSON.stringify(id)}: ${JSON.stringify(known[id])}`).join(',\n')}\n}\n`);
  console.log(`  ${listed.size} videos on the channel, ${likely.size} with a title like a recording's`);
  const dated = id => ({ id, ...known[id], title: listed.get(id).title || known[id]?.title || '', duration: known[id]?.duration || listed.get(id).duration || 0 });
  return all ? [...listed.keys()].map(dated) : [...listed.keys()].filter(id => likely.has(id) && known[id]).map(dated);
}

// Every acceptable (video, recording) pair, best first.
function pairs(videos, items) {
  const out = [];
  for (const v of videos) {
    if (!v.title || /is live$/i.test(v.title) || !v.date || v.duration < 5 * 60) continue;
    const vw = words(v.title);
    if (vw.length < 2) continue;
    const vset = new Set(vw), vnum = numbers(vw), vyear = titleYear(v.title);
    for (const x of items) {
      if (!x.date || numbers(x.w) !== vnum) continue;
      if (vyear && Number(x.date.slice(0, 4)) !== vyear) continue;
      // Shared words out of all the words in both titles.
      const score = new Set(x.w.filter(w => vset.has(w))).size / new Set([...x.w, ...vset]).size;
      if (score < 0.6) continue;
      if (v.any) { out.push({ v, x, score }); break; } // titles only: is it worth asking YouTube the date?
      // Days from the recording to the video. Lectures have exact dates; a kirtan may only have a year.
      const gap = x.exact ? days(v.date) - days(x.date) : null;
      if (gap !== null && (gap < -3 || gap > 60)) continue;
      if (gap === null && Number(v.date.slice(0, 4)) !== Number(x.date.slice(0, 4))) continue;
      const lengths = x.dur && v.duration ? Math.abs(x.dur - v.duration) / Math.max(x.dur, v.duration) : null;
      if (lengths !== null && lengths > 0.5) continue;
      // Put up weeks later, or a kirtan known only by its year: the lengths must agree too.
      if (((gap !== null && gap > 7) || gap === null) && !(lengths !== null && lengths <= (gap === null ? 0.1 : 0.25))) continue;
      // Not quite the same words: only on the very day, at about the same length.
      if (score < 0.8 && !(gap !== null && Math.abs(gap) <= 2 && lengths !== null && lengths <= 0.25)) continue;
      out.push({ v, x, score, gap, lengths });
    }
  }
  // Same words first; then the closest length (a livestream's edited upload matches the audio
  // better than the livestream), then the closest date.
  return out.sort((a, b) => b.score - a.score || (a.lengths ?? 1) - (b.lengths ?? 1) || Math.abs(a.gap ?? 30) - Math.abs(b.gap ?? 30));
}

async function main() {
  const arg = flag => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
  if (arg('--from-sheet')) return fromSheet(arg('--from-sheet'));
  const list = JSON.parse(await fs.readFile(existsSync(LIST) ? LIST : path.join(ROOT, '../Lecture transcripts.nosync/lectures.json'), 'utf8'));
  const catalog = JSON.parse(await fs.readFile(CATALOG, 'utf8'));
  const items = [
    ...list.lectures.filter(l => !AUDIO_ONLY.test(l.title)).map(l => ({ kind: 'lectures', id: l.id, title: l.title, date: l.date, exact: /^\d{4}-\d\d-\d\d$/.test(l.date), dur: l.dur || 0 })),
    // Only Sacinandana Swami's kirtans: the channel is his (a Gour Krishna "Rama Navami" isn't his talk).
    ...catalog.tracks.filter(t => t.section === 'kirtan' && !t.hidden && t.artist === 'Sacinandana Swami').map(t => ({
      kind: 'kirtans', id: t.id, title: t.title, date: t.date || (t.year ? `${t.year}-07-01` : null), exact: !!t.date, dur: t.duration || 0,
    })),
  ].map(x => ({ ...x, w: words(x.title) }));
  if (arg('--make-sheet')) return makeSheet(arg('--make-sheet'), list, await channelVideos(items, true), items);
  const videos = await channelVideos(items);
  const before = JSON.parse(await fs.readFile(LINKS, 'utf8').catch(() => '{}'));
  const sheetDecides = before.lecturesFrom === 'sheet';

  const links = { lectures: {}, kirtans: {} };
  const usedVideos = new Set();
  const chosen = [];
  if (sheetDecides) {
    links.lecturesFrom = 'sheet';
    links.lectures = before.lectures || {};
    for (const id of Object.values(links.lectures)) usedVideos.add(id);
  }
  for (const p of pairs(videos, items)) {
    if (sheetDecides && p.x.kind === 'lectures') continue; // the sheet decides
    if (usedVideos.has(p.v.id) || links[p.x.kind][p.x.id]) continue;
    usedVideos.add(p.v.id);
    links[p.x.kind][p.x.id] = p.v.id;
    chosen.push(p);
  }
  await fs.writeFile(LINKS, `${JSON.stringify(links, null, 1)}\n`);
  console.log(`  linked ${Object.keys(links.lectures).length} lectures and ${Object.keys(links.kirtans).length} kirtans → ${path.relative(ROOT, LINKS)}`);
  if (process.argv.includes('--show')) {
    for (const p of chosen.sort((a, b) => b.x.date.localeCompare(a.x.date))) {
      console.log(`  ${p.x.date} ${p.x.title}\n    ↔ ${p.v.date} ${p.v.title}  (words ${Math.round(p.score * 100)}%, ${p.gap ?? '?'} days, lengths ${p.lengths === null ? '?' : `${Math.round(p.lengths * 100)}%`} apart)`);
    }
  }

  await applyToList(links.lectures);
}

// The lecture list the app reads (kept by tools/lectures.mjs and tools/transcribe.mjs).
async function applyToList(lectureLinks) {
  if (!existsSync(LIST)) return;
  const list = JSON.parse(await fs.readFile(LIST, 'utf8'));
  for (const l of list.lectures) if (lectureLinks[l.id]) l.yt = lectureLinks[l.id]; else delete l.yt;
  await fs.writeFile(LIST, JSON.stringify(list));
  if (process.argv.includes('--upload')) {
    const r = spawnSync(path.join(ROOT, 'node_modules/.bin/wrangler'),
      ['r2', 'object', 'put', 'kirtans/lectures/catalog.json', '--file', LIST, '--content-type', 'application/json', '--remote'],
      { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Upload failed: ${(r.stderr || r.stdout).slice(-400)}`);
    console.log('Uploaded the lecture list to R2 with the video links.');
  }
}

// ---------------- the spreadsheet for putting links in by hand ----------------

const ytId = s => /(?:youtu\.be\/|[?&]v=|\/(?:live|shorts|embed)\/)([A-Za-z0-9_-]{11})/.exec(String(s || ''))?.[1] || (/^[A-Za-z0-9_-]{11}$/.test(String(s || '').trim()) ? String(s).trim() : null);
const watch = id => `https://www.youtube.com/watch?v=${id}`;
const clock = sec => (sec ? `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}` : '');
const TALKS = 'Talks', CHANNEL_TAB = 'Channel videos';

// A first attempt at every link (owner, 30 Oct 2026: "use your intelligence to match them up; mark
// what you're unsure of 'check'"). Each channel video is compared with the English talks:
//   sure:  (nearly) the same title words, the same numbers, put up within 60 days, similar length;
//   check: a looser title match within about a year; or a talk given within 2 days at about the
//          same length that shares a word or the place with the video's title.
// A kirtan, japa or arati video never goes with a talk whose title doesn't say so. Each video goes
// with one talk at most and each talk with one video, sure ones first. tools/youtube-review.json
// holds Claude's corrections after checking the list by eye (pairs to drop, and pairs to add).
const KINDS = /\b(kirtan|kirtana|japa|bhajan|arati|arat)\b/;
const GENERIC_PLACE = new Set('retreat center centre temple ashram house festival online castle'.split(' '));
function firstAttempt(videos, talks, review = {}) {
  const drop = new Set((review.drop || []).map(([t, v]) => `${t} ${v}`));
  const promote = new Set((review.sure || []).map(([t, v]) => `${t} ${v}`));
  const none = new Set(review.none || []);
  // Not his talks: guest speakers at his retreats ("H.G. Hari Parshad Prabhu", "Gauranga Darshan Das")
  // and Gour Krishna's kirtans.
  const guest = t => /\bH\.\s?G\.|hari parshad|gauranga darshan|keshava swami|gour kr|\b\w+ (das|dasi) - /i.test(t);
  const vs = videos.filter(v => v.date && !/kartik inspiration|above the clouds|is live$/i.test(v.title) && !guest(v.title) && v.duration >= 5 * 60)
    .map(v => { const w = words(v.title); return { v, w: new Set(w), n: numbers(w), y: titleYear(v.title), kind: KINDS.exec(v.title.toLowerCase())?.[1] }; });
  const found = [];
  for (const t of talks) {
    if (none.has(t.id)) continue;
    const tw = [...new Set([...t.w, ...words(t.ref || '')])], tn = tw.filter(w => /^\d/.test(w));
    const tplace = words(t.place || '').filter(w => !GENERIC_PLACE.has(w));
    const tkinds = t.title.toLowerCase();
    for (const c of vs) {
      if (c.y && c.y !== Number(t.date.slice(0, 4))) continue;
      const gap = t.exact ? days(c.v.date) - days(t.date) : null;
      if (gap === null ? Math.abs(Number(c.v.date.slice(0, 4)) - Number(t.date.slice(0, 4))) > 1 : gap < -3 || gap > 400) continue;
      // Part 1 isn't Part 2, SB 1.2.6 isn't SB 1.2.7; but "Holy Name Immersion 4 – Workshop 2" is "Workshop 2".
      const cn = c.n ? c.n.split(',') : [];
      if (tn.length && cn.length && !cn.every(n => tn.includes(n)) && !tn.every(n => cn.includes(n))) continue;
      if (c.kind && !new RegExp(`\\b${c.kind}`).test(tkinds)) continue; // a "Kirtan with …" video only goes with a kirtan
      const common = tw.filter(w => c.w.has(w)).length;
      const jac = common / new Set([...tw, ...c.w]).size, cover = tw.length ? common / tw.length : 0;
      const place = tplace.some(w => c.w.has(w));
      const len = t.dur && c.v.duration ? Math.abs(t.dur - c.v.duration) / Math.max(t.dur, c.v.duration) : null;
      const near = gap !== null && Math.abs(gap) <= 2;
      const far = gap === null || gap > 60; // put up long after (or a talk with only a month or year)
      const sure = (jac >= 0.8 || (cover >= 0.9 && common >= 2)) && gap !== null && gap >= -3 && gap <= 60 && (len === null || len <= 0.35);
      const check = sure || ((jac >= 0.5 || (cover >= 0.75 && common >= 2)) && (len === null ? !far : len <= (far ? 0.15 : 0.5)))
        || (near && len !== null && len <= 0.2 && (common >= 2 || (common >= 1 && place)))
        // put up within two weeks, the same length to the minute or so, a shared word and the place
        || (gap !== null && gap >= -3 && gap <= 14 && len !== null && len <= 0.1 && (common >= 2 || (common >= 1 && place)))
        // the year in the video's title, nearly the same length, and two shared words (uploads months later)
        || (c.y && gap !== null && gap >= 0 && len !== null && len <= 0.05 && common >= 2);
      if (!check || drop.has(`${t.id} ${c.v.id}`)) continue;
      const score = jac + cover / 2 + (place ? 0.1 : 0) - Math.abs(gap ?? 60) / 400 - (len ?? 0.3);
      found.push({ t, v: c.v, sure: sure || promote.has(`${t.id} ${c.v.id}`), score, jac, gap, len });
    }
  }
  for (const [tid, vid, sure] of review.add || []) {
    const t = talks.find(x => x.id === tid), v = videos.find(x => x.id === vid);
    if (t && v) found.push({ t, v, sure: !!sure, score: 99 });
  }
  found.sort((a, b) => b.sure - a.sure || b.score - a.score);
  const byTalk = new Map(), usedV = new Set();
  for (const f of found) {
    if (byTalk.has(f.t.id) || usedV.has(f.v.id)) continue;
    byTalk.set(f.t.id, f);
    usedV.add(f.v.id);
  }
  return byTalk;
}

async function makeSheet(file, list, videos, items) {
  const { default: ExcelJS } = await import('exceljs');
  const english = list.lectures.filter(l => l.language === 'English' && !AUDIO_ONLY.test(l.title));
  const byId = new Map(items.map(x => [x.id, x]));
  const talks = english.map(l => ({ ...byId.get(l.id), ref: l.ref, place: l.place })).filter(t => t.id);
  const review = JSON.parse(await fs.readFile(path.join(ROOT, 'tools/youtube-review.json'), 'utf8').catch(() => '{}'));
  const attempt = firstAttempt(videos, talks, review);
  const sure = [...attempt.values()].filter(f => f.sure).length;
  if (process.argv.includes('--show')) {
    for (const f of [...attempt.values()].sort((a, b) => a.sure - b.sure || b.t.date.localeCompare(a.t.date))) {
      console.log(`${f.sure ? 'SURE ' : 'CHECK'} ${f.t.id} ${f.v.id} | ${f.t.date} ${f.t.title}${f.t.ref ? ` [${f.t.ref}]` : ''}${f.t.place ? ` (${f.t.place})` : ''} ${clock(f.t.dur)}\n        ↔ ${f.v.date} ${f.v.title} ${clock(f.v.duration)}  (gap ${f.gap ?? '?'}d, len ${f.len == null ? '?' : Math.round(f.len * 100) + '%'})`);
    }
  }
  const wb = new ExcelJS.Workbook();
  const teal = 'FF2F6B6E', head = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: teal } } };
  const linkFont = { color: { argb: 'FF1155CC' }, underline: true };

  const readMe = wb.addWorksheet('Read me');
  readMe.getColumn(1).width = 110;
  const lines = [
    ['Sacinandana Swami’s talks and their YouTube videos', { bold: true, size: 15 }],
    [''],
    [`The Talks tab lists every English talk in the app’s Lectures section (${english.length.toLocaleString()}), newest first. Kartik Inspirations and Above the Clouds are left out: on YouTube they’re only audio.`],
    ['If a talk is on YouTube as a video, paste the video’s link into its “YouTube link” cell (any YouTube link works, including youtu.be and livestream links). Leave it empty when there’s no video.'],
    [`Claude has made a first attempt: ${attempt.size} talks have a link already. Claude is confident about ${sure} of them (the title, date and length agree, or Claude compared them by eye). The other ${attempt.size - sure} say “Check” in the Check column: open the video, and if it’s the same talk, clear “Check”; if not, delete the link (or paste the right one).`],
    ['Many talks have no video on the channel; leave those empty. To find a video for a talk, search the Channel videos tab (Ctrl+F or ⌘F) by a word from the title, or by the date.'],
    ['The Channel videos tab lists every video and livestream on the channel (@SacinandanaSwamiYouTube), newest first. Its “Linked to” column shows the talk each one is linked to, so the empty ones are still to do. Kirtans, japa and short clips don’t need a talk.'],
    ['Please don’t change the Talk ID column, and don’t sort just one column (sort the whole tab, or use the filter buttons).'],
    ['When it’s done, tell Vinoda Govinda: the app is updated from this sheet, and talks with a link get a Video button.'],
  ];
  for (const [text, font] of lines) {
    const row = readMe.addRow([text]);
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (font) row.getCell(1).font = font;
  }

  const ws = wb.addWorksheet(TALKS, { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 }, { header: 'Title', key: 'title', width: 58 }, { header: 'Verse', key: 'ref', width: 14 },
    { header: 'Place', key: 'place', width: 16 }, { header: 'Length', key: 'len', width: 8 }, { header: 'YouTube link', key: 'yt', width: 46 },
    { header: 'Check', key: 'check', width: 8 }, { header: 'Video title on YouTube (Claude’s match)', key: 'vt', width: 60 },
    { header: 'Notes', key: 'notes', width: 30 }, { header: 'Talk ID', key: 'id', width: 15 },
  ];
  const amber = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE9A8' } };
  for (const l of english) {
    const f = attempt.get(l.id);
    const row = ws.addRow({
      date: l.date, title: l.title, ref: l.ref || '', place: l.place || '', len: clock(l.dur),
      yt: f ? watch(f.v.id) : '', check: f && !f.sure ? 'Check' : '',
      vt: f ? `${f.v.date} · ${f.v.title} · ${clock(f.v.duration)}` : '',
      notes: l.into ? `Translated into ${l.into}` : '', id: l.id,
    });
    if (f && !f.sure) row.getCell('check').fill = amber;
    row.getCell('id').font = { color: { argb: 'FF888888' } };
  }
  ws.getRow(1).eachCell(c => Object.assign(c, head));
  ws.autoFilter = { from: 'A1', to: 'J1' };

  const ch = wb.addWorksheet(CHANNEL_TAB, { views: [{ state: 'frozen', ySplit: 1 }] });
  ch.columns = [
    { header: 'Date', key: 'date', width: 12 }, { header: 'Video (opens YouTube)', key: 'title', width: 80 }, { header: 'Length', key: 'len', width: 8 },
    { header: 'Linked to', key: 'used', width: 58 }, { header: 'Video ID', key: 'id', width: 14 },
  ];
  const sorted = videos.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  sorted.forEach((v, i) => {
    const r = i + 2;
    const audio = /kartik inspiration|above the clouds/i.test(v.title);
    const row = ch.addRow({
      date: v.date || '', title: { text: v.title, hyperlink: watch(v.id) }, len: clock(v.duration),
      used: audio ? 'Audio only: not needed' : v.duration && v.duration < 5 * 60 ? 'Short clip' : { formula: `IFERROR(INDEX(${TALKS}!$B:$B,MATCH("*"&E${r}&"*",${TALKS}!$F:$F,0)),"")` },
      id: v.id,
    });
    row.getCell('title').font = linkFont;
    row.getCell('id').font = { color: { argb: 'FF888888' } };
  });
  ch.getRow(1).eachCell(c => Object.assign(c, head));
  ch.autoFilter = { from: 'A1', to: 'E1' };

  wb.views = [{ activeTab: 1 }];
  await wb.xlsx.writeFile(file);
  console.log(`Wrote ${file}: ${english.length} talks, ${attempt.size} with a video (${sure} sure, ${attempt.size - sure} to check), ${videos.length} channel videos.`);
}

// Reads the filled-in sheet: its links become the lectures' links (an empty cell means no video;
// a link still marked "Check" waits until someone has checked it).
async function fromSheet(file) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(TALKS);
  if (!ws) throw new Error(`No "${TALKS}" tab in ${file}`);
  const col = {};
  ws.getRow(1).eachCell((c, i) => (col[String(c.value).trim()] = i));
  if (!col['Talk ID'] || !col['YouTube link']) throw new Error('The Talks tab needs its "Talk ID" and "YouTube link" columns.');
  const text = c => (c.value && typeof c.value === 'object' ? c.value.hyperlink || c.value.text || c.value.result || '' : c.value ?? '');
  const known = JSON.parse(await fs.readFile(VIDEOS, 'utf8').catch(() => '{}'));
  const lectures = {}, problems = [], seen = new Map();
  let unchecked = 0;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = String(text(row.getCell(col['Talk ID']))).trim();
    const raw = String(text(row.getCell(col['YouTube link']))).trim();
    if (!id || !raw) return;
    // Still marked "Check": nobody has looked at it yet, so it waits.
    if (col.Check && String(text(row.getCell(col.Check))).trim()) return void unchecked++;
    const v = ytId(raw);
    if (!v) return problems.push(`row ${n}: “${raw}” isn’t a YouTube link`);
    if (seen.has(v)) problems.push(`row ${n}: the same video as row ${seen.get(v)}`);
    else seen.set(v, n);
    if (!known[v]) problems.push(`row ${n}: ${v} isn’t one of the channel’s videos (kept anyway)`);
    lectures[id] = v;
  });
  const before = JSON.parse(await fs.readFile(LINKS, 'utf8').catch(() => '{}'));
  await fs.writeFile(LINKS, `${JSON.stringify({ lecturesFrom: 'sheet', lectures, kirtans: before.kirtans || {} }, null, 1)}\n`);
  console.log(`From the sheet: ${Object.keys(lectures).length} talks with a video → ${path.relative(ROOT, LINKS)}`);
  if (unchecked) console.log(`  ${unchecked} links still marked “Check” were left out until someone checks them`);
  for (const p of problems) console.log(`  check ${p}`);
  await applyToList(lectures);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
