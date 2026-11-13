# Cue-Mitleser – Textbuch-Format (Schnittstellenbeschreibung)

Version 1 · Stand 11.11.2026 · gilt für `web/js/skript.js` (`textImportieren`)

Dieses Dokument beschreibt, welche Schreibweisen der Import im Textbuch erkennt und was er daraus macht.
Alles, was hier nicht beschrieben ist, wird als normaler Text behandelt.

---

## 1. Eingabe

| Punkt | Festlegung |
| --- | --- |
| Dateiformate | `.txt`, `.md` (UTF-8, ersatzweise Windows-1252/Latin-1), `.docx` (Absätze), `.pdf` **mit Textebene** (keine Scans, kein OCR), Einfügen per Zwischenablage |
| Zeilenenden | beliebig (`\n`, `\r\n`, `\r`) |
| Leerraum | Tabs und geschützte Leerzeichen werden zu Leerzeichen, mehrere Leerzeichen zu einem; Einrückung wird ignoriert |
| Seitenzahlen | Zeilen, die nur aus `12`, `Seite 12` oder `12 / 79` bestehen, werden entfernt |
| Leere Zeilen | im Textbuch-Format bedeutungslos; im Zeilenformat beenden sie einen Rollenblock |
| Zeichen ohne Inhalt | Zeilen ohne Buchstaben/Ziffern (z. B. `.` oder `´`) werden im Textbuch-Format entfernt |

## 2. Format-Erkennung

Der Import wählt automatisch eines von zwei Formaten:

| Format | Wird gewählt, wenn … |
| --- | --- |
| **Textbuch-Format** | mindestens 3 Zeilen nur aus einem Rollennamen bestehen (`ANNA`) **und** es mindestens halb so viele solcher Zeilen gibt wie Zeilen der Form `NAME: Text` |
| **Zeilenformat** | sonst |

Die beiden Formate dürfen nicht gemischt werden. Im Textbuch-Format wird eine Zeile `ANNA: Hallo` als gesprochener Text der aktuellen Rolle gelesen, einschließlich „ANNA:“. Einzige Ausnahme ist das Personenverzeichnis (Abschnitt 5).

---

## 3. Elemente – Übersicht

| Element | Schreibweise | Wird mitgelesen? | Ergebnis |
| --- | --- | --- | --- |
| Rollenname | eigene Zeile, nur Großbuchstaben: `ANNA` | nein | setzt die sprechende Rolle |
| Rede | Text nach dem Rollennamen, beliebig umbrochen | **ja** | Textzeile(n) der Rolle |
| Regieanweisung | Text in `( … )` oder `[ … ]` (außer Cue-Marker) | nein | grau angezeigt |
| Überschrift | `Erster Akt`, `2. Szene`, `# Prolog` | nein | Überschrift |
| Personenverzeichnis | Zeile `Personen`, danach `NAME: Beschreibung` | nein | Regie |
| Hinweis-Cue (Zeile) | eigene Zeile `-Musik aus.` oder `BLACK` | nein | Cue, GO auf das **letzte Wort davor** |
| Hinweis-Cue (im Text) | `… Ich weiß nicht … -Das Telefon klingelt …` | nein | Cue, GO auf das **letzte Wort davor** |
| Cue-Marker | `[LX 12 Blackout]` | nein | Cue, GO auf das **nächste Wort danach** |
| Strich | Wort `Strich` an Satzgrenze | nein | `(Strich)`, im Import-Bericht gelistet |

---

## 4. Rollen und Rede

### 4.1 Textbuch-Format

```
                ANNA
       (kommt herein,
       spricht noch mit
       Clara)
   Nein! Das habe ich dir doch
   schon gestern gesagt …
```

**Rollenzeile:** Eine Zeile gilt als Rollenname, wenn sie alle diese Bedingungen erfüllt:

