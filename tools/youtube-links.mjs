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
const STOP = new Set('the of a an and in on to with for by at from is are sacinandana swami maharaja maharaj sns srila live lecture talk class'.split(' '));
function words(title) {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`](\d\d)\b/g, ' ') // the year in "Holy Name Immersion ‘26"
    .replace(/['’‘`]/g, '')
    .replace(/(\d)\.(\d)/g, '$1§$2') // verse numbers keep their dots
    .replace(/[^a-z0-9§]+/g, ' ')
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ri/g, 'r').replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/ou/g, 'au').replace(/w/g, 'v')
    .split(' ').filter(w => w && !STOP.has(w) && !/^(19|20)\d\d$/.test(w));
}
const numbers = ws => ws.filter(w => /^\d/.test(w)).sort().join(',');
const titleYear = title => Number(/\b((?:19|20)\d\d)\b/.exec(title)?.[1] || (/['’‘`](\d\d)\b/.exec(title) ? `20${/['’‘`](\d\d)\b/.exec(title)[1]}` : 0));
const days = ymd => Date.parse(`${ymd}T12:00:00Z`) / 864e5;

// The channel's videos and livestreams. Their dates aren't in YouTube's list, so they're asked for
// one video at a time, only for videos whose title matches a recording, and only once.
async function channelVideos(items) {
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
  const fresh = [...listed.values()].filter(v => likely.has(v.id) && !known[v.id]);
  if (fresh.length) {
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
  return [...listed.keys()].filter(id => likely.has(id) && known[id]).map(id => ({ id, ...known[id] }));
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
  const list = JSON.parse(await fs.readFile(existsSync(LIST) ? LIST : path.join(ROOT, '../Lecture transcripts.nosync/lectures.json'), 'utf8'));
  const catalog = JSON.parse(await fs.readFile(CATALOG, 'utf8'));
  const items = [
    ...list.lectures.map(l => ({ kind: 'lectures', id: l.id, title: l.title, date: l.date, exact: /^\d{4}-\d\d-\d\d$/.test(l.date), dur: l.dur || 0 })),
    // Only Sacinandana Swami's kirtans: the channel is his (a Gour Krishna "Rama Navami" isn't his talk).
    ...catalog.tracks.filter(t => t.section === 'kirtan' && !t.hidden && t.artist === 'Sacinandana Swami').map(t => ({
      kind: 'kirtans', id: t.id, title: t.title, date: t.date || (t.year ? `${t.year}-07-01` : null), exact: !!t.date, dur: t.duration || 0,
    })),
  ].map(x => ({ ...x, w: words(x.title) }));
  const videos = await channelVideos(items);

  const links = { lectures: {}, kirtans: {} };
  const usedVideos = new Set();
  const chosen = [];
  for (const p of pairs(videos, items)) {
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

  // The lecture list the app reads (kept by tools/lectures.mjs and tools/transcribe.mjs).
  if (existsSync(LIST)) {
    for (const l of list.lectures) if (links.lectures[l.id]) l.yt = links.lectures[l.id]; else delete l.yt;
    await fs.writeFile(LIST, JSON.stringify(list));
    if (process.argv.includes('--upload')) {
      const r = spawnSync(path.join(ROOT, 'node_modules/.bin/wrangler'),
        ['r2', 'object', 'put', 'kirtans/lectures/catalog.json', '--file', LIST, '--content-type', 'application/json', '--remote'],
        { cwd: ROOT, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`Upload failed: ${(r.stderr || r.stdout).slice(-400)}`);
      console.log('Uploaded the lecture list to R2 with the video links.');
    }
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
