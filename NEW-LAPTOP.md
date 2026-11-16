# Working on the app from another laptop

Everything needed to keep the app going is on GitHub, in three places, apart from two
secrets and the original recordings (see the end). On a new Mac it takes about 20 minutes to
set up; or open Claude Code on the new laptop and say *"set up the kirtan app from NEW-LAPTOP.md"*.

| What | Where on GitHub | On the laptop |
|---|---|---|
| The app: code, kirtan list, covers, photos it shows, notes | `vinay10804-a11y/kirtan-app` (public) | `SNS Kirtan Platform/kirtan-app.nosync` |
| Lecture transcripts | `vinay10804-a11y/lecture-transcripts` (private) | `SNS Kirtan Platform/Lecture transcripts.nosync` |
| Thumbnails, Photos of SNS, Kirtans list.xlsx, the READ ME | `vinay10804-a11y/sns-kirtan-originals` (private) | straight in `SNS Kirtan Platform` |

The app's audio is in Cloudflare (R2), not on any laptop, and the lecture list updates itself
in Cloudflare every 6 hours. So the website keeps working whatever happens to a laptop.

## Setting up

1. Install the tools (Terminal; Homebrew from https://brew.sh first if it isn't there):
   ```
   brew install node ffmpeg yt-dlp gh
   gh auth login
   ```
2. Bring the three down (the folder names matter: the `.nosync` ones keep iCloud away from them):
   ```
   mkdir -p ~/Desktop/"SNS Kirtan Platform" && cd ~/Desktop/"SNS Kirtan Platform"
   gh repo clone vinay10804-a11y/kirtan-app kirtan-app.nosync && ln -s kirtan-app.nosync kirtan-app
   gh repo clone vinay10804-a11y/lecture-transcripts "Lecture transcripts.nosync" && ln -s "Lecture transcripts.nosync" "Lecture transcripts"
   cd kirtan-app.nosync && npm install && tools/originals.sh restore
   ```
3. The Cloudflare key, so this laptop can publish. Make a new one (the old laptop's key can stay):
   open https://dash.cloudflare.com/profile/api-tokens, **Create Token**, template **Edit Cloudflare
   Workers**, add **Account · D1 · Edit**, all zones, no expiry. Then in `kirtan-app.nosync` make a
   file called `.env` with two lines (the account ID is on the Cloudflare dashboard's right-hand side):
   ```
   CLOUDFLARE_ACCOUNT_ID=<the account ID>
   CLOUDFLARE_API_TOKEN=<the new key>
   ```
   It's private: `.env` never goes to GitHub.
4. Check it: `./publish.sh --no-fetch` should finish with "Done".
5. Transcripts (only on a Mac with an Apple chip): `pip3 install -U mlx-whisper --break-system-packages`
   (it must give a `mlx_whisper` command), then double-click
   **Resume transcripts.command** in `Lecture transcripts.nosync`. Only one laptop should run it at a time.

## Not on GitHub, on purpose

- **The Lectures password** (`Lectures password.txt`). Keep it in your password manager. The app's
  own copy is in Cloudflare, so the website doesn't need the file; it's only for telling people.
- **The Cloudflare key** (`.env`): make a new one per laptop, as above.
- **The original recordings** (`Kirtans`, 8 GB): too big for GitHub, and not needed: the app's
  compressed copies are in Cloudflare, and the build keeps every recording that's online even when
  its original isn't on the laptop. Only put *new* recordings in `Kirtans` before publishing.
- The Excel list of YouTube links is in Google Drive already.

## Keeping it backed up

- The app: every change Claude makes goes to GitHub as a pull request.
- Transcripts: the transcript job saves them to GitHub as it goes.
- Pictures and the Excel list: every `./publish.sh` backs them up (`tools/originals.sh save`).
