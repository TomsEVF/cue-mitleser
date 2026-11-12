// „Mikrofon & Erkennung testen“: prüft auf dem Gerät Schritt für Schritt, wo es hakt,
// und erzeugt einen Bericht zum Kopieren.
import { voskModellStarten, modellInfo, MODELL_URL } from './erkennung.js';
import { lokal } from './hilfen.js';

const $ = (s) => document.querySelector(s);
const MB = (b) => `${Math.round((b || 0) / 1048576)} MB`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const mitZeitlimit = (p, ms, text) => Promise.race([p, new Promise((_, f) => setTimeout(() => f(new Error(text)), ms))]);

export class Diagnose {
  constructor(app) {
    this.app = app;
    this.laeuft = false;
    $('#diagStart').addEventListener('click', () => this.start());
    $('#diagKopieren').addEventListener('click', () => this.kopieren());
    $('#dlgDiagnose').addEventListener('close', () => this.ende());
  }

  oeffnen() {
    $('#diagLog').textContent = '';
    $('#diagErkannt').textContent = '';
    $('#diagErgebnis').textContent = '';
    $('#diagErgebnis').className = 'diag-ergebnis';
    $('#diagPegel').style.width = '0';
    $('#dlgDiagnose').showModal();
  }

  log(ok, text) {
    const zeichen = ok === true ? '✓' : ok === false ? '✗' : '•';
    $('#diagLog').textContent += `${zeichen} ${text}\n`;
    $('#diagLog').scrollTop = $('#diagLog').scrollHeight;
  }

  ergebnis(ok, text) {
    const el = $('#diagErgebnis');
    el.textContent = text;
    el.className = `diag-ergebnis ${ok ? 'gut' : 'schlecht'}`;
  }

