#!/bin/zsh
# The pictures and the kirtan list the app is built from (Thumbnails, Photos of SNS,
# Kirtans list.xlsx and the READ ME, all in "SNS Kirtan Platform"), backed up in the private
# GitHub repository vinay10804-a11y/sns-kirtan-originals (owner, 16 Nov 2026: "make sure all of
# this project is accessible from a different laptop … put it into GitHub").
#
#   tools/originals.sh save      # sends any changes to GitHub (publish.sh does this by itself)
#   tools/originals.sh restore   # on a new laptop: brings them down into "SNS Kirtan Platform"
#
# The Desktop syncs to iCloud, which breaks git's own folder, so git keeps its data in
# "originals-git.nosync" (".nosync": iCloud leaves it alone) and works on the files where they are.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TOP="$(cd "$HERE/.." && pwd)"
G="$TOP/originals-git.nosync"
REPO=https://github.com/vinay10804-a11y/sns-kirtan-originals.git
git_() { git --git-dir="$G" --work-tree="$TOP" "$@"; }
cd "$TOP" # so the paths git lists are the paths it is given back

only_these() {
  cat > "$G/info/exclude" <<'EOF'
# Only these are backed up; everything else in "SNS Kirtan Platform" is left out
# (the app and the transcripts have their own GitHub repositories; the Kirtans
# recordings are too big for GitHub and their compressed copies are in Cloudflare).
/*
!/Thumbnails/
!/Photos of SNS/
!/Kirtans list.xlsx
!/READ ME - what's in this folder.txt
.DS_Store
*.pdf
EOF
}

case "$1" in
  save)
    [ -d "$G" ] || { echo "No backup set up here (run: tools/originals.sh restore)"; exit 0; }
    git_ add -A
    if git_ diff --cached --quiet; then echo "Originals: nothing new to back up"; exit 0; fi
    git_ commit -q -m "Originals: $(date '+%-d %b %Y, %H:%M')"
    git_ push -q origin main && echo "Originals backed up to GitHub"
    ;;
  restore)
    if [ ! -d "$G" ]; then
      git init -q --bare "$G"
      git --git-dir="$G" config core.bare false
      git --git-dir="$G" config core.worktree "$TOP"
      git --git-dir="$G" remote add origin "$REPO"
      mkdir -p "$G/info"
      only_these
    fi
    git_ fetch -q origin main
    # Files already here win: only missing ones are filled in from GitHub.
    git_ reset -q origin/main
    git_ ls-files -z --deleted | xargs -0 git --git-dir="$G" --work-tree="$TOP" checkout --
    git_ branch -q -M main 2>/dev/null || true
    git_ branch -q -u origin/main main 2>/dev/null || true
    echo "Originals are in $TOP"
    ;;
  *) echo "Use: tools/originals.sh save | restore"; exit 1 ;;
esac
