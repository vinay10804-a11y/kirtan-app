#!/bin/bash
# Downloads Sacinandana Swami's japa collections. Already-downloaded items are skipped.
#   • audio  → Kirtans/Japa/<Collection>/   (for offline listening in the app)
#   • MP4    → KC/Japa Videos/<Collection>/ (to watch offline on the Mac or phone)
#
#   tools/fetch-japa.sh [KirtansFolder]
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
KIRTANS="${1:-$(cd "$(dirname "$0")/../.." && pwd)/Kirtans}"
AUDIO="$KIRTANS/Japa"
VIDEO="$(dirname "$KIRTANS")/Japa Videos"
mkdir -p "$AUDIO" "$VIDEO"

name='%(upload_date>%Y-%m-%d|undated)s %(title)s [%(id)s].%(ext)s'
quiet=(--ignore-errors --no-overwrites --quiet --progress --no-warnings)

audio() { # collection, then yt-dlp source args
  local col="$1"; shift
  yt-dlp "${quiet[@]}" -f 'bestaudio[ext=m4a]/bestaudio' -x \
    --download-archive "$AUDIO/.downloaded.txt" -o "$name" -P "$AUDIO/$col" "$@"
}
video() {
  local col="$1"; shift
  yt-dlp "${quiet[@]}" -f 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' --merge-output-format mp4 \
    --download-archive "$VIDEO/.downloaded.txt" -o "$name" -P "$VIDEO/$col" "$@"
}

echo "→ Guided Japa: audio, then MP4 video (each session is roughly 1 GB at 720p)"
audio "Guided Japa" --batch-file "$HERE/guided-japa.txt"
video "Guided Japa" --batch-file "$HERE/guided-japa.txt"

echo "→ Japa Inspirations: audio, then MP4 video"
audio "Japa Inspirations" --batch-file "$HERE/japa-inspirations.txt"
video "Japa Inspirations" --batch-file "$HERE/japa-inspirations.txt"

echo "→ Living Name Meditations (SoundCloud, audio only)"
audio "Living Name Meditations" "https://soundcloud.com/sacinandanaswami/sets/meditations-from-the-living"

# yt-dlp exits non-zero when any single item fails (private/removed videos);
# the rest still downloaded, so don't stop the publish over it.
exit 0