- Sie enthält nur Großbuchstaben `A–Z Ä Ö Ü ß` sowie Leerzeichen und `' / & -`.
- Sie beginnt und endet mit einem Buchstaben und enthält mindestens zwei Großbuchstaben hintereinander.
- Sie ist höchstens 42 Zeichen lang und enthält **keine** Ziffern, Punkte, Doppelpunkte oder Klammern.
- Sie ist **keines** dieser reservierten Wörter: `BLACK BLACKOUT ENDE PAUSE VORHANG MUSIK LICHT STRICH FREEZE OFF DUNKEL SPOT TON`.

Gültig sind z. B. `ANNA`, `PAUL WEBER`, `ANNA UND BEN`, `CLARA / BEN`, `ALLE`.
Ungültig sind `PAUL (im OFF)` (Zusatz in Klammern bitte in die nächste Zeile), `DR. MÜLLER` (Punkt) und `Anna` (nicht groß geschrieben).

**Rede:** Die Rede ist alles nach der Rollenzeile bis zum nächsten Rollennamen, zur nächsten Überschrift, zum nächsten Hinweis-Cue oder zur nächsten frei stehenden Regieanweisung (Abschnitt 6). Umbrochene Zeilen werden mit Leerzeichen verbunden. Eine Zeile, die auf Buchstabe + `-` endet (Silbentrennung wie `Welt-` / `KI-Monarchie`), wird ohne Leerzeichen angehängt.

**Rolle läuft weiter:** Nach einem Hinweis-Cue oder einer Regieanweisung gehört folgender Text ohne neuen Rollennamen weiter zur bisherigen Rolle. Ausnahmen sind `BLACK` und Überschriften: Danach gilt Text ohne Rollennamen als nicht gesprochene Beschreibung.

**Text ohne Rolle:** Text vor dem ersten Rollennamen eines Akts, etwa die Bühnenbeschreibung, wird nicht mitgelesen.

### 4.2 Zeilenformat

```
ANNA: Ich habe dir geschrieben.
BEN (leise): Ich weiß.
ANNA:
Zweite Zeile von Anna.
Dritte Zeile von Anna.

(Pause)
```

- Jede Zeile ist ein eigener Eintrag.
- **Rolle:** Als Rolle gilt `NAME: Text`. Der Name ist entweder in Großbuchstaben (Buchstaben, Ziffern, Leerzeichen, `. ' -`, höchstens 31 Zeichen) oder ein einzelnes groß geschriebenes Wort (`Anna`, `Anna-Lena`). Ein Zusatz in Klammern vor dem Doppelpunkt ist erlaubt.
- **Rollenblock:** `ANNA:` allein oder `ANNA` allein in Großbuchstaben gilt für die folgenden Zeilen, bis eine **leere Zeile** kommt.
- **Regie:** Zeilen, die vollständig in `( … )` oder `[ … ]` stehen, sind Regie.

---

## 5. Überschriften und Personenverzeichnis

**Überschrift:** Eine Zeile gilt als Überschrift, wenn sie höchstens 140 Zeichen lang ist und so beginnt:

- `#`
- optional Zahl oder römische Ziffer, danach `Szene`, `Akt`, `Aufzug`, `Bild`, `Auftritt`, `Teil`, `Prolog` oder `Epilog` (z. B. `2. Szene`, `III. Akt`)
- `Erster`, `Zweiter`, … `Zehnter` oder `Letzter`, danach `Akt`, `Aufzug`, `Teil`, `Bild`, `Szene` oder `Auftritt`

**Hinweise in der Überschrift:** Endet die Zeile auf ` -`, wird die nächste Zeile angehängt. Teile hinter ` - ` mit einem Cue-Stichwort (Abschnitt 7.3) werden **manuelle** Cues:

```
Erster Akt -O-Ton zur Frage: Was ist Glück? -
Musik setzt ein.
```

ergibt die Überschrift „Erster Akt …“ und zwei manuelle SND-Cues: „O-Ton zur Frage …“ und „Musik setzt ein“.

