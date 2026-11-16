// New lectures without the Mac (owner, 16 Nov 2026: "the lectures aren't updating … create a
// remote daily scrub from the website to make it more reliable"). The Mac's job
// (tools/transcribe.mjs --follow) stopped when the Mac restarted on 11 Nov, and five lectures
// were missed for five days. So Cloudflare itself looks at the Saranagati Library every 6 hours
// (the cron in wrangler.jsonc) and keeps R2 lectures/recent.json: every Sacinandana Swami
// lecture in the library's newest listings (the home page and this year's folder; last year's
// too in January), with its length. The app adds any it doesn't already have to the Lectures
// list (`mergeRecent` in app.js), so a new lecture shows within 6 hours even if the Mac is off.
// The Mac's job still makes the full list, the transcripts and the Video links.
//
// The full list (2 MB) is never read here: rewriting it would go past the free plan's CPU
// limit. recent.json is small (a year of lectures, about 50 KB).

import { LIBRARY, UA, NAMES, listing, parse, lengthOf, lectureId } from '../tools/lecture-parse.mjs';
import PLACE_CODES from '../tools/lecture-places.json';

const KEY = 'lectures/recent.json';
const PLACES = { ...PLACE_CODES, ...NAMES };
const MEASURE = 15; // lengths read per run, so a run stays well inside 50 requests

async function page(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

export async function checkRecentLectures(env) {
  const now = new Date();
  const years = [now.getUTCFullYear(), ...(now.getUTCMonth() === 0 ? [now.getUTCFullYear() - 1] : [])];
  const files = new Map();
  for (const f of listing(await page(LIBRARY), LIBRARY)) files.set(f.file, f);
  for (const y of years) {
    const base = `${LIBRARY}${y}/`;
    for (const f of listing(await page(base), base)) if (!files.has(f.file)) files.set(f.file, f);
  }

  const before = await env.AUDIO.get(KEY).then(o => o?.json()).catch(() => null);
  const known = new Map((before?.lectures || []).map(l => [l.id, l]));
  const lectures = [];
  let measured = 0;
  for (const f of files.values()) {
    const info = parse(f.file, PLACES);
    if (!info || !years.includes(info.year)) continue;
    const { lang, ...rest } = info;
    const id = await lectureId(f.file);
    let dur = known.get(id)?.dur;
    if (!dur && measured < MEASURE) {
      measured++;
      dur = await lengthOf(f.url).catch(() => 0) || undefined;
    }
    lectures.push({ id, url: f.url, ...rest, ...(dur && { dur }) });
  }
  lectures.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  // Written only when something changed, so the app's ETag check stays a 304.
  const same = before && JSON.stringify(before.lectures) === JSON.stringify(lectures);
  if (!same && lectures.length) {
    await env.AUDIO.put(KEY, JSON.stringify({ checked: now.toISOString(), lectures }), {
      httpMetadata: { contentType: 'application/json' },
    });
  }
  return { found: lectures.length, measured, changed: !same };
}
