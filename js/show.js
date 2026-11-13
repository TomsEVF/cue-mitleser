// Probe- und Show-Modus: Mitlesen, Prompter, Ansage in drei Stufen, manuelle Bedienung, Mitschnitt.
import * as S from './skript.js';
import { Tracker } from './tracker.js';
import { api, toast, lokal } from './hilfen.js';
import { audioKontext } from './erkennung.js';
import { ZeitplanLauf } from './zeitplan.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gKey = (g) => g.cues.map((c) => c.id).join('+');
const ERGEBNIS_KURZ = { treffer: 't', luecke: 'l', fehl: 'f', sprung: 's', fuell: 'u', wiederholung: 'w', ende: 'w' };

export class Laufzeit {
  constructor(app) {
    this.app = app;
    this.aktiv = false;
    this.modus = null;
    this.pausiert = false;
    this.frozen = false;
    this.audio = null;
    this.binden();
  }

  get st() { return this.app.stueck; }
  get ix() { return this.app.ix; }
  get e() { return this.st.einstellungen; }

  // ---------------------------------------------------------------- Start / Stopp
  async start(modus) {
    this.modus = modus;
    this.aktiv = true;
    this.pausiert = false;
    this.frozen = false;
    this.erledigt = new Set();      // Cue-IDs
    this.erledigtStapel = [];       // für "Z" (wieder öffnen)
    this.goZeit = new Map();        // Gruppenschlüssel → Zeitpunkt GO
    this.ersteAnsage = new Map();   // Gruppenschlüssel → Zeitpunkt Standby
    this.stufen = new Map();        // Gruppenschlüssel → letzte Stufe
    this.laufend = new Map();       // Cue-ID → {start, erinnert} für Cues mit Dauer/Timer
    this.blaettern = false;         // Pause: Text frei durchblättern
    this.auswahlZeile = null;
    this.ursache = 'wort';
    this.positionZeit = Date.now();  // Start oder letzte manuelle Korrektur
    this.statistik = { t: 0, l: 0, f: 0, s: 0, u: 0, w: 0 };
    this.probeNeu();
    this.indexNeu(0);
    $('#dbgWoerter').innerHTML = '';
    $('#dbgPartial').textContent = '';
    this.layout();

    this.wachHalten();
    this.zeit = new ZeitplanLauf(this);
    await this.wiederherstellen();
    this.zeit.vergangeneErledigen(120000);   // Gongs, die vor dem Öffnen der App lagen, nicht nachholen
    if (this.app.startZeile != null) { this.abHier(this.app.startZeile); this.app.startZeile = null; }
    this.mikroStart();
    clearInterval(this.takt);
    this.takt = setInterval(() => this.tick(), 250);
    this.aktualisieren();
  }

  wechsle(modus) {
    if (this.modus === 'probe') this.probeSpeichern();
    if (this.cueEdit) this.cueBearbeiten(false);
    this.modus = modus;
    this.layout();
    this.aktualisieren();
  }

  stopp() {
    if (!this.aktiv) return;
    this.probeSpeichern();
    this.zustandSpeichern(true);
    this.aktiv = false;
    clearInterval(this.takt);
    this.app.verbindung.stopp();
    $('#wiederherstellung').hidden = true;
    if (this.cueEdit) { this.cueEdit = false; document.body.classList.remove('cue-edit'); }
    this.wachLock?.release?.().catch(() => {});
    this.wachLock = null;
  }

  // Bildschirm nicht abschalten (iPad/Tablet), solange Probe oder Show läuft
  async wachHalten() {
    try { if ('wakeLock' in navigator && !this.wachLock) this.wachLock = await navigator.wakeLock.request('screen'); }
    catch { /* nicht erlaubt */ }
    this.wachLock?.addEventListener?.('release', () => { this.wachLock = null; });
  }

  layout() {
    const probe = this.modus === 'probe';
    $('#debug').hidden = !probe;
    document.querySelector('.lauf-raster').classList.toggle('mit-debug', probe);
    $('#btnShowEnde').hidden = this.modus !== 'show';
  }

  mikroStart() {
    const geraet = lokal('cue.geraet') || null;
    const vokabular = this.e.vokabularBeschraenken ? this.vokabular() : null;
    this.app.verbindung.start(geraet, vokabular);
  }

  vokabular() {
    const v = new Set();
    for (const tokens of this.ix.tokensProZeile) {
      for (const tk of tokens) {
        if (tk.regie) continue;
        for (const t of tk.text.toLowerCase().split(/[-–—/]+/)) {
          const w = t.replace(/[^a-zäöüß]/g, '');
          if (w) v.add(w);
        }
      }
    }
    for (const g of this.ix.gesprochen) { v.add(g.w); if (g.w.includes('ss')) v.add(g.w.replace(/ss/g, 'ß')); }
    for (const f of String(this.e.fuellwoerter).split(/[,\s]+/)) if (f) v.add(f.toLowerCase());
    return [...v];
  }

  // Index neu aufbauen (z. B. nach Einstellungsänderung in der Probe)
  indexNeu(pos) {
    const alt = pos ?? this.tracker?.pos ?? 0;
    this.tracker = new Tracker(this.ix.gesprochen, this.e);
    this.tracker.setzePosition(alt);
    this.anzeigePos = this.tracker.pos;
    this.goPos = this.tracker.pos;
    this.anzeigeSicherheit = 'sicher';
    this.letzterPartialPos = null;
    // Zuordnung Anzeigewort → gesprochene Indizes
    this.wortBereich = new Map();
    this.ix.gesprochen.forEach((g, i) => {
      const k = `${g.z}|${g.wort}`;
      const b = this.wortBereich.get(k);
      if (b) b[1] = i + 1; else this.wortBereich.set(k, [i, i + 1]);
    });
    if (this.aktiv && pos === undefined) {
      // Änderung während der Probe: neue/verschobene Cues hinter der Position nicht nachträglich als GO melden
      for (const g of this.ix.gruppen) {
        const k = gKey(g);
        if (!g.manuell && g.idx < this.goPos && !this.gruppeErledigt(g) && !this.goZeit.has(k)) {
          for (const c of g.cues) this.erledigt.add(c.id);
          this.stufen.set(k, 'erledigt');
        }
      }
      if (this.blaettern) { this.blaetternScroll = $('#prompter').scrollTop; this.prompterVoll = false; }
    }
    if (this.aktiv) this.aktualisieren();
  }