**Personenverzeichnis:** Eine Zeile, die genau `Personen`, `Figuren`, `Rollen`, `Personenverzeichnis`, `Besetzung` oder `Dramatis personae` lautet (optional mit `:`), startet das Personenverzeichnis. Alles bis zur nächsten Überschrift wird nicht mitgelesen. Jede Zeile `NAME: …` beginnt einen neuen Eintrag, andere Zeilen werden an den vorigen angehängt.

---

## 6. Regieanweisungen

- Alles in runden Klammern `( … )` wird angezeigt, aber **nicht mitgelesen**. Das gilt auch mitten in der Rede und über bis zu 15 Zeilen.
- Eckige Klammern `[ … ]` gelten ebenso als Regie, sofern es kein Cue-Marker ist.
- **Frei stehend oder Teil der Rede?** Eine Zeile, die mit `(` beginnt, wird eine **eigene Regiezeile**, wenn
  - gerade keine Rede läuft, **oder**
  - hinter der schließenden `)` nichts mehr steht **und** danach ein Rollenname, ein Hinweis-Cue, eine Überschrift, eine weitere `(`-Zeile oder das Ende folgt.

  Sonst gehört sie zur laufenden Rede, zum Beispiel `(sieht Ben an, wird ernst)`, wenn danach dieselbe Rolle weiterspricht.
- Klammern müssen geschlossen werden. Eine offene `(` macht den Rest des Abschnitts zu Regie.

---

## 7. Cues

### 7.1 Cue-Marker (explizit, empfohlen für feste Nummern)

```
[TYP NUMMER BEZEICHNUNG]
```

| Teil | Werte | Pflicht |
| --- | --- | --- |
| `TYP` | `LX` / `LICHT` → LX · `SND` / `TON` / `SOUND` → SND · `VID` / `VIDEO` → VID · `BT` / `BÜHNE` / `BÜHNENTECHNIK` → BT (Bühnentechnik) · `INFO` / `ANSAGE` → INFO (Groß-/Kleinschreibung egal) | ja |
| `NUMMER` | `12`, `12.5`, `12,5` (wird zu `12.5`), `12a` | nein |
| `BEZEICHNUNG` | freier Text bis `]` | nein |
| `manuell` | Wort am Ende der Bezeichnung → Cue ohne Stichwort, wird per „Erledigt“/Leertaste quittiert. Mit `manuell: Text` wird der Text als **Einsatz** angezeigt (wann der Cue kommt) | nein |

- **GO-Wort:** das **nächste gesprochene Wort nach** dem Marker. Folgt in der Zeile keines, ist es das erste gesprochene Wort der folgenden Zeilen. Steht der Marker ganz am Ende des Stücks, ist es das letzte Wort.
- **Nummer:** wird übernommen, wie sie im Marker steht.
- **Vorlauf:** der Standardwert aus den Einstellungen (20 Wörter).
- **Mehrere Marker** am selben Wort kommen **nacheinander** (erst der eine, nach „Erledigt“ der nächste). Gleichzeitig nur, wenn im Cue-Formular „Gleichzeitig mit“ gesetzt ist.

Beispiele: `[LX 12 Blackout langsam]` · `[SND 4]` · `[VID 2 Projektion Fahrplan]` · `[SND 5 Applaus manuell]` · `[SND 6 Musik manuell: nach dem Applaus]`

Dauer, Timer und „gleichzeitig mit“ werden im Bearbeiten-Modus im Cue-Formular eingestellt (Abschnitt 10).

### 7.2 Hinweis-Cue als eigene Zeile

Eine Zeile mit weniger als 90 Zeichen ist ein Hinweis-Cue, wenn sie

- mit `-` oder `–` beginnt und danach (ggf. nach Leerzeichen) ein Buchstabe folgt: `-Musik aus.`, `- Hundebellen`, **oder**
- mit `Black` oder `Blackout` beginnt (beliebige Schreibweise): `BLACK`, `Black Musik`.

### 7.3 Hinweis-Cue im Text

**Erkennungsregel:**

