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
- **Manu Tune removed** (25 Oct, at your request): off the website and the Excel list; the recording is
  in the Trash ("Removed kirtans (25 Oct 2026)") if you want it back.
- **Check three kirtan types.** KKS Tune, Adhivas and Meditation on Krsna's Arrival are
  filed as Mahamantra. Move any that are bhajans (Radhe Govinda · Mantra Lounge moved to Bhajans,
  24 Oct).
- **Platform audit: done** (22 Oct). Compared with SoundCloud and Spotify and fixed: quick skips
  playing the wrong kirtan, playback stopping for good when the signal drops, offline next/previous
  stopping at unsaved kirtans, no loading indicator, the queue being lost on closing the app, the
  phone's back button leaving the app, favourites listed oldest first, and very different volumes
  between kirtans (all now levelled to the same loudness). Added: Repeat all / Repeat one, link
  previews when sharing (title, leader and picture in WhatsApp/Messages), recent searches,
  space used by saved kirtans, and continue-listening on every device for signed-in people.
- **Kirtans saved offline before 22 Oct** need saving again (the levelled versions are new files;
  the app clears the old copies by itself).
- **Spotify-style ideas not built yet** (say which you'd like): drag to reorder playlists (today it's
  Move up/down in the ⋯ menu); suggestions based on what you listen to most; a sleep-timer fade-out.
- **Optional tidy-up on Cloudflare:** the older audio copies (`media/` folder in the kirtans bucket,
  about 3.5 GB) are no longer used. Still free (about 7 GB of 10 GB), but removing them leaves room
  for more kirtans. Ask Claude to walk you through it.
- **Accounts: done** (22 Oct). People can sign in under Library to keep favourites and playlists on all
  their devices. If someone forgets their password, ask Claude to "reset the password for <their
  email>": you'll get a temporary password to pass on, and they change it in the app.
- **Spotify playlist not included.** The site is public and those albums are commercial releases.
  Consider making the site login-only (Cloudflare Access) before adding them.
- **Smaller audio: done.** All kirtans are AAC 96 kbps (3.5 GB online instead of 4.9 GB), inside
  Cloudflare's free 10 GB. Publishing keeps every recording that's already online, so local copies can
  be deleted (see "Safe to delete" below).
- **No backup of the originals** (your choice). The app's versions are the only copy once you delete
  your local files. Keep the Kirtans folder on an external drive if you ever want full quality again.

- **46 kirtans added from your "Kirtans for app" Google Sheet** (23 Oct): 24 Sacinandana Swami
  (incl. Kirtan Mela Mayapur 2012, 2013 and 2015 from ISKCON Desire Tree) and 22 Gour Krishna (incl. the
  "Jay Krishna" recordings and two bhajans). Saved in the Kirtans folder and added to Kirtans list.xlsx
  (numbers 110–155). One was left out because it's already in the app: "Bhakti retreat night kirtan,
  26.07.25" is the same recording as "1am Kirtan" (Switzerland, 2025); rename that one in the sheet if
  you prefer. Guesses made from the SoundCloud pages (correct them in the sheet if wrong): Holy Name
  Immersion May 2025 = New Vrindaban (its artwork says "The Holy Name Experience, New Vrindaban");
  "SPH" = Srila Prabhupada's House, Vrindavan; Brunel 24h = London; "Jay Krsna Mellows 2015" = Radhadesh
  Mellows; Lila Kirtan = Pandava Sena Mentorship Trip, Feb 2024; Leicester 2014 = Leicester Kirtan Fest.
- **Cloudflare storage is about 8.4 GB of the free 10 GB** after adding these. Before adding many more,
  remove the unused older audio copies (`media/` folder, about 3.5 GB). Ask Claude to walk you through it.

- **9 more kirtans added** (24 Oct, from the "Kirtans for app" sheet, YouTube): Kirtan Rasa Dubai 2022
  and 2025 and London Mellows 2026, for Sacinandana Swami (5) and Gour Krishna (4). In the Kirtans
  folder and Kirtans list.xlsx (numbers 156–164).
- **Covers:** every Sacinandana Swami kirtan now has a photo. **Gour Krishna has only 5 photos**, each
  used on 3 kirtans (your limit), so **62 Gour Krishna kirtans still show "GK"**. Put about 20 more
  Gour Krishna photos in Thumbnails/GK and ask Claude to publish; they're given out automatically.
  To swap a picture you don't like, delete it in the Picture column of Kirtans list.xlsx (or type
  another file name in its Thumbnail cell), save, close Excel and publish.