  // ---------------------------------------------------------------- Cues in der Probe bearbeiten
  // Bearbeiten-Ansicht: Mitlesen pausiert, ganzer Text blätterbar, Wort antippen = neuer Cue, Marke antippen = ändern
  cueBearbeiten(an = !this.cueEdit) {
    if (this.modus !== 'probe' && an) return;
    this.cueEdit = an;
    document.body.classList.toggle('cue-edit', an);
    if (an && !this.pausiert) this.pauseUmschalten(true);
    if (!an) {
      this.app.editor.formularSchliessen();
      this.app.editor.verschiebenEnde();
      if (this.pausiert) this.pauseUmschalten(true);
    }
    this.render();
  }

  // Neuer Cue am gerade gesprochenen Wort
  neuerCueJetzt(el) {
    const g = this.ix.gesprochen[Math.max(0, Math.min(this.ix.gesprochen.length - 1, this.anzeigePos - 1))];
    if (!g) return;
    this.app.editor.formularOeffnen(el || $('#cueHaupt'), { neu: true, zeile: this.st.zeilen[g.z].id, wort: g.wort });
  }

  // Stichwort einer Gruppe auf ein anderes gesprochenes Wort legen (Timing in der Probe anpassen)
  gruppeAnIdx(g, idx) {
    idx = Math.max(0, Math.min(this.ix.gesprochen.length - 1, idx));
    const ziel = this.ix.gesprochen[idx];
    if (!ziel) return;
    const zeileId = this.st.zeilen[ziel.z].id;
    const k = gKey(g);
    if (idx < this.goPos) this.goZeit.set(k, this.goZeit.get(k) || Date.now()); else this.goZeit.delete(k);
    this.app.aendern((st) => {
      for (const c of g.cues) {
        if (c.istEnde) { const p = st.cues.find((x) => x.id === c.zuCue); if (p) p.dauer = { ...p.dauer, zeile: zeileId, wort: ziel.wort }; }
        else { const x = st.cues.find((y) => y.id === c.id); if (x) { x.zeile = zeileId; x.wort = ziel.wort; } }
      }
    }, { render: false });
    toast(`${S.gruppenLabel(g)}: GO jetzt bei „${this.ix.tokensProZeile[ziel.z][ziel.wort]?.text}“`, 2200);
  }

  karteAktion(aktion, key, el) {
    const g = this.ix.gruppen.find((x) => gKey(x) === key);
    if (!g) return;
    if (aktion === 'bearbeiten') { this.app.editor.markeAntippen(el, g.cues[0].id); return; }
    if (g.manuell) return;
    if (aktion === 'frueher') this.gruppeAnIdx(g, g.idx - 1);
    if (aktion === 'spaeter') this.gruppeAnIdx(g, g.idx + 1);
    if (aktion === 'jetzt') this.gruppeAnIdx(g, this.anzeigePos - 1);
  }

  // ---------------------------------------------------------------- Wiederherstellen nach Absturz
  async wiederherstellen() {
    const banner = $('#wiederherstellung');
    banner.hidden = true;
    let z = null;
    try { z = await api.zustand(this.app.name); } catch { /* offline */ }
    if (!z?.zeit) { try { z = JSON.parse(lokal(`cue.zustand.${this.app.name}`) || 'null'); } catch { z = null; } }
    if (!z || !z.zeit || Date.now() - z.zeit > 12 * 3600 * 1000) return;
    this.zeit.laden(z.zeitplan);
    if (!z.pos && !(z.erledigt || []).length) return;
    this.tracker.setzePosition(z.pos || 0);
    this.anzeigePos = this.goPos = this.tracker.pos;
    const ids = new Set(this.ix.reihenfolge.map((c) => c.id));
    for (const id of z.erledigt || []) if (ids.has(id)) this.erledigt.add(id);
    for (const [id, l] of z.laufend || []) if (ids.has(id)) this.laufend.set(id, l);
    // bereits erreichte, nicht erledigte Gruppen nicht erneut als GO anzeigen lassen
    for (const g of this.ix.gruppen) if (!g.manuell && g.idx < this.goPos && !this.gruppeErledigt(g)) this.goZeit.set(gKey(g), Date.now());
    const zeile = this.ix.gesprochen[Math.min(this.tracker.pos, this.ix.gesprochen.length - 1)];
    const zText = zeile ? this.st.zeilen[zeile.z].text.slice(0, 50) : '';
    const uhr = new Date(z.zeit).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    banner.innerHTML = `<span>Position von ${uhr} Uhr wiederhergestellt: „${esc(zText)} …“ · ${this.erledigt.size} Cues erledigt</span>
      <span class="platz"></span><button id="btnVonVorn">Von vorn beginnen</button><button id="btnBannerZu">OK</button>`;
    banner.hidden = false;
    $('#btnVonVorn').onclick = () => {
      this.erledigt.clear(); this.goZeit.clear(); this.ersteAnsage.clear(); this.stufen.clear(); this.laufend.clear();
      this.zeit.zuruecksetzen();
      this.setzePosition(0, false);
      banner.hidden = true;
    };
    $('#btnBannerZu').onclick = () => { banner.hidden = true; };
  }

  zustandSpeichern(sofort = false) {
    if (!this.app.name) return;
    const z = { pos: this.tracker.pos, erledigt: [...this.erledigt], laufend: [...this.laufend], zeitplan: this.zeit?.zustand(), zeit: Date.now(), modus: this.modus };
    lokal(`cue.zustand.${this.app.name}`, JSON.stringify(z));
    clearTimeout(this.zustandTimer);
    const senden = () => api.zustandSpeichern(this.app.name, z).catch(() => {});
    if (sofort) senden(); else this.zustandTimer = setTimeout(senden, 1500);
  }

