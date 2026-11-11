// Zahlen in deutsche Zahlwörter umwandeln ("3" → "drei", "1834" → "achtzehnhundertvierunddreißig").
// Vosk liefert deutsche Zahlen als ein zusammengeschriebenes Wort.

const EINER = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const ZEHNER = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

function unter100(n) {
  if (n < 20) return EINER[n];
  const e = n % 10, z = Math.floor(n / 10);
  if (e === 0) return ZEHNER[z];
  return (e === 1 ? 'ein' : EINER[e]) + 'und' + ZEHNER[z];
}

function unter1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  let s = '';
  if (h) s += (h === 1 ? 'ein' : EINER[h]) + 'hundert';
  if (r) s += unter100(r);
  return s || 'null';
}

export function zahlWort(n) {
  n = Math.floor(n);
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return 'null';
  // Jahreszahlen 1100–1999 wie gesprochen: achtzehnhundert…
  if (n >= 1100 && n < 2000) {
    const h = Math.floor(n / 100), r = n % 100;
    return unter100(h) + 'hundert' + (r ? unter100(r) : '');
  }
  if (n < 1000) return unter1000(n);
  if (n < 1000000) {
    const t = Math.floor(n / 1000), r = n % 1000;
    return (t === 1 ? 'ein' : unter1000(t)) + 'tausend' + (r ? unter1000(r) : '');
  }
  const m = Math.floor(n / 1000000), r = n % 1000000;
  return (m === 1 ? 'eine million' : unter1000(m) + ' millionen') + (r ? ' ' + zahlWort(r) : '');
}
