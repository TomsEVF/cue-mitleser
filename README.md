# Cue-Mitleser

Hört während der Vorstellung über das Mac-Mikrofon mit, erkennt die Stelle im Skript
und kündigt Licht-, Ton- und Video-Einsätze (LX / SND / VID) rechtzeitig an.
Die App löst nichts aus – den Go drückt weiterhin ein Mensch in Cue2 bzw. QLC+.

## Drei Arten, die App zu nutzen

| | **Im Browser / iPad** (GitHub Pages) | **Mac mit Server** (`start.command`) |
| --- | --- | --- |
| Aufruf | `https://<benutzer>.github.io/<repo>/` | `http://localhost:8000` |
| Spracherkennung | Vosk im Browser (offline) oder eingebaute Apple-Erkennung | Vosk auf dem Mac (Mac-Mikrofon) |
| Stücke gespeichert | im Browser des Geräts (IndexedDB) | Ordner `stuecke/` auf dem Mac |
| Installation | keine – auf dem iPad „Teilen → Zum Home-Bildschirm“ | Python, wird beim ersten Start eingerichtet |

Dritte Möglichkeit: **Mac hört mit, iPad zeigt an.** `CUE_HOST=0.0.0.0` setzen (siehe unten) und auf dem
iPad `http://<mac-name>.local:8000` öffnen. Dann kommt die Erkennung vom Mac-Mikrofon. Das iPad-Mikrofon
geht so nicht, weil Browser Mikrofone nur über https erlauben.

### iPad (oder jeder andere Browser)

1. In Safari die GitHub-Pages-Adresse öffnen.
2. **Teilen → Zum Home-Bildschirm.** Ab dann startet die App im Vollbild, funktioniert offline,
   und Safari löscht die gespeicherten Stücke nicht.
3. ⋯ → Einstellungen → Spracherkennung:
   - **Vosk im Browser (offline):** „Sprachmodell jetzt laden“ (ca. 45 MB, einmalig im WLAN).
     Danach braucht es kein Internet mehr.
   - **Eingebaute Erkennung (Apple):** oft genauer, braucht aber meist Internet und schickt den Ton an Apple.
4. Beim ersten Start von Probe/Show fragt das iPad nach dem Mikrofon → erlauben.
5. Steuerung per Touch-Leiste unter dem Prompter (▲▼ Zeile, Pause, Freeze, Cue zurück, ✓ Erledigt).
   Mit Tastatur gelten die Tasten unten. Cues verschieben: Marke antippen → „Verschieben“ → neues Wort antippen.
6. Während Probe/Show bleibt der Bildschirm an.

**Stücke zwischen Mac und iPad übertragen:** ⋯ → „Stück exportieren (.json)“ und auf dem anderen Gerät
⋯ → „Stück aus Datei laden“ (z. B. über AirDrop oder iCloud Drive). Stücke im Browser regelmäßig
exportieren, denn sie liegen nur auf diesem einen Gerät.

### Mac mit Server

Doppelklick auf **`start.command`** (beim ersten Mal: Rechtsklick → Öffnen).

- Beim ersten Start werden die Python-Pakete und das deutsche Vosk-Modell (ca. 45 MB)
  nach `~/.cue-mitleser/` geladen. Danach läuft alles offline.
- Der Browser öffnet `http://localhost:8000`. Für die Show: Vollbild-Knopf oben rechts.
- macOS fragt beim ersten Mitlesen, ob das Terminal das Mikrofon benutzen darf → erlauben.
- Solange der Server läuft, verhindert `caffeinate`, dass der Mac einschläft.

Von Hand: `~/.cue-mitleser/venv/bin/python server.py`. Optionen über Umgebungsvariablen:
`CUE_PORT`, `CUE_HOST=0.0.0.0` (im WLAN erreichbar), `CUE_MODELL=/pfad/zum/modell`, `CUE_OHNE_ERKENNUNG=1`.