  // ---------------------------------------------------------------- Spracherkennung
  partial(d) {
    if (!this.aktiv || this.pausiert || this.frozen) return;
    if (this.modus === 'probe') $('#dbgPartial').textContent = d.text;
    const klon = this.tracker.klon();
    const log = klon.verarbeite(d.text.split(/\s+/).filter(Boolean));
    this.anzeigePos = klon.pos;
    this.anzeigeSicherheit = klon.sicherheit;
    // gesichert erst, wenn zwei vorläufige Ergebnisse übereinstimmen
    if (this.letzterPartialPos != null) {
      const sicher = Math.min(klon.pos, this.letzterPartialPos);
      if (sicher > this.goPos) {
        this.goPos = sicher;
        this.ursache = log.some((x) => x.ergebnis === 'sprung') ? 'sprung' : 'wort';
      }
    }
    this.letzterPartialPos = klon.pos;
    this.aktualisieren();
  }

  final(woerter) {
    if (!this.aktiv || this.pausiert || this.frozen) return;
    const t = Date.now();
    const log = this.tracker.verarbeite(woerter);
    this.anzeigePos = this.tracker.pos;
    this.anzeigeSicherheit = this.tracker.sicherheit;
    this.goPos = this.tracker.pos;
    this.letzterPartialPos = null;
    if (log.some((x) => x.ergebnis === 'sprung')) this.ursache = 'sprung';
    else if (log.some((x) => x.ergebnis === 'treffer' || x.ergebnis === 'luecke')) this.ursache = 'wort';
    this.protokolliere(log, t);
    this.aktualisieren();
    this.zustandSpeichern();
  }

  protokolliere(log, t) {
    const g = this.ix.gesprochen;
    const anker = (i) => (g[i] ? { z: this.st.zeilen[g[i].z].id, w: g[i].wort } : null);
    const chips = [];
    for (const x of log) {
      const k = ERGEBNIS_KURZ[x.ergebnis] || 'w';
      this.statistik[k] = (this.statistik[k] || 0) + 1;
      chips.push(`<span class="e-${k}" title="${x.ergebnis} @${x.pos}">${esc(x.w)}</span>`);
      const eintrag = { t, w: x.w, ergebnis: x.ergebnis };
      if (x.ergebnis === 'fehl') eintrag.erw = anker(x.von);
      if (x.ergebnis === 'luecke' || (x.ergebnis === 'sprung' && x.pos > x.von)) {
        const bis = x.ergebnis === 'luecke' ? x.von + x.uebersprungen : Math.min(x.pos, x.von + 40);
        eintrag.ueber = [];
        for (let i = x.von; i < bis; i++) { const a = anker(i); if (a) eintrag.ueber.push(a); }
      }
      this.probe.woerter.push(eintrag);
    }
    this.probe.geaendert = true;
    if (this.modus === 'probe') {
      const box = $('#dbgWoerter');
      box.insertAdjacentHTML('beforeend', chips.join(''));
      while (box.childElementCount > 300) box.firstElementChild.remove();
      box.scrollTop = box.scrollHeight;
      $('#dbgPartial').textContent = '';
      const s = this.statistik;
      const gesamt = s.t + s.l + s.f + s.s;
      $('#dbgQuote').textContent = gesamt ? `${Math.round((100 * (s.t + s.l)) / gesamt)} %` : '–';
      $('#dbgAnzahl').textContent = gesamt + s.u + s.w;
    }
  }

  // ---------------------------------------------------------------- Probe-Mitschnitt
  probeNeu() {
    const jetzt = new Date();
    this.probe = {
      id: jetzt.toISOString().slice(0, 19).replace(/[:T]/g, '-'),
      start: jetzt.toISOString(), woerter: [], cues: [], korrekturen: [], geaendert: false,
    };
  }

  probeSpeichern(manuell = false) {
    if (!this.probe || !this.app.name) return;
    if (!this.probe.woerter.length) { if (manuell) toast('Noch nichts erkannt – kein Mitschnitt gespeichert.'); return; }
    if (!this.probe.geaendert && !manuell) return;
    const daten = { ...this.probe, ende: new Date().toISOString(), modus: this.modus };
    delete daten.geaendert;
    this.probe.geaendert = false;
    api.probeSpeichern(this.app.name, daten)
      .then(() => manuell && toast('Mitschnitt gespeichert. Auswertung im Bearbeiten-Modus.'))
      .catch(() => toast('Mitschnitt konnte nicht gespeichert werden.'));
  }

  // ---------------------------------------------------------------- Cue-Logik
  gruppeErledigt(g) { return g.cues.every((c) => this.erledigt.has(c.id)); }

  // Stufen aller Gruppen. Manuelle Cues stehen auf Standby, sobald alle vorigen erledigt sind.
  stufenBerechnen() {
    const gruppen = this.ix.gruppen;
    let ersteOffene = gruppen.findIndex((g) => !this.gruppeErledigt(g));
    if (ersteOffene < 0) ersteOffene = gruppen.length;
    const ergebnis = [];
    gruppen.forEach((g, i) => {
      let st = this.stufe(g, i, ersteOffene);
      // Cue am selben Stichwort wie die vorige Gruppe: erst, wenn diese erledigt ist („danach“)
      if (g.wartetAuf != null && st !== 'erledigt') {
        const vorher = ergebnis[g.wartetAuf];
        if (vorher !== 'erledigt') st = vorher === 'wartet' ? 'wartet' : 'folgt';
      }
      ergebnis.push(st);
    });
    return ergebnis;
  }

  stufe(g, i, ersteOffene) {
    if (this.gruppeErledigt(g)) return 'erledigt';
    if (g.manuell) return i === ersteOffene ? 'standby' : 'wartet';
    if (this.goZeit.has(gKey(g))) return 'go';
    if (this.goPos > g.idx) return 'go';
    const rest = g.idx - this.anzeigePos;
    if (rest <= this.e.bereitWoerter) return 'bereit';
    if (rest <= g.vorlauf) return 'warnung';
    return 'wartet';
  }

