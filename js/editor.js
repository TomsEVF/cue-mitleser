// Bearbeiten-Modus: Skriptansicht mit Cue-Marken, Cue-Formular, Cue-Liste, Zeilen bearbeiten, Proben-Auswertung.
import * as S from './skript.js';
import { api, toast, lokal } from './hilfen.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ordnet alte Wortindizes nach einer Textänderung den neuen zu (LCS über Wörter).
function wortZuordnung(alt, neu) {
  const m = alt.length, n = neu.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    dp[i][j] = alt[i] === neu[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const map = new Array(m).fill(-1);
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (alt[i] === neu[j]) { map[i] = j; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  let vorher = -1;
  for (let k = 0; k < m; k++) {
    if (map[k] >= 0) vorher = map[k]; else map[k] = Math.min(Math.max(0, n - 1), vorher + 1);
  }
  return map;
}

export class Editor {
  constructor(app) {
    this.app = app;
    this.gewaehlt = null;
    this.filter = 'alle';
    this.form = null;          // {neu: bool, cueId, zeile, wort, typ}
    this.letzterTyp = 'LX';
    this.auswertung = null;    // {heat: Map, probleme: Map, anzahl}
    this.verschieben = null;   // Cue-ID, die per Antippen umgesetzt wird (iPad)
    this.binden();
  }

  get st() { return this.app.stueck; }
  get ix() { return this.app.ix; }

  neuesStueck() {
    this.gewaehlt = null;
    this.formularSchliessen();
    this.auswertung = null;
    $('#chkAuswertung').checked = lokal('cue.auswertung') === '1';
    if ($('#chkAuswertung').checked) this.auswertungLaden(); else this.render();
    $('#skript').scrollTop = 0;
  }

  render() {
    if (!this.st) return;
    this.renderSkript();
    this.renderListe();
    this.knoepfe();
  }

  knoepfe() {
    $('#btnUndo').disabled = !this.app.undo.length;
    $('#btnRedo').disabled = !this.app.redo.length;
  }

  // ---------------------------------------------------------------- Skript
  renderSkript() {
    const el = $('#skript');
    const scroll = el.scrollTop;
    const { tokensProZeile, aufgeloest } = this.ix;
    const doppelt = S.doppelteNummern(this.st);

    // Cues nach Anker gruppieren
    const amWort = new Map();
    for (const c of this.ix.reihenfolge) {
      const k = `${c.zeile}|${c.wort}`;
      if (!amWort.has(k)) amWort.set(k, []);
      amWort.get(k).push(c);
    }
    // Tatsächliche Stichwörter (nach Auflösung) einfärben
    const stich = new Map();
    for (const c of this.ix.reihenfolge) {
      if (c.ausloeser === 'manuell') continue;
      const z = aufgeloest.get(c.id)?.ziel;
      if (z && !stich.has(`${z.z}|${z.wort}`)) stich.set(`${z.z}|${z.wort}`, c.typ);
    }
    const heat = this.auswertung?.heat;
    // Zeilen, in denen ein Dauer-Cue läuft (Start bis Endwort)
    const bereich = new Map();
    for (const c of this.st.cues) {
      if (c.dauer?.art !== 'wort' || !c.dauer.zeile) continue;
      const von = this.ix.zeilenIndex.get(c.zeile), bis = this.ix.zeilenIndex.get(c.dauer.zeile);
      if (von === undefined || bis === undefined) continue;
      for (let i = Math.min(von, bis); i <= Math.max(von, bis); i++) if (!bereich.has(i)) bereich.set(i, c.typ);
    }

    const teile = [];
    if (!this.st.zeilen.length) {
      teile.push('<p class="hinweis" style="padding:20px">Noch kein Skript. Über „Skript importieren“ Text einfügen oder eine Datei laden.</p>');
    }
    this.st.zeilen.forEach((z, zi) => {
      const tokens = tokensProZeile[zi];
      const klassen = ['zeile', z.typ, z.gestrichen ? 'gestrichen' : '', bereich.has(zi) ? `bereich bereich-${bereich.get(zi)}` : ''].join(' ');
      let html = '';
      const marken = (wort) => (amWort.get(`${z.id}|${wort}`) || []).map((c) => this.markeHtml(c, aufgeloest.get(c.id), doppelt)).join('');
      for (const tk of tokens) {
        const k = `${zi}|${tk.idx}`;
        const cls = ['w'];
        if (tk.regie) cls.push('regie');
        if (stich.has(k) && !z.gestrichen) cls.push(`stich-${stich.get(k)}`);
        const h = heat?.get(`${z.id}|${tk.idx}`);
        if (h) cls.push(`heat${h}`);
        html += marken(tk.idx) + `<span class="${cls.join(' ')}" data-z="${zi}" data-w="${tk.idx}">${esc(tk.text)}</span> `;
      }
      // Cues hinter dem letzten Wort (z. B. nach Textänderung)
      for (const [k, cs] of amWort) {
        const [zid, w] = k.split('|');
        if (zid === z.id && Number(w) >= tokens.length) html += cs.map((c) => this.markeHtml(c, aufgeloest.get(c.id), doppelt)).join('');
      }
      // Rolle nur zeigen, wenn sie wechselt (lange Reden sind in mehrere Zeilen geteilt)
      const vorige = this.st.zeilen[zi - 1];
      const zeigeRolle = !vorige || vorige.typ !== 'text' || vorige.rolle !== z.rolle;
      teile.push(`<div class="${klassen}" data-z="${zi}">
        <div class="rolle">${zeigeRolle ? esc(z.rolle) : ''}</div>
        <div class="text">${html || '<span class="w regie" data-z="' + zi + '" data-w="0">&nbsp;</span>'}</div>
        <div class="zeile-werkzeug">
          <button data-aktion="abhier" title="Probe ab dieser Zeile starten">▶</button>
          <button data-aktion="bearbeiten" title="Zeile bearbeiten">✎</button>
          <button data-aktion="streichen" title="${z.gestrichen ? 'Strich aufheben' : 'Zeile streichen'}">${z.gestrichen ? '↺' : '✂'}</button>
          <button data-aktion="einfuegen" title="Neue Zeile darunter">＋</button>
          <button data-aktion="loeschen" title="Zeile löschen">✕</button>
        </div>
      </div>`);
    });
    el.innerHTML = teile.join('');
    el.scrollTop = scroll;
  }

  markeHtml(c, r, doppelt) {
    const cls = ['mark', `t-${c.typ}`];
    if (c.istEnde) {
      if (c.zuCue === this.gewaehlt) cls.push('gewaehlt');
      return `<span class="${cls.join(' ')} ende" draggable="true" data-cue="${c.id}" title="${esc(`Ende von ${c.typ} ${c.nummer}: ${c.bezeichnung}`)}">■ ${esc(`${c.typ} ${c.nummer || '?'}`)}</span>`;
    }
    if (c.ausloeser === 'manuell') cls.push('manuell');
    if (c.id === this.gewaehlt) cls.push('gewaehlt');
    if (r?.verschoben) cls.push('verschoben');
    const titel = [S.cueLabel(c), c.bezeichnung, c.ausloeser === 'manuell' ? 'manuell' : `Vorlauf ${c.vorlauf} Wörter`,
      doppelt.has(c.id) ? '⚠ doppelte Nummer' : '', r?.verschoben ? '⚠ Stichwort verschoben' : ''].filter(Boolean).join(' · ');
    const symbol = { zeit: ' ⏱', wort: ' ▶', manuell: ' ▶' }[c.dauer?.art] || '';
    return `<span class="${cls.join(' ')}" draggable="true" data-cue="${c.id}" title="${esc(titel)}">${esc(S.cueLabel(c))}${symbol}</span>`;
  }

  // ---------------------------------------------------------------- Cue-Liste
  renderListe() {
    const ol = $('#cueListe');
    const doppelt = S.doppelteNummern(this.st);
    const { aufgeloest } = this.ix;
    const probleme = this.auswertung?.probleme;
    const warnungen = [];
    if (doppelt.size) warnungen.push(`⚠ ${doppelt.size} Cues mit doppelter Nummer`);
    const verschoben = this.st.cues.filter((c) => aufgeloest.get(c.id)?.verschoben).length;
    if (verschoben) warnungen.push(`⚠ ${verschoben} Cues liegen auf gestrichenem/stummem Text und wurden aufs nächste gesprochene Wort verschoben`);
    if (this.auswertung) {
      const a = this.auswertung;
      warnungen.push(a.anzahl
        ? `Auswertung aus ${a.anzahl} Mitschnitt${a.anzahl > 1 ? 'en' : ''}: ${a.heat.size} schwache Wörter, ${a.probleme.size} Cues mit Problemen. <button class="klein" id="btnProbenLoeschen">Mitschnitte löschen</button>`
        : 'Noch keine Proben-Mitschnitte vorhanden.');
    }
    $('#cueWarnungen').innerHTML = warnungen.join('<br>');
    $('#btnProbenLoeschen')?.addEventListener('click', async () => {
      if (!confirm('Alle Proben-Mitschnitte dieses Stücks löschen?')) return;
      await api.probenLoeschen(this.app.name);
      this.auswertungLaden();
    });

    const liste = this.ix.reihenfolge.filter((c) => !c.istEnde && (this.filter === 'alle' || c.typ === this.filter));
    const gruppeVon = new Map();
    for (const g of this.ix.gruppen) for (const c of g.cues) gruppeVon.set(c.id, g);
    if (!liste.length) {
      ol.innerHTML = `<li class="leer-hinweis">${this.st.cues.length ? 'Keine Cues dieses Typs.' : 'Noch keine Cues. Auf ein Wort im Skript klicken, um einen Cue zu setzen.'}</li>`;
      return;
    }
    ol.innerHTML = liste.map((c) => {
      const r = aufgeloest.get(c.id);
      const g = r.ziel;
      const zeile = g ? this.st.zeilen[g.z] : null;
      const tokens = g ? this.ix.tokensProZeile[g.z] : [];
      const wo = g
        ? `${zeile.rolle ? esc(zeile.rolle) + ': ' : ''}… ${esc(tokens.slice(Math.max(0, g.wort - 3), g.wort).map((t) => t.text).join(' '))} <b>${esc(tokens[g.wort]?.text)}</b>`
        : 'am Ende des Stücks';
      const warn = [];
      if (doppelt.has(c.id)) warn.push('<div class="warn">⚠ Nummer doppelt</div>');
      if (r.verwaist) warn.push('<div class="warn rot">⚠ Zeile gelöscht – bitte neu setzen</div>');
      else if (r.verschoben) warn.push('<div class="warn">⚠ Stichwort verschoben (gestrichen/stumm)</div>');
      const p = probleme?.get(c.id);
      if (p) {
        warn.push(`<div class="warn rot">⚠ ${esc(p.texte.join(', '))}</div>
          <div class="vorschlag"><button data-vorschlag="vorlauf" data-cue="${c.id}">Vorlauf +10</button>
          <button data-vorschlag="stichwort" data-cue="${c.id}">anderes Stichwort wählen</button></div>`);
      }
      return `<li class="cue-eintrag t-${c.typ}${c.id === this.gewaehlt ? ' gewaehlt' : ''}" data-cue="${c.id}">
        <span class="farbe"></span>
        <span class="nr">${esc(S.cueLabel(c))}</span>
        <span>
          <div class="bez">${esc(c.bezeichnung || '–')}${c.ausloeser === 'manuell' ? ' <small>(manuell)</small>' : ''}</div>
          <div class="wo">${c.ausloeser === 'manuell' ? `Einsatz: ${c.einsatz ? `<b>${esc(c.einsatz)}</b>` : '<i>nicht angegeben</i>'} · vor ` : ''}${wo}${c.ausloeser === 'manuell' ? '' : ` · Vorlauf ${esc(c.vorlauf)}`}</div>
          ${c.dauer?.art ? `<div class="dauer">${esc(S.dauerBeschreibung(c, this.ix))}</div>` : ''}
          ${(() => { const mit = (gruppeVon.get(c.id)?.cues || []).filter((x) => x.id !== c.id && !x.istEnde); return mit.length ? `<div class="mit">⇉ gleichzeitig mit ${esc(mit.map(S.cueLabel).join(', '))}</div>` : ''; })()}
          ${c.notiz ? `<div class="notiz">${esc(c.notiz)}</div>` : ''}
          ${warn.join('')}
        </span>
      </li>`;
    }).join('');
  }

  // ---------------------------------------------------------------- Auswahl & Navigation
  waehle(id, { scrollSkript = false, scrollListe = false } = {}) {
    this.gewaehlt = id;
    document.querySelectorAll('.mark.gewaehlt, .cue-eintrag.gewaehlt').forEach((e) => e.classList.remove('gewaehlt'));
    if (!id) return;
    const mark = document.querySelector(`#skript .mark[data-cue="${id}"]`);
    const li = document.querySelector(`#cueListe [data-cue="${id}"]`);
    mark?.classList.add('gewaehlt');
    li?.classList.add('gewaehlt');
    if (scrollSkript && mark) {
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      mark.classList.remove('blitz'); void mark.offsetWidth; mark.classList.add('blitz');
    }
    if (scrollListe && li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- Formular
  formularOeffnen(ziel, daten) {
    this.form = daten;
    const f = $('#cueForm');
    const c = daten.cueId ? this.st.cues.find((x) => x.id === daten.cueId) : null;
    const typ = c?.typ || this.letzterTyp;
    this.form.typ = typ;
    f.elements.nummer.value = c ? c.nummer : this.nummerVorschlag(typ, daten.zeile, daten.wort);
    f.elements.bezeichnung.value = c?.bezeichnung || '';
    f.elements.vorlauf.value = c ? c.vorlauf : this.st.einstellungen.vorlauf;
    f.elements.notiz.value = c?.notiz || '';
    f.elements.manuell.checked = c?.ausloeser === 'manuell';
    f.elements.einsatz.value = c?.einsatz || '';
    f.elements.dauerArt.value = c?.dauer?.art || '';
    f.elements.sekunden.value = c?.dauer?.sekunden ? S.zeitText(c.dauer.sekunden) : '';
    f.elements.dauerText.value = c?.dauer?.text || '';
    // „Gleichzeitig mit“: alle anderen Cues; vorausgewählt, wenn schon in einer Gruppe
    const gruppe = c ? this.ix.gruppen.find((g) => g.cues.some((x) => x.id === c.id)) : null;
    const partner = gruppe?.cues.find((x) => x.id !== c.id && !x.istEnde);
    f.elements.mit.innerHTML = '<option value="">– eigener Einsatz –</option>' + this.ix.reihenfolge
      .filter((x) => !x.istEnde && x.id !== c?.id)
      .map((x) => `<option value="${x.id}">${esc(S.cueLabel(x))} ${esc(x.bezeichnung || '')} (${x.ausloeser === 'manuell' ? 'manuell' : `bei „${esc(this.wortVon(x))}“`})</option>`).join('');
    f.elements.mit.value = partner?.id || '';
    this.formFelderZeigen();
    this.typZeigen();
    $('#cueLoeschen').hidden = !c;
    $('#cueVerschieben').hidden = !c;
    const zi = this.ix.zeilenIndex.get(daten.zeile);
    const wortText = this.ix.tokensProZeile[zi]?.[daten.wort]?.text || '';
    $('#cueFormInfo').textContent = `${c ? 'Cue bearbeiten' : 'Neuer Cue'} am Wort „${wortText}“`;
    f.hidden = false;
    const r = ziel.getBoundingClientRect();
    const w = f.offsetWidth, h = f.offsetHeight;
    let left = Math.min(window.innerWidth - w - 10, Math.max(10, r.left - 20));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 8);
    f.style.left = `${left}px`;
    f.style.top = `${top}px`;
    (c ? f.elements.bezeichnung : f.elements.nummer).focus();
    f.elements[c ? 'bezeichnung' : 'nummer'].select();
  }

  // Wort angetippt (im Skript oder im Prompter der Probe): Endwort setzen, Cue verschieben oder neuen Cue anlegen
  wortAntippen(el, zi, wort) {
    const zeile = this.st.zeilen[zi]?.id;
    if (!zeile) return;
    const text = el.textContent;
    if (this.endwortFuer) {
      const id = this.endwortFuer;
      this.verschiebenEnde();
      this.app.aendern((st) => { const x = st.cues.find((y) => y.id === id); x.dauer = { ...(x.dauer || {}), art: 'wort', zeile, wort }; });
      this.waehle(id, { scrollListe: true });
      toast(`Endet jetzt bei „${text}“.`);
      return;
    }
    if (this.verschieben) {
      const id = this.verschieben;
      this.verschiebenEnde();
      this.app.aendern((st) => { const x = st.cues.find((y) => y.id === id); x.zeile = zeile; x.wort = wort; });
      this.waehle(id, { scrollListe: true });
      toast(`Verschoben auf „${text}“.`);
      return;
    }
    this.waehle(null);
    this.formularOeffnen(el, { neu: true, zeile, wort });
  }

  // Cue-Marke angetippt (Ende-Marken öffnen den zugehörigen Cue)
  markeAntippen(el, id) {
    const c = this.st.cues.find((x) => x.id === String(id).replace(/#ende$/, ''));
    if (!c) return;
    this.waehle(c.id, { scrollListe: true });
    this.formularOeffnen(el, { cueId: c.id, zeile: c.zeile, wort: c.wort });
  }

  verschiebenEnde() {
    this.verschieben = null;
    this.endwortFuer = null;
    document.body.classList.remove('verschiebe-modus');
  }

  wortVon(c) {
    const z = this.ix.aufgeloest.get(c.id)?.ziel;
    return z ? this.ix.tokensProZeile[z.z][z.wort]?.text || '' : '';
  }

  // Felder je nach Auswahl ein-/ausblenden
  formFelderZeigen() {
    const f = $('#cueForm');
    const art = f.elements.dauerArt.value;
    $('#einsatzFeld').hidden = !f.elements.manuell.checked || !!f.elements.mit.value;
    $('#sekundenFeld').hidden = art !== 'zeit';
    $('#endwortFeld').hidden = art !== 'wort';
    $('#dauerTextFeld').hidden = !art;
    if (art === 'wort') {
      const c = this.form?.cueId ? this.st.cues.find((x) => x.id === this.form.cueId) : null;
      const ende = c ? this.ix.aufgeloest.get(`${c.id}#ende`)?.ziel : null;
      $('#endwortText').textContent = ende ? `Endet bei „${this.ix.tokensProZeile[ende.z][ende.wort]?.text}“` : 'Noch kein Endwort gewählt';
    }
  }

  formularSchliessen() {
    $('#cueForm').hidden = true;
    this.form = null;
  }

  typZeigen() {
    document.querySelectorAll('#cueTyp button').forEach((b) => b.classList.toggle('aktiv', b.dataset.typ === this.form.typ));
  }

  // Nummer vorschlagen: nach dem vorigen Cue gleichen Typs, ggf. Zwischennummer (12.5)
  nummerVorschlag(typ, zeileId, wort) {
    const zi = this.ix.zeilenIndex.get(zeileId);
    const gleiche = this.ix.reihenfolge.filter((c) => !c.istEnde && c.typ === typ && c.nummer !== '' && !isNaN(parseFloat(c.nummer)));
    const pos = (c) => [this.ix.zeilenIndex.get(c.zeile) ?? 1e9, c.wort];
    const vor = gleiche.filter((c) => { const [a, b] = pos(c); return a < zi || (a === zi && b <= wort); });
    const nach = gleiche.filter((c) => !vor.includes(c));
    const p = vor.length ? parseFloat(vor[vor.length - 1].nummer) : 0;
    const n = nach.length ? parseFloat(nach[0].nummer) : null;
    if (n === null) return String(Math.floor(p) + 1);
    if (n - p > 1) return String(Math.floor(p) + 1);
    const mitte = Math.round(((p + n) / 2) * 100) / 100;
    return mitte > p && mitte < n ? String(mitte) : String(Math.floor(p) + 1);
  }

  formularSpeichern() {
    const f = $('#cueForm');
    const d = this.form;
    if (!d) return null;
    const alt = d.cueId ? this.st.cues.find((c) => c.id === d.cueId) : null;
    const art = f.elements.dauerArt.value;
    const dauer = art ? {
      art,
      sekunden: art === 'zeit' ? S.sekundenLesen(f.elements.sekunden.value) : undefined,
      text: f.elements.dauerText.value.trim(),
      zeile: art === 'wort' ? alt?.dauer?.zeile : undefined,
      wort: art === 'wort' ? alt?.dauer?.wort : undefined,
    } : null;
    if (art === 'zeit' && !dauer.sekunden) toast('Timer ohne Zeit – bitte z. B. 1:30 eintragen.', 3500);
    const partner = f.elements.mit.value ? this.st.cues.find((c) => c.id === f.elements.mit.value) : null;
    const werte = {
      typ: d.typ,
      nummer: f.elements.nummer.value.trim().replace(',', '.'),
      bezeichnung: f.elements.bezeichnung.value.trim(),
      vorlauf: Math.max(0, parseInt(f.elements.vorlauf.value, 10) || 0),
      notiz: f.elements.notiz.value.trim(),
      ausloeser: f.elements.manuell.checked ? 'manuell' : 'wort',
      einsatz: f.elements.einsatz.value.trim(),
      dauer,
    };
    // „Gleichzeitig mit“: gleicher Einsatz wie der andere Cue
    if (partner) Object.assign(werte, { zeile: partner.zeile, wort: partner.wort, ausloeser: partner.ausloeser, einsatz: partner.einsatz || werte.einsatz });
    this.letzterTyp = d.typ;
    let id = d.cueId;
    this.app.aendern((st) => {
      if (id) Object.assign(st.cues.find((c) => c.id === id), werte);
      else { id = S.neueId('c'); st.cues.push({ id, zeile: d.zeile, wort: d.wort, ...werte }); }
    });
    this.formularSchliessen();
    this.waehle(id, { scrollListe: true });
    return id;
  }

  cueLoeschen(id) {
    const c = this.st.cues.find((x) => x.id === id);
    if (!c) return;
    this.app.aendern((st) => { st.cues = st.cues.filter((x) => x.id !== id); });
    this.formularSchliessen();
    this.gewaehlt = null;
    toast(`${S.cueLabel(c)} gelöscht – ⌘Z stellt ihn wieder her.`);
  }

  // ---------------------------------------------------------------- Zeilen
  zeileDialog(zi, neu) {
    const dlg = $('#dlgZeile');
    const form = $('#zeileForm');
    const z = neu ? { typ: 'text', rolle: '', text: '' } : this.st.zeilen[zi];
    if (neu && zi >= 0 && this.st.zeilen[zi]) z.rolle = '';
    dlg.querySelector('h2').textContent = neu ? 'Neue Zeile' : 'Zeile bearbeiten';
    form.elements.typ.value = z.typ;
    form.elements.rolle.value = z.rolle;
    form.elements.text.value = z.text;
    form.elements.text.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dlg.close('ok'); } };
    dlg.returnValue = '';
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const ex = S.markerExtrahieren(form.elements.text.value.replace(/\s*\n\s*/g, ' '), this.st.einstellungen.vorlauf);
      const typ = form.elements.typ.value;
      const rolle = form.elements.rolle.value.trim().toUpperCase();
      if (!ex.text && neu) return;
      this.app.aendern((st) => {
        let zeile;
        if (neu) {
          zeile = { id: S.neueId('z'), typ, rolle, text: ex.text, gestrichen: false };
          st.zeilen.splice(zi + 1, 0, zeile);
        } else {
          zeile = st.zeilen[zi];
          const map = wortZuordnung(S.woerterIn(zeile.text), S.woerterIn(ex.text));
          for (const c of st.cues) {
            if (c.zeile !== zeile.id) continue;
            c.wort = c.wort < map.length ? map[c.wort] : Math.max(0, S.woerterIn(ex.text).length - 1);
          }
          Object.assign(zeile, { typ, rolle, text: ex.text });
        }
        const idx = st.zeilen.indexOf(zeile);
        for (const mk of ex.marker) {
          if (mk.wort !== null) st.cues.push({ ...mk.cue, zeile: zeile.id, wort: mk.wort });
          else if (st.zeilen[idx + 1]) st.cues.push({ ...mk.cue, zeile: st.zeilen[idx + 1].id, wort: 0 });
          else st.cues.push({ ...mk.cue, zeile: zeile.id, wort: Math.max(0, S.woerterIn(ex.text).length - 1) });
        }
      });
      if (ex.marker.length) toast(`${ex.marker.length} Cue${ex.marker.length > 1 ? 's' : ''} aus Markern angelegt.`);
    };
    dlg.showModal();
    form.elements.text.focus();
  }

  zeileAktion(aktion, zi) {
    const z = this.st.zeilen[zi];
    if (aktion === 'abhier') { this.app.abHierStarten(zi); return; }
    if (aktion === 'bearbeiten') this.zeileDialog(zi, false);
    if (aktion === 'einfuegen') this.zeileDialog(zi, true);
    if (aktion === 'streichen') {
      this.app.aendern((st) => { st.zeilen[zi].gestrichen = !st.zeilen[zi].gestrichen; });
      const n = this.st.cues.filter((c) => c.zeile === z.id && c.ausloeser !== 'manuell').length;
      if (z.gestrichen && n) toast(`${n} Cue${n > 1 ? 's' : ''} auf dieser Zeile ${n > 1 ? 'rutschen' : 'rutscht'} aufs nächste gesprochene Wort.`, 4000);
    }
    if (aktion === 'loeschen') {
      const cues = this.st.cues.filter((c) => c.zeile === z.id);
      if (cues.length && !confirm(`Diese Zeile hat ${cues.length} Cue(s). Sie werden auf die nächste Zeile verschoben. Zeile löschen?`)) return;
      this.app.aendern((st) => {
        const naechste = st.zeilen[zi + 1] || st.zeilen[zi - 1];
        for (const c of st.cues) {
          if (c.zeile !== z.id) continue;
          if (naechste) {
            c.zeile = naechste.id;
            c.wort = st.zeilen[zi + 1] ? 0 : Math.max(0, S.woerterIn(naechste.text).length - 1);
          }
        }
        st.zeilen.splice(zi, 1);
        if (!naechste) st.cues = st.cues.filter((c) => c.zeile !== z.id);
      });
    }
  }

  umnummerieren() {
    const typen = this.filter === 'alle' ? S.TYPEN : [this.filter];
    if (!confirm(`Cues (${typen.join(', ')}) in Stückreihenfolge fortlaufend ab 1 nummerieren?`)) return;
    this.app.aendern((st) => {
      for (const typ of typen) {
        let n = 1;
        for (const c of this.ix.reihenfolge) {
          if (c.typ !== typ || c.istEnde) continue;
          st.cues.find((x) => x.id === c.id).nummer = String(n++);
        }
      }
    });
    toast('Umnummeriert. ⌘Z macht es rückgängig.');
  }

  // ---------------------------------------------------------------- Proben-Auswertung
  async auswertungLaden() {
    if (!$('#chkAuswertung').checked) { this.auswertung = null; this.render(); return; }
    const proben = await api.proben(this.app.name).catch(() => []);
    const heatRoh = new Map();
    const probleme = new Map();
    const zaehle = (k, n = 1) => heatRoh.set(k, (heatRoh.get(k) || 0) + n);
    for (const p of proben) {
      for (const e of p.woerter || []) {
        if (e.ergebnis === 'fehl' && e.erw) zaehle(`${e.erw.z}|${e.erw.w}`);
        for (const u of e.ueber || []) zaehle(`${u.z}|${u.w}`);
      }
      for (const c of p.cues || []) {
        let text = null;
        if (c.stufe === 'go' && c.via === 'sprung') text = 'GO kam erst durch Sprung';
        if (c.stufe === 'go' && c.via === 'position') text = 'GO erst nach manueller Korrektur';
        if (c.stufe === 'erledigt' && c.via === 'leertaste-vor-go') text = 'Stichwort nicht erkannt (Leertaste vor GO)';
        if (c.stufe === 'go' && c.vorlaufSek != null && c.vorlaufSek < 3) text = `Ansage knapp (${c.vorlaufSek.toFixed(1)} s)`;
        if (!text) continue;
        for (const id of c.ids) {
          if (!probleme.has(id)) probleme.set(id, { texte: [] });
          const t = probleme.get(id).texte;
          if (!t.includes(text)) t.push(text);
        }
      }
    }
    const heat = new Map();
    const n = Math.max(1, proben.length);
    for (const [k, v] of heatRoh) heat.set(k, v / n >= 1 ? 3 : v / n >= 0.5 ? 2 : 1);
    this.auswertung = { heat, probleme, anzahl: proben.length };
    this.render();
  }

  // ---------------------------------------------------------------- Ereignisse
  binden() {
    const skript = $('#skript');

    skript.addEventListener('click', (e) => {
      if (this.app.modus !== 'bearbeiten') return;
      const mark = e.target.closest('.mark');
      if (mark) {
        e.stopPropagation();
        this.markeAntippen(mark, mark.dataset.cue);
        return;
      }
      const btn = e.target.closest('.zeile-werkzeug button');
      if (btn) { this.zeileAktion(btn.dataset.aktion, Number(btn.closest('.zeile').dataset.z)); return; }
      const w = e.target.closest('.w');
      if (w) { this.wortAntippen(w, Number(w.dataset.z), Number(w.dataset.w)); return; }
      this.formularSchliessen();
      this.waehle(null);
    });

    // Drag & Drop: Marke auf anderes Wort ziehen
    skript.addEventListener('dragstart', (e) => {
      const mark = e.target.closest('.mark');
      if (!mark) return;
      e.dataTransfer.setData('text/x-cue', mark.dataset.cue);
      e.dataTransfer.effectAllowed = 'move';
      this.formularSchliessen();
    });
    skript.addEventListener('dragover', (e) => {
      const w = e.target.closest('.w');
      if (!w || !e.dataTransfer.types.includes('text/x-cue')) return;
      e.preventDefault();
      skript.querySelectorAll('.w.ziel').forEach((x) => x !== w && x.classList.remove('ziel'));
      w.classList.add('ziel');
    });
    skript.addEventListener('dragleave', (e) => e.target.closest?.('.w')?.classList.remove('ziel'));
    skript.addEventListener('drop', (e) => {
      const w = e.target.closest('.w');
      const id = e.dataTransfer.getData('text/x-cue');
      if (!w || !id) return;
      e.preventDefault();
      const zeile = this.st.zeilen[Number(w.dataset.z)].id;
      const wort = Number(w.dataset.w);
      if (id.endsWith('#ende')) {
        const haupt = id.replace(/#ende$/, '');
        this.app.aendern((st) => { const x = st.cues.find((y) => y.id === haupt); x.dauer = { ...x.dauer, zeile, wort }; });
        toast(`Ende verschoben auf „${w.textContent}“.`);
        return;
      }
      const c = this.st.cues.find((x) => x.id === id);
      if (c.zeile === zeile && c.wort === wort) { w.classList.remove('ziel'); return; }
      this.app.aendern((st) => { const x = st.cues.find((y) => y.id === id); x.zeile = zeile; x.wort = wort; });
      this.waehle(id, { scrollListe: true });
      toast(`${S.cueLabel(c)} verschoben auf „${w.textContent}“.`);
    });

    // Cue-Liste
    $('#cueListe').addEventListener('click', (e) => {
      const v = e.target.closest('[data-vorschlag]');
      if (v) {
        const id = v.dataset.cue;
        if (v.dataset.vorschlag === 'vorlauf') {
          this.app.aendern((st) => { const c = st.cues.find((x) => x.id === id); c.vorlauf = Number(c.vorlauf || 0) + 10; });
        } else {
          this.waehle(id, { scrollSkript: true });
          toast('Marke im Skript auf ein lautes, eindeutiges Wort ziehen.', 4000);
        }
        return;
      }
      const li = e.target.closest('.cue-eintrag');
      if (li) this.waehle(li.dataset.cue, { scrollSkript: true });
    });
    $('#cueListe').addEventListener('dblclick', (e) => {
      const li = e.target.closest('.cue-eintrag');
      if (!li) return;
      const c = this.st.cues.find((x) => x.id === li.dataset.cue);
      const mark = document.querySelector(`#skript .mark[data-cue="${c.id}"]`);
      this.formularOeffnen(mark || li, { cueId: c.id, zeile: c.zeile, wort: c.wort });
    });
    $('#cueFilter').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.filter = b.dataset.filter;
      document.querySelectorAll('#cueFilter button').forEach((x) => x.classList.toggle('aktiv', x === b));
      this.renderListe();
    });
    $('#btnUmnummerieren').addEventListener('click', () => this.umnummerieren());

    // Formular
    const f = $('#cueForm');
    f.addEventListener('submit', (e) => { e.preventDefault(); this.formularSpeichern(); });
    $('#cueTyp').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.form) return;
      this.form.typ = b.dataset.typ;
      if (this.form.neu) f.elements.nummer.value = this.nummerVorschlag(b.dataset.typ, this.form.zeile, this.form.wort);
      this.typZeigen();
    });
    $('#cueAbbrechen').addEventListener('click', () => this.formularSchliessen());
    for (const n of ['dauerArt', 'manuell', 'mit']) f.elements[n].addEventListener('change', () => this.formFelderZeigen());
    $('#btnEndwort').addEventListener('click', () => {
      $('#cueForm').elements.dauerArt.value = 'wort';
      const id = this.formularSpeichern();
      if (!id) return;
      this.endwortFuer = id;
      document.body.classList.add('verschiebe-modus');
      if (this.app.modus === 'probe') this.app.laufzeit.cueBearbeiten(true);
      toast('Jetzt auf das Wort tippen, bei dem der Cue endet (Esc bricht ab).', 4000);
    });
    $('#cueVerschieben').addEventListener('click', () => {
      if (!this.form?.cueId) return;
      this.verschieben = this.form.cueId;
      this.formularSchliessen();
      document.body.classList.add('verschiebe-modus');
      if (this.app.modus === 'probe') this.app.laufzeit.cueBearbeiten(true);
      toast('Jetzt auf das neue Stichwort tippen (Esc bricht ab).', 4000);
    });
    $('#cueLoeschen').addEventListener('click', () => this.form?.cueId && this.cueLoeschen(this.form.cueId));
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.formularSchliessen(); }
      // Typ per Alt+1/2/3
      if (e.altKey && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        this.form.typ = S.TYPEN[Number(e.key) - 1];
        this.typZeigen();
      }
    });

    // Werkzeugleiste
    $('#btnImport').addEventListener('click', () => this.app.dialogImport());
    $('#btnZeileNeu').addEventListener('click', () => this.zeileDialog(this.st.zeilen.length - 1, true));
    $('#btnUndo').addEventListener('click', () => this.app.rueckgaengig());
    $('#btnRedo').addEventListener('click', () => this.app.wiederholen());
    $('#chkAuswertung').addEventListener('change', (e) => { lokal('cue.auswertung', e.target.checked ? '1' : null); this.auswertungLaden(); });

    // Tastatur
    document.addEventListener('keydown', (e) => {
      if (this.app.modus !== 'bearbeiten' || !this.st) return;
      if (document.querySelector('dialog[open]')) return;
      const inFeld = e.target.closest?.('input, textarea, select');
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'z' && !inFeld) {
        e.preventDefault();
        if (e.shiftKey) this.app.wiederholen(); else this.app.rueckgaengig();
        return;
      }
      if (inFeld) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.gewaehlt) {
        e.preventDefault();
        this.cueLoeschen(this.gewaehlt);
      }
      if (e.key === 'Escape') { this.formularSchliessen(); this.waehle(null); this.verschiebenEnde(); }
    });
  }
}