Genaueres, größeres Modell für den Mac (ca. 1,9 GB): `vosk-model-de-0.21` von
https://alphacephei.com/vosk/models entpacken nach `~/.cue-mitleser/models/`. Es wird
automatisch dem kleinen vorgezogen. Im Browser bleibt es beim kleinen Modell.

## Veröffentlichen auf GitHub Pages

Adresse: **https://tomsevf.github.io/cue-mitleser/**

Nach Änderungen an der App: `bash werkzeuge/veroeffentlichen.sh` ausführen. Das Skript packt das
Sprachmodell (`werkzeuge/modell-packen.sh`), kopiert `web/` in den Branch `gh-pages` und pusht ihn.
GitHub Pages ist auf „Deploy from a branch: gh-pages /“ eingestellt. Der Code liegt in `main`,
die veröffentlichte App inklusive Modell nur in `gh-pages`.

`stuecke/` steht in `.gitignore`: **Textbücher und Proben gehören nicht ins öffentliche Repository.**

## Modi

| Modus | Wofür |
| --- | --- |
| **Bearbeiten** | Skript importieren, Cues setzen (Wort anklicken), verschieben (Marke ziehen), löschen (Entf, ⌘Z), Zeilen bearbeiten/streichen |
| **Probe** | wie Show, plus Debug-Spalte: erkannter Text, Trefferquote, Simulation per Tastatur, Mitschnitt |
| **Show** | ruhige Anzeige: Cue-Karte (Standby → Bereit → GO), Prompter, nächste Cues, Pegel, Ampel. Bearbeiten ist gesperrt |

### Cue-Typen

`LX` Licht · `SND` Ton · `VID` Video · `BT` Bühnentechnik (Vorhang, Züge, Drehbühne, Umbau …) · `INFO` Ansage/Hinweis.

### Cue-Arten (im Cue-Formular)

- **Nacheinander oder gleichzeitig:** Mehrere Cues an derselben Stelle (z. B. vor Beginn oder in einer Sprechpause) kommen
  **nacheinander**: erst die eine Karte, nach „Erledigt“ die nächste („Danach: …“). Die Reihenfolge lässt sich in der Cue-Liste mit ↑/↓ ändern.
  **Gleichzeitig** kommen sie nur mit „Gleichzeitig mit …“ im Formular.

- **Einmalig:** GO am Stichwort.
- **Läuft bis zu einem Stichwort:** z. B. Musik oder Lichtstimmung. „Endwort wählen“ und dann ein Wort antippen. Dort kommt eine eigene Ansage („GO SND 4 Ende – Musik ausblenden“). Im Skript ist der Bereich am Rand markiert.
- **Timer:** Nach dem GO läuft die Zeit (z. B. `1:30`). Danach meldet sich der Cue mit dem Text unter „Ansage am Ende“ und wird mit „Erledigt“ quittiert.
- **Läuft, bis ich ihn beende:** steht in der „Läuft“-Leiste, Antippen beendet ihn.
- **Gleichzeitig mit:** übernimmt den Einsatz eines anderen Cues. Beide werden zusammen angesagt und quittiert, mit oder ohne Stichwort.
- **Manuell (ohne Stichwort):** Im Feld „Einsatz – wann genau?“ steht, wann es losgeht. Das wird groß in der Standby-Karte angezeigt.

### Cues in der Probe bearbeiten

- **＋ Cue jetzt** (oder N): Formular für einen neuen Cue am gerade gesprochenen Wort. Das Mitlesen läuft weiter.
- **✎ Cues** (oder E): Das Mitlesen pausiert, der ganze Text ist blätterbar. Wort antippen = neuer Cue,
  Cue-Marke antippen = ändern, verschieben, Endwort setzen. „✓ Fertig“ liest weiter.
- **Timing auf der Cue-Karte:** „◀ früher“ / „später ▶“ verschieben das GO um ein Wort, „⏱ GO jetzt“ legt es
  auf das gerade gesprochene Wort, „✎ bearbeiten“ öffnet das Formular (Vorlauf, Timer, Einsatz …).