1. Ein `-` oder `–` steht am Zeilenanfang oder nach Leerzeichen, `(`, `,` oder `;`.
2. Darauf folgen höchstens drei Wörter und dann ein **Cue-Stichwort**:
   `klingel…`, `läut…`, `musik…`, `Ton`, `Töne`, `O-Ton`/`OH Ton`, `Black(out)`, `bell…`, `Hundebellen`, `röchel…`, `Reel`, `Video`, `Licht`, `Einspieler`, `Geräusch…`, `Sound`, `Alarm`
3. Optional folgt noch `ein`, `aus`, `an`, `ab`, `stoppen`, `weg` oder `los`.

Die Wörter davor dürfen keine Satzzeichen `, . ; : ! ? ( )` enthalten.

**Beispiele:** `-es klingelt`, `(-Läuten.)`, `-TON stoppen`, `… -Das Telefon klingelt …`

Der Hinweis wird in Klammern gesetzt und deshalb nicht mitgelesen. Ein `-` ohne Cue-Stichwort, etwa `uninteressant - kein Unterschied`, bleibt normaler Text.

### 7.4 Was aus Hinweis-Cues (7.2 und 7.3) wird

| Eigenschaft | Regel |
| --- | --- |
| Typ | nach Stichwörtern: `black, blackout, licht, spot, dimm…, lx` → **LX** · `reel, video, film, projektion, beamer, vid` → **VID** · `musik, ton, töne, sound, klingel, läut, bell, röchel, geräusch, alarm, einspieler, snd` → **SND** · `vorhang, versenkung, drehbühne, hubpodium, prospekt, schleier, umbau, bühnenbild, kulisse, zug 3` → **BT** · `ansage, durchsage, einlass` → **INFO**. Passen mehrere Typen, entsteht je Typ ein Cue, und diese sind **gleichzeitig** (`Black Musik` → LX + SND zusammen). Passt keiner, wird es SND. |
| Nummer | pro Typ fortlaufend ab 1 in Stückreihenfolge. Die Nummerierung ist **unabhängig von Cue-Markern**, beim Mischen können doppelte Nummern entstehen (die App warnt). |
| Bezeichnung | der Hinweistext ohne `-` und Schlusspunkt, max. 60 Zeichen. Reine Großschreibung wird angepasst (`BLACK` → „Black“). |
| GO-Wort | das **letzte gesprochene Wort vor** dem Hinweis |
| manuell | wenn es vorher kein gesprochenes Wort gibt **oder** seit dem letzten gesprochenen Wort schon ein Hinweis-Cue kam (`BLACK`, dann `-O-TÖNE …` → der zweite wird manuell). Hinweise in Überschriften sind immer manuell. |
| Vorlauf | Standardwert aus den Einstellungen |

Die Umwandlung lässt sich beim Import abschalten (Häkchen „Regiehinweise … als Cues anlegen“). Die Hinweiszeilen bleiben dann als Regie stehen.

### 7.5 Wichtig: Wo die Cue-Angabe steht, entscheidet über das GO-Wort

| Schreibweise | GO auf |
| --- | --- |
| `… und keiner kam zurück. [SND 5 Klingel]` ↵ `BEN` ↵ `Wer ist da?` | „**Wer**“ (nächstes Wort) |
| `… und keiner kam zurück.` ↵ `-Es klingelt` | „**zurück**“ (letztes Wort davor) |

---

## 8. Strich

Ein Wort `Strich` (beliebige Schreibweise, auch `.STRICH`) wird als Strich-Markierung behandelt, wenn es

- komplett groß geschrieben ist, **oder**
- am Anfang oder Ende einer Rede steht, **oder**
- nach einem Satzzeichen `. ! ? …` steht.

Das Wort wird dann zu `(Strich)`, also nicht mitgelesen, und im Import-Bericht mit Fundstelle aufgeführt.
**Welcher Text gestrichen ist, erkennt der Import nicht.** Gestrichener Text muss im Bearbeiten-Modus gelöscht oder die Zeile mit ✂ gestrichen werden.
Ein `Strich` mitten im Satz, wie in „ein roter Strich“, bleibt gesprochener Text.

