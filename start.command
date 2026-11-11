#!/bin/bash
# Cue-Mitleser starten – Doppelklick im Finder.
# Beim ersten Start: Python-Umgebung anlegen und deutsches Vosk-Modell laden (ca. 45 MB, braucht Internet).
# Danach läuft alles offline.

set -e
cd "$(dirname "$0")"

DATEN="$HOME/.cue-mitleser"          # außerhalb von iCloud, damit nicht synchronisiert wird
VENV="$DATEN/venv"
MODELLE="$DATEN/models"
MODELL="vosk-model-small-de-0.15"
PORT="${CUE_PORT:-8000}"

mkdir -p "$DATEN" "$MODELLE"

if [ ! -x "$VENV/bin/python" ]; then
  echo "Lege Python-Umgebung an …"
  python3 -m venv "$VENV"
fi
if [ ! -f "$VENV/.installiert" ] || [ requirements.txt -nt "$VENV/.installiert" ]; then
  echo "Installiere Pakete …"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r requirements.txt
  touch "$VENV/.installiert"
fi

if ! ls -d "$MODELLE"/*de* >/dev/null 2>&1 && ! ls -d models/*de* >/dev/null 2>&1; then
  echo "Lade deutsches Sprachmodell ($MODELL) …"
  curl -L --fail -o "$MODELLE/$MODELL.zip" "https://alphacephei.com/vosk/models/$MODELL.zip"
  (cd "$MODELLE" && unzip -q "$MODELL.zip" && rm "$MODELL.zip")
fi

# Modell zusätzlich für die Browser-Version packen (web/models, für iPad/GitHub-Variante am Mac)
bash werkzeuge/modell-packen.sh >/dev/null 2>&1 || true

# Läuft schon ein Server? Dann nur Browser öffnen.
if curl -s "http://localhost:$PORT/api/stuecke" >/dev/null 2>&1; then
  open "http://localhost:$PORT"
  exit 0
fi

# Ruhezustand verhindern, solange der Server läuft
exec caffeinate -dims "$VENV/bin/python" server.py --browser
