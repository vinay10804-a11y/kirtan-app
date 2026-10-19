#!/bin/bash
# Downloads the Spotify playlists listed in tools/spotify-playlists.txt into
# Kirtans/<artist>/<year> <album>/<title>.mp3. spotdl finds each track on
# YouTube Music (Spotify audio itself is copy-protected) and skips files that
# already exist.
#
#   tools/fetch-spotify.sh [KirtansFolder]
set -uo pipefail

KIRTANS="${1:-$HOME/Desktop/KC/Kirtans}"
LIST="$(dirname "$0")/spotify-playlists.txt"
SPOTDL="$(command -v spotdl || echo "$HOME/.local/bin/spotdl")"

if [ ! -x "$SPOTDL" ]; then
  echo "spotdl isn't installed, so Spotify playlists were skipped."
  echo "Install it with:  brew install pipx && pipx install spotdl"
  exit 0
fi

grep -vE '^\s*(#|$)' "$LIST" | while read -r url; do
  echo "→ $url"
  "$SPOTDL" download "$url" --format mp3 --threads 4 \
    --output "$KIRTANS/{artist}/{year} {album}/{title}.{output-ext}"
done

# A track spotdl can't match is reported above but shouldn't stop the publish.
exit 0