- **Laufzeit messen:** Einen laufenden Cue in der „Läuft“-Leiste antippen und beenden. Die App bietet an,
  die gemessene Zeit als Timer zu speichern.
- Alle Änderungen werden sofort gespeichert. Im Show-Modus ist Bearbeiten gesperrt.

### Zeitplan der Vorstellung (⏱ Zeitplan im Bearbeiten-Modus)

- **Vorstellungsbeginn** (Uhrzeit), **Pausen** (Dauer; Start per Knopf oder automatisch mit einem Cue) und **Zeit-Ereignisse**,
  z. B. „1. Gong – 7 min vor Vorstellungsbeginn“, „Pausengong – 5 min vor Ende Pause 1“, „INFO Ansage Handys aus – 1 min vor Beginn“.
  Knöpfe für Gongs vor Beginn (7/5/2 min) und Pausengongs (5/3/1 min vor Ende).
- In Probe/Show zeigt eine **Zeitleiste** Uhr, Countdown bis Beginn bzw. Pausenende und das nächste Ereignis, mit
  „Beginn jetzt“, „±1 / +5 min“, „Pause starten“, „+1 min“, „Pause beenden“.
- Ereignisse erscheinen als **Standby/GO-Karten** (mit Ton/Blitz) und werden mit „Erledigt“ quittiert. Was schon vorbei war,
  als die App geöffnet oder der Beginn verschoben wurde, wird nicht nachgeholt.
- **Im Text sichtbar** (Bearbeiten und Prompter): vor der ersten Zeile ein Block mit Beginn und Gongs/Ansagen samt Uhrzeit,
  jede Pause als Block hinter der Zeile mit ihrem Start-Cue. Pausen ohne Start-Cue setzt man mit **⏸** an einer Zeile
  (nochmal ⏸ = Stelle entfernen). In Probe/Show zeigen die Blöcke echte Uhrzeiten und was erledigt ist (✓).
  Antippen eines Blocks im Bearbeiten-Modus öffnet den Zeitplan.

### Text

- **Pause** (P oder Knopf): Der Text lässt sich frei durchblättern. Eine Zeile antippen und dann **„▶ Ab hier starten“**. Alles davor gilt als erledigt, alles danach ist offen, und Musik, die über diese Stelle hinausläuft, steht in der „Läuft“-Leiste.
- Im Bearbeiten-Modus startet **▶** an jeder Zeile die Probe ab dieser Zeile.

### Tasten im Probe-/Show-Modus (oder Touch-Leiste)

| Taste | Wirkung |
| --- | --- |
| Leertaste | aktuellen Cue erledigt / manuellen Cue / abgelaufenen Timer quittieren |
| ↓ / ↑ | Position eine Zeile vor / zurück |
| Klick auf Zeile | Position dorthin |
| P | Mitlesen pausieren, Text durchblättern, „Ab hier starten“ |
| F | Freeze – Position fest bis zur nächsten manuellen Korrektur |
| Z | zuletzt erledigten Cue wieder öffnen |

## Skript-Import

Einfügen oder Datei (.txt, .docx, PDF mit Textebene). Zwei Formate werden automatisch erkannt.

**Textbuch-Format** (Rolle in Großbuchstaben allein auf einer Zeile, Text umbrochen):

```
Personen                          → Personenverzeichnis, wird nicht mitgelesen
Erster Akt -O-Ton … - Musik …     → Überschrift; Hinweise darin werden manuelle Cues
                ANNA              → Rolle (auch „ANNA UND BEN“, „CLARA / BEN“)
       (kommt herein, spricht     → Regie in Klammern, auch über mehrere Zeilen
       noch mit Clara)
   Nein! Das habe ich dir doch    → umbrochene Zeilen werden zu einer Rede zusammengesetzt
   schon gestern gesagt …           (lange Reden in Abschnitte von ein paar Sätzen geteilt)
                    -Es klingelt  → Cue „Es klingelt“, GO auf das letzte Wort davor
                           BLACK  → LX-Cue
… Ich weiß nicht … -Das Telefon klingelt   → Hinweis mitten im Text wird ebenfalls ein Cue
… gesagt. Strich Und dann …       → „Strich“ wird nicht mitgelesen und im Import-Bericht gelistet
```

