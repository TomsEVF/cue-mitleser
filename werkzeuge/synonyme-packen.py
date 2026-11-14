#!/usr/bin/env python3
"""Baut web/vendor/synonyme-de.txt.gz aus OpenThesaurus (https://www.openthesaurus.de, LGPL-2.1).

Aufruf:  python3 werkzeuge/synonyme-packen.py [openthesaurus.txt]
Ohne Datei wird die aktuelle Textversion von openthesaurus.de geladen.

Ergebnis: eine Synonymgruppe pro Zeile, Wörter mit „;“ getrennt. Nur Einzelwörter
(Mehrwort-Ausdrücke kann der Wort-für-Wort-Abgleich nicht nutzen). Umgangssprachliche
Wörter werden mit „~“ markiert (z. B. „~abhauen“), weil Schauspieler oft genau die benutzen.
"""
import gzip
import io
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

QUELLE = "https://www.openthesaurus.de/export/OpenThesaurus-Textversion.zip"
ZIEL = Path(__file__).resolve().parent.parent / "web" / "vendor" / "synonyme-de.txt.gz"


def laden() -> str:
    if len(sys.argv) > 1:
        return Path(sys.argv[1]).read_text(encoding="utf-8")
    print("Lade", QUELLE)
    daten = urllib.request.urlopen(QUELLE, timeout=60).read()
    with zipfile.ZipFile(io.BytesIO(daten)) as z:
        return z.read("openthesaurus.txt").decode("utf-8")


def wort(eintrag: str):
    anm = " ".join(re.findall(r"\(([^)]*)\)", eintrag))
    rest = re.sub(r"\([^)]*\)", " ", eintrag).strip()
    if not rest or " " in rest or "..." in rest or "…" in rest:
        return None
    if not re.fullmatch(r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*", rest) or len(rest) < 2:
        return None
    if re.search(r"fachspr|veraltet|regional|österr|schweiz|lat\.|engl\.|selten|Jargon|historisch|Amtsdeutsch", anm):
        return None
    ugs = bool(re.search(r"ugs|derb|salopp|umgangs", anm))
    return ("~" if ugs else "") + rest


def main():
    gruppen, gesehen = [], set()
    for zeile in laden().splitlines():
        if not zeile or zeile.startswith("#"):
            continue
        woerter = []
        for e in zeile.split(";"):
            w = wort(e)
            if w and w.lstrip("~").lower() not in {x.lstrip("~").lower() for x in woerter}:
                woerter.append(w)
        if len(woerter) < 2:
            continue
        schluessel = ";".join(sorted(woerter))
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        gruppen.append(";".join(woerter))
    text = "\n".join(gruppen) + "\n"
    ZIEL.write_bytes(gzip.compress(text.encode("utf-8"), 9, mtime=0))
    print(f"{len(gruppen)} Gruppen → {ZIEL} ({ZIEL.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
