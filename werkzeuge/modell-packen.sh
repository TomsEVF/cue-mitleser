#!/bin/bash
# Packt das deutsche Vosk-Modell so, wie die Browser-Version (vosk-browser) es erwartet:
# web/models/vosk-model-small-de-0.15.tar.gz mit dem Ordner „model/“ darin.
# Nimmt das Modell aus ~/.cue-mitleser/models, falls vorhanden, sonst wird es geladen.
set -euo pipefail
cd "$(dirname "$0")/.."
MODELL=vosk-model-small-de-0.15
ZIEL="web/models/$MODELL.tar.gz"
if [ -f "$ZIEL" ]; then echo "Modell vorhanden: $ZIEL"; exit 0; fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
QUELLE="${CUE_DATEN:-$HOME/.cue-mitleser}/models/$MODELL"
if [ -d "$QUELLE" ]; then
  cp -R "$QUELLE" "$TMP/model"
else
  echo "Lade $MODELL …"
  curl -L --fail -o "$TMP/m.zip" "https://alphacephei.com/vosk/models/$MODELL.zip"
  unzip -q "$TMP/m.zip" -d "$TMP"
  mv "$TMP/$MODELL" "$TMP/model"
fi
mkdir -p web/models
COPYFILE_DISABLE=1 tar -czf "$ZIEL" -C "$TMP" model
ls -la "$ZIEL"