  // Stufenwechsel erkennen: Töne, Blitz, Protokoll, übersprungene Cues
  aktualisieren() {
    if (!this.aktiv || !this.ix) return;
    const jetzt = Date.now();
    const gruppen = this.ix.gruppen;
    const neuGo = [];
    const stufen = this.stufenBerechnen();
    gruppen.forEach((g, i) => {
      const k = gKey(g);
      const s = stufen[i];
      const alt = this.stufen.get(k) || 'wartet';
      if (s === alt) return;
      this.stufen.set(k, s);
      if ((s === 'warnung' || s === 'standby' || s === 'bereit') && !this.ersteAnsage.has(k)) this.ersteAnsage.set(k, jetzt);
      if (s === 'go' && !this.goZeit.has(k)) { this.goZeit.set(k, jetzt); neuGo.push(g); }
      if (s === 'warnung' || s === 'bereit' || s === 'standby') {
        this.ton(s);
        this.probe.cues.push({ t: jetzt, ids: g.cues.map((c) => c.id), stufe: s });
      }
    });

    // Viele Cues auf einmal überholt (großer Sprung)? Nur den letzten als GO zeigen.
    if (neuGo.length > 2) {
      const weg = neuGo.slice(0, -1);
      for (const g of weg) { for (const c of g.cues) this.erledigt.add(c.id); this.stufen.set(gKey(g), 'erledigt'); }
      toast(`${weg.length} Cues übersprungen: ${weg.map(S.gruppenLabel).join(', ')}`, 6000);
      neuGo.splice(0, neuGo.length - 1);
    }
    for (const g of neuGo) {
      const k = gKey(g);
      const start = this.ersteAnsage.get(k);
      this.probe.cues.push({
        t: jetzt, ids: g.cues.map((c) => c.id), stufe: 'go', via: this.ursache,
        // knapp nur werten, wenn eine frühere Ansage überhaupt möglich war
        vorlaufSek: start && start - this.positionZeit > 1500 ? (jetzt - start) / 1000 : null,
      });
      this.ton('go');
      this.blitz(g.cues[0].typ);
      for (const c of g.cues) { if (c.istEnde) this.laufenBeenden(c.zuCue, 'endwort'); else this.laufenStarten(c); this.zeit?.cueAusgeloest(c.id); }
    }
    this.render();
  }

  // ---------------------------------------------------------------- Cues mit Dauer / Timer
  cueVon(id) { return this.ix.reihenfolge.find((c) => c.id === id); }

  laufenStarten(c) {
    if (!c?.dauer?.art || c.istEnde || this.laufend.has(c.id)) return;
    this.laufend.set(c.id, { start: Date.now(), erinnert: 0 });
    this.zustandSpeichern();
  }

  laufenBeenden(id, via) {
    if (!this.laufend.delete(id)) return;
    this.probe.cues.push({ t: Date.now(), ids: [id], stufe: 'ende', via });
    this.zustandSpeichern();
  }

  // Ab einer bestimmten Zeile starten: alles davor erledigt, alles danach offen
  abHier(zi) {
    const b = this.ix.zeilenBereich;
    while (zi < b.length && b[zi].bis <= b[zi].von) zi++;
    const pos = zi < b.length ? b[zi].von : this.ix.gesprochen.length;
    this.erledigt.clear(); this.goZeit.clear(); this.ersteAnsage.clear(); this.stufen.clear();
    this.erledigtStapel = []; this.laufend.clear();
    let n = 0;
    for (const g of this.ix.gruppen) {
      if (g.idx >= pos) continue;
      for (const c of g.cues) this.erledigt.add(c.id);
      this.stufen.set(gKey(g), 'erledigt');
      n++;
    }
    // Dauer-Cues, die vor dieser Stelle beginnen und danach enden, laufen bereits
    for (const c of this.st.cues) {
      const start = this.ix.aufgeloest.get(c.id)?.idx, ende = this.ix.aufgeloest.get(`${c.id}#ende`)?.idx;
      if (c.dauer?.art === 'wort' && start < pos && ende >= pos) this.laufend.set(c.id, { start: Date.now(), erinnert: 0 });
    }
    this.pausiert = false;
    this.blaettern = false;
    this.auswahlZeile = null;
    $('#wiederherstellung').hidden = true;
    this.setzePosition(pos, false);
    this.probe.korrekturen.push({ t: Date.now(), von: null, nach: pos, abHier: true });
    toast(`Start ab hier${n ? ` – ${n} Cue${n > 1 ? 's' : ''} davor als erledigt markiert` : ''}.`, 3000);
  }

  tick() {
    if (!this.aktiv) return;
    const sek = Number(this.e.goAutoErledigt) || 0;
    const jetzt = Date.now();
    let geaendert = false;
    if (sek) {
      for (const g of this.ix.gruppen) {
        const t = this.goZeit.get(gKey(g));
        if (t && !this.gruppeErledigt(g) && jetzt - t > sek * 1000) {
          this.markiereErledigt(g, 'auto', false);
          geaendert = true;
        }
      }
    }
    // Timer abgelaufen → Cue meldet sich wieder
    for (const [id, l] of this.laufend) {
      const c = this.cueVon(id);
      if (c?.dauer?.art !== 'zeit' || l.erinnert || !c.dauer.sekunden) continue;
      if (jetzt - l.start >= c.dauer.sekunden * 1000) {
        l.erinnert = jetzt;
        this.ton('go');
        this.blitz(c.typ);
        this.probe.cues.push({ t: jetzt, ids: [id], stufe: 'timer' });
        geaendert = true;
      }
    }
    if (this.zeit?.tick()) geaendert = true;
    if (geaendert) this.aktualisieren();
    else if ((this.laufend.size || this.zeit?.aktiv()) && Math.floor(jetzt / 1000) !== this.letzteSekunde) {
      this.letzteSekunde = Math.floor(jetzt / 1000);
      this.renderCues();   // Uhren weiterzählen
    }
  }

  markiereErledigt(g, via, neuZeichnen = true) {
    for (const c of g.cues) {
      this.erledigt.add(c.id);
      if (c.istEnde) this.laufenBeenden(c.zuCue, via); else this.laufenStarten(c);
      this.zeit?.cueAusgeloest(c.id);
    }
    this.erledigtStapel.push(g.cues.map((c) => c.id));
    this.probe.cues.push({ t: Date.now(), ids: g.cues.map((c) => c.id), stufe: 'erledigt', via });
    this.zustandSpeichern();
    if (neuZeichnen) this.aktualisieren();
  }

