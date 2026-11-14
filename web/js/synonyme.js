// Synonyme: Schauspieler sagen oft ein anderes Wort als im Textbuch („Bahn“ statt „Zug“).
// Für einen Textbereich wird Wort für Wort im Synonym-Wörterbuch (OpenThesaurus, offline) gesucht;
// die gewählten Synonyme zählen beim Mitlesen wie das Textbuch-Wort.
//
// stueck.synonyme = { "<gesprochenes Wort, klein, ß→ss>": ["bahn", "eisenbahn", …] }
import * as S from './skript.js';
import { toast } from './hilfen.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (w) => w.toLowerCase().replace(/ß/g, 'ss');

// Wörter, bei denen Synonyme mehr schaden als nützen (Artikel, Pronomen, Hilfsverben …)
const STOPP = new Set(`der die das den dem des ein eine einen einem einer eines und oder aber denn doch sondern
  ich du er sie es wir ihr mich dich sich uns euch mir dir ihm ihn ihnen mein dein sein unser euer meine deine seine
  ist bin bist sind seid war waren warst hat habe hast haben hatte hatten wird werde wirst werden wurde kann kannst
  können muss musst müssen soll sollst sollen will willst wollen darf mag nicht kein keine keinen auch noch schon nur
  mal ja nein so wie was wer wo wann hier da dort dann wenn weil dass ob als mit von zu zum zur für auf an am in im
  ins aus bei nach über unter vor hinter neben durch gegen ohne um bis seit man alles etwas nichts sehr
  null eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf zwanzig dreissig hundert tausend`.split(/\s+/).map(norm));

// ---------------------------------------------------------------- Wörterbuch
let woerterbuch = null;   // Promise<{gruppen: string[][], index: Map<wort, number[]>}>

export function woerterbuchLaden() {
  woerterbuch ||= (async () => {
    const r = await fetch('vendor/synonyme-de.txt.gz');
    if (!r.ok) throw new Error(`Synonym-Wörterbuch nicht ladbar (HTTP ${r.status})`);
    let bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {   // noch gepackt (manche Server entpacken selbst)
      const strom = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(strom).arrayBuffer());
    }
    const text = new TextDecoder().decode(bytes);
    const gruppen = [], index = new Map();
    for (const zeile of text.split('\n')) {
      if (!zeile) continue;
      const g = zeile.split(';');
      const gi = gruppen.push(g) - 1;
      for (const w of g) {
        const k = norm(w.replace(/^~/, ''));
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(gi);
      }
    }
    return { gruppen, index };
  })().catch((e) => { woerterbuch = null; throw e; });
  return woerterbuch;
}

// Grundform raten: „kommt“ → „kommen“, „schnelle“ → „schnell“ („fährt“ → „fahren“ kann das nicht: Umlaut)
function grundformen(w) {
  const out = [];
  for (const end of ['est', 'ern', 'em', 'en', 'er', 'es', 'et', 'st', 'te', 'e', 'n', 's', 't']) {
    if (w.length - end.length < 3 || !w.endsWith(end)) continue;
    const stamm = w.slice(0, -end.length);
    out.push(stamm, stamm + 'en', stamm + 'n');
  }
  if (w.startsWith('ge') && w.length > 6) { const s = w.slice(2).replace(/(en|t)$/, ''); out.push(s + 'en', s + 'n'); }
  return [...new Set(out)].filter((x) => x !== w);
}

