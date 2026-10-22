# Notes: what's next for the kirtan app

A running list for Vinoda Govinda. Ask "what's on the list?" and Claude reads this file.
Tick items off (or delete them) as they're done.

## Changes still to make

- **Places for 42 kirtans.** They show no place until we know where they were recorded
  (list under "What I need from you").
- **Thumbnails and details: use "Kirtans list.xlsx"** in the SNS Kirtan Platform folder (built
  22 Oct). Put a picture in the Thumbnails folder named after the kirtan's number (e.g. `12.jpg`),
  or type its file name in the Thumbnail column. Places, titles, types and years can be typed in
  too. Save, close Excel, and ask Claude to publish. The sheet's "How to use" tab explains it.
- **Lyrics inside the app.** Done for 14 bhajans: the lyrics card opens that song's kksongs.org
  page in a panel inside the app (it needs internet, and looks like the KKSongs site). To show the
  words in the app's own style and offline instead, add `verses` to the song in `site/lyrics.json`,
  using only text we have permission to use (e.g. your own songbook).
- **Four bhajans have no lyrics page yet** and still use a web search: He Govinda, He Gopal
  (kksongs has three different songs with this name), Gauranga Karuna Koro, Radharaman Kaho,
  and Sakhi He (Smita Krsna).
- **Japa plays from YouTube and SoundCloud** (chosen 19 Oct 2026; Japa Inspirations moved to
  SoundCloud on 22 Oct). Downside: it stops when the
  phone screen locks or you leave the Japa page, there's no offline listening, and YouTube may show
  ads. If that gets annoying, switch to audio-only copies on Cloudflare (about 0.5 GB, free tier).
- **Check five kirtan types.** Radhe Govinda, KKS Tune, Manu Tune, Adhivas and Meditation on
  Krsna's Arrival are filed as Mahamantra. Move any that are bhajans.
- **Spotify-style ideas not built yet** (say which you'd like): drag to reorder playlists (today it's
  Move up/down in the ⋯ menu); playlists and favourites that follow you between phone and laptop (needs
  sign-in); repeat a whole playlist; suggestions based on what you listen to most; recent searches.
- **Playlists and favourites stay on each device.** Ones made on your phone don't appear on your laptop.
- **Spotify playlist not included.** The site is public and those albums are commercial releases.
  Consider making the site login-only (Cloudflare Access) before adding them.
- **Smaller audio: done.** All kirtans are AAC 96 kbps (3.5 GB online instead of 4.9 GB), inside
  Cloudflare's free 10 GB. Publishing keeps every recording that's already online, so local copies can
  be deleted (see "Safe to delete" below).
- **No backup of the originals** (your choice). The app's versions are the only copy once you delete
  your local files. Keep the Kirtans folder on an external drive if you ever want full quality again.

## Safe to delete on your Mac

Once a kirtan is published it stays on the website. You can delete (or move to an external drive):
- the recordings in `Kirtans` (keep any new ones until they've been published);
- `kirtan-app/build` (4.6 GB of compressed copies);
- the `Photos of SNS` folder (the photos are already in the app).
Add new kirtans to an empty `Kirtans` folder next to `kirtan-app` and ask Claude to publish.

## What I need from you

1. **Where each of these was recorded** (e.g. "Holy Name Immersion = Radhadesh"):
   - Sacinandana Swami: Govinda Kund · Swiss Church (2025); He Govinda, He Gopal; Holy Name
     Immersion; Holy Name Retreat · Govinda Kund; Jaya Jaya Radhe Jaya Jaya Shyam; Mantra Lounge ·
     Govinda Kund; Ter Kadamba (2023); The Cure for the Mind · Gauranga Karuna Koro.
   - Gour Krishna: Abhishek Kirtan, Narasimha Caturdasi (2024); Adhivas (2025); Are Bhai Nitai Amar
     Doyara Avadhi; Bhakti Retreat (2024); Emona Durmati; Guruvastakam with Manu (2026); Holy Name
     Immersion; Holy Name Immersion 8hr Kirtan (2025); Holy Name Immersion Day 4 (2025); Holy Name
     Immersion Evening Kirtan (2025); Holy Name Immersion Retreat (2023); Janmashtami (2024);
     Janmashtami Midnight Kirtan (2025); Jaya Radha Madhava; Kevalastakam (2023); KKS Tune; Manu
     Tune; Meditation on Krsna's Arrival, Janmastami (2023); Mentorship (2025); Mentorship Kirtan #1
     and #2 (2022); Narashimadev Prayers; Nityananda Trayodashi (2025); Prabhupada's Room (2025);
     Radharaman Kaho; Radhe Govinda · Mantra Lounge (2025); Rama Navami (2026); Sanga Mela;
     Siksastakam Parts 1 and 2; Sakhi He Bhajan (Smita Krsna); Sri Krishna Caitanya Prabhu Doya
     Koro; Srila Prabhupada's House; The Mood of Longing (2022).
2. **Track images**, whenever they're ready.
3. **The four bhajans without a lyrics page:** which "He Govinda, He Gopal" it is, and a page for
   the others if you know one.
4. **Bhajan or Mahamantra?** for the five kirtans listed above.
5. **Lyrics text you're happy to have in the app** (for example from your own songbook), if you
   want the words shown inside the app rather than linked.
6. **One-time on your iPhone:** delete the old home-screen shortcut, then in Safari open the site,
   tap Share → Add to Home Screen, so the new icon is picked up.
