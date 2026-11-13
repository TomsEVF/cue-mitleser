// Cue-Mitleser – App-Steuerung: Stücke laden/speichern, Modi, Rückgängig, Dialoge.
import * as S from './skript.js';
import { Editor } from './editor.js';
import { Laufzeit } from './show.js';
import { Erkennung, entsperren, MODELL_URL, modellInfo, modellHerunterladen, modellLoeschen, modellAusDatei, voskModellStarten } from './erkennung.js';

export const APP_VERSION = '2026-11-13 c';
import { dateiLesen } from './datei-import.js';
import { Diagnose } from './diagnose.js';
import { pegelReglerEinbauen } from './pegel-regler.js';
import { ZeitplanDialog } from './zeitplan.js';
import { pegelEinst, pegelSetzen } from './erkennung.js';
import { modellAbsturzVermutet } from './erkennung.js';
import { BEISPIEL } from './beispiel.js';
import { api, toast, lokal, speicherStart, speicherModus, speicherDauerhaft, browserGeraete } from './hilfen.js';

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.stueck = null;
    this.name = null;
    this.ix = null;
    this.modus = 'bearbeiten';
    this.undo = [];
    this.redo = [];
    this.speicherTimer = null;
    this.verbindung = new Erkennung();
    this.editor = new Editor(this);
    this.laufzeit = new Laufzeit(this);
    this.version = APP_VERSION;
    this.diagnose = new Diagnose(this);
    this.zeitplanDialog = new ZeitplanDialog(this);
    // Verstärkungs-Regler mit Live-Pegel (Einstellungen + Probe-Spalte)
    this.pegelRegler = [
      pegelReglerEinbauen($('#pegelEinstellungen'), { hinweis: 'Live-Pegel erscheint, wenn Probe/Show läuft – oder im Mikrofon-Test.' }),
      pegelReglerEinbauen($('#pegelProbe')),
    ];
    this.verbindung.on('level', (d) => this.pegelRegler.forEach((r) => r.pegel(d)));
    this.bindeKopf();
    this.bindeDialoge();
    this.verbindung.on('status', (s) => this.zeigeAsrStatus(s));
    this.verbindung.on('info', (d) => toast(d.text));
    window.addEventListener('beforeunload', (e) => {
      if (this.speicherTimer) { this.jetztSpeichern(); e.preventDefault(); }
    });
    this.start();
  }

  async start() {
    const modus = await speicherStart();
    document.body.dataset.speicher = modus;
    this.verbindung.init(modus === 'server');
    if (modellAbsturzVermutet()) {
      setTimeout(() => alert('Beim letzten Start des Sprachmodells wurde die Seite beendet – vermutlich reicht der Arbeitsspeicher '
        + 'dieses Geräts für „Vosk im Browser“ nicht.\n\nBitte unter ⋯ → Einstellungen die „Eingebaute Erkennung (Apple)“ wählen '
        + 'oder den Mac-Server verwenden. Mit „Mikrofon & Erkennung testen“ lässt sich das prüfen.'), 500);
    }
    this.serviceWorker(modus);
    await this.listeAktualisieren();
    const letztes = lokal('cue.letztes');
    const namen = [...$('#stueckListe').options].map((o) => o.value).filter(Boolean);
    if (letztes && namen.includes(letztes)) await this.oeffnen(letztes);
    else if (namen.length) await this.oeffnen(namen[0]);
    else this.zeigeAnsicht();
  }

  // ---------------------------------------------------------------- Stücke
  async listeAktualisieren() {
    const liste = await api.liste().catch(() => []);
    const sel = $('#stueckListe');
    sel.innerHTML = liste.length ? '' : '<option value="">– kein Stück –</option>';
    for (const s of liste) {
      const o = document.createElement('option');
      o.value = s.name; o.textContent = s.name;
      sel.append(o);
    }
    if (this.name) sel.value = this.name;
  }

  async oeffnen(name) {
    if (this.modus !== 'bearbeiten') this.setzeModus('bearbeiten', true);
    await this.jetztSpeichern();
    try {
      const daten = await api.laden(name);
      this.stueck = { ...S.neuesStueck(name), ...daten, name };
      this.stueck.einstellungen = S.einstellungen(this.stueck);
      this.name = name;
      this.undo = []; this.redo = [];
      lokal('cue.letztes', name);
      $('#stueckListe').value = name;
      this.neuIndex();
      this.editor.neuesStueck();
      this.zeigeAnsicht();
    } catch (e) {
      toast(`Konnte „${name}“ nicht laden: ${e.message}`);
    }
  }

  async anlegen(name, daten) {
    name = name.trim().replace(/[^A-Za-z0-9ÄÖÜäöüß _.-]/g, '').slice(0, 80);
    if (!name) { toast('Bitte einen gültigen Namen eingeben.'); return false; }
    const vorhanden = [...$('#stueckListe').options].some((o) => o.value === name);
    if (vorhanden && !confirm(`„${name}“ gibt es schon. Überschreiben? (Eine Sicherheitskopie wird angelegt.)`)) return false;
    const st = { ...S.neuesStueck(name), ...(daten || {}), name };
    await api.speichern(name, st);
    await this.listeAktualisieren();
    await this.oeffnen(name);
    return true;
  }

  neuIndex() {
    this.ix = S.indexBauen(this.stueck);
  }

  // Jede Änderung läuft hierüber: Rückgängig-Schnappschuss, Index neu, speichern, neu zeichnen.
  aendern(fn, { render = true } = {}) {
    if (!this.stueck) return;
    this.undo.push(JSON.stringify({ zeilen: this.stueck.zeilen, cues: this.stueck.cues, einstellungen: this.stueck.einstellungen, zeitplan: this.stueck.zeitplan ?? null }));
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
    fn(this.stueck);
    this.neuIndex();
    if (this.modus !== 'bearbeiten') this.laufzeit.indexNeu();
    this.speichernSpaeter();
    if (render) this.editor.render();
    this.editor.knoepfe();
  }

  rueckgaengig() { this.zeitreise(this.undo, this.redo, 'Rückgängig'); }
  wiederholen() { this.zeitreise(this.redo, this.undo, 'Wiederholt'); }
  zeitreise(von, nach, text) {
    if (!von.length || !this.stueck) return;
    nach.push(JSON.stringify({ zeilen: this.stueck.zeilen, cues: this.stueck.cues, einstellungen: this.stueck.einstellungen, zeitplan: this.stueck.zeitplan ?? null }));
    Object.assign(this.stueck, JSON.parse(von.pop()));
    this.neuIndex();
    this.speichernSpaeter();
    this.editor.render();
    this.editor.knoepfe();
    toast(text, 1200);
  }

  speichernSpaeter() {
    clearTimeout(this.speicherTimer);
    $('#speicherStatus').textContent = 'ungespeichert';
    $('#speicherStatus').className = 'speicher';
    this.speicherTimer = setTimeout(() => this.jetztSpeichern(), 700);
  }

  async jetztSpeichern() {
    if (!this.speicherTimer || !this.stueck) return;
    clearTimeout(this.speicherTimer);
    this.speicherTimer = null;
    const el = $('#speicherStatus');
    try {
      el.textContent = 'speichert …';
      await api.speichern(this.name, this.stueck);
      el.textContent = 'gespeichert';
      el.className = 'speicher';
    } catch (e) {
      el.textContent = 'Speichern fehlgeschlagen!';
      el.className = 'speicher fehler';
      this.speicherTimer = setTimeout(() => this.jetztSpeichern(), 3000);
    }
  }

  // ---------------------------------------------------------------- Modi
  zeigeAnsicht() {
    const hat = !!this.stueck;
    $('#ansichtLeer').hidden = hat;
    $('#ansichtBearbeiten').hidden = !hat || this.modus !== 'bearbeiten';
    $('#ansichtLauf').hidden = !hat || this.modus === 'bearbeiten';
    document.querySelectorAll('#modi button').forEach((b) => {
      b.classList.toggle('aktiv', b.dataset.modus === this.modus);
      b.disabled = !hat || (this.modus === 'show' && b.dataset.modus === 'bearbeiten');
      b.title = b.disabled && hat ? 'Im Show-Modus gesperrt – erst „Show beenden“' : '';
    });
    $('#stueckListe').disabled = this.modus === 'show';
    $('#btnNeu').disabled = this.modus === 'show';
    $('#btnMenue').disabled = this.modus === 'show';
    document.body.dataset.modus = this.modus;
  }

  setzeModus(m, erzwingen = false) {
    if (m === this.modus || !this.stueck) return;
    if (m !== 'bearbeiten') entsperren();   // iPad: Audio nur nach Berührung
    if (!erzwingen && this.modus === 'show' && m === 'bearbeiten') return;
    if (!erzwingen && this.modus === 'show' && !confirm('Show-Modus verlassen?')) return;
    const vorher = this.modus;
    this.modus = m;
    this.editor.formularSchliessen();
    if (m === 'bearbeiten') {
      this.laufzeit.stopp();
    } else if (vorher === 'bearbeiten') {
      this.jetztSpeichern();
      this.laufzeit.start(m);
    } else {
      this.laufzeit.wechsle(m);
    }
    this.zeigeAnsicht();
    if (m === 'bearbeiten') this.editor.render();
  }

  // Bearbeiten: „▶ ab hier“ an einer Zeile → Probe ab dieser Zeile
  abHierStarten(zi) {
    if (!this.stueck) return;
    if (this.modus === 'bearbeiten') { this.startZeile = zi; this.setzeModus('probe'); }
    else this.laufzeit.abHier(zi);
  }

  zeigeAsrStatus(s) {
    const el = $('#asrStatus');
    const motor = { vosk: 'Vosk', apple: 'Apple', server: 'Mac' }[s.motor] || '';
    if (s.laeuft) { el.textContent = `Mikro an · ${motor}`; el.className = 'asr an'; }
    else if (s.asr) { el.textContent = `Erkennung bereit · ${motor}`; el.className = 'asr bereit'; }
    else { el.textContent = 'Keine Erkennung'; el.className = 'asr fehler'; }
    el.title = [s.motorName, s.modell ? `Modell: ${s.modell}` : '', s.grund || ''].filter(Boolean).join('\n');
  }

  // Offline-Fähigkeit (iPad, GitHub Pages). Am Mac-Server nicht nötig.
  serviceWorker(modus) {
    if (modus === 'server' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    const hatteController = !!navigator.serviceWorker.controller;
    let einmal = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hatteController || einmal) return;
      einmal = true;
      if (this.modus === 'bearbeiten') this.jetztSpeichern().then(() => location.reload());
      else toast('Neue Version der App ist da – nach Probe/Show einmal neu laden.', 8000);
    });
    navigator.serviceWorker.register('sw.js').then((reg) => reg.update?.()).catch((e) => console.warn('Service Worker:', e));
  }

  // ---------------------------------------------------------------- Kopfleiste
  bindeKopf() {
    $('#stueckListe').addEventListener('change', (e) => this.oeffnen(e.target.value));
    $('#asrStatus').addEventListener('click', () => this.diagnose.oeffnen());
    $('#btnZeitplan').addEventListener('click', () => this.zeitplanDialog.oeffnen());
    $('#ampel').addEventListener('click', () => this.diagnose.oeffnen());
    $('#btnModellLaden').addEventListener('click', () => this.modellAktion('laden'));
    $('#btnModellNeu').addEventListener('click', () => this.modellAktion('neu'));
    $('#btnModellTesten').addEventListener('click', () => this.modellAktion('testen'));
    $('#btnModellLoeschen').addEventListener('click', () => this.modellAktion('loeschen'));
    $('#btnModellDatei').addEventListener('click', () => $('#modellDatei').click());
    $('#modellDatei').addEventListener('change', (e) => this.modellDatei(e.target.files[0]));
    $('#modellUrl').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      lokal('cue.modellUrl', v && v !== MODELL_URL ? v : null);
      this.verbindung.modellEntladen();
      this.modellStatusZeigen();
    });
    $('#btnAppAktualisieren').addEventListener('click', () => {
      if (this.modus === 'show' && !confirm('Während der Show neu laden?')) return;
      this.appAktualisieren();
    });
    $('#btnDiagnose').addEventListener('click', () => {
      const motorSel = $('#einstMotor');
      if (motorSel.value !== this.verbindung.motorId) this.verbindung.waehle(motorSel.value);
      $('#dlgEinstellungen').close('abbrechen');
      this.diagnose.oeffnen();
    });
    $('#btnNeu').addEventListener('click', () => this.dialogNeu());
    $('#btnLeerNeu').addEventListener('click', () => this.dialogNeu());
    $('#btnLeerBeispiel').addEventListener('click', async () => {
      const r = S.textImportieren(BEISPIEL);
      await this.anlegen('Beispiel', r);
    });
    document.querySelectorAll('#modi button').forEach((b) => b.addEventListener('click', () => this.setzeModus(b.dataset.modus)));
    $('#btnShowEnde').addEventListener('click', () => {
      if (confirm('Show beenden und zum Bearbeiten wechseln?')) this.setzeModus('bearbeiten', true);
    });
    $('#btnVollbild').addEventListener('click', () => {
      const d = document, el = d.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else toast('Vollbild: auf dem iPad über „Teilen → Zum Home-Bildschirm“ als App öffnen.', 5000);
    });
    const menue = $('#menueListe');
    $('#btnMenue').addEventListener('click', (e) => { e.stopPropagation(); menue.hidden = !menue.hidden; });
    document.addEventListener('click', () => { menue.hidden = true; });
    menue.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.aktion;
      if (!a) return;
      menue.hidden = true;
      if (a === 'import-text') this.dialogImport();
      if (a === 'export') this.exportieren();
      if (a === 'import-json') $('#jsonDatei').click();
      if (a === 'einstellungen') this.dialogEinstellungen();
      if (a === 'loeschen') this.loeschen();
    });
    $('#jsonDatei').addEventListener('change', (e) => this.jsonImportieren(e.target.files[0]));
  }

  async loeschen() {
    if (!this.stueck) return;
    if (!confirm(`Stück „${this.name}“ löschen? (Es wird in stuecke/backup verschoben.)`)) return;
    clearTimeout(this.speicherTimer); this.speicherTimer = null;
    await api.loeschen(this.name);
    this.stueck = null; this.name = null;
    lokal('cue.letztes', null);
    await this.listeAktualisieren();
    const erster = $('#stueckListe').value;
    if (erster) await this.oeffnen(erster); else this.zeigeAnsicht();
  }

  exportieren() {
    if (!this.stueck) return;
    const blob = new Blob([JSON.stringify(this.stueck, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async jsonImportieren(datei) {
    if (!datei) return;
    try {
      const daten = JSON.parse(await datei.text());
      if (!Array.isArray(daten.zeilen) || !Array.isArray(daten.cues)) throw new Error('Keine Cue-Mitleser-Datei');
      const name = prompt('Name für das Stück:', daten.name || datei.name.replace(/\.json$/i, ''));
      if (name) await this.anlegen(name, daten);
    } catch (e) {
      toast(`Import fehlgeschlagen: ${e.message}`);
    }
    $('#jsonDatei').value = '';
  }

  // ---------------------------------------------------------------- Dialoge
  bindeDialoge() {
    $('#importDatei').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        $('#importText').value = '';
        $('#importText').placeholder = 'Datei wird gelesen …';
        $('#importText').value = await dateiLesen(f);
      } catch (err) {
        toast(`Datei konnte nicht gelesen werden: ${err.message}`, 5000);
      }
    });
  }

  dialogNeu() {
    const dlg = $('#dlgNeu');
    $('#neuName').value = '';
    dlg.returnValue = '';
    dlg.onclose = async () => {
      if (dlg.returnValue !== 'ok') return;
      if (await this.anlegen($('#neuName').value)) this.dialogImport();
    };
    dlg.showModal();
  }

  dialogImport() {
    if (!this.stueck) return;
    const dlg = $('#dlgImport');
    $('#importText').value = '';
    $('#importDatei').value = '';
    dlg.querySelector('input[value="ersetzen"]').checked = true;
    dlg.querySelector('input[value="anhaengen"]').disabled = !this.stueck.zeilen.length;
    dlg.returnValue = '';
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const text = $('#importText').value;
      if (!text.trim()) return;
      const art = dlg.querySelector('input[name="importArt"]:checked').value;
      if (art === 'ersetzen' && this.stueck.zeilen.length && !confirm('Vorhandenes Skript und alle Cues ersetzen?')) return;
      const r = S.textImportieren(text, this.stueck.einstellungen, { hinweisCues: $('#importHinweise').checked });
      this.aendern((st) => {
        if (art === 'ersetzen') { st.zeilen = r.zeilen; st.cues = r.cues; } else { st.zeilen.push(...r.zeilen); st.cues.push(...r.cues); }
      });
      $('#berichtText').textContent = [`${r.zeilen.length} Zeilen und ${r.cues.length} Cues importiert.`, ...r.bericht].join('\n\n');
      $('#dlgBericht').showModal();
    };
    dlg.showModal();
  }

  // ---------------------------------------------------------------- Sprachmodell verwalten
  modellUrl() { return lokal('cue.modellUrl') || MODELL_URL; }

  async modellStatusZeigen(text) {
    const el = $('#modellStatus');
    if (text) { el.textContent = text; return; }
    const i = await modellInfo(this.modellUrl());
    const geladen = this.verbindung.motoren.vosk.modell ? ' · gestartet' : '';
    const mb = (b) => `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;
    const datum = i.zeit ? ` vom ${new Date(i.zeit).toLocaleDateString('de-DE')}` : '';
    el.textContent = !i.gespeichert ? '– noch nicht auf diesem Gerät gespeichert.'
      : !i.ok ? `⚠ gespeicherte Datei ist beschädigt (${mb(i.groesse)}) – bitte „Neu laden“.`
      : `✓ gespeichert (${mb(i.groesse)}, ${i.quelle}${datum}) – offline nutzbar${geladen}.`;
    el.className = `hinweis ${!i.gespeichert ? '' : i.ok ? 'gut' : 'schlecht'}`;
  }

  modellFortschritt(p, geladen, gesamt) {
    $('#modellFortschrittRahmen').hidden = false;
    $('#modellFortschritt').style.width = `${p ?? 0}%`;
    const mb = (b) => (b / 1048576).toFixed(1).replace('.', ',');
    $('#modellStatus').textContent = `Lade … ${p ?? ''}${p != null ? ' %' : ''} (${mb(geladen || 0)}${gesamt ? ` von ${mb(gesamt)}` : ''} MB)`;
    $('#modellStatus').className = 'hinweis';
  }

  async modellAktion(name) {
    const knoepfe = document.querySelectorAll('#modellZeile button');
    knoepfe.forEach((b) => { b.disabled = true; });
    const url = this.modellUrl();
    let lief = false;
    try {
      if (name === 'laden' || name === 'neu') {
        lief = this.verbindung.modellEntladen();
        if (name === 'neu') await modellLoeschen(url);
        const i = await modellInfo(url);
        if (i.gespeichert && i.ok && name === 'laden') await this.modellStatusZeigen();
        else {
          await modellHerunterladen(url, (p, g, t) => this.modellFortschritt(p, g, t));
          await this.modellStatusZeigen();
        }
      } else if (name === 'testen') {
        lief = this.verbindung.modellEntladen();
        const t0 = performance.now();
        const m = await voskModellStarten(url, (p, g, t) => this.modellFortschritt(p, g, t), (t) => this.modellStatusZeigen(t));
        this.verbindung.motoren.vosk.modell = m;
        await this.modellStatusZeigen();
        $('#modellStatus').textContent += ` Start-Test ok (${((performance.now() - t0) / 1000).toFixed(1)} s).`;
      } else if (name === 'loeschen') {
        if (!confirm('Gespeichertes Sprachmodell von diesem Gerät löschen?')) return;
        lief = this.verbindung.modellEntladen();
        await modellLoeschen(url);
        await this.modellStatusZeigen();
      }
    } catch (e) {
      await this.modellStatusZeigen(`✗ ${e.message}`);
      $('#modellStatus').className = 'hinweis schlecht';
    } finally {
      knoepfe.forEach((b) => { b.disabled = false; });
      setTimeout(() => { $('#modellFortschrittRahmen').hidden = true; }, 1500);
      if (lief && this.laufzeit.aktiv) this.laufzeit.mikroStart();
    }
  }

  async modellDatei(datei) {
    if (!datei) return;
    const lief = this.verbindung.modellEntladen();
    try {
      await modellAusDatei(datei, this.modellUrl(), (t) => this.modellStatusZeigen(t));
      await this.modellStatusZeigen();
      $('#modellStatus').textContent += ' Aus Datei übernommen – „Starten (Test)“ prüft es.';
    } catch (e) {
      await this.modellStatusZeigen(`✗ ${e.message}`);
      $('#modellStatus').className = 'hinweis schlecht';
    }
    $('#modellDatei').value = '';
    if (lief && this.laufzeit.aktiv) this.laufzeit.mikroStart();
  }

  // Neueste Version laden: nur den App-Speicher leeren (Stücke und Sprachmodell bleiben).
  // Den Service Worker nicht abmelden – Safari löscht dabei sonst auch das gespeicherte Modell.
  async appAktualisieren() {
    await this.jetztSpeichern();
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('cue-app-')).map((k) => caches.delete(k)));
      await (await navigator.serviceWorker?.getRegistration())?.update();
    } catch { /* egal */ }
    location.reload();
  }

  async dialogEinstellungen() {
    if (!this.stueck) return;
    const dlg = $('#dlgEinstellungen');
    const form = $('#einstForm');
    const fuellen = (e) => {
      for (const [k, v] of Object.entries(e)) {
        const el = form.elements[k];
        if (!el) continue;
        if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      }
    };
    fuellen(this.stueck.einstellungen);
    // Spracherkennung
    const motorSel = $('#einstMotor');
    motorSel.innerHTML = this.verbindung.liste().map((m) =>
      `<option value="${m.id}" ${m.grund ? 'disabled' : ''}>${m.name}${m.grund ? ' – nicht verfügbar' : ''}</option>`).join('');
    motorSel.value = this.verbindung.motorId;
    const sel = $('#einstGeraet');
    const motorAnzeigen = async () => {
      const m = motorSel.value;
      $('#einstMotorHinweis').textContent = {
        vosk: 'Läuft komplett auf diesem Gerät, auch ohne Internet. Das Sprachmodell (ca. 45 MB) wird beim ersten Mal geladen und gespeichert.',
        apple: 'Nutzt die Spracherkennung des Geräts (iPad: Apple/Siri). Oft schneller und genauer, braucht aber meist Internet und sendet Ton an Apple bzw. Google.',
        server: 'Der Mac hört mit seinem Mikrofon mit (start.command). Dieses Gerät zeigt nur an.',
      }[m];
      $('#modellZeile').hidden = m !== 'vosk';
      $('#pegelEinstellungen').hidden = m === 'apple';
      $('#geraeteOptionen').hidden = m !== 'vosk';
      $('#einstVokabular').hidden = m === 'apple';
      const liste = m === 'server' ? await api.geraete() : m === 'vosk' ? await browserGeraete() : [];
      $('#einstGeraetFeld').hidden = m === 'apple';
      sel.innerHTML = '<option value="">Standard (Systemeinstellung)</option>' +
        liste.filter((g) => g.id !== 'default').map((g) => `<option value="${g.id}">${g.name}${g.standard ? ' (Standard)' : ''}</option>`).join('');
      sel.value = lokal(m === 'server' ? 'cue.geraet' : 'cue.mikro') || '';
      if (m === 'vosk') await this.modellStatusZeigen();
    };
    motorSel.onchange = motorAnzeigen;
    $('#modellUrl').value = lokal('cue.modellUrl') || '';
    $('#einstAgc').checked = pegelEinst.agc;
    $('#einstRausch').checked = pegelEinst.rausch;
    $('#appVersion').textContent = `Version ${APP_VERSION}`;
    await motorAnzeigen();
    // Speicherort
    const dauerhaft = await speicherDauerhaft();
    $('#speicherInfo').textContent = speicherModus() === 'server'
      ? 'Stücke liegen auf dem Mac im Ordner stuecke/ (mit Sicherheitskopien).'
      : `Stücke liegen nur in diesem Browser auf diesem Gerät${dauerhaft ? ' (dauerhaft gespeichert)' : ''}. `
        + 'Zum Übertragen und als Sicherung: ⋯ → „Stück exportieren“. Auf dem iPad die App über „Teilen → Zum Home-Bildschirm“ installieren, '
        + 'sonst kann Safari die Daten nach längerer Nichtbenutzung löschen.';
    dlg.returnValue = '';
    dlg.onclose = () => {
      if (dlg.returnValue === 'standard') {
        this.aendern((st) => { st.einstellungen = { ...S.STANDARD_EINSTELLUNGEN }; }, { render: false });
        toast('Standardwerte wiederhergestellt.');
        return;
      }
      if (dlg.returnValue !== 'ok') return;
      const mikroVorher = `${lokal('cue.mikro')}|${pegelEinst.agc}|${pegelEinst.rausch}`;
      lokal(motorSel.value === 'server' ? 'cue.geraet' : 'cue.mikro', sel.value || null);
      pegelSetzen({ agc: $('#einstAgc').checked, rausch: $('#einstRausch').checked });
      // Mikrofon-Optionen geändert → laufendes Mikrofon neu öffnen
      if (mikroVorher !== `${lokal('cue.mikro')}|${pegelEinst.agc}|${pegelEinst.rausch}` && this.laufzeit.aktiv) this.laufzeit.mikroStart();
      if (motorSel.value !== this.verbindung.motorId) this.verbindung.waehle(motorSel.value);
      const neu = { ...this.stueck.einstellungen };
      for (const k of Object.keys(S.STANDARD_EINSTELLUNGEN)) {
        const el = form.elements[k];
        if (!el) continue;
        if (el.type === 'checkbox') neu[k] = el.checked;
        else if (el.type === 'number') neu[k] = Number(el.value);
        else neu[k] = el.value;
      }
      this.aendern((st) => { st.einstellungen = neu; }, { render: false });
      toast('Einstellungen gespeichert.');
    };
    dlg.showModal();
  }
}

window.app = new App();