---

## 9. Wie gesprochene Wörter aufbereitet werden

Diese Aufbereitung betrifft nur den Abgleich mit der Spracherkennung, der angezeigte Text bleibt unverändert.

| Eingabe | wird verglichen als |
| --- | --- |
| Groß-/Kleinschreibung, Satzzeichen, Anführungszeichen | entfernt |
| `ß` | `ss` |
| Zahlen `3`, `1924`, `1.000`, `10.000` | `drei`, `neunzehnhundertvierundzwanzig`, `tausend`, `zehntausend` (Jahreszahlen 1100–1999 wie gesprochen) |
| `&` · `%` · `§` | `und` · `prozent` · `paragraph` |
| Bindestrich, Schrägstrich | trennen Wörter (`Welt-KI` → `welt`, `ki`) |
| immer ausgeschrieben | `z.B.`, `usw`, `bzw`, `ca`, `u.a.`, `d.h.`, `evtl`, `ml`, `km`, `kg` |
| nur **mit Punkt** ausgeschrieben | `Dr.`, `Hr.`, `Fr.`, `St.`, `Nr.`, `Prof.`, `Mio.`, `Mrd.` |

**Aufteilung langer Reden:** Lange Reden werden nach Satzenden (`. ! ? …`) in Abschnitte von etwa 160 Zeichen geteilt, nie innerhalb von Klammern. Ein Abschnitt entspricht einer Zeile im Prompter und einem Schritt mit ↑/↓.

---

## 10. Gespeichertes Format (`stuecke/<name>.json`)

```json
{
  "version": 1,
  "name": "Drei Schwestern",
  "zeilen": [
    { "id": "z-ab12", "typ": "text", "rolle": "ANNA", "text": "(kommt herein) Nein! Das habe …", "gestrichen": false },
    { "id": "z-ab13", "typ": "regie", "rolle": "", "text": "-Es klingelt", "gestrichen": false }
  ],
  "cues": [
    { "id": "c-x1", "typ": "SND", "nummer": "5", "bezeichnung": "Es klingelt",
      "zeile": "z-ab12", "wort": 14, "vorlauf": 20, "notiz": "", "ausloeser": "wort", "einsatz": "",
      "dauer": { "art": "zeit", "sekunden": 90, "text": "Klingel ausblenden" } }
  ],
  "einstellungen": { "schwelle": 70, "vorlauf": 20, "…": "…" }
}
```

| Feld | Bedeutung |
| --- | --- |
| `zeilen[].typ` | `text` (gesprochen) · `regie` · `szene` |
| `zeilen[].gestrichen` | `true` = angezeigt, aber nicht mitgelesen |
| `cues[].typ` | `LX` · `SND` · `VID` · `BT` (Bühnentechnik) · `INFO` (Ansage/Info) |
| `cues[].nummer` | Text, z. B. `"12.5"` |
| `cues[].zeile` | `id` der Zeile mit dem GO-Wort |
| `cues[].wort` | 0-basierter Index des Worts in `text` (Wörter = durch Leerzeichen getrennt, Klammerwörter mitgezählt). Liegt das Wort in Regie oder einer gestrichenen Zeile, rutscht das GO auf das nächste gesprochene Wort. |
| `cues[].vorlauf` | Wörter vor dem GO-Wort, ab denen „Standby“ angezeigt wird |
| `cues[].ausloeser` | `wort` (GO beim Erkennen) · `manuell` (Standby nach dem vorigen Cue, Quittung per Leertaste) |
| `cues[].einsatz` | nur bei `manuell`: Text, wann der Cue kommt („nach dem Applaus“), groß in der Standby-Karte |
| `cues[].dauer` | `null` = einmaliger Cue, sonst `art`: `wort` (läuft bis `zeile`/`wort`, dort eigene Ansage „… Ende“) · `zeit` (Timer, meldet sich nach `sekunden`) · `manuell` (läuft, bis man ihn in der „Läuft“-Leiste beendet). `text` = Ansage am Ende |
| `cues[].gruppe` | Cues mit derselben Gruppen-ID kommen **gleichzeitig** (im Formular „Gleichzeitig mit“). Ohne Gruppe kommen Cues an derselben Stelle **nacheinander** |
| `cues[].folge` | Reihenfolge nacheinander folgender Cues am selben Anker (Cue-Liste ↑/↓) |
| `zeitplan` | `{ beginn: "19:30", pausen: [{id, name, dauer (min), startCue}], ereignisse: [{id, typ, nummer, bezeichnung, notiz, bezug: "beginn" \| "pstart:<pausenId>" \| "pende:<pausenId>", minuten (negativ = vorher), vorlauf (s)}] }` – Ereignisse nach der Uhr (Gongs, Pausen, Ansagen) |

