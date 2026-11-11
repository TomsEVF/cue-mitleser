#!/bin/bash
# Veröffentlicht die App (Ordner web/ inkl. Sprachmodell) auf GitHub Pages.
# Schreibt dazu den Inhalt von web/ in den Branch „gh-pages“ und pusht ihn.
# GitHub Pages ist auf „Deploy from a branch: gh-pages /“ eingestellt.
set -euo pipefail
cd "$(dirname "$0")/.."
bash werkzeuge/modell-packen.sh

TMP=$(mktemp -d)
aufraeumen() { git worktree remove --force "$TMP" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap aufraeumen EXIT

git fetch -q origin gh-pages 2>/dev/null || true
if git show-ref --verify --quiet refs/remotes/origin/gh-pages; then
  git worktree add -q -f -B gh-pages "$TMP" origin/gh-pages
else
  git worktree add -q --detach "$TMP"
  (cd "$TMP" && git checkout -q --orphan gh-pages && git rm -rfq . )
fi

rsync -a --delete --exclude .git --exclude models/.gitkeep web/ "$TMP/"
touch "$TMP/.nojekyll"

cd "$TMP"
git add -A
if git diff --cached --quiet; then echo "Keine Änderungen – nichts zu veröffentlichen."; exit 0; fi
git commit -q -m "Veröffentlichung $(date '+%Y-%m-%d %H:%M')" ${COMMIT_ZUSATZ:+-m "$COMMIT_ZUSATZ"}
git push -q origin gh-pages
echo "Veröffentlicht. In 1–2 Minuten aktuell unter der GitHub-Pages-Adresse."
