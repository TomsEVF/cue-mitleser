// Spracherkennung mit drei austauschbaren Motoren, alle mit derselben Schnittstelle:
//   Ereignisse: status {asr, grund, laeuft, modell, motor}, partial {text}, final {woerter:[{w}]}, level {wert}, info {text}
//   start(geraet, vokabular), stopp()
//
//  * vosk   – Vosk als WebAssembly im Browser. Läuft offline (auch iPad), Modell wird einmal geladen.
//  * apple  – eingebaute Spracherkennung des Browsers (Safari/iPad: Apple, Chrome: Google). Braucht oft Internet.
//  * server – der Python-Server auf dem Mac (nur wenn die Seite von ihm kommt).
import { lokal } from './hilfen.js';

export const MODELL_URL = 'models/vosk-model-small-de-0.15.tar.gz';
const MODELL_CACHE = 'cue-sprachmodell-v1';

// ---------------------------------------------------------------- gemeinsamer Audio-Kontext
// iPad/Safari erlauben Audio nur nach einer Berührung. entsperren() wird deshalb direkt im Klick aufgerufen.
let ctx = null;
export function audioKontext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  return ctx;
}
export function entsperren() {
  const c = audioKontext();
  if (c && c.state !== 'running') c.resume().catch(() => {});
}

// Safari: resume() bleibt ohne Berührung für immer hängen → nie unbegrenzt darauf warten
async function laufenLassen(c) {
  if (c.state === 'running') return true;
  await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  return c.state === 'running';
}

// Jede Berührung/Taste entsperrt angehaltene Audio-Kontexte (Töne und Erkennung)
const kontexte = new Set();
export function kontextMerken(c) { kontexte.add(c); }
for (const art of ['pointerdown', 'touchend', 'keydown']) {
  document.addEventListener(art, () => {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    for (const c of kontexte) {
      if (c.state === 'closed') kontexte.delete(c);
      else if (c.state !== 'running') c.resume().catch(() => {});
    }
  }, { capture: true, passive: true });
}

let skripte = {};
export function skriptLaden(src) {
  return (skripte[src] ||= new Promise((ok, fehler) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => { delete skripte[src]; fehler(new Error(`${src} konnte nicht geladen werden`)); };
    document.head.append(s);
  }));
}

// ---------------------------------------------------------------- Sprachmodell (mit Offline-Cache)
export async function modellImCache(url = MODELL_URL) {
  try { return !!(await (await caches.open(MODELL_CACHE)).match(url)); } catch { return false; }
}