  // Leertaste: aktuellen (frühesten aktiven) Cue erledigen
  leertaste() {
    // zuerst abgelaufene Timer quittieren
    const erinnerung = [...this.laufend].filter(([, l]) => l.erinnert).sort((a, b) => a[1].erinnert - b[1].erinnert)[0];
    if (erinnerung) { this.laufenBeenden(erinnerung[0], 'timer-quittiert'); this.aktualisieren(); return; }
    if (this.zeit?.quittieren()) { this.aktualisieren(); return; }   // Zeit-Ereignis im GO (Gong, Ansage …)
    const gruppen = this.ix.gruppen;
    const stufen = this.stufenBerechnen();
    let ziel = null, zielStufe = null;
    for (let i = 0; i < gruppen.length; i++) {
      const s = stufen[i];
      if (s === 'erledigt') continue;
      if (s !== 'wartet') { ziel = gruppen[i]; zielStufe = s; break; }
      if (!ziel) { ziel = gruppen[i]; zielStufe = s; }
    }
    if (!ziel) return;
    const via = ziel.manuell ? 'manuell' : zielStufe === 'go' ? 'leertaste' : 'leertaste-vor-go';
    this.markiereErledigt(ziel, via);
  }

  wiederOeffnen() {
    const ids = this.erledigtStapel.pop();
    if (!ids) return;
    for (const id of ids) { this.erledigt.delete(id); this.laufend.delete(id); }
    const k = ids.join('+');
    this.goZeit.delete(k);
    this.stufen.delete(k);
    toast('Cue wieder geöffnet.', 1500);
    this.zustandSpeichern();
    this.aktualisieren();
  }

  // ---------------------------------------------------------------- Manuelle Position
  setzePosition(i, protokoll = true) {
    const von = this.tracker.pos;
    this.tracker.setzePosition(i);
    this.anzeigePos = this.goPos = this.tracker.pos;
    this.anzeigeSicherheit = 'sicher';
    this.letzterPartialPos = null;
    this.frozen = false;
    this.ursache = 'position';
    this.positionZeit = Date.now();
    // zurück: GO-Anzeige für noch nicht erledigte Cues hinter der neuen Position aufheben
    if (this.tracker.pos < von) {
      for (const g of this.ix.gruppen) {
        if (g.idx >= this.tracker.pos && !this.gruppeErledigt(g)) { this.goZeit.delete(gKey(g)); this.stufen.delete(gKey(g)); }
      }
    }
    // großer Sprung nach vorn (z. B. Probe ab der Mitte): alles davor gilt als erledigt
    if (protokoll && this.tracker.pos - von > 40) {
      const weg = this.ix.gruppen.filter((g) => g.idx < this.tracker.pos && !this.gruppeErledigt(g));
      for (const g of weg) { for (const c of g.cues) this.erledigt.add(c.id); this.stufen.set(gKey(g), 'erledigt'); }
      if (weg.length) toast(`${weg.length} Cue${weg.length > 1 ? 's' : ''} vor dieser Stelle als erledigt markiert.`, 3000);
    }
    if (protokoll) this.probe.korrekturen.push({ t: Date.now(), von, nach: this.tracker.pos });
    this.aktualisieren();
    this.zustandSpeichern();
  }

  aktuelleZeile() {
    const g = this.ix.gesprochen;
    if (!g.length) return 0;
    return g[Math.min(this.anzeigePos, g.length - 1)].z;
  }

  zeileSchritt(richtung) {
    const b = this.ix.zeilenBereich;
    let zi = this.aktuelleZeile();
    if (richtung < 0 && this.anzeigePos > b[zi].von && this.anzeigePos < b[zi].bis) {
      this.setzePosition(b[zi].von);
      return;
    }
    do { zi += richtung; } while (zi >= 0 && zi < b.length && b[zi].bis <= b[zi].von);
    if (zi < 0 || zi >= b.length) return;
    this.setzePosition(b[zi].von);
  }

  // ---------------------------------------------------------------- Anzeige
  render() {
    this.aktStufen = this.stufenBerechnen();
    this.renderCues();
    this.renderPrompter();
    this.renderAmpel();
    if (this.modus === 'probe') $('#dbgPos').textContent = `${this.tracker.pos} / ${this.ix.gesprochen.length}`;
  }

  karte(g, s, klein) {
    const c0 = g.cues[0];
    const label = S.gruppenLabel(g);
    const rest = Math.max(0, g.idx - this.anzeigePos);
    const titel = {
      go: `GO ${label}`, bereit: `Bereit ${label}`, warnung: `Standby ${label}`,
      standby: `Standby ${label}`, wartet: label, folgt: `Danach: ${label}`,
    }[s];
    const stufeText = {
      go: 'GO', bereit: 'BEREIT', warnung: 'STANDBY', standby: 'STANDBY · MANUELL – nach Go Leertaste', wartet: 'NÄCHSTER CUE',
      folgt: 'DANACH – kommt nach dem vorigen Cue',
    }[s];
    const bez = g.cues.map((c) => c.bezeichnung).filter(Boolean).join(' · ');
    const notiz = g.cues.map((c) => c.notiz).filter(Boolean).join(' · ');
    const einsatz = g.manuell ? g.cues.map((c) => c.einsatz).filter(Boolean).join(' · ') : '';
    const dauer = g.cues.filter((c) => c.dauer?.art).map((c) => `${S.cueLabel(c)}: ${S.dauerBeschreibung(c, this.ix)}`).join(' · ');
    const zeigeRest = !g.manuell && s !== 'go' && s !== 'folgt';
    const breite = g.vorlauf ? Math.max(0, Math.min(100, (rest / g.vorlauf) * 100)) : 0;
    const cls = ['cue-karte', `typ-${c0.typ}`, s === 'standby' ? 'manuell-standby' : s, klein ? 'klein' : ''];
    const k = esc(gKey(g));
    const knoepfe = this.modus !== 'probe' ? '' : `<div class="karte-knoepfe">
      ${g.manuell ? '' : `<button data-ka="frueher" data-g="${k}" title="GO ein Wort früher">◀ früher</button>
      <button data-ka="spaeter" data-g="${k}" title="GO ein Wort später">später ▶</button>
      <button data-ka="jetzt" data-g="${k}" title="GO auf das gerade gesprochene Wort legen">⏱ GO jetzt</button>`}
      <button data-ka="bearbeiten" data-g="${k}" title="Cue bearbeiten">✎ bearbeiten</button>
    </div>`;
    return `<div class="${cls.join(' ')}">
      <div class="stufe">${stufeText}</div>
      <div class="titel">${esc(titel)}</div>
      ${bez ? `<div class="bez">${esc(bez)}</div>` : ''}
      ${einsatz ? `<div class="einsatz">Einsatz: ${esc(einsatz)}</div>` : ''}
      ${dauer && s !== 'wartet' ? `<div class="notiz">${esc(dauer)}</div>` : ''}
      ${notiz ? `<div class="notiz">${esc(notiz)}</div>` : ''}
      ${zeigeRest ? `<div class="rest">${rest}<small>Wörter</small></div>` : ''}
      ${zeigeRest && (s === 'warnung' || s === 'bereit') ? `<div class="balken"><div style="width:${breite}%"></div></div>` : ''}
      ${knoepfe}
    </div>`;
  }

