// Mitlese-Logik: gleicht erkannte Wörter Wort für Wort mit dem Skript ab.
// Prinzip wie bei autocue (tracker.py): immer das nächste Skriptwort erwarten,
// kleine Lücken überspringen, erst bei wiederholten Fehlern breiter suchen.
// Theater-Ergänzungen: Rücksprünge nur bei sehr hoher Sicherheit, Ruhe ist kein Fehler.
import { normalisieren } from './skript.js';

const simCache = new Map();

// Ähnlichkeit 0–100 (wie rapidfuzz.ratio: 2·LCS / (|a|+|b|))
export function aehnlichkeit(a, b) {
  if (a === b) return 100;
  if (!a || !b) return 0;
  const key = a < b ? a + '|' + b : b + '|' + a;
  const c = simCache.get(key);
  if (c !== undefined) return c;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0), cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const wert = Math.round((200 * prev[n]) / (m + n));
  if (simCache.size > 200000) simCache.clear();
  simCache.set(key, wert);
  return wert;
}

export class Tracker {
  constructor(gesprochen, einst) {
    this.g = gesprochen;            // [{w, z, wort}]
    this.e = einst;
    this.fuell = new Set(String(einst.fuellwoerter || '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    this.pos = 0;                   // Index des nächsten erwarteten Skriptworts
    this.fehl = 0;                  // Fehlwörter in Folge
    this.letzte = [];               // zuletzt erkannte Wörter (für Sprungsuche)
    this.zuletztErkannt = -1;       // Index des zuletzt erkannten Skriptworts
  }

  klon() {
    const t = Object.create(Tracker.prototype);
    Object.assign(t, this);
    t.letzte = this.letzte.slice();
    return t;
  }

  setzePosition(i) {
    this.pos = Math.max(0, Math.min(this.g.length, i));
    this.fehl = 0;
    this.letzte = [];
    this.zuletztErkannt = this.pos - 1;
  }

  get sicherheit() {
    const f = this.e.fehlFolge;
    if (this.fehl === 0) return 'sicher';
    if (this.fehl < f * 2) return 'unsicher';
    return 'verloren';
  }

  passt(w, i) {
    if (i < 0 || i >= this.g.length) return false;
    const s = this.g[i].w;
    // kurze Wörter müssen fast genau passen
    const schwelle = Math.min(w.length, s.length) <= 2 ? 100 : this.e.schwelle;
    return aehnlichkeit(w, s) >= schwelle;
  }

  // Verarbeitet erkannte Wörter (Rohtext von der Erkennung). Liefert ein Protokoll pro Wort.
  verarbeite(roh) {
    const log = [];
    const woerter = [];
    for (const r of roh) woerter.push(...normalisieren(r));
    for (const w of woerter) log.push(this.wort(w));
    return log;
  }

  wort(w) {
    const von = this.pos;
    const eintrag = (ergebnis, extra = {}) => ({ w, ergebnis, von, pos: this.pos, ...extra });
    if (this.pos >= this.g.length) return eintrag('ende');

    // 1. direkter Treffer
    if (this.passt(w, this.pos)) return this.treffer(w, this.pos, eintrag, 'treffer');

    // 2. Füllwort (nur wenn es nicht ohnehin das erwartete Wort ist)
    if (this.fuell.has(w)) return eintrag('fuell');

    // Wiederholung des gerade gesprochenen Worts → kein Fehler
    if (this.zuletztErkannt >= 0 && this.zuletztErkannt === this.pos - 1 && this.passt(w, this.pos - 1)) {
      return eintrag('wiederholung');
    }

    // 3. kleine Lücke: die nächsten Skriptwörter prüfen (kurze Wörter nur 1 weit)
    const maxLuecke = w.length <= 3 ? 1 : this.e.luecke;
    for (let k = 1; k <= maxLuecke; k++) {
      if (this.passt(w, this.pos + k)) return this.treffer(w, this.pos + k, eintrag, 'luecke', { uebersprungen: k });
    }

    // Fehlwort
    this.fehl++;
    this.letzte.push(w);
    if (this.letzte.length > this.e.fenster * 2) this.letzte.shift();

    // 4. Sprung erkennen
    if (this.fehl >= this.e.fehlFolge) {
      const sp = this.sprungSuchen();
      if (sp) {
        this.pos = sp.pos;
        this.zuletztErkannt = sp.pos - 1;
        this.fehl = 0;
        return eintrag('sprung', { sicherheit: sp.anteil });
      }
    }
    return eintrag('fehl');
  }

  treffer(w, i, eintrag, art, extra) {
    this.pos = i + 1;
    this.zuletztErkannt = i;
    this.fehl = 0;
    this.letzte.push(w);
    if (this.letzte.length > this.e.fenster * 2) this.letzte.shift();
    return eintrag(art, extra);
  }

  // Schiebt die letzten erkannten Wörter als Gruppe durch einen Bereich um die Position.
  sprungSuchen() {
    const laenge = Math.min(this.e.fenster, this.fehl + 2, this.letzte.length);
    if (laenge < Math.min(3, this.e.fehlFolge)) return null;
    const fenster = this.letzte.slice(-laenge);
    const von = Math.max(0, this.pos - this.e.suchbereich);
    const bis = Math.min(this.g.length, this.pos + this.e.suchbereich);
    const spanne = laenge + 3;

    const kandidaten = [];
    for (let s = von; s < bis; s++) {
      const r = this.ausrichten(fenster, s, Math.min(this.g.length, s + spanne));
      if (r.treffer >= 3) kandidaten.push({ ...r, start: s });
    }
    if (!kandidaten.length) return null;
    // bei Gleichstand: der Kandidat, der die neuesten Wörter trifft, dann der nächstgelegene
    kandidaten.sort((a, b) => b.treffer - a.treffer || b.juengster - a.juengster
      || Math.abs(a.ende - this.pos) - Math.abs(b.ende - this.pos));
    const best = kandidaten[0];
    const anteil = Math.round((100 * best.treffer) / laenge);

    // Mehrdeutig? (gleich guter Treffer an einer klar anderen Stelle)
    const konkurrent = kandidaten.find((k) => k.treffer >= best.treffer && k.juengster >= best.juengster
      && Math.abs(k.ende - best.ende) > laenge + 2);
    if (konkurrent) return null;

    const ziel = best.ende; // nächstes erwartetes Wort
    const abstand = ziel - this.pos;
    if (abstand >= 0) {
      if (anteil < this.e.sprungSicherheit) return null;
      return { pos: ziel, anteil };
    }
    if (anteil < this.e.rueckSprungSicherheit || -abstand <= 3) return null;
    return { pos: ziel, anteil };
  }

  // Unscharfe LCS zwischen Fenster und Skriptabschnitt [s, e). Liefert Anzahl Treffer
  // und Position hinter dem zuletzt getroffenen Skriptwort.
  ausrichten(fenster, s, e) {
    const m = fenster.length, n = e - s;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = this.passt(fenster[i - 1], s + j - 1) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    // Ende: kleinstes j, bei dem das Maximum erreicht ist
    const max = dp[m][n];
    let j = n;
    while (j > 0 && dp[m][j - 1] === max) j--;
    // Rückverfolgung: jüngstes getroffenes Fensterwort
    let juengster = -1;
    for (let i = m, k = j; i > 0 && k > 0;) {
      if (dp[i][k] === dp[i - 1][k - 1] + 1 && this.passt(fenster[i - 1], s + k - 1)) { juengster = i - 1; break; }
      if (dp[i - 1][k] >= dp[i][k - 1]) i--; else k--;
    }
    return { treffer: max, ende: s + j, juengster };
  }
}
