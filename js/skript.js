// Skript-Datenmodell: Import, Zerlegung in Wörter, "sprechbare" Wortliste, Cue-Auflösung.
import { zahlWort } from './zahlen.js';

export const TYPEN = ['LX', 'SND', 'VID', 'BT', 'INFO'];
export const TYP_NAME = { LX: 'Licht', SND: 'Ton', VID: 'Video', BT: 'Bühne', INFO: 'Ansage/Info' };

export const STANDARD_FUELLWOERTER = ['äh', 'ähm', 'öh', 'öhm', 'hm', 'hmm', 'mhm', 'ah', 'eh', 'em', 'ehm', 'na'];

export const STANDARD_EINSTELLUNGEN = {
  schwelle: 70,        // Ähnlichkeit 0–100 für einen Treffer
  fehlFolge: 3,        // so viele Fehlwörter in Folge → Sprungsuche
  fenster: 8,          // Wörter, die bei der Sprungsuche als Gruppe verglichen werden
  luecke: 4,           // so viele Skriptwörter darf ein Wort überspringen
  suchbereich: 300,    // ± Wörter um die aktuelle Position
  sprungSicherheit: 60,       // % der Fensterwörter, die bei einem Sprung nach vorn passen müssen
  rueckSprungSicherheit: 90,  // % bei Sprung zurück (fast nie)
  bereitWoerter: 3,    // "Bereit" so viele Wörter vor dem Stichwort
  vorlauf: 20,         // Standard-Vorlauf neuer Cues
  goAutoErledigt: 6,   // Sekunden, nach denen ein GO automatisch erledigt ist (0 = nur Leertaste)
  toene: false,        // leise Töne bei Warnung/Bereit/Go
  vokabularBeschraenken: false,
  fuellwoerter: STANDARD_FUELLWOERTER.join(', '),
};