// Vorschläge für ein gesprochenes Wort, nach Bedeutung gruppiert: {grundform, gruppen: [[{w, ugs}]]}
export function vorschlaege(wb, wort) {
  let schluessel = wb.index.has(wort) ? wort : null;
  if (!schluessel) schluessel = grundformen(wort).find((g) => wb.index.has(g)) || null;
  if (!schluessel) return { grundform: null, gruppen: [] };
  const gesehen = new Set([wort, schluessel]);
  const gruppen = [];
  for (const gi of wb.index.get(schluessel)) {
    const g = [];
    for (const roh of wb.gruppen[gi]) {
      const ugs = roh.startsWith('~');
      const w = norm(roh.replace(/^~/, ''));
      if (gesehen.has(w) || w.length < 3) continue;
      gesehen.add(w);
      g.push({ w, ugs });
    }
    if (g.length) gruppen.push(g.sort((a, b) => a.ugs - b.ugs));
  }
  // kleine, eindeutige Bedeutungen zuerst (große Gruppen sind oft sehr allgemein)
  gruppen.sort((a, b) => a.length - b.length);
  return { grundform: schluessel !== wort ? schluessel : null, gruppen };
}

export function synonymeVon(st) { return st?.synonyme || {}; }

// ---------------------------------------------------------------- Dialog
const SEITE = 120;            // so viele Wörter auf einmal anzeigen (iPad)
const GRUPPEN = 5;            // so viele Bedeutungen pro Wort, Rest per „+ n“
const CHIPS = 10;             // so viele Wörter pro Bedeutung

