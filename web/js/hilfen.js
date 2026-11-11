// Gemeinsame Hilfen: Speicher (Mac-Server oder Browser), Hinweise, lokale Einstellungen.
//
// Speicherorte:
//  * server  – die Seite kommt vom Python-Server (start.command): Dateien in stuecke/ auf dem Mac
//  * browser – z. B. GitHub Pages oder iPad: IndexedDB in diesem Browser. Regelmäßig exportieren!
const $ = (s) => document.querySelector(s);

export function lokal(key, wert) {
  try {
    if (wert === undefined) return localStorage.getItem(key);
    if (wert === null) localStorage.removeItem(key); else localStorage.setItem(key, wert);
  } catch { /* privater Modus */ }
  return null;
}

export function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

let modus = null;
export const speicherModus = () => modus;

export async function speicherStart() {
  if (location.hostname.endsWith('github.io') || location.protocol === 'file:') modus = 'browser';
  else try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('api/status', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    modus = r.ok && (await r.json().catch(() => ({}))).server ? 'server' : 'browser';
  } catch {
    modus = 'browser';
  }
  if (modus === 'browser') {
    await db();
    try { await navigator.storage?.persist?.(); } catch { /* egal */ }
  }
  return modus;
}

export async function speicherDauerhaft() {
  try { return await navigator.storage?.persisted?.(); } catch { return false; }
}

// ---------------------------------------------------------------- IndexedDB
let dbVersprechen = null;
function db() {
  return (dbVersprechen ||= new Promise((ok, fehler) => {
    const req = indexedDB.open('cue-mitleser', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('stuecke', { keyPath: 'name' });
      d.createObjectStore('zustand', { keyPath: 'name' });
      d.createObjectStore('backups', { keyPath: 'id', autoIncrement: true }).createIndex('name', 'name');
      d.createObjectStore('proben', { keyPath: 'id', autoIncrement: true }).createIndex('name', 'name');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fehler(req.error);
  }));
}

async function idb(store, art, fn) {
  const d = await db();
  return new Promise((ok, fehler) => {
    const t = d.transaction(store, art);
    let ergebnis;
    const r = fn(t.objectStore(store));
    if (r && 'onsuccess' in r) r.onsuccess = () => { ergebnis = r.result; };
    t.oncomplete = () => ok(ergebnis);
    t.onerror = () => fehler(t.error);
    t.onabort = () => fehler(t.error || new Error('Speichern abgebrochen (Speicher voll?)'));
  });
}

async function aufraeumen(store, name, behalten) {
  const alle = await idb(store, 'readonly', (s) => s.index('name').getAllKeys(name));
  const weg = (alle || []).slice(0, Math.max(0, alle.length - behalten));
  if (weg.length) await idb(store, 'readwrite', (s) => { weg.forEach((k) => s.delete(k)); });
}

const browserApi = {
  async liste() {
    const alle = await idb('stuecke', 'readonly', (s) => s.getAll());
    return (alle || []).map((x) => ({ name: x.name, geaendert: x.geaendert / 1000 })).sort((a, b) => a.name.localeCompare(b.name));
  },
  async laden(name) {
    const x = await idb('stuecke', 'readonly', (s) => s.get(name));
    if (!x) throw new Error('Stück nicht gefunden');
    return structuredClone(x.daten);
  },
  async speichern(name, daten) {
    const alt = await idb('stuecke', 'readonly', (s) => s.get(name));
    if (alt) {
      await idb('backups', 'readwrite', (s) => s.add({ name, zeit: Date.now(), daten: alt.daten }));
      await aufraeumen('backups', name, 20);
    }
    const kopie = JSON.parse(JSON.stringify(daten));
    await idb('stuecke', 'readwrite', (s) => s.put({ name, geaendert: Date.now(), daten: kopie }));
  },
  async loeschen(name) {
    const alt = await idb('stuecke', 'readonly', (s) => s.get(name));
    if (alt) await idb('backups', 'readwrite', (s) => s.add({ name, zeit: Date.now(), geloescht: true, daten: alt.daten }));
    await idb('stuecke', 'readwrite', (s) => s.delete(name));
  },
  async zustand(name) {
    return (await idb('zustand', 'readonly', (s) => s.get(name)))?.daten || {};
  },
  async zustandSpeichern(name, z) {
    await idb('zustand', 'readwrite', (s) => s.put({ name, daten: z }));
  },
  async proben(name) {
    return ((await idb('proben', 'readonly', (s) => s.index('name').getAll(name))) || []).map((x) => x.daten);
  },
  async probeSpeichern(name, p) {
    await idb('proben', 'readwrite', (s) => s.add({ name, daten: p }));
    await aufraeumen('proben', name, 20);
  },
  async probenLoeschen(name) {
    const keys = await idb('proben', 'readonly', (s) => s.index('name').getAllKeys(name));
    await idb('proben', 'readwrite', (s) => { (keys || []).forEach((k) => s.delete(k)); });
  },
  async geraete() {
    try {
      const alle = await navigator.mediaDevices.enumerateDevices();
      return alle.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Mikrofon ${i + 1}`, standard: d.deviceId === 'default' }));
    } catch { return []; }
  },
};

// ---------------------------------------------------------------- Mac-Server
const enc = encodeURIComponent;
async function json(r) { if (!r.ok) throw new Error(await r.text()); return r.json(); }
const sende = (url, methode, daten) => fetch(url, {
  method: methode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten),
}).then(json);

const serverApi = {
  liste: () => fetch('api/stuecke').then(json),
  laden: (name) => fetch(`api/stuecke/${enc(name)}`).then(json),
  speichern: (name, daten) => sende(`api/stuecke/${enc(name)}`, 'PUT', daten),
  loeschen: (name) => fetch(`api/stuecke/${enc(name)}`, { method: 'DELETE' }).then(json),
  zustand: (name) => fetch(`api/stuecke/${enc(name)}/zustand`).then(json),
  zustandSpeichern: (name, z) => sende(`api/stuecke/${enc(name)}/zustand`, 'PUT', z),
  proben: (name) => fetch(`api/stuecke/${enc(name)}/proben`).then(json),
  probeSpeichern: (name, p) => sende(`api/stuecke/${enc(name)}/proben`, 'POST', p),
  probenLoeschen: (name) => fetch(`api/stuecke/${enc(name)}/proben`, { method: 'DELETE' }).then(json),
  async geraete() { try { return await fetch('api/geraete').then(json); } catch { return []; } },
};

// Je nach Modus an den richtigen Speicher weiterreichen
export const api = new Proxy({}, {
  get: (_z, name) => (...args) => (modus === 'server' ? serverApi : browserApi)[name](...args),
});
export const browserGeraete = () => browserApi.geraete();
