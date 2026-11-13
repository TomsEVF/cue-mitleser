// Zeitplan der Vorstellung: Ereignisse nach der Uhr statt nach dem Text –
// Gongs vor Beginn, Pausen mit Pausengongs, Ansagen usw.
//
// stueck.zeitplan = {
//   beginn: '19:30',                                    // geplanter Vorstellungsbeginn
//   pausen: [{ id, name, dauer /* min */, startCue }],   // startCue: Pause beginnt automatisch mit diesem Cue
//   ereignisse: [{ id, typ, nummer, bezeichnung, notiz, bezug, minuten, vorlauf /* s */ }],
// }
// bezug: 'beginn' | 'pstart:<pausenId>' | 'pende:<pausenId>',  minuten: negativ = vorher, positiv = nachher
import * as S from './skript.js';
import { toast } from './hilfen.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function zeitplanVon(st) {
  const z = st?.zeitplan || {};
  return { beginn: z.beginn || '', pausen: z.pausen || [], ereignisse: z.ereignisse || [] };
}

export function bezugText(bezug, zp) {
  if (bezug === 'beginn') return 'Vorstellungsbeginn';
  const [art, pid] = String(bezug).split(':');
  const p = zp.pausen.find((x) => x.id === pid);
  return `${art === 'pstart' ? 'Beginn' : 'Ende'} ${p?.name || 'Pause'}`;
}

// „7“ → 7 Minuten, „1:30“ → 1,5 Minuten
function minutenLesen(t) {
  const s = String(t ?? '').trim().replace(',', '.');
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}
function minutenText(min) {
  const a = Math.abs(min);
  if (Number.isInteger(a)) return String(a);
  return `${Math.floor(a)}:${String(Math.round((a % 1) * 60)).padStart(2, '0')}`;
}

export function wannText(e, zp) {
  const ref = bezugText(e.bezug, zp);
  if (!e.minuten) return `bei ${ref}`;
  return `${minutenText(e.minuten)} min ${e.minuten < 0 ? 'vor' : 'nach'} ${ref}`;
}

export function dauerText(ms) {
  const neg = ms < 0;
  let s = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const t = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return neg ? `−${t}` : t;
}
const uhr = (ms, sek = false) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', ...(sek ? { second: '2-digit' } : {}) });

// ======================================================================== Bearbeiten-Dialog
export class ZeitplanDialog {
  constructor(app) {
    this.app = app;
    $('#zpPauseNeu').addEventListener('click', () => { this.leer(); this.z.pausen.push({ id: S.neueId('p'), name: `Pause ${this.z.pausen.length + 1}`, dauer: 20, startCue: '' }); this.zeichnen(); });
    $('#zpNeu').addEventListener('click', () => { this.z.ereignisse.push(this.neuesEreignis({})); this.zeichnen(); });
    $('#zpGongs').addEventListener('click', () => {
      [[-7, '1. Gong'], [-5, '2. Gong'], [-2, '3. Gong']].forEach(([m, b]) => this.z.ereignisse.push(this.neuesEreignis({ typ: 'SND', bezeichnung: b, minuten: m, bezug: 'beginn' })));
      this.zeichnen();
    });
    $('#zpPausenGongs').addEventListener('click', () => {
      if (!this.z.pausen.length) this.z.pausen.push({ id: S.neueId('p'), name: 'Pause', dauer: 20, startCue: '' });
      const p = this.z.pausen[this.z.pausen.length - 1];
      [[-5, '1. Pausengong'], [-3, '2. Pausengong'], [-1, '3. Pausengong']].forEach(([m, b]) => this.z.ereignisse.push(this.neuesEreignis({ typ: 'SND', bezeichnung: b, minuten: m, bezug: `pende:${p.id}` })));
      this.zeichnen();
    });
    const f = $('#zpForm');
    f.addEventListener('input', (e) => this.feld(e.target));
    f.addEventListener('change', (e) => this.feld(e.target));
    f.addEventListener('click', (e) => {
      const weg = e.target.closest('[data-weg]');
      if (!weg) return;
      const [liste, i] = weg.dataset.weg.split(':');
      if (liste === 'pausen') {
        const pid = this.z.pausen[i].id;
        this.z.ereignisse = this.z.ereignisse.filter((x) => !x.bezug.endsWith(`:${pid}`));
      }
      this.z[liste].splice(Number(i), 1);
      this.zeichnen();
    });
  }

