// Regler für die Mikrofon-Verstärkung mit Live-Pegel. Wird in Einstellungen, Mikrofon-Test und Probe genutzt;
// alle Regler bleiben über das Ereignis „pegel-geaendert“ synchron.
import { pegelEinst, pegelSetzen, faktorText } from './erkennung.js';

export function pegelReglerEinbauen(el, { hinweis = '' } = {}) {
  el.innerHTML = `<div class="pegel-regler">
    <div class="pr-zeile"><span>Mikrofon-Verstärkung</span><b class="pr-wert"></b></div>
    <input type="range" min="0" max="40" step="1" class="pr-db" aria-label="Verstärkung in dB">
    <label class="schalter"><input type="checkbox" class="pr-auto"> Automatisch – passt sich der Sprechlautstärke an</label>
    <div class="pr-meter-rahmen" title="Pegel nach der Verstärkung (Balken) und vom Mikrofon (Strich)">
      <div class="pr-ziel"></div><div class="pr-meter"></div><div class="pr-roh"></div>
    </div>
    <div class="pr-text hinweis">${hinweis}</div>
  </div>`;
  const db = el.querySelector('.pr-db');
  const auto = el.querySelector('.pr-auto');
  const wert = el.querySelector('.pr-wert');
  const meter = el.querySelector('.pr-meter');
  const roh = el.querySelector('.pr-roh');
  const text = el.querySelector('.pr-text');
  let letzterFaktor = 1;
  const zeigen = () => {
    db.value = pegelEinst.db;
    auto.checked = pegelEinst.auto;
    db.disabled = pegelEinst.auto;
    wert.textContent = pegelEinst.auto ? `automatisch · ${faktorText(letzterFaktor)}` : faktorText(10 ** (pegelEinst.db / 20));
  };
  db.addEventListener('input', () => pegelSetzen({ db: Number(db.value) }));
  auto.addEventListener('change', () => pegelSetzen({ auto: auto.checked }));
  document.addEventListener('pegel-geaendert', zeigen);
  zeigen();

  let spitze = 0, spitzeZeit = 0;
  return {
    // wert/roh: 0..1 (Balken), faktor: aktuelle Verstärkung
    pegel({ wert: w = 0, roh: r = 0, faktor = 1 }) {
      meter.style.setProperty('--p', `${Math.round(w * 100)}%`);
      roh.style.left = `${Math.round(r * 100)}%`;
      if (pegelEinst.auto && Math.abs(faktor - letzterFaktor) / letzterFaktor > 0.1) { letzterFaktor = faktor; zeigen(); }
      // Rückmeldung anhand der lautesten Stelle der letzten Sekunden
      const jetzt = Date.now();
      if (w > spitze || jetzt - spitzeZeit > 3000) { spitze = w; spitzeZeit = jetzt; }
      if (jetzt - (this.textZeit || 0) > 600) {
        this.textZeit = jetzt;
        text.textContent = spitze < 0.05 ? (hinweis || 'Stille – bitte sprechen.')
          : spitze < 0.25 ? (pegelEinst.auto ? 'Leise Stelle – die Automatik regelt nach.' : 'Zu leise – Verstärkung erhöhen (Sprache sollte im grünen Bereich liegen).')
          : spitze > 0.95 ? 'Zu laut – Verstärkung verringern.'
          : '✓ Gut – Sprache liegt im grünen Bereich.';
      }
    },
  };
}
