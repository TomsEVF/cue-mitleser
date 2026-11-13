#!/usr/bin/env python3
"""Cue-Mitleser – lokaler Server.

Aufgaben:
  * liefert die Browser-Oberfläche aus (http://localhost:8000)
  * speichert Stücke als JSON in ./stuecke (mit Sicherheitskopie bei jedem Speichern)
  * hört über das Mikrofon mit (Vosk, deutsches Modell) und schickt erkannte
    Wörter per WebSocket an den Browser. Der Abgleich mit dem Skript passiert
    im Browser (static/js/tracker.js).

Läuft auch ohne Vosk/Mikrofon – dann ist die App ein digitales Regiebuch.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import queue
import re
import shutil
import socket
import sys
import threading
import time
import webbrowser
import zipfile
from array import array
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree

from aiohttp import WSMsgType, web

BASIS = Path(__file__).resolve().parent
WEB = BASIS / "web"
STUECKE = BASIS / "stuecke"
BACKUP = STUECKE / "backup"
PROBEN = STUECKE / "proben"
DATEN = Path(os.environ.get("CUE_DATEN", Path.home() / ".cue-mitleser"))
MODELL_ORDNER = [BASIS / "models", DATEN / "models"]
PORT = int(os.environ.get("CUE_PORT", "8000"))
HOST = os.environ.get("CUE_HOST", "127.0.0.1")  # 0.0.0.0 = auch im WLAN erreichbar
BACKUPS_BEHALTEN = 30
PROBEN_BEHALTEN = 20

for p in (STUECKE, BACKUP, PROBEN):
    p.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- Hilfen

NAME_RE = re.compile(r"[^A-Za-z0-9ÄÖÜäöüß _.-]")


def sicherer_name(name: str) -> str:
    name = NAME_RE.sub("", name or "").strip().strip(".")
    if not name:
        raise web.HTTPBadRequest(text="Ungültiger Name")
    return name[:80]


def schreibe_atomar(pfad: Path, daten: str) -> None:
    tmp = pfad.with_suffix(pfad.suffix + ".tmp")
    tmp.write_text(daten, encoding="utf-8")
    os.replace(tmp, pfad)


def aufraeumen(ordner: Path, muster: str, behalten: int) -> None:
    dateien = sorted(ordner.glob(muster), key=lambda f: f.stat().st_mtime, reverse=True)
    for alt in dateien[behalten:]:
        try:
            alt.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------- Stücke

async def stuecke_liste(_req):
    liste = []
    for f in sorted(STUECKE.glob("*.json")):
        if f.name.endswith(".state.json"):
            continue
        liste.append({"name": f.stem, "geaendert": f.stat().st_mtime})
    return web.json_response(liste)


async def stueck_laden(req):
    name = sicherer_name(req.match_info["name"])
    pfad = STUECKE / f"{name}.json"
    if not pfad.exists():
        raise web.HTTPNotFound(text="Stück nicht gefunden")
    return web.Response(text=pfad.read_text(encoding="utf-8"), content_type="application/json")


async def stueck_speichern(req):
    name = sicherer_name(req.match_info["name"])
    daten = await req.json()
    pfad = STUECKE / f"{name}.json"
    if pfad.exists():
        stempel = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(pfad, BACKUP / f"{name}__{stempel}.json")
        aufraeumen(BACKUP, f"{name}__*.json", BACKUPS_BEHALTEN)
    schreibe_atomar(pfad, json.dumps(daten, ensure_ascii=False, indent=1))
    return web.json_response({"ok": True})


async def stueck_loeschen(req):
    name = sicherer_name(req.match_info["name"])
    pfad = STUECKE / f"{name}.json"
    if pfad.exists():
        stempel = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.move(pfad, BACKUP / f"{name}__geloescht-{stempel}.json")
    return web.json_response({"ok": True})


async def zustand_laden(req):
    name = sicherer_name(req.match_info["name"])
    pfad = STUECKE / f"{name}.state.json"
    if not pfad.exists():
        return web.json_response({})
    return web.Response(text=pfad.read_text(encoding="utf-8"), content_type="application/json")


async def zustand_speichern(req):
    name = sicherer_name(req.match_info["name"])
    daten = await req.json()
    schreibe_atomar(STUECKE / f"{name}.state.json", json.dumps(daten, ensure_ascii=False))
    return web.json_response({"ok": True})


async def probe_speichern(req):
    name = sicherer_name(req.match_info["name"])
    daten = await req.json()
    pid = sicherer_name(str(daten.get("id") or datetime.now().strftime("%Y%m%d-%H%M%S")))
    schreibe_atomar(PROBEN / f"{name}__{pid}.json", json.dumps(daten, ensure_ascii=False))
    aufraeumen(PROBEN, f"{name}__*.json", PROBEN_BEHALTEN)
    return web.json_response({"ok": True})


async def proben_laden(req):
    name = sicherer_name(req.match_info["name"])
    liste = []
    for f in sorted(PROBEN.glob(f"{name}__*.json")):
        try:
            liste.append(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    return web.json_response(liste)


async def proben_loeschen(req):
    name = sicherer_name(req.match_info["name"])
    for f in PROBEN.glob(f"{name}__*.json"):
        f.unlink()
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- Import (.docx / .pdf / .txt)

def docx_text(daten: bytes) -> str:
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(daten)) as z:
        xml = z.read("word/document.xml")
    wurzel = ElementTree.fromstring(xml)
    absaetze = []
    for p in wurzel.iter(f"{ns}p"):
        teile = []
        for el in p.iter():
            if el.tag == f"{ns}t" and el.text:
                teile.append(el.text)
            elif el.tag == f"{ns}tab":
                teile.append("\t")
            elif el.tag in (f"{ns}br", f"{ns}cr"):
                teile.append("\n")
        absaetze.append("".join(teile))
    return "\n".join(absaetze)


def pdf_text(daten: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise web.HTTPBadRequest(text="PDF-Import braucht das Paket 'pypdf' (pip install pypdf).") from exc
    leser = PdfReader(io.BytesIO(daten))
    return "\n".join((seite.extract_text() or "") for seite in leser.pages)


async def text_import(req):
    post = await req.post()
    datei = post.get("datei")
    if datei is None or not hasattr(datei, "file"):
        raise web.HTTPBadRequest(text="Keine Datei")
    daten = datei.file.read()
    endung = Path(datei.filename or "").suffix.lower()
    if endung == ".docx":
        text = docx_text(daten)
    elif endung == ".pdf":
        text = pdf_text(daten)
    else:
        for kodierung in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = daten.decode(kodierung)
                break
            except UnicodeDecodeError:
                continue
    return web.json_response({"text": text, "name": Path(datei.filename or "Stück").stem})


# ---------------------------------------------------------------- Spracherkennung

try:
    import vosk  # type: ignore

    vosk.SetLogLevel(-1)
except Exception:  # noqa: BLE001
    vosk = None

try:
    import sounddevice as sd  # type: ignore
except Exception:  # noqa: BLE001
    sd = None


def finde_modell() -> Path | None:
    wunsch = os.environ.get("CUE_MODELL")
    if wunsch and Path(wunsch).is_dir():
        return Path(wunsch)
    kandidaten = []
    for ordner in MODELL_ORDNER:
        if ordner.is_dir():
            kandidaten += [d for d in ordner.iterdir() if d.is_dir() and "de" in d.name.lower()]
    if not kandidaten:
        return None
    # großes Modell bevorzugen, wenn vorhanden
    kandidaten.sort(key=lambda d: ("small" in d.name.lower(), d.name))
    return kandidaten[0]


class Erkennung:
    """Liest das Mikrofon, füttert Vosk und verteilt Ergebnisse an alle Browser."""

    RATE = 16000
    BLOCK = 2000  # 125 ms

    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: set[web.WebSocketResponse] = set()
        self.modell = None
        self.modell_pfad = finde_modell()
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.laeuft = False
        self.geraet = None
        self.fehler = ""
        self.verstaerkung = 0          # dB oder "auto"
        self._auto_faktor = 4.0
        self._huelle = 0.0

    # -- Status
    def status(self) -> dict:
        grund = ""
        if os.environ.get("CUE_OHNE_ERKENNUNG"):
            grund = "Erkennung abgeschaltet (CUE_OHNE_ERKENNUNG)"
        elif vosk is None:
            grund = "Python-Paket 'vosk' fehlt"
        elif sd is None:
            grund = "Python-Paket 'sounddevice' fehlt"
        elif self.modell_pfad is None:
            grund = "Kein deutsches Vosk-Modell gefunden (Ordner models/ oder ~/.cue-mitleser/models)"
        return {
            "type": "status",
            "asr": grund == "",
            "grund": grund or self.fehler,
            "laeuft": self.laeuft,
            "modell": self.modell_pfad.name if self.modell_pfad else None,
            "geraet": self.geraet,
        }

    def senden(self, nachricht: dict) -> None:
        if self.loop is None:
            return
        text = json.dumps(nachricht, ensure_ascii=False)
        self.loop.call_soon_threadsafe(asyncio.ensure_future, self._verteilen(text))

    async def _verteilen(self, text: str) -> None:
        for ws in list(self.clients):
            if ws.closed:
                self.clients.discard(ws)
                continue
            try:
                await ws.send_str(text)
            except Exception:  # noqa: BLE001
                self.clients.discard(ws)

    # -- Verstärkung (wie im Browser: fest in dB oder automatisch auf Sprechlautstärke)
    def verstaerkung_setzen(self, wert) -> None:
        if wert == "auto":
            self.verstaerkung = "auto"
        else:
            try:
                self.verstaerkung = max(0.0, min(40.0, float(wert or 0)))
            except (TypeError, ValueError):
                self.verstaerkung = 0.0

    def _faktor(self, roh: float) -> float:
        if self.verstaerkung == "auto":
            self._huelle = max(roh, self._huelle * 0.985)
            wunsch = max(1.0, min(100.0, 0.08 / max(self._huelle, 0.0008)))
            self._auto_faktor += (wunsch - self._auto_faktor) * (0.5 if wunsch < self._auto_faktor else 0.04)
            return self._auto_faktor
        return 10 ** (float(self.verstaerkung) / 20)

    # -- Start/Stopp
    def start(self, geraet=None, vokabular: list[str] | None = None, verstaerkung=None) -> None:
        self.stopp()
        if verstaerkung is not None:
            self.verstaerkung_setzen(verstaerkung)
        st = self.status()
        if not st["asr"]:
            self.senden(st)
            return
        self.fehler = ""
        self.geraet = geraet
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._lauf, args=(geraet, vokabular), daemon=True)
        self.thread.start()

    def stopp(self) -> None:
        if self.thread and self.thread.is_alive():
            self.stop_event.set()
            self.thread.join(timeout=3)
        self.thread = None
        if self.laeuft:
            self.laeuft = False
            self.senden(self.status())

    def _lauf(self, geraet, vokabular) -> None:
        try:
            if self.modell is None:
                self.senden({"type": "info", "text": f"Lade Modell {self.modell_pfad.name} …"})
                self.modell = vosk.Model(str(self.modell_pfad))
            if vokabular:
                grammatik = json.dumps(sorted(set(vokabular)) + ["[unk]"], ensure_ascii=False)
                rec = vosk.KaldiRecognizer(self.modell, self.RATE, grammatik)
            else:
                rec = vosk.KaldiRecognizer(self.modell, self.RATE)
            rec.SetWords(True)

            q: queue.Queue[bytes] = queue.Queue(maxsize=200)

            def callback(indata, _frames, _time, status):  # noqa: ANN001
                try:
                    q.put_nowait(bytes(indata))
                except queue.Full:
                    pass

            with sd.RawInputStream(
                samplerate=self.RATE,
                blocksize=self.BLOCK,
                device=geraet,
                dtype="int16",
                channels=1,
                callback=callback,
            ):
                self.laeuft = True
                self.senden(self.status())
                letzter_partial = ""
                while not self.stop_event.is_set():
                    try:
                        block = q.get(timeout=0.3)
                    except queue.Empty:
                        continue
                    samples = array("h", block)
                    if samples:
                        rms = (sum(s * s for s in samples[::2]) / max(1, len(samples) // 2)) ** 0.5
                        roh = rms / 32768
                        faktor = self._faktor(roh)
                        if faktor > 1.001:
                            samples = array("h", (max(-32768, min(32767, int(x * faktor))) for x in samples))
                            block = samples.tobytes()
                        self.senden({"type": "level", "wert": min(1.0, roh * faktor * 4), "roh": min(1.0, roh * 4), "faktor": faktor})
                    if rec.AcceptWaveform(block):
                        res = json.loads(rec.Result())
                        text = res.get("text", "").strip()
                        letzter_partial = ""
                        if text:
                            woerter = [
                                {"w": w.get("word", ""), "conf": round(w.get("conf", 1.0), 2)}
                                for w in res.get("result", [])
                            ] or [{"w": w, "conf": 1.0} for w in text.split()]
                            self.senden({"type": "final", "text": text, "woerter": woerter, "t": time.time()})
                    else:
                        partial = json.loads(rec.PartialResult()).get("partial", "").strip()
                        if partial and partial != letzter_partial:
                            letzter_partial = partial
                            self.senden({"type": "partial", "text": partial, "t": time.time()})
        except Exception as exc:  # noqa: BLE001
            self.fehler = f"Mikrofon/Erkennung: {exc}"
            print(self.fehler, file=sys.stderr)
        finally:
            self.laeuft = False
            self.senden(self.status())


ERKENNUNG = Erkennung()


async def geraete(_req):
    if sd is None:
        return web.json_response([])
    liste = []
    try:
        standard = sd.default.device[0]
        for i, d in enumerate(sd.query_devices()):
            if d.get("max_input_channels", 0) > 0:
                liste.append({"id": i, "name": d["name"], "standard": i == standard})
    except Exception:  # noqa: BLE001
        pass
    return web.json_response(liste)


async def websocket(req):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(req)
    ERKENNUNG.clients.add(ws)
    await ws.send_str(json.dumps(ERKENNUNG.status(), ensure_ascii=False))
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                daten = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            art = daten.get("type")
            if art == "start":
                geraet = daten.get("geraet")
                geraet = int(geraet) if geraet not in (None, "", "standard") else None
                await asyncio.to_thread(ERKENNUNG.start, geraet, daten.get("vokabular"), daten.get("verstaerkung"))
            elif art == "stop":
                await asyncio.to_thread(ERKENNUNG.stopp)
            elif art == "verstaerkung":
                ERKENNUNG.verstaerkung_setzen(daten.get("wert"))
            elif art == "status":
                await ws.send_str(json.dumps(ERKENNUNG.status(), ensure_ascii=False))
    finally:
        ERKENNUNG.clients.discard(ws)
        if not ERKENNUNG.clients:
            await asyncio.to_thread(ERKENNUNG.stopp)
    return ws


# ---------------------------------------------------------------- App

async def status(_req):
    return web.json_response({"server": True, **ERKENNUNG.status()})


async def datei(req):
    """Liefert Dateien aus web/ (die Oberfläche, wie sie auch auf GitHub Pages liegt)."""
    pfad = (req.match_info.get("pfad") or "index.html").lstrip("/")
    ziel = (WEB / pfad).resolve()
    if ziel.is_dir():
        ziel = ziel / "index.html"
    if not str(ziel).startswith(str(WEB.resolve())) or not ziel.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(ziel, headers={"Cache-Control": "no-cache"})


async def beim_start(app):
    ERKENNUNG.loop = asyncio.get_running_loop()


def app_bauen() -> web.Application:
    app = web.Application(client_max_size=50 * 1024 * 1024)
    app.on_startup.append(beim_start)
    app.router.add_get("/ws", websocket)
    app.router.add_get("/api/status", status)
    app.router.add_get("/api/stuecke", stuecke_liste)
    app.router.add_get("/api/stuecke/{name}", stueck_laden)
    app.router.add_put("/api/stuecke/{name}", stueck_speichern)
    app.router.add_delete("/api/stuecke/{name}", stueck_loeschen)
    app.router.add_get("/api/stuecke/{name}/zustand", zustand_laden)
    app.router.add_put("/api/stuecke/{name}/zustand", zustand_speichern)
    app.router.add_get("/api/stuecke/{name}/proben", proben_laden)
    app.router.add_post("/api/stuecke/{name}/proben", probe_speichern)
    app.router.add_delete("/api/stuecke/{name}/proben", proben_loeschen)
    app.router.add_post("/api/import", text_import)
    app.router.add_get("/api/geraete", geraete)
    app.router.add_get("/{pfad:.*}", datei)
    return app


if __name__ == "__main__":
    st = ERKENNUNG.status()
    print("Cue-Mitleser")
    print(f"  Oberfläche: http://localhost:{PORT}")
    if HOST != "127.0.0.1":
        print(f"  Im WLAN:    http://{socket.gethostname()}:{PORT}  (z. B. iPad als Anzeige)")
    print(f"  Stücke:     {STUECKE}")
    print(f"  Erkennung:  {'bereit, Modell ' + st['modell'] if st['asr'] else 'AUS – ' + st['grund']}")
    if "--browser" in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    web.run_app(app_bauen(), host=HOST, port=PORT, print=None)