export async function modellLaden(url, fortschritt) {
  let antwort = null;
  try { antwort = await (await caches.open(MODELL_CACHE)).match(url); } catch { /* kein Cache */ }
  if (!antwort) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Sprachmodell nicht gefunden (${r.status}): ${url}`);
    const gesamt = Number(r.headers.get('content-length')) || 0;
    const leser = r.body.getReader();
    const teile = [];
    let geladen = 0, zuletzt = 0;
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      teile.push(value);
      geladen += value.length;
      if (fortschritt && Date.now() - zuletzt > 400) {
        zuletzt = Date.now();
        fortschritt(gesamt ? Math.round((100 * geladen) / gesamt) : null, geladen);
      }
    }
    const blob = new Blob(teile, { type: 'application/gzip' });
    try { await (await caches.open(MODELL_CACHE)).put(url, new Response(blob)); } catch { /* Speicher voll */ }
    return blob;
  }
  return antwort.blob();
}

// ---------------------------------------------------------------- Motor: Vosk im Browser
// Startet das Sprachmodell. vosk-browser selbst wartet bei Fehlern endlos – hier gibt es Fehler + Zeitlimit.
// Ein Merker in localStorage erkennt, wenn die Seite beim Laden abstürzt (zu wenig Arbeitsspeicher, v. a. iPad).
export async function voskModellStarten(url, fortschritt, info) {
  await skriptLaden('vendor/vosk.js');
  const blob = await modellLaden(url, fortschritt);
  info?.('Sprachmodell wird gestartet …');
  const blobUrl = URL.createObjectURL(blob);
  lokal('cue.modellStart', String(Date.now()));
  try {
    return await new Promise((ok, fehler) => {
      const m = new window.Vosk.Model(blobUrl, -1);
      const t = setTimeout(() => fehler(new Error('Sprachmodell startet nicht (Zeitüberschreitung, evtl. zu wenig Arbeitsspeicher)')), 120000);
      m.on('load', (msg) => { clearTimeout(t); if (msg.result) ok(m); else fehler(new Error('Sprachmodell konnte nicht geladen werden')); });
      m.on('error', (msg) => { clearTimeout(t); fehler(new Error(`Sprachmodell: ${msg.error || 'unbekannter Fehler'}`)); });
    });
  } finally {
    lokal('cue.modellStart', null);
  }
}

// Wurde die Seite zuletzt während des Modellstarts beendet? (→ vermutlich Absturz)
export function modellAbsturzVermutet() {
  const t = Number(lokal('cue.modellStart') || 0);
  lokal('cue.modellStart', null);
  return t > 0 && Date.now() - t < 10 * 60 * 1000;
}

class VoskMotor {
  constructor(e) { this.e = e; this.modell = null; this.laeuft = false; }
  get name() { return 'Vosk im Browser (offline)'; }
  verfuegbar() {
    if (!window.isSecureContext) return 'Nur über https oder localhost möglich';
    if (!navigator.mediaDevices?.getUserMedia) return 'Kein Mikrofonzugriff in diesem Browser';
    if (typeof WebAssembly === 'undefined') return 'Browser unterstützt kein WebAssembly';
    return '';
  }
  status() { const g = this.verfuegbar(); return { asr: !g, grund: g, laeuft: this.laeuft, modell: 'vosk-model-small-de-0.15' }; }

  async modellBereit() {
    if (this.modell) return this.modell;
    this.modell = await voskModellStarten(lokal('cue.modellUrl') || MODELL_URL,
      (p) => this.e.emit('info', { text: `Lade Sprachmodell … ${p ?? ''}${p != null ? ' %' : ''}` }),
      (t) => this.e.emit('info', { text: t }));
    return this.modell;
  }

  async start(_geraet, vokabular) {
    this.stopp();
    const nr = (this.startNr = (this.startNr || 0) + 1);
    try {
      const mikro = lokal('cue.mikro');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: mikro ? { exact: mikro } : undefined,
          channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true,
        },
      });
      const spur = this.stream.getAudioTracks()[0];
      spur.onended = () => {
        if (nr !== this.startNr) return;
        this.e.emit('info', { text: 'Mikrofon wurde unterbrochen – starte neu …' });
        setTimeout(() => { if (nr === this.startNr && this.e.gewuenscht) this.start(...this.e.gewuenscht); }, 800);
      };
      const modell = await this.modellBereit();
      if (nr !== this.startNr) { this.streamStoppen(); return; }   // inzwischen gestoppt

      // Eigener Audio-Kontext, erst NACH dem Mikrofon angelegt: Auf iPad/iPhone stellt Safari die
      // Audio-Sitzung beim Mikrofonstart um; ein vorher erzeugter Kontext bleibt dann oft stumm.
      const AC = window.AudioContext || window.webkitAudioContext;
      const c = new AC();
      this.ctx = c;
      kontextMerken(c);
      c.onstatechange = () => { if (this.ctx === c && c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {}); };
      if (!(await laufenLassen(c))) this.e.emit('info', { text: 'Bitte einmal auf den Bildschirm tippen, damit das Mikrofon startet.' });

      const grammatik = vokabular ? JSON.stringify([...vokabular, '[unk]']) : undefined;
      const rec = grammatik ? new modell.KaldiRecognizer(c.sampleRate, grammatik) : new modell.KaldiRecognizer(c.sampleRate);
      rec.setWords(true);
      let letzterPartial = '';
      rec.on('result', (m) => {
        const text = (m.result?.text || '').trim();
        letzterPartial = '';
        if (!text) return;
        const woerter = (m.result.result || []).map((w) => ({ w: w.word, conf: w.conf }));
        this.e.emit('final', { text, woerter: woerter.length ? woerter : text.split(/\s+/).map((w) => ({ w })) });
      });
      rec.on('partialresult', (m) => {
        const p = (m.result?.partial || '').trim();
        if (p && p !== letzterPartial) { letzterPartial = p; this.e.emit('partial', { text: p }); }
      });
      this.rec = rec;
      this.quelle = c.createMediaStreamSource(this.stream);
      this.knoten = c.createScriptProcessor(4096, 1, 1);
      this.letzterBlock = 0;
      this.knoten.onaudioprocess = (ev) => {
        this.letzterBlock = Date.now();
        const d = ev.inputBuffer.getChannelData(0);
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i] * d[i];
        this.e.emit('level', { wert: Math.min(1, Math.sqrt(s / (d.length / 4)) * 4) });
        try { rec.acceptWaveform(ev.inputBuffer); } catch (err) { console.error(err); }
      };
      this.quelle.connect(this.knoten);
      this.knoten.connect(c.destination);
      this.laeuft = true;
      this.e.statusMelden();

      // Wächter: kommt kein Ton an, Kontext wieder anwerfen und Bescheid geben
      const start = Date.now();
      let gemeldet = false;
      clearInterval(this.waechter);
      this.waechter = setInterval(() => {
        if (nr !== this.startNr) { clearInterval(this.waechter); return; }
        const seit = Date.now() - (this.letzterBlock || start);
        if (seit > 3000) {
          c.resume().catch(() => {});
          if (!gemeldet) { gemeldet = true; this.e.emit('info', { text: `Kein Ton vom Mikrofon (Audio: ${c.state}) – bitte einmal auf den Bildschirm tippen.` }); }
        } else gemeldet = false;
      }, 2000);
    } catch (err) {
      this.stopp();
      this.e.statusMelden(err.name === 'NotAllowedError'
        ? 'Mikrofon nicht erlaubt – iPad: Einstellungen → Safari → Mikrofon → Erlauben'
        : `Erkennung: ${err.message}`);
    }
  }

  streamStoppen() { this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); this.stream = null; }

  stopp() {
    this.startNr = (this.startNr || 0) + 1;
    clearInterval(this.waechter);
    try { this.knoten?.disconnect(); this.quelle?.disconnect(); } catch { /* egal */ }
    if (this.knoten) this.knoten.onaudioprocess = null;
    try { this.rec?.remove(); } catch { /* egal */ }
    this.knoten = this.quelle = this.rec = null;
    this.streamStoppen();
    if (this.ctx) { const c = this.ctx; this.ctx = null; c.onstatechange = null; c.close().catch(() => {}); }
    if (this.laeuft) { this.laeuft = false; this.e.statusMelden(); }
  }
}

// ---------------------------------------------------------------- Motor: eingebaute Erkennung (Web Speech API)
class SprachMotor {
  constructor(e) { this.e = e; this.laeuft = false; this.aktiv = false; }
  get name() { return 'Eingebaute Erkennung (Apple/Browser)'; }
  get SR() { return window.SpeechRecognition || window.webkitSpeechRecognition; }
  verfuegbar() { return this.SR ? '' : 'Dieser Browser hat keine eingebaute Spracherkennung'; }
  status() { const g = this.verfuegbar(); return { asr: !g, grund: g, laeuft: this.laeuft, modell: 'Web Speech de-DE' }; }

  start() {
    this.stopp();
    if (!this.SR) { this.e.statusMelden(this.verfuegbar()); return; }
    this.aktiv = true;
    this.sitzung();
  }

  // Ergebnisse werden in Wort-Zuwächse umgerechnet: Was stabil ist (alles außer den letzten 2 Wörtern),
  // gilt als „endgültig“. So funktioniert es auch, wenn Safari nie ein Endergebnis meldet.
  sitzung() {
    const r = new this.SR();
    r.lang = 'de-DE';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    const gesendet = new Map();
    r.onstart = () => { this.laeuft = true; this.e.statusMelden(); };
    r.onresult = (ev) => {
      let rest = [];
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const woerter = res[0].transcript.trim().split(/\s+/).filter(Boolean);
        const schon = gesendet.get(i) || 0;
        const stabil = res.isFinal ? woerter.length : Math.max(0, woerter.length - 2);
        if (stabil > schon) {
          const neu = woerter.slice(schon, stabil);
          gesendet.set(i, stabil);
          this.e.emit('final', { text: neu.join(' '), woerter: neu.map((w) => ({ w })) });
        }
        rest = woerter.slice(Math.max(schon, stabil));
      }
      if (rest.length) this.e.emit('partial', { text: rest.join(' ') });
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        this.aktiv = false;
        this.e.statusMelden('Spracherkennung nicht erlaubt (Mikrofon/Siri in den Einstellungen freigeben)');
      } else if (ev.error === 'network') {
        this.e.emit('info', { text: 'Eingebaute Erkennung braucht Internet – Verbindung prüfen' });
      } else if (ev.error === 'audio-capture') {
        this.e.statusMelden('Kein Mikrofon verfügbar (anderes Programm nutzt es?)');
      } else if (ev.error === 'language-not-supported') {
        this.aktiv = false;
        this.e.statusMelden('Deutsch wird von der eingebauten Erkennung nicht unterstützt (Diktat/Siri-Sprache prüfen)');
      } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        this.e.emit('info', { text: `Eingebaute Erkennung: ${ev.error}` });
      }
    };
    r.onend = () => {
      this.laeuft = false;
      if (this.aktiv) setTimeout(() => this.aktiv && this.sitzung(), 250);   // Safari beendet nach einer Weile
      else this.e.statusMelden();
    };
    this.r = r;
    try { r.start(); } catch (err) { this.e.statusMelden(`Erkennung: ${err.message}`); }
  }

  stopp() {
    this.aktiv = false;
    try { this.r?.abort(); } catch { /* egal */ }
    this.r = null;
    if (this.laeuft) { this.laeuft = false; this.e.statusMelden(); }
  }
}

// ---------------------------------------------------------------- Motor: Python-Server auf dem Mac
class ServerMotor {
  constructor(e) { this.e = e; this.ws = null; this.st = { asr: false, grund: 'Nicht verbunden', laeuft: false }; this.gewuenscht = null; }
  get name() { return 'Mac-Server (Vosk, Mac-Mikrofon)'; }
  verfuegbar() { return this.e.serverDa ? '' : 'Nur wenn die App vom Mac-Server geöffnet wurde (start.command)'; }
  status() { return this.e.serverDa ? this.st : { asr: false, grund: this.verfuegbar(), laeuft: false }; }

  verbinden() {
    if (this.ws || !this.e.serverDa) return;
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { if (this.gewuenscht) ws.send(JSON.stringify(this.gewuenscht)); };
    ws.onclose = () => {
      this.ws = null;
      this.st = { ...this.st, laeuft: false, asr: false, grund: 'Mac-Server nicht erreichbar' };
      if (this.e.motor === this) this.e.statusMelden();
      setTimeout(() => this.e.motor === this && this.verbinden(), 1500);
    };
    ws.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch { return; }
      if (d.type === 'status') { this.st = d; this.e.statusMelden(); return; }
      this.e.emit(d.type, d);
    };
  }

  senden(o) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)); }
  start(geraet, vokabular) {
    this.gewuenscht = { type: 'start', geraet: lokal('cue.geraet') || geraet || null, vokabular };
    this.verbinden();
    this.senden(this.gewuenscht);
  }
  stopp() { this.gewuenscht = null; this.senden({ type: 'stop' }); }
}

// ---------------------------------------------------------------- Verwaltung
export class Erkennung {
  constructor() {
    this.handler = {};
    this.serverDa = false;
    this.motoren = { vosk: new VoskMotor(this), apple: new SprachMotor(this), server: new ServerMotor(this) };
    this.motor = this.motoren.vosk;
    this.motorId = 'vosk';
    this.status = { asr: false, grund: '', laeuft: false };
  }

  on(art, fn) { (this.handler[art] ||= []).push(fn); }
  emit(art, d) { (this.handler[art] || []).forEach((fn) => fn(d)); }

  init(serverDa) {
    this.serverDa = serverDa;
    const gewaehlt = lokal('cue.motor');
    this.waehle(gewaehlt && this.motoren[gewaehlt] ? gewaehlt : serverDa ? 'server' : 'vosk');
  }

  liste() {
    return Object.entries(this.motoren).map(([id, m]) => ({ id, name: m.name, grund: m.verfuegbar() }));
  }

  waehle(id) {
    if (!this.motoren[id]) return;
    const lief = this.motor?.laeuft || this.gewuenscht;
    this.motor?.stopp();
    this.motor = this.motoren[id];
    this.motorId = id;
    lokal('cue.motor', id);
    if (id === 'server') this.motor.verbinden();
    this.statusMelden();
    if (lief && this.gewuenscht) this.start(...this.gewuenscht);
  }

  statusMelden(grund) {
    this.status = { ...this.motor.status(), motor: this.motorId, motorName: this.motor.name };
    if (grund) this.status = { ...this.status, asr: false, grund };
    this.emit('status', this.status);
  }

  start(geraet, vokabular) { this.gewuenscht = [geraet, vokabular]; this.motor.start(geraet, vokabular); }
  stopp() { this.gewuenscht = null; this.motor.stopp(); }

  // Für die Vorbereitung: Modell vorab laden, damit es in der Vorstellung offline da ist
  async modellVorladen(fortschritt) {
    await modellLaden(lokal('cue.modellUrl') || MODELL_URL, fortschritt);
  }
}
