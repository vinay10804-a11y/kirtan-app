#!/bin/bash
# One command to (re)publish the app. Run it again any time you add kirtans.
#
#   ./publish.sh                 # uses the Kirtans folder next to this project
#   ./publish.sh --no-fetch      # don't refresh the Japa list from YouTube and SoundCloud
#   ./publish.sh --download      # also download Japa audio/video and the Spotify playlists (many GB)
#   ./publish.sh /other/folder
set -euo pipefail
cd "$(dirname "$0")"

FETCH=1
DOWNLOAD=0
# Recordings live in a "Kirtans" folder beside this project
# (e.g. ~/Desktop/sns kirtan platform/Kirtans); ~/Desktop/KC/Kirtans is the older location.
SRC="$(cd .. && pwd)/Kirtans"
[ -d "$SRC" ] || SRC="$HOME/Desktop/KC/Kirtans"
for arg in "$@"; do
  case "$arg" in
    --no-fetch|--no-japa) FETCH=0 ;;
    --download) DOWNLOAD=1 ;;
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

# Japa plays from YouTube and SoundCloud, so normally only its list is refreshed.
if [ "$DOWNLOAD" = 1 ]; then
  echo "== Downloading japa sessions"
  tools/fetch-japa.sh "$SRC"
  echo "== Checking Spotify playlists"
  tools/fetch-spotify.sh "$SRC"
fi
if [ "$FETCH" = 1 ]; then
  echo "== Refreshing the Japa list"
  node tools/videos.mjs
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