export class SynonymDialog {
  constructor(app) {
    this.app = app;
    // [{w, anzahl, zeile, grundform, gruppen:[[{w,ugs}]], eigene:[], gewaehlt:Set, offen}]
    this.woerter = [];
    $('#synSuchen').addEventListener('click', () => this.suchen());
    $('#synMehr').addEventListener('click', () => { this.sichtbar += SEITE; this.zeichnen(); });
    $('#synNurMit').addEventListener('change', () => { this.sichtbar = SEITE; this.zeichnen(); });
    $('#synAlleAus').addEventListener('click', () => { if (confirm('Alle Synonyme in diesem Bereich abwählen?')) this.alle((x) => x.gewaehlt.clear()); });
    $('#synUgsAus').addEventListener('click', () => this.alle((x) => x.gruppen.flat().forEach((v) => v.ugs && x.gewaehlt.delete(v.w))));
    const liste = $('#synListe');
    liste.addEventListener('click', (e) => {
      const zeile = e.target.closest('[data-i]');
      if (!zeile) return;
      const i = Number(zeile.dataset.i);
      const x = this.woerter[i];
      const neu = () => { zeile.outerHTML = this.zeileHtml(x, i); this.zaehlen(); };
      const chip = e.target.closest('[data-s]');
      if (chip) {
        const s = chip.dataset.s;
        if (x.gewaehlt.has(s)) x.gewaehlt.delete(s); else x.gewaehlt.add(s);
        neu();
        return;
      }
      const gb = e.target.closest('[data-g]');
      if (gb) {   // ganze Bedeutung an/aus
        const g = gb.dataset.g === 'eigen' ? x.eigene : x.gruppen[Number(gb.dataset.g)].map((v) => v.w);
        const alleAn = g.every((w) => x.gewaehlt.has(w));
        g.forEach((w) => (alleAn ? x.gewaehlt.delete(w) : x.gewaehlt.add(w)));
        neu();
        return;
      }
      if (e.target.closest('[data-mehr]')) { x.offen = true; neu(); return; }
      if (e.target.closest('[data-keine]')) { x.gewaehlt.clear(); neu(); }
    });
    // eigenes Synonym: Enter oder Feld verlassen
    const eigenes = (inp) => {
      const zeile = inp.closest('[data-i]');
      const i = Number(zeile.dataset.i);
      const x = this.woerter[i];
      for (const teil of inp.value.split(/[,;]+/)) {
        // Mehrwort-Ausdruck („auf der Stelle“): das längste Wort zählt („stelle“)
        const w = S.normalisieren(teil.trim()).sort((a, b) => b.length - a.length)[0];
        if (!w || w === x.w) continue;
        if (!x.gruppen.flat().some((v) => v.w === w) && !x.eigene.includes(w)) x.eigene.push(w);
        x.gewaehlt.add(w);
      }
      inp.value = '';
      zeile.outerHTML = this.zeileHtml(x, i);
      this.zaehlen();
      $(`#synListe [data-i="${i}"] input`)?.focus();
    };
    liste.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); eigenes(e.target); } });
    liste.addEventListener('change', (e) => { if (e.target.matches('input') && e.target.value.trim()) eigenes(e.target); });
  }

  alle(fn) { for (const x of this.woerter) fn(x); this.zeichnen(); }

  oeffnen(vonZeile = null) {
    const st = this.app.stueck;
    if (!st) return;
    if (!st.zeilen.length) { toast('Noch kein Skript.'); return; }
    const opt = st.zeilen.map((z, i) => {
      const t = z.typ === 'szene' ? `■ ${z.text}` : `${z.rolle ? z.rolle + ': ' : ''}${z.text}`;
      return `<option value="${i}">${i + 1} · ${esc(t.slice(0, 60))}</option>`;
    }).join('');
    $('#synVon').innerHTML = opt;
    $('#synBis').innerHTML = opt;
    $('#synVon').value = String(vonZeile ?? 0);
    $('#synBis').value = String(st.zeilen.length - 1);
    this.woerter = [];
    $('#synListe').innerHTML = '';
    $('#synMehr').hidden = true;
    $('#synStatus').textContent = 'Bereich wählen und „Synonyme suchen“ tippen. Schon gespeicherte Synonyme werden mit angezeigt.';
    $('#synAuswahl').hidden = true;
    const dlg = $('#dlgSynonyme');
    dlg.returnValue = '';
    dlg.onclose = () => { if (dlg.returnValue === 'ok') this.speichern(); };
    dlg.showModal();
    woerterbuchLaden().catch(() => {});   // schon mal im Hintergrund laden
  }

  async suchen() {
    const st = this.app.stueck;
    let von = Number($('#synVon').value), bis = Number($('#synBis').value);
    if (bis < von) [von, bis] = [bis, von];
    $('#synStatus').textContent = 'Lade Synonym-Wörterbuch …';
    let wb;
    try { wb = await woerterbuchLaden(); } catch (e) { $('#synStatus').textContent = `⚠ ${e.message}`; return; }
    const gespeichert = synonymeVon(st);
    const map = new Map();
    for (let zi = von; zi <= bis; zi++) {
      if (st.zeilen[zi].gestrichen) continue;
      for (const tk of this.app.ix.tokensProZeile[zi]) {
        for (const w of tk.gesprochen) {
          if (w.length < 3 || STOPP.has(w) || /^\d/.test(w)) continue;
          if (map.has(w)) { map.get(w).anzahl++; continue; }
          const v = vorschlaege(wb, w);
          const alt = gespeichert[w] || [];
          const bekannt = new Set(v.gruppen.flat().map((x) => x.w));
          // nichts vorausgewählt: man entscheidet selbst, welche Bedeutung gemeint ist
          map.set(w, { w, anzahl: 1, zeile: zi, grundform: v.grundform, gruppen: v.gruppen, eigene: alt.filter((s) => !bekannt.has(s)), gewaehlt: new Set(alt) });
        }
      }
    }
    this.woerter = [...map.values()];
    this.sichtbar = SEITE;
    $('#synAuswahl').hidden = false;
    this.zeichnen();
  }

  liste() { return $('#synNurMit').checked ? this.woerter.filter((x) => x.gruppen.length || x.eigene.length) : this.woerter; }

  zaehlen() {
    const mit = this.woerter.filter((x) => x.gruppen.length).length;
    const gew = this.woerter.filter((x) => x.gewaehlt.size).length;
    const syn = this.woerter.reduce((n, x) => n + x.gewaehlt.size, 0);
    $('#synStatus').textContent = `${this.woerter.length} verschiedene Wörter, ${mit} mit Vorschlägen · übernommen: ${syn} Synonyme für ${gew} Wörter`;
  }

  zeichnen() {
    const l = this.liste();
    const teile = [];
    for (const x of l.slice(0, this.sichtbar)) teile.push(this.zeileHtml(x, this.woerter.indexOf(x)));
    $('#synListe').innerHTML = teile.join('') || '<p class="hinweis">Keine passenden Wörter in diesem Bereich.</p>';
    $('#synMehr').hidden = l.length <= this.sichtbar;
    $('#synMehr').textContent = `Weitere ${Math.min(SEITE, l.length - this.sichtbar)} Wörter anzeigen (noch ${l.length - this.sichtbar})`;
    this.zaehlen();
  }

  zeileHtml(x, i) {
    const chip = (v, eigen = false) => `<button type="button" class="syn-chip${x.gewaehlt.has(v.w) ? ' an' : ''}${v.ugs ? ' ugs' : ''}${eigen ? ' eigen' : ''}" data-s="${esc(v.w)}"${v.ugs ? ' title="umgangssprachlich"' : ''}>${esc(v.w)}</button>`;
    const gruppe = (key, ws, html) => {
      const an = ws.filter((w) => x.gewaehlt.has(w)).length;
      return `<div class="syn-gruppe"><button type="button" class="syn-g${an === ws.length ? ' an' : an ? ' teil' : ''}" data-g="${key}" title="ganze Bedeutung an/aus">${an === ws.length ? '✓' : an ? '–' : '＋'}</button>${html}</div>`;
    };
    const gruppen = x.offen ? x.gruppen : x.gruppen.slice(0, GRUPPEN);
    const zeilen = gruppen.map((g) => {
      const gi = x.gruppen.indexOf(g);
      const zeigen = x.offen ? g : g.slice(0, CHIPS);
      return gruppe(gi, g.map((v) => v.w), zeigen.map((v) => chip(v)).join('') + (g.length > zeigen.length ? `<button type="button" class="syn-chip mehr" data-mehr>+ ${g.length - zeigen.length}</button>` : ''));
    });
    if (x.eigene.length) zeilen.push(gruppe('eigen', x.eigene, '<span class="syn-eigen-titel">eigene:</span>' + x.eigene.map((w) => chip({ w }, true)).join('')));
    const rest = x.gruppen.length - gruppen.length;
    const rolle = this.app.stueck.zeilen[x.zeile]?.rolle;
    return `<div class="syn-zeile${x.gewaehlt.size ? ' hat' : ''}" data-i="${i}">
      <div class="syn-wort"><b>${esc(x.w)}</b>
        <small>${x.anzahl}× · Zeile ${x.zeile + 1}${rolle ? ` (${esc(rolle)})` : ''}${x.grundform ? ` · nachgeschlagen als „${esc(x.grundform)}“` : ''}</small>
        ${x.gewaehlt.size ? `<small class="syn-anz">✓ ${x.gewaehlt.size} übernommen <button type="button" data-keine>keine</button></small>` : ''}</div>
      <div class="syn-gruppen">
        ${zeilen.join('') || '<span class="hinweis">keine Vorschläge</span>'}
        ${rest ? `<button type="button" class="syn-chip mehr" data-mehr>+ ${rest} weitere Bedeutungen</button>` : ''}
        <input class="syn-eigen" placeholder="+ eigenes Wort" enterkeyhint="done" autocapitalize="off" autocomplete="off">
      </div>
    </div>`;
  }

  speichern() {
    if (!this.woerter.length) return;
    let n = 0;
    this.app.aendern((st) => {
      const neu = { ...(st.synonyme || {}) };
      for (const x of this.woerter) {
        const reihe = [...x.gruppen.flat().map((v) => v.w), ...x.eigene].filter((w) => x.gewaehlt.has(w));
        if (reihe.length) { neu[x.w] = reihe; n += reihe.length; } else delete neu[x.w];
      }
      st.synonyme = neu;
    });
    toast(`Synonyme gespeichert: ${n} für ${this.woerter.filter((x) => x.gewaehlt.size).length} Wörter.`);
  }
}