- **Lectures (private test, 25 Oct):** https://kirtans.kirtan-app.workers.dev/lectures/ with the password in
  "Lectures password.txt" (in the SNS Kirtan Platform folder). 6,913 of Sacinandana Swami's lectures from
  the Saranagati Library, playing straight from there; not linked from the main app. Decide whether to
  keep it; if it goes public, ask SacinandanaSwami.com first (their site says the content is copyright).
  Tell Claude what the place codes mean (GD, RD, V, GB, B, HD, VA, Z, …) to show places.

## Your SNS Kirtan Platform folder

Tidied on 24 Oct: "READ ME - what's in this folder.txt" at the top explains each folder. Old test
clips, an empty Guided Japa folder, a broken "kirtan-app 2" copy and about 8 GB of old audio copies
went to the Trash ("SNS Kirtan Platform clean-up (24 Oct 2026)"); empty the Trash to free 7.8 GB.

If you need more space later: once a kirtan is published it stays on the website, so the recordings
in `Kirtans` and the 5 GB of compressed copies in `kirtan-app/build/audio` could move to an external
drive. Keep the folder names as they are; the app finds things by them.

## What I need from you

1. **Where each of these was recorded** (e.g. "Holy Name Immersion = Radhadesh"):
   - Sacinandana Swami: Govinda Kund · Swiss Church (2025); He Govinda, He Gopal; Holy Name
     Immersion; Holy Name Retreat · Govinda Kund; Jaya Jaya Radhe Jaya Jaya Shyam; Mantra Lounge ·
     Govinda Kund; Ter Kadamba (2023); The Cure for the Mind · Gauranga Karuna Koro.
   - Gour Krishna: Abhishek Kirtan, Narasimha Caturdasi (2024); Adhivas (2025); Are Bhai Nitai Amar
     Doyara Avadhi; Bhakti Retreat (2024); Emona Durmati; Guruvastakam with Manu (2026); Holy Name
     Immersion; Holy Name Immersion 8hr Kirtan (2025); Holy Name Immersion Day 4 (2025); Holy Name
     Immersion Evening Kirtan (2025); Holy Name Immersion Retreat (2023); Janmashtami (2024);
     Janmashtami Midnight Kirtan (2025); Jaya Radha Madhava; Kevalastakam (2023); KKS Tune;
     Meditation on Krsna's Arrival, Janmastami (2023); Mentorship (2025); Mentorship Kirtan #1
     and #2 (2022); Narashimadev Prayers; Nityananda Trayodashi (2025); Prabhupada's Room (2025);
     Radharaman Kaho; Radhe Govinda · Mantra Lounge (2025); Rama Navami (2026); Sanga Mela;
     Siksastakam Parts 1 and 2; Sakhi He Bhajan (Smita Krsna); Sri Krishna Caitanya Prabhu Doya
     Koro; Srila Prabhupada's House; The Mood of Longing (2022).
   - Added 23 Oct, place and/or year unknown: Sacinandana Swami: Lila Kirtan · Mentorship Trip (2024);
     Gaura Meditation & Kirtan Parts 1 and 2 (Holy Name Immersion, May 2023); Kirtan Mela Germany 5
     (2011). Gour Krishna: Aindra Prabhu Appearance Day (2014); Sena Getaway Retreat, Germany (2016);
     Birmingham 24 Hour Kirtan · Night Shift (year?); Brunel 24 Hour Kirtan (year?); Hare Krishna Kirtan
     with Arjun Raja; Kirtan at Audarya's House Programme; Kirtan at Radhadesh (year?); Saturday Kirtan;
     Sunday Kirtan.
2. **Track images**, whenever they're ready.
3. **The four bhajans without a lyrics page:** which "He Govinda, He Gopal" it is, and a page for
   the others if you know one.
4. **Bhajan or Mahamantra?** for the three kirtans listed above.
5. **Lyrics text you're happy to have in the app** (for example from your own songbook), if you
   want the words shown inside the app rather than linked.
6. **One-time on your iPhone:** delete the old home-screen shortcut, then in Safari open the site,
   tap Share → Add to Home Screen, so the new icon is picked up.
