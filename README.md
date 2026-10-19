# Sacinandana Swami and Gour Krishna Kirtans

A web app for kirtans, bhajans and guided japa that works on laptop and phone and can play recordings offline.
It's hosted free on your own Cloudflare account.

## First time (about 15 minutes)

1. **Install the tools** (skip any you already have). In Terminal:
   ```
   brew install node ffmpeg yt-dlp
   ```
   No Homebrew? Install it first from https://brew.sh.
2. **Create a free Cloudflare account** at https://dash.cloudflare.com/sign-up.
   Then open **R2 Object Storage** in the left menu and turn it on. It may ask for a card.
   The free tier covers 10 GB, so a collection this size costs nothing.
3. **Publish.** Put this folder next to your `Kirtans` folder (for example `~/Desktop/sns kirtan platform/kirtan-app`) and run:
   ```
   cd ~/Desktop/sns\ kirtan\ platform/kirtan-app
   ./publish.sh
   ```
   The first time, a browser window opens: log in to Cloudflare and click **Allow**.
   When it finishes, it prints your link, like `https://kirtans.<your-name>.workers.dev`.

## Adding more later

- **New kirtans:** drop them anywhere in the `Kirtans` folder and run `./publish.sh` again. Only new files are processed.
- **New guided japa sessions:** add the YouTube link to `tools/guided-japa.txt`, then run `./publish.sh`.
  New videos in the Japa Inspirations playlist and the Living Name SoundCloud set are picked up automatically.
- **Photos:** whatever is in the `photos of sns` folder (next to the project) shows on the home page.
  Put a name in a photo's file name (e.g. `gour krishna.jpg`, `sns.jpg`) to use it as that person's picture.
- **Japa:** the Guided Japa and Japa Inspirations tabs show the YouTube videos; **Listen here** plays one on the page,
  and tapping the picture opens YouTube. Living Name meditations play from SoundCloud. Nothing is downloaded.
  `./publish.sh --download` saves audio and MP4 copies to your Mac instead (about 1 GB per session at 720p).
- **Spotify playlists:** add the link to `tools/spotify-playlists.txt`. New tracks download on the next `./publish.sh --download`.
  Spotify audio is copy-protected, so each track is fetched from YouTube Music. Check that the odd rare one matched the right recording.
- **Skip refreshing the Japa list** (faster): `./publish.sh --no-fetch`

## How things are sorted

- `Kirtans/Japa/<collection>/…` → the **Japa** tab
- Anything with "Sacinandana" in its path → **Sacinandana Swami**. Anything with "Gour", "Gaur" or "Radhanath" → **Gour Krishna**.
  Only these two appear; anything else is skipped, and `./publish.sh` lists what it skipped.
- A folder named "Bhajans" → **Bhajans**. Names containing "Hare Krishna" or "Maha Mantra" → **Mahamantra**
- A year (e.g. 2019) anywhere in the path → filter by **Year**
- A holy place (Vrindavan, Mayapur, Govardhan…) in the path, or the event folder name (e.g. `2024 Holy Name Retreat`) → filter by **Place**

If something lands in the wrong place, the rules live in `tools/classify.mjs`.

## On your phone

Open the link in Safari (iPhone) or Chrome (Android), then **Share → Add to Home Screen**.
It then opens like an app, keeps playing with the screen locked, and keeps your saved recordings.

## Working in the cloud (no Mac)

The original recordings can live in the Cloudflare R2 bucket `kirtans-source` instead of on the Mac
(upload the `Kirtans` folder with Cyberduck or the dashboard, keeping its folders). A cloud session
with `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` set can then build and publish; the steps are in `CLAUDE.md`.