  renderCues() {
    const gruppen = this.ix.gruppen;
    const aktiv = [];
    let naechsteWartend = null;
    const rest = [];
    gruppen.forEach((g, i) => {
      const s = this.aktStufen[i];
      if (s === 'erledigt') return;
      if (s !== 'wartet' && aktiv.length < 3) aktiv.push([g, s]);
      else if (!naechsteWartend && !aktiv.length) naechsteWartend = [g, s];
      else rest.push([g, s]);
    });
    const jetzt = Date.now();
    const erinnerungen = [...this.laufend].filter(([, l]) => l.erinnert).map(([id]) => {
      const c = this.cueVon(id);
      return c ? `<div class="cue-karte typ-${c.typ} erinnerung">
        <div class="stufe">⏱ ZEIT ABGELAUFEN · ${esc(S.cueLabel(c))} ${esc(c.bezeichnung || '')}</div>
        <div class="titel">${esc(c.dauer.text || `${S.cueLabel(c)} beenden`)}</div>
        <div class="bez">nach ${S.zeitText(c.dauer.sekunden)} – mit „Erledigt“ quittieren</div>
      </div>` : '';
    });
    let html = erinnerungen.join('') + (this.zeit?.kartenHtml() || '');
    // Zeitleiste (Uhr, Beginn, Pause, nächstes Ereignis)
    const zl = $('#zeitLeiste');
    zl.hidden = !this.zeit?.aktiv();
    if (!zl.hidden) zl.innerHTML = this.zeit.leisteHtml();
    const davor = html.length > 0;
    if (aktiv.length) html += aktiv.map(([g, s], i) => this.karte(g, s, i > 0 || davor)).join('');
    else if (naechsteWartend) html += this.karte(naechsteWartend[0], 'wartet', davor);
    else if (!davor) html += `<div class="ende">${gruppen.length ? 'Alle Cues erledigt.' : 'Keine Cues im Stück.'}</div>`;
    // Laufende Cues (Musik, Lichtstimmung, Timer)
    const laeuft = [...this.laufend].filter(([, l]) => !l.erinnert).map(([id, l]) => {
      const c = this.cueVon(id);
      if (!c) return '';
      const seit = (jetzt - l.start) / 1000;
      let info = `seit ${S.zeitText(seit)}`;
      if (c.dauer.art === 'zeit') info = `noch ${S.zeitText((c.dauer.sekunden || 0) - seit)}`;
      if (c.dauer.art === 'wort') {
        const z = this.ix.aufgeloest.get(`${id}#ende`);
        info += z ? ` · bis „${esc(this.ix.tokensProZeile[z.ziel?.z]?.[z.ziel?.wort]?.text || '')}“ (${Math.max(0, z.idx - this.anzeigePos)} W.)` : '';
      }
      return `<button class="laeuft typ-${c.typ}" data-laeuft="${id}" title="Antippen beendet den Cue"><b>▶ ${esc(S.cueLabel(c))}</b> ${esc(c.bezeichnung || '')} <small>${info}</small></button>`;
    }).join('');
    if (laeuft) html += `<div class="laeuft-liste"><span class="laeuft-titel">Läuft</span>${laeuft}</div>`;
    // nur neu zeichnen, wenn sich etwas geändert hat (Knöpfe bleiben antippbar)
    if (html !== this.letzteCueHtml) { $('#cueHaupt').innerHTML = html; this.letzteCueHtml = html; }

    $('#naechsteCues').innerHTML = rest.slice(0, 3).map(([g]) => {
      const einsatz = g.cues.map((c) => c.einsatz).filter(Boolean).join(' · ');
      const w = g.manuell ? (einsatz ? `manuell: ${einsatz.slice(0, 30)}` : 'manuell') : `in ${Math.max(0, g.idx - this.anzeigePos)} W.`;
      return `<span class="n typ-${g.cues[0].typ}"><b>${esc(S.gruppenLabel(g))}</b>${esc(g.cues.map((c) => c.bezeichnung).filter(Boolean).join(' · ').slice(0, 30))} <small>${w}</small></span>`;
    }).join('') || '<span class="n"><small>keine weiteren Cues</small></span>';
  }