  async kopieren() {
    const text = `Cue-Mitleser Diagnose ${new Date().toLocaleString('de-DE')}\n${$('#diagErgebnis').textContent}\n\n${$('#diagLog').textContent}`;
    try { await navigator.clipboard.writeText(text); $('#diagKopieren').textContent = '✓ Kopiert'; }
    catch {
      const r = document.createRange(); r.selectNodeContents($('#diagLog'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      $('#diagKopieren').textContent = 'Text markiert – kopieren';
    }
    setTimeout(() => { $('#diagKopieren').textContent = 'Bericht kopieren'; }, 2500);
  }

  ende() {
    this.abbruch = true;
    try { this.knoten?.disconnect(); this.quelle?.disconnect(); } catch { /* egal */ }
    try { this.rec?.remove(); } catch { /* egal */ }
    try { this.sr?.abort(); } catch { /* egal */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.knoten = this.quelle = this.rec = this.sr = this.stream = this.ctx = null;
    this.laeuft = false;
    $('#diagStart').disabled = false;
    // laufende Probe/Show wieder ans Mikrofon
    if (this.mikroWarAn && this.app.laufzeit.aktiv) this.app.laufzeit.mikroStart();
    this.mikroWarAn = false;
  }

  async start() {
    if (this.laeuft) return;
    this.laeuft = true;
    this.abbruch = false;
    $('#diagStart').disabled = true;
    $('#diagLog').textContent = '';
    $('#diagErkannt').textContent = '';
    // Probe/Show gibt das Mikrofon für den Test frei
    if (this.app.verbindung.motor.laeuft) { this.mikroWarAn = true; this.app.verbindung.stopp(); await warte(300); }
    try {
      await this.ablauf();
    } catch (err) {
      this.log(false, `Abbruch: ${err.name || ''} ${err.message}`);
      this.ergebnis(false, `Fehler: ${err.message}`);
    }
    this.ende();
  }

  async ablauf() {
    const v = this.app.verbindung;
    const motor = v.motorId;
    this.log(null, `App-Version: ${this.app.version || '?'}`);
    this.log(null, `Gerät: ${navigator.userAgent}`);
    this.log(null, `Als App vom Home-Bildschirm: ${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'ja' : 'nein'}`);
    this.log(window.isSecureContext, `Sichere Verbindung (https): ${location.origin}`);
    this.log(typeof WebAssembly !== 'undefined', 'WebAssembly (für Vosk)');
    this.log(!!navigator.mediaDevices?.getUserMedia, 'Mikrofon-Schnittstelle');
    this.log(!!(window.SpeechRecognition || window.webkitSpeechRecognition), 'Eingebaute Spracherkennung (Apple/Browser)');
    this.log(null, `Gewählte Erkennung: ${v.motor.name}`);
    try { const e = await navigator.storage.estimate(); this.log(null, `Speicher: ${MB(e.usage)} belegt von ${MB(e.quota)}`); } catch { /* egal */ }
    if (navigator.deviceMemory) this.log(null, `Arbeitsspeicher (Schätzung): ${navigator.deviceMemory} GB`);

    if (motor === 'server') {
      try { const s = await (await fetch('api/status')).json(); this.log(s.asr, `Mac-Server: ${s.laeuft ? 'Mikro an' : 'bereit'} ${s.grund || ''}`); this.ergebnis(!!s.asr, s.asr ? 'Mac-Server bereit. Das Mikrofon des Macs wird verwendet.' : `Mac-Server: ${s.grund}`); }
      catch (e) { this.log(false, `Mac-Server nicht erreichbar: ${e.message}`); this.ergebnis(false, 'Mac-Server nicht erreichbar.'); }
      return;
    }

    // 1) Mikrofon
    this.log(null, 'Frage Mikrofon an …');
    try {
      this.stream = await mitZeitlimit(navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } }),
        20000, 'Keine Antwort auf die Mikrofon-Anfrage');
    } catch (e) {
      this.log(false, `Mikrofon: ${e.name}: ${e.message}`);
      this.ergebnis(false, e.name === 'NotAllowedError'
        ? 'Mikrofon ist nicht erlaubt. iPad: Einstellungen → Safari → Mikrofon → „Erlauben“ (bzw. beim Home-Bildschirm-App: Einstellungen → Datenschutz → Mikrofon).'
        : `Mikrofon nicht verfügbar: ${e.message}`);
      return;
    }
    const spur = this.stream.getAudioTracks()[0];
    let einst = {};
    try { einst = spur.getSettings(); } catch { /* egal */ }
    this.log(true, `Mikrofon: „${spur.label || '?'}“, Zustand ${spur.readyState}${spur.muted ? ', STUMM' : ''}, ${einst.sampleRate || '?'} Hz`);

    // 2) Audio
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    await Promise.race([this.ctx.resume().catch(() => {}), warte(1500)]);
    this.log(this.ctx.state === 'running', `Audio-Kontext: ${this.ctx.state}, ${this.ctx.sampleRate} Hz`);
    if (this.ctx.state !== 'running') this.log(null, 'Tipp: Einmal auf den Bildschirm tippen – manche iPads geben Audio erst danach frei.');
    this.quelle = this.ctx.createMediaStreamSource(this.stream);
    this.knoten = this.ctx.createScriptProcessor(4096, 1, 1);
    let bloecke = 0, maxPegel = 0;
    this.verarbeiten = null;
    this.knoten.onaudioprocess = (ev) => {
      bloecke++;
      const d = ev.inputBuffer.getChannelData(0);
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] * d[i];
      const pegel = Math.min(1, Math.sqrt(s / (d.length / 4)) * 4);
      maxPegel = Math.max(maxPegel, pegel);
      $('#diagPegel').style.width = `${Math.round(Math.sqrt(pegel) * 100)}%`;
      this.verarbeiten?.(ev.inputBuffer);
    };
    this.quelle.connect(this.knoten);
    this.knoten.connect(this.ctx.destination);
    $('#diagErkannt').textContent = 'Bitte jetzt 5 Sekunden lang sprechen …';
    await warte(5000);
    if (this.abbruch) return;
    const erwartet = Math.round(5 * this.ctx.sampleRate / 4096);
    this.log(bloecke > erwartet * 0.5, `Audio-Blöcke in 5 s: ${bloecke} (erwartet ≈ ${erwartet})`);
    this.log(maxPegel > 0.02, `Lautester Pegel: ${Math.round(maxPegel * 100)} %`);
    if (!bloecke) {
      this.ergebnis(false, `Das Mikrofon ist an, aber es kommt kein Ton in der App an (Audio: ${this.ctx.state}). Bitte einmal auf den Bildschirm tippen und den Test wiederholen. Hilft das nicht: Bericht kopieren und schicken.`);
      return;
    }
    if (maxPegel <= 0.02) {
      this.ergebnis(false, 'Es kommt nur Stille an. Ist ein anderes Mikrofon gewählt, das iPad stummgeschaltet oder nutzt eine andere App das Mikrofon?');
      return;
    }

