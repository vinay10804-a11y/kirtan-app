#!/bin/bash
# One command to (re)publish the app. Run it again any time you add kirtans.
#
#   ./publish.sh                 # uses ~/Desktop/KC/Kirtans
#   ./publish.sh --no-fetch      # skip checking YouTube, SoundCloud and Spotify for new recordings
#   ./publish.sh /other/folder
set -euo pipefail
cd "$(dirname "$0")"

FETCH=1
SRC="$HOME/Desktop/KC/Kirtans"
for arg in "$@"; do
  case "$arg" in
    --no-fetch|--no-japa) FETCH=0 ;;
    *) SRC="$arg" ;;
  esac
done

missing=()
for tool in node ffmpeg ffprobe; do command -v "$tool" >/dev/null || missing+=("$tool"); done
[ "$FETCH" = 1 ] && { command -v yt-dlp >/dev/null || missing+=("yt-dlp"); }
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing: ${missing[*]}"
  echo "Install with Homebrew:  brew install node ffmpeg yt-dlp"
  echo "(No Homebrew? Get it from https://brew.sh first.)"
  exit 1
fi

[ -d node_modules ] || npm install --no-audit --no-fund
W=./node_modules/.bin/wrangler

if [ "$FETCH" = 1 ]; then
  echo "== Checking for new japa sessions"
  tools/fetch-japa.sh "$SRC"
  node tools/videos.mjs
  echo "== Checking Spotify playlists"
  tools/fetch-spotify.sh "$SRC"
fi

echo "== Photos"
node tools/photos.mjs

echo "== Preparing audio"
node tools/build.mjs "$SRC"

echo "== Cloudflare"
if $W whoami 2>&1 | grep -qi "not authenticated"; then
  echo "A browser window will open: log in to Cloudflare and click Allow."
  $W login
fi
if ! out=$($W r2 bucket create kirtans 2>&1) && ! grep -qi "already exists" <<<"$out"; then
  echo "$out"
  echo
  echo "Couldn't create the storage bucket. Turn on R2 once at"
  echo "https://dash.cloudflare.com → R2 Object Storage, then run ./publish.sh again."
  exit 1
fi

echo "== Uploading audio (only new files)"
node tools/upload.mjs

echo "== Publishing the app"
$W deploy
echo
echo "Done. Open the workers.dev link above on your laptop and phone."