let zaehler = Date.now() % 100000;
export const neueId = (p) => `${p}-${(zaehler++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function neuesStueck(name) {
  return { version: 1, name, zeilen: [], cues: [], einstellungen: { ...STANDARD_EINSTELLUNGEN } };
}

export function einstellungen(stueck) {
  return { ...STANDARD_EINSTELLUNGEN, ...(stueck.einstellungen || {}) };
}

// ------------------------------------------------------------------ Import

const MARKER_RE = /\[\s*(LX|LICHT|SND|TON|SOUND|VID|VIDEO|BT|BÜHNE|BUEHNE|BÜHNENTECHNIK|BUEHNENTECHNIK|INFO|ANSAGE)\s*([0-9]+(?:[.,][0-9]+)?[a-z]?)?\s*([^\]]*)\]/gi;
const TYP_ALIAS = {
  LX: 'LX', LICHT: 'LX', SND: 'SND', TON: 'SND', SOUND: 'SND', VID: 'VID', VIDEO: 'VID',
  BT: 'BT', 'BÜHNE': 'BT', BUEHNE: 'BT', 'BÜHNENTECHNIK': 'BT', BUEHNENTECHNIK: 'BT', INFO: 'INFO', ANSAGE: 'INFO',
};
function markerZuCue(m, vorlauf) {
  const typ = TYP_ALIAS[m[1].toUpperCase()];
  let bez = (m[3] || '').trim();
  let ausloeser = 'wort', einsatz = '';
  // „manuell“ oder „manuell: nach dem Applaus“ → Cue ohne Stichwort, Text danach = Einsatz
  const mm = bez.match(/\s*\bmanuell\b\s*(?::\s*(.*))?$/i);
  if (mm) { ausloeser = 'manuell'; einsatz = (mm[1] || '').trim(); bez = bez.slice(0, mm.index).trim(); }
  return {
    id: neueId('c'), typ, nummer: (m[2] || '').replace(',', '.'), bezeichnung: bez,
    vorlauf, notiz: '', ausloeser, einsatz, dauer: null,
  };
}

// Entfernt Cue-Marker aus einem Text. Liefert sauberen Text und für jeden Marker
// den Index des folgenden Worts (oder null, wenn kein Wort mehr folgt).
export function markerExtrahieren(text, vorlauf = STANDARD_EINSTELLUNGEN.vorlauf) {
  const gefunden = [];
  let sauber = '';
  let letzte = 0;
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(text))) {
    sauber += text.slice(letzte, m.index);
    letzte = m.index + m[0].length;
    gefunden.push({ cue: markerZuCue(m, vorlauf), vorWoertern: woerterIn(sauber).length });
  }
  sauber += text.slice(letzte);
  sauber = sauber.replace(/[ \t]{2,}/g, ' ').trim();
  const anzahl = woerterIn(sauber).length;
  return {
    text: sauber,
    marker: gefunden.map((g) => ({ cue: g.cue, wort: g.vorWoertern < anzahl ? g.vorWoertern : null })),
  };
}

// ------------------------------------------------------------------ Textbuch-Import
//
// Zwei Formate werden erkannt:
//  * Zeilenformat:   ANNA: Text …            (Rolle mit Doppelpunkt in derselben Zeile)
//  * Textbuchformat: ANNA                    (Rolle in Großbuchstaben allein auf einer Zeile,
//                    Text über mehrere Zeilen umbrochen, Regie in Klammern, Seitenzahlen dazwischen)
// Regiehinweise wie „-Musik aus.“, „-Es klingelt“, „BLACK“ oder „(-Läuten.)“ werden auf Wunsch zu Cues.
// Solche Cues kommen nach dem zuletzt gesprochenen Wort (GO auf dieses Wort). Marker wie [LX 12]
// sitzen dagegen am folgenden Wort.

const SZENE_RE = /^(#+\s*|((\d+|[IVXLC]+)\.?\s*)?(szene|akt|aufzug|bild|auftritt|teil|prolog|epilog)\b|(erster|zweiter|dritter|vierter|fünfter|sechster|siebter|achter|neunter|zehnter|letzter)\s+(akt|aufzug|teil|bild|szene|auftritt)\b)/i;
const PERSONEN_RE = /^(personen|figuren|rollen|personenverzeichnis|besetzung|dramatis personae)\s*:?$/i;
const ROLLE_RE = /^([A-ZÄÖÜ][A-ZÄÖÜß0-9 .'\-]{0,30}|[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?)\s*(\([^)]*\))?\s*:\s*(.*)$/;
const NUR_ROLLE_RE = /^[A-ZÄÖÜ][A-ZÄÖÜß'\/&\- ]{0,40}[A-ZÄÖÜß]$/;
const KEINE_ROLLE = new Set(['BLACK', 'BLACKOUT', 'ENDE', 'PAUSE', 'VORHANG', 'MUSIK', 'LICHT', 'STRICH', 'FREEZE', 'OFF', 'DUNKEL', 'SPOT', 'TON']);
const CUE_ZEILE_RE = /^([-–]\s*[A-Za-zÄÖÜäöü]|black(out)?\b)/i;
const SEITENZAHL_RE = /^(seite\s*)?\d{1,4}(\s*\/\s*\d{1,4})?$/i;
const PLATZ_RE = /⟦(\d+)⟧/g;
const CUE_WORT = 'klingel\\w*|läut\\w*|musik\\w*|ton|töne|o-?h?-?ton\\w*|black(?:out)?|bell\\w*|hundebellen|röchel\\w*|reel|video|licht|einspieler|geräusch\\w*|sound|alarm';
const INLINE_CUE_RE = new RegExp(`(^|[\\s(,;])[-–]\\s?((?:[^\\s,.;:!?()\\-–⟦]+\\s+){0,3}?(?:${CUE_WORT})(?![a-zäöüß])(?:\\s+(?:ein|aus|an|ab|stoppen|weg|los))?)`, 'giu');

const ohnePlatz = (t) => t.replace(PLATZ_RE, '').trim();
const istRollenZeile = (t) => {
  t = ohnePlatz(t);
  return t.length <= 42 && NUR_ROLLE_RE.test(t) && /[A-ZÄÖÜ]{2}/.test(t) && !KEINE_ROLLE.has(t.toUpperCase());
};
const istCueZeile = (t) => { t = ohnePlatz(t); return t.length < 90 && CUE_ZEILE_RE.test(t); };
const istSzene = (t) => { t = ohnePlatz(t); return t.length < 140 && SZENE_RE.test(t) && !ROLLE_RE.test(t); };
const tiefeNach = (t, d = 0) => { for (const ch of t) { if (ch === '(') d++; else if (ch === ')' && d > 0) d--; } return d; };

export function cueTypen(text) {
  const t = [];
  if (/\b(black(out)?|licht|spot|dimm\w*|lx)\b/i.test(text)) t.push('LX');
  if (/(musik|\bton\b|töne|sound|klingel|läut|bell|röchel|geräusch|alarm|einspieler|\bsnd\b)/i.test(text)) t.push('SND');
  if (/\b(reel|video|film|projektion|beamer|vid)\b/i.test(text)) t.push('VID');
  if (/(vorhang|versenkung|drehbühne|drehscheibe|hubpodium|podium|prospekt|schleier|umbau|bühnenbild|kulisse|zug\s*\d)/i.test(text)) t.push('BT');
  if (/(ansage|durchsage|einlass)/i.test(text)) t.push('INFO');
  return t.length ? t : ['SND'];
}

function cueBezeichnung(text) {
  let t = text.replace(/⟦\d+⟧/g, '').replace(/^[-–\s(]+/, '').replace(/[.\s)]+$/, '').replace(/\s+/g, ' ').trim();
  if (t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t.slice(0, 60);
}

// Umbrochene Zeilen wieder zusammensetzen (Silbentrennung „Welt-“ + „KI“ bleibt als Bindestrich)
function verbinden(teile) {
  let s = '';
  for (const t of teile) {
    if (!s) s = t;
    else if (/[A-Za-zÄÖÜäöüß]-$/.test(s) && /^[A-Za-zÄÖÜäöü]/.test(t)) s += t;
    else s += ' ' + t;
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

// Lange Reden in Abschnitte von ein paar Sätzen teilen (nie innerhalb von Klammern)
function inAbschnitte(text, maxLen = 160) {
  const teile = [];
  let tiefe = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') tiefe++;
    else if (ch === ')' && tiefe > 0) tiefe--;
    if (ch === ' ' && tiefe === 0 && i - start >= maxLen && /[.!?…][)»“"']?$/.test(text.slice(Math.max(0, i - 3), i))) {
      teile.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  teile.push(text.slice(start).trim());
  return teile.filter(Boolean);
}

// „Strich“-Markierungen im Text (z. B. „…gesagt. Strich Und dann…“) nicht mitlesen
function strichMarkieren(text, rolle, bericht) {
  const tk = text.split(' ');
  for (let i = 0; i < tk.length; i++) {
    const roh = tk[i];
    const vorne = (roh.match(/^[.…]+/) || [''])[0];
    const kern = roh.slice(vorne.length).replace(/[.,!?…]+$/, '');
    if (!/^strich$/i.test(kern)) continue;
    if (kern === 'STRICH' || i === 0 || i === tk.length - 1 || vorne || /[.!?…]$/.test(tk[i - 1])) {
      tk[i] = `${vorne}(Strich)`;
      const umfeld = tk.slice(Math.max(0, i - 5), i + 6).join(' ').replace(/⟦\d+⟧\s?/g, '');
      bericht.strich.push(`${rolle || 'Regie'}: „… ${umfeld} …“`);
    }
  }
  return tk.join(' ');
}

// ---- Zeilen → Blöcke
function bloeckeTextbuch(zs) {
  const bloecke = [];
  let block = null, rolle = '', tiefe = 0, inKlammer = 0, personen = false;
  const fertig = () => {
    if (block && block.teile.length) bloecke.push({ art: block.art, rolle: block.rolle, text: verbinden(block.teile) });
    block = null;
  };
  for (let i = 0; i < zs.length; i++) {
    let t = zs[i];
    if (tiefe > 0 && block) {                         // mehrzeilige Klammer läuft weiter
      block.teile.push(t);
      tiefe = tiefeNach(t, tiefe);
      if (++inKlammer > 15) tiefe = 0;
      if (tiefe === 0 && block.fuerSich) fertig();
      continue;
    }
    tiefe = 0;
    if (PERSONEN_RE.test(t)) { fertig(); bloecke.push({ art: 'szene', text: t }); personen = true; rolle = ''; continue; }
    if (istSzene(t)) {
      fertig(); personen = false; rolle = '';
      while (/\s[-–]$/.test(t) && i + 1 < zs.length) t += ' ' + zs[++i];   // „Erster Akt -O-Ton … -“ + nächste Zeile
      bloecke.push({ art: 'szene', text: t });
      continue;
    }
    if (personen) {                                    // Personenverzeichnis: nicht mitlesen
      if (!block || /^[^:()]{2,40}:/.test(t)) { fertig(); block = { art: 'regie', rolle: '', teile: [] }; }
      block.teile.push(t);
      continue;
    }
    if (istCueZeile(t)) {
      fertig();
      bloecke.push({ art: 'cue', text: t });
      if (/^black/i.test(ohnePlatz(t))) rolle = '';
      continue;
    }
    if (istRollenZeile(t)) {
      fertig();
      rolle = ohnePlatz(t).replace(/\s+/g, ' ');
      block = { art: 'rede', rolle, teile: [] };
      const platz = t.match(PLATZ_RE);
      if (platz) block.teile.push(platz.join(' '));
      continue;
    }
    if (t.startsWith('(')) {
      // Steht die Klammer für sich (danach Rolle, Cue, Überschrift) oder gehört sie in die Rede?
      let d = 0, j = i;
      for (; j < zs.length && j < i + 16; j++) { d = tiefeNach(zs[j], d); if (d === 0) break; }
      const danach = zs[j + 1];
      const rest = (zs[j] || '').slice((zs[j] || '').lastIndexOf(')') + 1).trim();
      const redeOffen = block && block.art === 'rede';
      const fuerSich = !redeOffen || (!rest && (!danach || istRollenZeile(danach) || istCueZeile(danach) || istSzene(danach) || danach.startsWith('(')));
      if (fuerSich) { fertig(); block = { art: 'regie', rolle: '', teile: [], fuerSich: true }; }
      block.teile.push(t);
      tiefe = tiefeNach(t);
      inKlammer = 0;
      if (tiefe === 0 && block.fuerSich) fertig();
      continue;
    }
    if (!block) block = rolle ? { art: 'rede', rolle, teile: [] } : { art: 'regie', rolle: '', teile: [] };
    block.teile.push(t);
    tiefe = tiefeNach(t);
    inKlammer = 0;
  }
  fertig();
  return bloecke;
}

function bloeckeZeilenweise(zs) {
  const bloecke = [];
  let blockRolle = '', personen = false;
  for (const t of zs) {
    if (!t) { blockRolle = ''; continue; }
    const o = ohnePlatz(t);
    if (!o) { bloecke.push({ art: 'rede', rolle: '', text: t }); continue; }       // nur Marker
    if (PERSONEN_RE.test(o)) { bloecke.push({ art: 'szene', text: t }); personen = true; continue; }
    if (istSzene(t)) { blockRolle = ''; personen = false; bloecke.push({ art: 'szene', text: t.replace(/^#+\s*/, '') }); continue; }
    if (personen) { bloecke.push({ art: 'regie', rolle: '', text: t }); continue; }
    if (istCueZeile(t)) { bloecke.push({ art: 'cue', text: t }); continue; }
    if (/^[(\[].*[)\]]$/.test(o)) { bloecke.push({ art: 'regie', rolle: '', text: t }); continue; }
    const r = t.match(ROLLE_RE);
    if (r) {
      const rolle = r[1].trim().toUpperCase();
      const rest = ((r[2] ? r[2] + ' ' : '') + r[3]).trim();
      if (!ohnePlatz(rest)) { blockRolle = rolle; if (rest) bloecke.push({ art: 'rede', rolle: '', text: rest }); continue; }
      blockRolle = '';
      bloecke.push({ art: 'rede', rolle, text: rest });
      continue;
    }
    if (istRollenZeile(t)) { blockRolle = o; continue; }
    bloecke.push({ art: 'rede', rolle: blockRolle, text: t });
  }
  return bloecke;
}

// Cues ausdrücklich gleichzeitig machen (gemeinsame Gruppe)
function gemeinsam(cues) {
  if (cues.length > 1) { const g = neueId('g'); for (const c of cues) c.gruppe = g; }
  return cues;
}

export function textImportieren(roh, einst = STANDARD_EINSTELLUNGEN, { hinweisCues = true } = {}) {
  const vorlauf = einst.vorlauf ?? STANDARD_EINSTELLUNGEN.vorlauf;
  const platz = [];                                   // Platzhalter ⟦n⟧ → {art: 'nach'|'vor', cues}
  const bericht = { strich: [], auto: 0, manuell: 0, marker: 0 };

  // [LX 12 …]-Marker → Platzhalter (Cue am folgenden Wort)
  let text = roh.replace(/\r\n?/g, '\n').replace(/[ \t]/g, ' ');
  text = text.replace(MARKER_RE, (...m) => {
    platz.push({ art: 'nach', cues: [markerZuCue(m, vorlauf)] });
    bericht.marker++;
    return ` ⟦${platz.length - 1}⟧ `;
  });
  const alle = text.split('\n').map((z) => z.replace(/\s+/g, ' ').trim());

  // Format erkennen
  let nurRolle = 0, mitDoppelpunkt = 0;
  for (const t of alle) { if (istRollenZeile(t)) nurRolle++; else if (ROLLE_RE.test(t)) mitDoppelpunkt++; }
  const textbuch = nurRolle >= 3 && nurRolle >= mitDoppelpunkt * 0.5;
  const bloecke = textbuch
    ? bloeckeTextbuch(alle.filter((t) => t && !SEITENZAHL_RE.test(t) && /[A-Za-zÄÖÜäöüß0-9⟦]/.test(t)))
    : bloeckeZeilenweise(alle.map((t) => (SEITENZAHL_RE.test(t) ? '' : t)));

  // ---- Blöcke → Zeilen und Cues
  const zeilen = [], cues = [];
  let offen = [];                // Cues für das nächste gesprochene Wort
  let letztesWort = null;        // {zeile, wort}
  let cueSeitWort = false;       // seit dem letzten gesprochenen Wort schon ein Hinweis-Cue?
  const zaehler = Object.fromEntries(TYPEN.map((x) => [x, 0]));
  const neueCues = (t, manuell) => gemeinsam(cueTypen(t).map((typ) => ({
    id: neueId('c'), typ, nummer: String(++zaehler[typ]), bezeichnung: cueBezeichnung(t),
    vorlauf, notiz: '', ausloeser: manuell ? 'manuell' : 'wort',
  })));
  const zaehlen = (liste) => { for (const c of liste) { bericht.auto++; if (c.ausloeser === 'manuell') bericht.manuell++; } };
  // Hinweis nach dem zuletzt gesprochenen Wort; folgt er direkt auf einen anderen, wird er manuell
  const nachLetztemWort = (liste) => {
    if (letztesWort && !cueSeitWort) { for (const c of liste) cues.push({ ...c, ...letztesWort }); cueSeitWort = true; }
    else for (const c of liste) { c.ausloeser = 'manuell'; offen.push(c); }
    zaehlen(liste);
  };

  const ausgeben = (typ, rolle, abschnitt) => {
    const woerter = [], marken = [];
    for (const tk of abschnitt.split(/\s+/).filter(Boolean)) {
      const m = tk.match(/^⟦(\d+)⟧$/);
      if (m) marken.push({ p: platz[Number(m[1])], vor: woerter.length });
      else woerter.push(tk.replace(PLATZ_RE, ''));
    }
    const zText = woerter.filter(Boolean).join(' ');
    let zeile = null, gesprochen = [];
    if (zText) {
      zeile = { id: neueId('z'), typ, rolle: typ === 'text' ? rolle : '', text: zText, gestrichen: false };
      zeilen.push(zeile);
      gesprochen = tokenisieren(zeile).filter((x) => x.gesprochen.length).map((x) => x.idx);
    }
    const anker = (w) => ({ zeile: zeile.id, wort: w });
    if (gesprochen.length && offen.length) { for (const c of offen) cues.push({ ...c, ...anker(gesprochen[0]) }); offen = []; }
    let hinweisAmEnde = false;
    for (const mk of marken) {
      if (mk.p.art === 'nach') {
        const w = gesprochen.find((i) => i >= mk.vor);
        if (w !== undefined) cues.push(...mk.p.cues.map((c) => ({ ...c, ...anker(w) })));
        else offen.push(...mk.p.cues);
      } else {
        const w = [...gesprochen].reverse().find((i) => i < mk.vor);
        if (w !== undefined) {
          cues.push(...mk.p.cues.map((c) => ({ ...c, ...anker(w) })));
          zaehlen(mk.p.cues);
          if (w === gesprochen[gesprochen.length - 1]) hinweisAmEnde = true;
        } else nachLetztemWort(mk.p.cues);
      }
    }
    if (gesprochen.length) {
      letztesWort = anker(gesprochen[gesprochen.length - 1]);
      cueSeitWort = hinweisAmEnde;
    }
  };

  // Hinweise mitten im Text („… Ich weiß nicht … -Das Telefon klingelt Ach …“) → Platzhalter + Klammer
  const inlineCues = (t) => {
    const tiefen = [];
    let d = 0;
    for (const ch of t) { tiefen.push(d); if (ch === '(') d++; else if (ch === ')' && d > 0) d--; }
    return t.replace(INLINE_CUE_RE, (ganz, vor, phrase, offset) => {
      const strich = ganz.slice(vor.length);
      platz.push({ art: 'vor', cues: neueCues(phrase, false) });
      const n = platz.length - 1;
      const innen = tiefen[offset + vor.length] > 0;
      return ` ⟦${n}⟧ ${vor.trim()}${innen ? strich : `(${strich})`}`;
    });
  };

  for (const b of bloecke) {
    if (b.art === 'szene') {
      ausgeben('szene', '', b.text);
      if (hinweisCues) {
        const teile = ohnePlatz(b.text).split(/\s[-–]\s*/).slice(1).filter((p) => new RegExp(CUE_WORT, 'iu').test(p));
        for (const p of teile) { const c = neueCues(p, true); offen.push(...c); zaehlen(c); }
      }
    } else if (b.art === 'cue') {
      ausgeben('regie', '', b.text);
      if (hinweisCues) nachLetztemWort(neueCues(ohnePlatz(b.text), false));
    } else {
      let t = b.text;
      if (b.art === 'rede') t = strichMarkieren(t, b.rolle, bericht);
      if (hinweisCues) t = inlineCues(t);
      for (const abschnitt of inAbschnitte(t)) ausgeben(b.art === 'rede' ? 'text' : 'regie', b.rolle, abschnitt);
    }
  }
  // Übrige Cues ans letzte Wort hängen
  if (offen.length && letztesWort) for (const c of offen) cues.push({ ...c, ...letztesWort });

  const texte = [];
  if (textbuch) texte.push('Textbuch-Format erkannt (Rollennamen in eigener Zeile).');
  if (bericht.marker) texte.push(`${bericht.marker} Cue-Marker [LX …] übernommen.`);
  if (bericht.auto) {
    texte.push(`${bericht.auto} Cues aus Regiehinweisen angelegt (z. B. „-Musik aus“, „BLACK“), davon ${bericht.manuell} manuell. `
      + 'GO kommt jeweils auf das letzte Wort vor dem Hinweis. Nummern bitte an QLC+/Cue2 anpassen.');
  }
  if (bericht.strich.length) {
    texte.push(`${bericht.strich.length}× „Strich“ im Text – wird nicht mitgelesen. Bitte prüfen, welcher Text gestrichen ist, und ihn ggf. in der Zeile löschen oder die Zeile streichen:\n`
      + bericht.strich.map((x) => `  • ${x}`).join('\n'));
  }
  return { zeilen, cues, bericht: texte };
}

// ------------------------------------------------------------------ Wörter

export function woerterIn(text) {
  return (text || '').split(/\s+/).filter(Boolean);
}

// immer ausschreiben
const ABKUERZUNGEN = {
  'z.b': ['zum', 'beispiel'], 'usw': ['und', 'so', 'weiter'], 'bzw': ['beziehungsweise'], 'ca': ['circa'],
  'u.a': ['unter', 'anderem'], 'd.h': ['das', 'heisst'], 'evtl': ['eventuell'],
  'ml': ['milliliter'], 'km': ['kilometer'], 'kg': ['kilogramm'],
};
// nur mit Punkt („Mio.“, aber nicht „Mio“ als Wort im Text)
const ABKUERZUNGEN_PUNKT = {
  'dr': ['doktor'], 'hr': ['herr'], 'fr': ['frau'], 'st': ['sankt'], 'nr': ['nummer'], 'prof': ['professor'],
  'mio': ['millionen'], 'mrd': ['milliarden'],
};

// Ein angezeigtes Wort → Liste gesprochener Wörter (klein, ohne Satzzeichen, Zahlen ausgeschrieben).
export function normalisieren(token) {
  let t = token.toLowerCase().replace(/[„“”"«»‚‘’'`´]/g, '');
  const ohnePunkt = t.replace(/[.!?,;:…]+$/g, '').replace(/^[.!?,;:…]+/g, '');
  if (ABKUERZUNGEN[ohnePunkt]) return ABKUERZUNGEN[ohnePunkt].slice();
  if (/\.$/.test(t) && ABKUERZUNGEN_PUNKT[ohnePunkt]) return ABKUERZUNGEN_PUNKT[ohnePunkt].slice();
  t = t.replace(/&/g, ' und ').replace(/%/g, ' prozent ').replace(/§/g, ' paragraph ');
  t = t.replace(/(\d)\.(\d{3})/g, '$1$2'); // 1.000 → 1000
  const teile = t.split(/[-–—/_]+|\s+/);
  const out = [];
  for (let p of teile) {
    p = p.replace(/[^0-9a-zäöüßéèàáêç]/g, '');
    if (!p) continue;
    const z = p.match(/^(\d+)(.*)$/);
    if (z) {
      out.push(...zahlWort(parseInt(z[1], 10)).replace(/ß/g, 'ss').split(' '));
      if (z[2]) out.push(z[2]);
    } else {
      out.push(p.replace(/ß/g, 'ss'));
    }
  }
  return out;
}