Seitenzahlen werden entfernt. Die Cue-Nummern aus Regiehinweisen werden pro Typ fortlaufend vergeben
und müssen an QLC+/Cue2 angepasst werden (Cue-Liste → Nummer ändern oder Umnummerieren).
Folgt ein Hinweis direkt auf einen anderen ohne gesprochenes Wort dazwischen (z. B. „BLACK“, dann
„-O-TÖNE …“), wird der zweite ein manueller Cue.

**Zeilenformat** (Rolle mit Doppelpunkt):

```
1. Szene                         → Überschrift
(Ein Zimmer. Abend.)             → Regieanweisung, wird beim Mitlesen übersprungen
ANNA: Ich habe dir geschrieben.  → Rolle + Text
BEN: (leise) Das weiß ich.       → Regie in Klammern innerhalb der Zeile wird übersprungen
[LX 12 Blackout langsam]         → Cue am folgenden gesprochenen Wort
[SND 4] [VID 2 Projektion]
[SND 5 Applausmusik manuell]     → manueller Cue (ohne Stichwort, Quittung per Leertaste)
```

## Dateien (Mac-Server)

- `stuecke/<name>.json` – ein Stück (Zeilen + Cues + Einstellungen)
- `stuecke/backup/` – Sicherheitskopie bei jedem Speichern (die letzten 30)
- `stuecke/<name>.state.json` – laufende Position, wird nach Absturz/Neuladen wiederhergestellt
- `stuecke/proben/` – Mitschnitte aus Probe/Show für die Proben-Auswertung im Bearbeiten-Modus

## Aufbau

- `web/` – die komplette App (wird so auf GitHub Pages veröffentlicht)
  - `js/tracker.js` – Mitlese-Logik (Wort für Wort, Lücken, Sprungsuche, ± Suchbereich,
    Rücksprung nur bei sehr hoher Sicherheit). Nach dem Prinzip von
    [autocue](https://github.com/EdNutting/autocue) neu geschrieben, kein Code übernommen.
  - `js/skript.js` – Import, sprechbare Wörter, Zahlen → Zahlwörter, Cue-Auflösung (Format: `TEXTBUCH-FORMAT.md`)
  - `js/erkennung.js` – Spracherkennung: Vosk im Browser, eingebaute Erkennung oder Mac-Server
  - `js/hilfen.js` – Speicher: Mac-Server oder Browser (IndexedDB)
  - `js/datei-import.js` – PDF (pdf.js), Word (JSZip) und Text im Browser lesen
  - `js/show.js` – Probe/Show: Stufen, Prompter, Tasten/Touch, Mitschnitt, Wiederherstellung
  - `js/editor.js` – Bearbeiten-Modus
  - `sw.js`, `manifest.webmanifest` – offline nutzbar, als App installierbar
  - `vendor/` – mitgelieferte Bibliotheken (siehe `vendor/README.md`)
- `server.py` – optionaler Mac-Server: liefert `web/` aus, speichert in `stuecke/`, Mikrofon → Vosk → WebSocket
- `werkzeuge/modell-packen.sh` – Sprachmodell für den Browser packen

Alle Schwellenwerte (Ähnlichkeit 70, Fehlfolge 3, Fenster 8, Lücke 4, Suchbereich ± 300, …)
stehen unter ⋯ → Einstellungen und werden pro Stück gespeichert.

**Bei der Vorstellung gilt: Die App ist eine Hilfe. Das Regiebuch auf Papier liegt daneben.**