  leer() { this.z ||= { beginn: '', pausen: [], ereignisse: [] }; }

  neuesEreignis(v) {
    return { id: S.neueId('t'), typ: 'SND', nummer: '', bezeichnung: '', notiz: '', bezug: 'beginn', minuten: -5, vorlauf: 30, ...v };
  }

  oeffnen() {
    if (!this.app.stueck) return;
    this.z = JSON.parse(JSON.stringify(zeitplanVon(this.app.stueck)));
    $('#zpBeginn').value = this.z.beginn;
    this.zeichnen();
    const dlg = $('#dlgZeitplan');
    dlg.returnValue = '';
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      this.z.beginn = $('#zpBeginn').value;
      const neu = this.z;
      this.app.aendern((st) => { st.zeitplan = neu; }, { render: false });
      toast(`Zeitplan gespeichert: ${neu.ereignisse.length} Ereignisse, ${neu.pausen.length} Pausen.`);
    };
    dlg.showModal();
  }

  feld(el) {
    const zeile = el.closest('[data-liste]');
    if (!zeile || !el.dataset.f) return;
    const obj = this.z[zeile.dataset.liste][Number(zeile.dataset.i)];
    const f = el.dataset.f;
    if (f === 'min' || f === 'richtung') {
      const min = minutenLesen(zeile.querySelector('[data-f=min]').value);
      obj.minuten = zeile.querySelector('[data-f=richtung]').value === 'vor' ? -min : min;
    } else if (f === 'dauer' || f === 'vorlauf') {
      obj[f] = Math.max(0, Number(String(el.value).replace(',', '.')) || 0);
    } else {
      obj[f] = el.value;
      if (f === 'name' && el.type !== 'hidden') this.bezuegeAktualisieren();
    }
  }

  bezugOptionen(wert) {
    const opt = [['beginn', 'Vorstellungsbeginn'], ...this.z.pausen.flatMap((p) => [[`pstart:${p.id}`, `Beginn ${p.name}`], [`pende:${p.id}`, `Ende ${p.name}`]])];
    return opt.map(([v, t]) => `<option value="${v}" ${v === wert ? 'selected' : ''}>${esc(t)}</option>`).join('');
  }

  bezuegeAktualisieren() {
    document.querySelectorAll('#zpEreignisse [data-f=bezug]').forEach((sel) => { const v = sel.value; sel.innerHTML = this.bezugOptionen(v); });
  }

  zeichnen() {
    const cues = this.app.ix?.reihenfolge.filter((c) => !c.istEnde) || [];
    $('#zpPausen').innerHTML = this.z.pausen.map((p, i) => `<div class="zp-zeile" data-liste="pausen" data-i="${i}">
      <input data-f="name" value="${esc(p.name)}" placeholder="Pause 1" size="10">
      <input data-f="dauer" type="number" min="0" step="any" value="${esc(p.dauer)}" style="width:5em"> <span>min</span>
      <label class="zp-klein">beginnt
        <select data-f="startCue"><option value="">wenn ich „Pause starten“ tippe</option>
          ${cues.map((c) => `<option value="${c.id}" ${c.id === p.startCue ? 'selected' : ''}>automatisch mit ${esc(S.cueLabel(c))} ${esc(c.bezeichnung || '')}</option>`).join('')}
        </select></label>
      <button type="button" data-weg="pausen:${i}" title="Pause löschen">✕</button>
    </div>`).join('') || '<p class="hinweis">Keine Pausen.</p>';
    $('#zpEreignisse').innerHTML = this.z.ereignisse.map((e, i) => `<div class="zp-zeile" data-liste="ereignisse" data-i="${i}">
      <select data-f="typ" class="zp-typ">${S.TYPEN.map((t) => `<option value="${t}" ${t === e.typ ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input data-f="nummer" value="${esc(e.nummer)}" placeholder="Nr" size="3">
      <input data-f="bezeichnung" value="${esc(e.bezeichnung)}" placeholder="z. B. 1. Gong, Ansage Handys aus" class="zp-breit">
      <input data-f="min" value="${esc(minutenText(e.minuten || 0))}" size="4" inputmode="decimal" title="Minuten, auch 1:30"> <span>min</span>
      <select data-f="richtung"><option value="vor" ${e.minuten < 0 ? 'selected' : ''}>vor</option><option value="nach" ${e.minuten >= 0 ? 'selected' : ''}>nach</option></select>
      <select data-f="bezug">${this.bezugOptionen(e.bezug)}</select>
      <input data-f="notiz" value="${esc(e.notiz)}" placeholder="Notiz" class="zp-breit">
      <label class="zp-klein">Standby <input data-f="vorlauf" type="number" min="0" step="any" value="${esc(e.vorlauf ?? 30)}" style="width:4.5em"> s vorher</label>
      <button type="button" data-weg="ereignisse:${i}" title="Ereignis löschen">✕</button>
    </div>`).join('') || '<p class="hinweis">Noch keine Zeit-Ereignisse. Z. B. „＋ Gongs vor Beginn“.</p>';
  }
}

// ======================================================================== Ablauf in Probe/Show
export class ZeitplanLauf {
  constructor(lauf) {
    this.l = lauf;
    this.zuruecksetzen();
  }

  zuruecksetzen() {
    this.beginnIst = null;      // verschobener/tatsächlicher Beginn (ms), sonst geplante Uhrzeit
    this.pausen = {};           // pausenId → {start, extra (s)}
    this.erledigt = new Set();
    this.goZeit = new Map();
    this.stufen = new Map();
  }

  get zp() { return zeitplanVon(this.l.st); }
  aktiv() { const z = this.zp; return !!(z.beginn || z.ereignisse.length || z.pausen.length); }

  laden(d) {
    if (!d) return;
    this.beginnIst = d.beginnIst ?? null;
    this.pausen = d.pausen || {};
    this.erledigt = new Set(d.erledigt || []);
  }
  zustand() { return { beginnIst: this.beginnIst, pausen: this.pausen, erledigt: [...this.erledigt] }; }

  beginnZeit() {
    if (this.beginnIst) return this.beginnIst;
    if (!this.zp.beginn) return null;
    const [h, m] = this.zp.beginn.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  pauseEnde(p) {
    const z = this.pausen[p.id];
    return z?.start ? z.start + ((Number(p.dauer) || 0) * 60 + (z.extra || 0)) * 1000 : null;
  }

  referenz(bezug) {
    if (bezug === 'beginn') return this.beginnZeit();
    const [art, pid] = String(bezug).split(':');
    const p = this.zp.pausen.find((x) => x.id === pid);
    if (!p) return null;
    return art === 'pstart' ? (this.pausen[pid]?.start ?? null) : this.pauseEnde(p);
  }

  zeitVon(e) {
    const r = this.referenz(e.bezug);
    return r == null ? null : r + (Number(e.minuten) || 0) * 60000;
  }

  stufe(e, jetzt) {
    if (this.erledigt.has(e.id)) return 'erledigt';
    if (this.goZeit.has(e.id)) return 'go';
    const t = this.zeitVon(e);
    if (t == null) return 'offen';
    if (jetzt >= t) return 'go';
    if (jetzt >= t - (Number(e.vorlauf ?? 30)) * 1000) return 'warnung';
    return 'wartet';
  }

  // Ereignisse, die schon länger vorbei sind (App später geöffnet, Beginn verschoben …), nicht nachholen
  vergangeneErledigen(toleranzMs) {
    const jetzt = Date.now();
    for (const e of this.zp.ereignisse) {
      const t = this.zeitVon(e);
      if (t != null && t < jetzt - toleranzMs && !this.goZeit.has(e.id)) this.erledigt.add(e.id);
    }
  }

  // jede Viertelsekunde: Stufenwechsel → Ton/Blitz; gibt true zurück, wenn neu gezeichnet werden muss
  tick() {
    if (!this.aktiv()) return false;
    const jetzt = Date.now();
    let geaendert = false;
    const neuGo = [];
    for (const e of this.zp.ereignisse) {
      const s = this.stufe(e, jetzt);
      const alt = this.stufen.get(e.id) || 'wartet';
      if (s === alt) continue;
      this.stufen.set(e.id, s);
      geaendert = true;
      if (s === 'warnung') { this.l.ton('warnung'); this.l.probe?.cues.push({ t: jetzt, ids: [e.id], stufe: 'zeit-warnung' }); }
      if (s === 'go' && !this.goZeit.has(e.id)) { this.goZeit.set(e.id, jetzt); neuGo.push(e); }
    }
    if (neuGo.length > 2) {
      const weg = neuGo.slice(0, -1);
      weg.forEach((e) => this.erledigt.add(e.id));
      toast(`${weg.length} Zeit-Ereignisse übersprungen.`, 4000);
      neuGo.splice(0, neuGo.length - 1);
    }
    for (const e of neuGo) {
      this.l.ton('go');
      this.l.blitz(e.typ);
      this.l.probe?.cues.push({ t: jetzt, ids: [e.id], stufe: 'zeit-go' });
    }
    const sek = Number(this.l.e.goAutoErledigt) || 0;
    if (sek) {
      for (const [id, t] of this.goZeit) {
        if (!this.erledigt.has(id) && jetzt - t > sek * 1000) { this.erledigt.add(id); geaendert = true; }
      }
    }
    if (geaendert) this.l.zustandSpeichern();
    return geaendert;
  }

  // „Erledigt“: ältestes Zeit-Ereignis im GO quittieren
  quittieren() {
    const offen = [...this.goZeit].filter(([id]) => !this.erledigt.has(id)).sort((a, b) => a[1] - b[1]);
    if (!offen.length) return false;
    this.erledigt.add(offen[0][0]);
    this.l.zustandSpeichern();
    return true;
  }

  // Ein Cue wurde ausgelöst → evtl. startet damit eine Pause
  cueAusgeloest(cueId) {
    for (const p of this.zp.pausen) if (p.startCue && p.startCue === cueId && !this.pausen[p.id]?.start) this.pauseStarten(p.id);
  }

  pauseStarten(pid) {
    const p = this.zp.pausen.find((x) => x.id === pid);
    if (!p) return;
    this.pausen[pid] = { start: Date.now(), extra: 0 };
    toast(`${p.name} läuft – ${p.dauer} min.`, 3000);
    this.l.zustandSpeichern();
  }

  aktion(name, arg) {
    const jetzt = Date.now();
    if (name === 'beginnJetzt') { this.beginnIst = jetzt; this.vergangeneErledigen(5000); toast('Vorstellungsbeginn: jetzt.'); }
    else if (name === 'beginnPlus') { this.beginnIst = (this.beginnZeit() ?? jetzt) + Number(arg) * 60000; this.goZeitAufraeumen(); }
    else if (name === 'pauseStart') this.pauseStarten(arg);
    else if (name === 'pauseExtra') { const z = this.pausen[arg]; if (z) z.extra = (z.extra || 0) + 60; this.goZeitAufraeumen(); }
    else if (name === 'pauseEnde') {
      const p = this.zp.pausen.find((x) => x.id === arg), z = this.pausen[arg];
      if (p && z) { z.extra = (jetzt - z.start) / 1000 - (Number(p.dauer) || 0) * 60; this.vergangeneErledigen(5000); }
    } else if (name === 'zuruecksetzen') { this.zuruecksetzen(); toast('Zeitplan zurückgesetzt.'); }
    this.l.zustandSpeichern();
  }

  // Zeit nach hinten geschoben: noch nicht quittierte GO/Standby-Ereignisse, die jetzt in der Zukunft liegen, wieder öffnen
  goZeitAufraeumen() {
    const jetzt = Date.now();
    for (const e of this.zp.ereignisse) {
      const t = this.zeitVon(e);
      if (t != null && t > jetzt && !this.erledigt.has(e.id)) { this.goZeit.delete(e.id); this.stufen.delete(e.id); }
    }
  }

  // ---- Anzeige
  kartenHtml() {
    if (!this.aktiv()) return '';
    const jetzt = Date.now();
    const zp = this.zp;
    return zp.ereignisse
      .map((e) => ({ e, s: this.stufe(e, jetzt), t: this.zeitVon(e) }))
      .filter((x) => x.s === 'warnung' || x.s === 'go')
      .sort((a, b) => a.t - b.t)
      .map(({ e, s, t }) => {
        const label = `${e.typ}${e.nummer ? ` ${e.nummer}` : ''}`;
        return `<div class="cue-karte typ-${e.typ} ${s} zeit-karte">
          <div class="stufe">⏱ ${s === 'go' ? 'GO' : 'STANDBY'} · ${uhr(t)} · ${esc(wannText(e, zp))}</div>
          <div class="titel">${s === 'go' ? 'GO' : 'Standby'} ${esc(label)}</div>
          ${e.bezeichnung ? `<div class="bez">${esc(e.bezeichnung)}</div>` : ''}
          ${e.notiz ? `<div class="notiz">${esc(e.notiz)}</div>` : ''}
          ${s === 'warnung' ? `<div class="rest">${dauerText(t - jetzt)}<small>bis GO</small></div>` : ''}
        </div>`;
      }).join('');
  }

  leisteHtml() {
    if (!this.aktiv()) return '';
    const jetzt = Date.now();
    const zp = this.zp;
    const teile = [`<span class="zl-uhr">${uhr(jetzt, true)}</span>`];
    const beginn = this.beginnZeit();
    if (beginn != null) {
      if (jetzt < beginn) {
        teile.push(`<span class="zl-block"><b>Beginn ${uhr(beginn)}</b> · in ${dauerText(beginn - jetzt)}
          <button data-zeit="beginnJetzt">Beginn jetzt</button><button data-zeit="beginnPlus" data-arg="-1">−1</button><button data-zeit="beginnPlus" data-arg="1">+1</button><button data-zeit="beginnPlus" data-arg="5">+5 min</button></span>`);
      } else {
        teile.push(`<span class="zl-block">Vorstellung seit ${dauerText(jetzt - beginn)}</span>`);
      }
    }
    // laufende oder nächste Pause
    for (const p of zp.pausen) {
      const z = this.pausen[p.id];
      const ende = this.pauseEnde(p);
      if (z?.start && ende > jetzt) {
        teile.push(`<span class="zl-block zl-pause">⏸ <b>${esc(p.name)}</b> · Ende ${uhr(ende)} (in ${dauerText(ende - jetzt)})
          <button data-zeit="pauseExtra" data-arg="${p.id}">+1 min</button><button data-zeit="pauseEnde" data-arg="${p.id}">Pause beenden</button></span>`);
        break;
      }
      if (!z?.start) {
        teile.push(`<span class="zl-block"><button data-zeit="pauseStart" data-arg="${p.id}">⏸ ${esc(p.name)} starten (${p.dauer} min)</button></span>`);
        break;
      }
    }
    // nächstes Ereignis
    const naechstes = zp.ereignisse
      .map((e) => ({ e, s: this.stufe(e, jetzt), t: this.zeitVon(e) }))
      .filter((x) => x.s === 'wartet' && x.t != null)
      .sort((a, b) => a.t - b.t)[0];
    if (naechstes) {
      const { e, t } = naechstes;
      teile.push(`<span class="zl-block zl-naechstes typ-${e.typ}">Nächstes: <b>${esc(`${e.typ}${e.nummer ? ` ${e.nummer}` : ''}`)}</b> ${esc(e.bezeichnung || '')} · ${uhr(t)} (in ${dauerText(t - jetzt)})</span>`);
    } else if (zp.ereignisse.some((e) => this.stufe(e, jetzt) === 'offen')) {
      teile.push('<span class="zl-block zl-naechstes">Weitere Ereignisse folgen nach Pausenbeginn</span>');
    }
    return teile.join('');
  }
}