// Zerlegt eine Zeile in Anzeige-Token. Regieanweisungen in Klammern werden markiert.
export function tokenisieren(zeile) {
  const tokens = [];
  let tiefe = 0;
  const regieZeile = zeile.typ !== 'text';
  woerterIn(zeile.text).forEach((text, idx) => {
    const vorher = tiefe;
    for (const ch of text) {
      if (ch === '(' || ch === '[') tiefe++;
      else if ((ch === ')' || ch === ']') && tiefe > 0) tiefe--;
    }
    const regie = regieZeile || vorher > 0 || /[([]/.test(text);
    tokens.push({ text, idx, regie, gesprochen: regie ? [] : normalisieren(text) });
  });
  return tokens;
}

// ------------------------------------------------------------------ Index fürs Mitlesen

// Baut aus dem Stück die Liste aller gesprochenen Wörter und löst Cues auf.
export function indexBauen(stueck) {
  const gesprochen = [];           // {w, z (Zeilenindex), wort (Tokenindex)}
  const zeilenIndex = new Map();   // zeilenId → Array-Index
  const zeilenBereich = [];        // pro Zeile {von, bis} in gesprochen (bis exklusiv)
  const tokensProZeile = [];

  stueck.zeilen.forEach((z, zi) => {
    zeilenIndex.set(z.id, zi);
    const tokens = tokenisieren(z);
    tokensProZeile.push(tokens);
    const von = gesprochen.length;
    if (!z.gestrichen) {
      for (const tk of tokens) {
        for (const w of tk.gesprochen) gesprochen.push({ w, z: zi, wort: tk.idx });
      }
    }
    zeilenBereich.push({ von, bis: gesprochen.length });
  });

  // Dauer-Cues mit Endwort bekommen einen eigenen „Ende“-Cue, der wie ein normaler Cue angesagt wird
  const alleCues = stueck.cues.slice();
  for (const c of stueck.cues) {
    const d = c.dauer;
    if (d?.art === 'wort' && d.zeile) {
      alleCues.push({
        id: `${c.id}#ende`, typ: c.typ, nummer: c.nummer, bezeichnung: d.text || 'Ende',
        zeile: d.zeile, wort: d.wort || 0, vorlauf: c.vorlauf, notiz: '', ausloeser: 'wort',
        istEnde: true, zuCue: c.id,
      });
    }
  }

  // Cues auflösen: erstes gesprochenes Wort an oder nach dem Anker
  const aufgeloest = new Map();
  for (const c of alleCues) {
    const zi = zeilenIndex.has(c.zeile) ? zeilenIndex.get(c.zeile) : -1;
    let idx = gesprochen.length;
    if (zi >= 0) {
      let lo = 0, hi = gesprochen.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const g = gesprochen[mid];
        if (g.z < zi || (g.z === zi && g.wort < c.wort)) lo = mid + 1; else hi = mid;
      }
      idx = lo;
    }
    const ziel = gesprochen[idx];
    const verschoben = zi < 0 || !ziel || ziel.z !== zi || ziel.wort !== c.wort;
    aufgeloest.set(c.id, { idx, verschoben, verwaist: zi < 0, ziel });
  }

  const typReihe = Object.fromEntries(TYPEN.map((x, i) => [x, i]));
  const reihenfolge = alleCues.sort((a, b) => {
    const ra = aufgeloest.get(a.id), rb = aufgeloest.get(b.id);
    if (ra.idx !== rb.idx) return ra.idx - rb.idx;
    const za = zeilenIndex.get(a.zeile) ?? 1e9, zb = zeilenIndex.get(b.zeile) ?? 1e9;
    if (za !== zb) return za - zb;
    if (a.wort !== b.wort) return a.wort - b.wort;
    if (a.ausloeser !== b.ausloeser) return a.ausloeser === 'manuell' ? -1 : 1;
    if (!!a.istEnde !== !!b.istEnde) return a.istEnde ? -1 : 1;
    if ((a.folge ?? 1e6) !== (b.folge ?? 1e6)) return (a.folge ?? 1e6) - (b.folge ?? 1e6);
    if (a.typ !== b.typ) return typReihe[a.typ] - typReihe[b.typ];
    return parseFloat(a.nummer || 0) - parseFloat(b.nummer || 0);
  });

  // Gruppen: Nur ausdrücklich gleichzeitige Cues (gemeinsame „gruppe“, z. B. über „Gleichzeitig mit“)
  // werden zusammen angesagt. Alle anderen Cues an derselben Stelle kommen nacheinander.
  const gruppen = [];
  for (const c of reihenfolge) {
    const r = aufgeloest.get(c.id);
    const letzte = gruppen[gruppen.length - 1];
    const manuell = c.ausloeser === 'manuell';
    const passt = letzte && c.gruppe && letzte.cues.some((x) => x.gruppe === c.gruppe)
      && letzte.manuell === manuell && letzte.idx === r.idx;
    if (passt) {
      letzte.cues.push(c);
    } else {
      gruppen.push({ idx: r.idx, manuell: c.ausloeser === 'manuell', cues: [c] });
    }
  }
  gruppen.forEach((g, i) => {
    g.nr = i;
    // Wort-Cue am selben Stichwort wie die vorige Gruppe: kommt erst, wenn diese erledigt ist
    const vorige = gruppen[i - 1];
    if (vorige && !g.manuell && !vorige.manuell && vorige.idx === g.idx) g.wartetAuf = i - 1;
    g.vorlauf = Math.max(...g.cues.map((c) => Number(c.vorlauf) || 0));
  });

  return { gesprochen, zeilenIndex, zeilenBereich, tokensProZeile, aufgeloest, reihenfolge, gruppen };
}

export function cueLabel(c) {
  return `${c.typ} ${c.nummer || '?'}${c.istEnde ? ' Ende' : ''}`.trim();
}

// „1:30“ oder „90“ → 90 Sekunden
export function sekundenLesen(t) {
  const s = String(t ?? '').trim();
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
export function zeitText(sek) {
  sek = Math.max(0, Math.round(sek));
  return `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')}`;
}

export function dauerBeschreibung(c, ix) {
  const d = c.dauer;
  if (!d?.art) return '';
  const text = d.text ? ` → „${d.text}“` : '';
  if (d.art === 'zeit') return `⏱ Timer ${zeitText(d.sekunden || 0)}${text}`;
  if (d.art === 'manuell') return `▶ läuft, bis du ihn beendest${text}`;
  const ziel = ix?.aufgeloest.get(`${c.id}#ende`)?.ziel;
  const wort = ziel ? ix.tokensProZeile[ziel.z][ziel.wort]?.text : null;
  return wort ? `▶ läuft bis „${wort}“${text}` : '▶ läuft bis … (Endwort fehlt)';
}

export function gruppenLabel(g) {
  return g.cues.map(cueLabel).join(' + ');
}

// Doppelte Nummern pro Typ finden
export function doppelteNummern(stueck) {
  const gesehen = new Map();
  const doppelt = new Set();
  for (const c of stueck.cues) {
    if (!c.nummer) continue;
    const k = `${c.typ}|${c.nummer}`;
    if (gesehen.has(k)) { doppelt.add(c.id); doppelt.add(gesehen.get(k)); } else gesehen.set(k, c.id);
  }
  return doppelt;
}