  renderPrompter() {
    const pr = $('#prompter');
    this.abHierLeisteZeigen();
    if (this.blaettern && this.prompterVoll) {   // beim Blättern nicht neu aufbauen (Scrollposition bleibt)
      pr.querySelectorAll('.pz.auswahl').forEach((e) => e.classList.remove('auswahl'));
      if (this.auswahlZeile != null) pr.querySelector(`.pz[data-z="${this.auswahlZeile}"]`)?.classList.add('auswahl');
      return;
    }
    pr.classList.toggle('blaettern', this.blaettern);
    const zeilen = this.st.zeilen;
    const sichtbar = [];
    zeilen.forEach((z, i) => { if (!z.gestrichen) sichtbar.push(i); });
    const akt = this.aktuelleZeile();
    let k = sichtbar.indexOf(akt);
    if (k < 0) k = 0;
    const von = this.blaettern ? 0 : Math.max(0, k - 2), bis = this.blaettern ? sichtbar.length : Math.min(sichtbar.length, k + 6);

    // Stichwörter und Cue-Chips nach Zielwort
    const stichAn = new Map(); // "z|wort" → {typ, bereit}
    const chipsAn = new Map();
    this.ix.gruppen.forEach((g, i) => {
      const s = this.aktStufen[i];
      for (const c of g.cues) {
        const ziel = this.ix.aufgeloest.get(c.id)?.ziel;
        if (!ziel) continue;
        const key = `${ziel.z}|${ziel.wort}`;
        if (!chipsAn.has(key)) chipsAn.set(key, []);
        chipsAn.get(key).push(`<span data-cue="${c.id}" class="cue-chip typ-${c.typ}${c.ausloeser === 'manuell' ? ' manuell' : ''}${this.erledigt.has(c.id) ? ' erledigt' : ''}">${esc(S.cueLabel(c))}</span>`);
        if (!g.manuell && s !== 'erledigt' && !stichAn.has(key)) stichAn.set(key, { typ: c.typ, bereit: s === 'bereit' });
      }
    });

    const erkannt = this.anzeigePos - 1;
    const html = [];
    for (let j = von; j < bis; j++) {
      const zi = sichtbar[j];
      const z = zeilen[zi];
      const klasse = ['pz', z.typ, zi === akt ? 'aktuell' : j < k ? 'vergangen' : ''];
      let text = '';
      for (const tk of this.ix.tokensProZeile[zi]) {
        const key = `${zi}|${tk.idx}`;
        const cls = ['w'];
        if (tk.regie) cls.push('regie');
        const b = this.wortBereich.get(key);
        if (b) {
          if (b[1] <= this.anzeigePos) cls.push('gesprochen');
          if (erkannt >= b[0] && erkannt < b[1]) cls.push(this.anzeigePos > this.goPos ? 'erkannt vorlaeufig' : 'erkannt');
        }
        const st = stichAn.get(key);
        if (st) cls.push('stich', `typ-${st.typ}`, st.bereit ? 'bereit' : '');
        text += (chipsAn.get(key) || []).join('') + `<span class="${cls.join(' ')}" data-z="${zi}" data-w="${tk.idx}">${esc(tk.text)}</span> `;
      }
      html.push(`<div class="${klasse.join(' ')}" data-z="${zi}"><div class="rolle">${esc(z.rolle)}</div><div>${text}</div></div>`);
    }
    pr.innerHTML = html.join('') || '<div class="pz">Kein Skript.</div>';
    if (this.blaettern) {
      this.prompterVoll = true;
      if (this.blaetternScroll != null) { pr.scrollTop = this.blaetternScroll; this.blaetternScroll = null; }
      else pr.querySelector('.pz.aktuell')?.scrollIntoView({ block: 'center' });
    } else {
      pr.scrollTop = 0;
    }
  }

  abHierLeisteZeigen() {
    const leiste = $('#abHierLeiste');
    leiste.hidden = !this.blaettern;
    if (!this.blaettern) return;
    leiste.classList.toggle('bearbeiten', !!this.cueEdit);
    $('#btnCueEditFertig').hidden = !this.cueEdit;
    $('#btnAbHierWeiter').hidden = !!this.cueEdit;
    if (this.cueEdit) {
      const ed = this.app.editor;
      $('#abHierText').textContent = ed.endwortFuer ? 'Wort antippen, bei dem der Cue endet'
        : ed.verschieben ? 'Neues Stichwort antippen'
        : '✎ Cues bearbeiten: Wort antippen = neuer Cue · Marke antippen = ändern';
      $('#btnAbHier').hidden = true;
      return;
    }
    const z = this.auswahlZeile != null ? this.st.zeilen[this.auswahlZeile] : null;
    $('#abHierText').textContent = z
      ? `${z.rolle ? z.rolle + ': ' : ''}„${z.text.slice(0, 60)}${z.text.length > 60 ? ' …' : ''}“`
      : 'Pausiert – Text durchblättern und eine Zeile antippen, um ab dort zu starten.';
    $('#btnAbHier').hidden = !z;
  }

  pauseUmschalten(leise = false) {
    this.pausiert = !this.pausiert;
    this.letzterPartialPos = null;
    this.blaettern = this.pausiert;
    this.prompterVoll = false;
    this.blaetternScroll = null;
    this.auswahlZeile = null;
    if (!leise) toast(this.pausiert ? 'Pausiert – Text kann durchblättert werden' : 'Mitlesen läuft wieder', 1800);
    this.render();
  }

  renderAmpel() {
    const el = $('#ampel');
    const v = this.app.verbindung.status;
    let cls, text;
    if (this.pausiert) { cls = 'pause'; text = 'Pause (P)'; }
    else if (this.frozen) { cls = 'freeze'; text = 'Freeze (F)'; }
    else if (!v.laeuft) { cls = 'aus'; text = v.asr ? 'Mikro aus' : 'ohne Erkennung'; }
    else { cls = this.anzeigeSicherheit; text = { sicher: 'sicher', unsicher: 'unsicher', verloren: 'verloren' }[cls]; }
    el.className = `ampel ${cls}`;
    document.querySelector('#steuerung [data-aktion="pause"]')?.classList.toggle('aktiv', this.pausiert);
    document.querySelector('#steuerung [data-aktion="freeze"]')?.classList.toggle('aktiv', this.frozen);
    el.querySelector('b').textContent = text;
    el.title = v.grund || 'Tracking-Sicherheit';
  }

  blitz(typ) {
    const f = $('#flash');
    f.style.setProperty('--f', getComputedStyle(document.documentElement).getPropertyValue(`--${typ}`));
    f.classList.remove('an'); void f.offsetWidth; f.classList.add('an');
  }