    // 3) Erkennung
    if (motor === 'vosk') await this.voskTest();
    else if (motor === 'apple') await this.appleTest();
  }

  async voskTest() {
    const url = lokal('cue.modellUrl') || MODELL_URL;
    const info = await modellInfo(url);
    this.log(info.gespeichert ? info.ok : null, `Sprachmodell: ${!info.gespeichert ? 'nicht gespeichert – wird geladen (ca. 45 MB)' : info.ok ? `gespeichert, ${MB(info.groesse)} (${info.quelle})` : `BESCHÄDIGT (${MB(info.groesse)}) – wird neu geladen`} · Adresse ${url}`);
    const t0 = performance.now();
    let modell = this.app.verbindung.motoren.vosk.modell;
    if (!modell) {
      modell = await voskModellStarten(url, (p) => { $('#diagErkannt').textContent = `Lade Sprachmodell … ${p ?? ''}${p != null ? ' %' : ''}`; },
        (t) => { $('#diagErkannt').textContent = t; });
      this.app.verbindung.motoren.vosk.modell = modell;
    }
    this.log(true, `Sprachmodell gestartet in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    if (this.abbruch) return;
    this.rec = new modell.KaldiRecognizer(this.ctx.sampleRate);
    const texte = [];
    let teil = 0;
    this.rec.on('partialresult', (m) => { const p = m.result?.partial; if (p) { teil++; $('#diagErkannt').textContent = `… ${p}`; } });
    this.rec.on('result', (m) => { const t = m.result?.text; if (t) { texte.push(t); $('#diagErkannt').textContent = `✓ ${texte.join(' / ')}`; } });
    this.verarbeiten = (buf) => { try { this.rec.acceptWaveform(buf); } catch (e) { this.log(false, `acceptWaveform: ${e.message}`); this.verarbeiten = null; } };
    $('#diagErkannt').textContent = 'Erkennung läuft – bitte jetzt 12 Sekunden lang deutlich sprechen …';
    await warte(12000);
    this.verarbeiten = null;
    try { this.rec.retrieveFinalResult(); } catch { /* egal */ }
    await warte(1500);
    const woerter = texte.join(' ').split(/\s+/).filter(Boolean).length;
    this.log(woerter > 0 || teil > 0, `Vosk: ${teil} Zwischenergebnisse, ${woerter} erkannte Wörter: „${texte.join(' / ').slice(0, 200)}“`);
    this.ergebnis(woerter > 0, woerter > 0
      ? `Erkennung funktioniert (${woerter} Wörter erkannt). Wenn es in der Probe trotzdem hakt: Bericht kopieren und schicken.`
      : 'Ton kommt an und das Sprachmodell läuft, aber es wurde nichts erkannt. Bitte näher ans iPad sprechen und wiederholen – oder Bericht kopieren und schicken.');
  }

  async appleTest() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.ergebnis(false, 'Dieser Browser hat keine eingebaute Spracherkennung. Bitte „Vosk im Browser“ wählen.'); return; }
    // eigenes Mikrofon freigeben, sonst kann Safari die Erkennung nicht starten
    this.stream?.getTracks().forEach((t) => t.stop());
    const texte = [];
    let fehler = '';
    await new Promise((fertig) => {
      const r = new SR();
      this.sr = r;
      r.lang = 'de-DE'; r.continuous = true; r.interimResults = true;
      r.onresult = (ev) => {
        const t = [...ev.results].map((x) => x[0].transcript).join(' ');
        $('#diagErkannt').textContent = `… ${t}`;
        texte.splice(0, texte.length, t);
      };
      r.onerror = (ev) => { fehler = ev.error; this.log(false, `Eingebaute Erkennung: Fehler „${ev.error}“ ${ev.message || ''}`); };
      r.onend = () => fertig();
      try { r.start(); $('#diagErkannt').textContent = 'Eingebaute Erkennung läuft – bitte 10 Sekunden sprechen …'; }
      catch (e) { fehler = e.message; fertig(); }
      setTimeout(() => { try { r.stop(); } catch { /* egal */ } }, 10000);
    });
    const woerter = texte.join(' ').split(/\s+/).filter(Boolean).length;
    this.log(woerter > 0, `Eingebaute Erkennung: ${woerter} Wörter: „${texte.join(' ').slice(0, 200)}“`);
    const hinweis = { 'not-allowed': 'Spracherkennung nicht erlaubt (Einstellungen → Safari → Mikrofon, und Siri/Diktat aktivieren).',
      'service-not-allowed': 'Spracherkennung ist auf diesem Gerät gesperrt – Diktieren aktivieren (Einstellungen → Allgemein → Tastatur → Diktierfunktion). In der Home-Bildschirm-App ist sie teils nicht verfügbar: dann in Safari öffnen.',
      network: 'Keine Internetverbindung – die eingebaute Erkennung braucht meist Internet.' }[fehler];
    this.ergebnis(woerter > 0, woerter > 0 ? `Eingebaute Erkennung funktioniert (${woerter} Wörter).` : (hinweis || `Nichts erkannt${fehler ? ` (Fehler: ${fehler})` : ''}.`));
  }
}