---

## 11. Empfehlungen für das Textbuch

1. **Rollennamen allein auf eine Zeile, in Großbuchstaben, ohne Zusatz.** Zusätze wie „(im OFF)“ gehören in eine eigene Zeile darunter.
2. **Regie immer in runde Klammern**, auch Beschreibungen mitten im Akt.
3. **Cues mit fester Nummer als Marker schreiben:** `[LX 12 Blackout]` direkt **vor** das Wort, auf das GO kommen soll. Dann stimmen die Nummern sofort mit QLC+/Cue2 überein.
4. **Hinweis-Cues** (`-Musik aus.`) nur verwenden, wenn GO auf das Wort **davor** kommen soll. Nicht für dieselbe Stelle zusätzlich einen Marker setzen.
5. **Cues nicht in lange Regieanweisungen verstecken** wie „(Musik läuft, …, Licht langsam dimmen, …)“. Daraus entstehen keine Cues. Besser jeden Einsatz einzeln als Marker oder Hinweiszeile schreiben.
6. **Striche:** gestrichenen Text löschen oder in Klammern setzen, statt nur „Strich“ dazuzuschreiben.
7. **PDF mit Textebene** exportieren (aus Word, Pages oder Drehbuchprogramm), keine eingescannten Seiten.
8. **Keine Zeile, die nur aus einer Zahl besteht.** Sie wird als Seitenzahl entfernt.

## 12. Vollständiges Beispiel

```
Personen
ANNA BERGER: Erzieherin
CLARA BERGER: Bibliothekarin

Erster Akt - Musik setzt ein.
Ein Wohnzimmer. Es ist Vormittag.
-Musik aus.
                ANNA
       (kommt herein)
   Ich habe dir einen Brief geschrieben. [LX 3 Sonne] Er kam
   nie zurück.
                CLARA
   Hör auf. Strich Ich will das nicht hören.
                    -Es klingelt
(Ben kommt mit einem Kuchen)
                ANNA
   Wer ist da? … -Das Telefon klingelt Auch das noch.
                           BLACK
```

| Stelle | Ergebnis |
| --- | --- |
| `Personen` … | nicht mitgelesen |
| `Erster Akt - Musik setzt ein.` | Überschrift + **SND 1 „Musik setzt ein“, manuell** |
| `Ein Wohnzimmer …` | Beschreibung, nicht mitgelesen |
| `-Musik aus.` | **SND 2, manuell** (es gibt noch kein gesprochenes Wort) |
| `[LX 3 Sonne]` | **LX 3**, GO auf „**Er**“ |
| `Strich` | `(Strich)`, nicht mitgelesen, im Bericht gelistet |
| `-Es klingelt` | **SND 3**, GO auf „**hören**“ |
| `(Ben kommt …)` | eigene Regiezeile |
| `-Das Telefon klingelt` | **SND 4**, GO auf „**da**“ |
| `BLACK` | **LX 1**, GO auf „**noch**“ |