  ton(stufe) {
    const ctx = audioKontext();
    if (!this.e.toene || !ctx) return;
    const muster = { warnung: [[440, 0.12]], standby: [[440, 0.12]], bereit: [[660, 0.08], [660, 0.08]], go: [[880, 0.35]] }[stufe];
    if (!muster) return;
    let t = ctx.currentTime + 0.01;
    for (const [f, d] of muster) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + d + 0.02);
      t += d + 0.07;
    }
  }

  aktion(a) {
    if (!this.aktiv) return;
    if (a === 'erledigt') this.leertaste();
    else if (a === 'vor') this.zeileSchritt(1);
    else if (a === 'zurueck') this.zeileSchritt(-1);
    else if (a === 'oeffnen') this.wiederOeffnen();
    else if (a === 'hilfe') $('#dlgTasten').showModal();
    else if (a === 'pause') { if (this.cueEdit) this.cueBearbeiten(false); else this.pauseUmschalten(); }
    else if (a === 'neu' && this.modus === 'probe') this.neuerCueJetzt(document.querySelector('#steuerung [data-aktion="neu"]'));
    else if (a === 'bearbeiten' && this.modus === 'probe') this.cueBearbeiten();
    else if (a === 'freeze') {
      this.frozen = !this.frozen;
      this.letzterPartialPos = null;
      this.anzeigePos = this.goPos = this.tracker.pos;
      toast(this.frozen ? 'Position eingefroren – Zeile antippen oder ▲▼ löst' : 'Freeze aufgehoben', 1800);
      this.render();
    }
  }

  // ---------------------------------------------------------------- Ereignisse
  binden() {
    const v = this.app.verbindung;
    v.on('partial', (d) => this.partial(d));
    v.on('final', (d) => this.final((d.woerter || []).map((w) => w.w)));
    v.on('level', (d) => { if (this.aktiv) $('#pegelBalken').style.width = `${Math.round(Math.sqrt(d.wert) * 100)}%`; });
    v.on('status', (s) => {
      if (!this.aktiv) return;
      if (!s.laeuft) $('#pegelBalken').style.width = '0';
      this.renderAmpel();
    });

    $('#prompter').addEventListener('click', (e) => {
      const z = e.target.closest('.pz');
      if (!z || !this.aktiv) return;
      if (this.cueEdit) {
        const chip = e.target.closest('.cue-chip');
        const w = e.target.closest('.w[data-w]');
        if (chip && !this.app.editor.verschieben && !this.app.editor.endwortFuer) this.app.editor.markeAntippen(chip, chip.dataset.cue);
        else if (w) this.app.editor.wortAntippen(w, Number(w.dataset.z), Number(w.dataset.w));
        return;
      }
      if (this.blaettern) { this.auswahlZeile = Number(z.dataset.z); this.renderPrompter(); return; }
      const b = this.ix.zeilenBereich[Number(z.dataset.z)];
      if (b && b.bis > b.von) this.setzePosition(b.von);
    });

    document.addEventListener('keydown', (e) => {
      if (!this.aktiv || this.app.modus === 'bearbeiten') return;
      if (document.querySelector('dialog[open]') || !$('#cueForm').hidden) return;
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && this.cueEdit) { this.cueBearbeiten(false); return; }
      const aktion = { ' ': 'erledigt', arrowdown: 'vor', arrowup: 'zurueck', p: 'pause', f: 'freeze', z: 'oeffnen', '?': 'hilfe', n: 'neu', e: 'bearbeiten' }[e.key.toLowerCase()];
      if (!aktion) return;
      e.preventDefault();
      this.aktion(aktion);
    });
    // Touch-Leiste (iPad): dieselben Aktionen wie die Tasten
    $('#steuerung').addEventListener('click', (e) => {
      const b = e.target.closest('[data-aktion]');
      if (b) this.aktion(b.dataset.aktion);
    });
    document.addEventListener('visibilitychange', () => { if (this.aktiv && document.visibilityState === 'visible') this.wachHalten(); });
    $('#btnTasten').addEventListener('click', () => $('#dlgTasten').showModal());
    $('#btnAbHier').addEventListener('click', () => { if (this.auswahlZeile != null) this.abHier(this.auswahlZeile); });
    $('#btnAbHierWeiter').addEventListener('click', () => { if (this.pausiert) this.pauseUmschalten(); });
    $('#btnCueEditFertig').addEventListener('click', () => this.cueBearbeiten(false));
    // Zeitleiste: pointerdown statt click, weil die Leiste jede Sekunde neu gezeichnet wird
    $('#zeitLeiste').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-zeit]');
      if (!b || !this.aktiv) return;
      e.preventDefault();
      this.zeit.aktion(b.dataset.zeit, b.dataset.arg);
      this.aktualisieren();
    });
    // Laufenden Cue antippen → beenden
    $('#cueHaupt').addEventListener('click', (e) => {
      const ka = e.target.closest('[data-ka]');
      if (ka) { this.karteAktion(ka.dataset.ka, ka.dataset.g, ka); return; }
      const b = e.target.closest('[data-laeuft]');
      if (!b) return;
      const c = this.cueVon(b.dataset.laeuft);
      if (!confirm(`${S.cueLabel(c)} ${c.bezeichnung || ''} beenden?`)) return;
      const gemessen = Math.round((Date.now() - (this.laufend.get(c.id)?.start || Date.now())) / 1000);
      this.laufenBeenden(b.dataset.laeuft, 'manuell');
      // Probe: gemessene Laufzeit als Timer übernehmen
      if (this.modus === 'probe' && gemessen > 0 && (c.dauer.art === 'zeit' || c.dauer.art === 'manuell')
        && confirm(`Gemessene Laufzeit ${S.zeitText(gemessen)} als Timer für ${S.cueLabel(c)} speichern?`)) {
        this.app.aendern((st) => { const x = st.cues.find((y) => y.id === c.id); x.dauer = { ...x.dauer, art: 'zeit', sekunden: gemessen }; }, { render: false });
        toast(`${S.cueLabel(c)}: Timer jetzt ${S.zeitText(gemessen)}.`);
      }
      // ein eventuelles Ende-Stichwort ist damit auch erledigt
      const ende = this.ix.reihenfolge.find((x) => x.id === `${c.id}#ende`);
      if (ende) this.erledigt.add(ende.id);
      this.aktualisieren();
    });

    // Probe-Werkzeuge
    $('#simForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = $('#simText').value.trim();
      if (!t) return;
      $('#simText').value = '';
      this.final(t.split(/\s+/));
    });
    $('#btnProbeSpeichern').addEventListener('click', () => this.probeSpeichern(true));
    $('#btnCuesZurueck').addEventListener('click', () => {
      if (!confirm('Alle Cues wieder als offen markieren?')) return;
      this.erledigt.clear(); this.goZeit.clear(); this.ersteAnsage.clear(); this.stufen.clear(); this.erledigtStapel = [];
      this.zeit?.zuruecksetzen();
      this.zustandSpeichern();
      this.aktualisieren();
    });
    setInterval(() => { if (this.aktiv && this.modus === 'probe') this.probeSpeichern(); }, 60000);
  }
}
