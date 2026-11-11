// Textbuch-Dateien im Browser lesen (ohne Server): .txt/.md, .docx (JSZip), .pdf mit Textebene (pdf.js).
import { skriptLaden } from './erkennung.js';

export async function dateiLesen(datei) {
  const name = datei.name.toLowerCase();
  const daten = await datei.arrayBuffer();
  if (name.endsWith('.pdf') || datei.type === 'application/pdf') return pdfText(daten);
  if (name.endsWith('.docx')) return docxText(daten);
  return textDekodieren(daten);
}

function textDekodieren(daten) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(daten).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(daten); }
}

async function docxText(daten) {
  await skriptLaden('vendor/jszip.min.js');
  const zip = await window.JSZip.loadAsync(daten);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Keine Word-Datei (word/document.xml fehlt)');
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const absaetze = [];
  for (const p of doc.getElementsByTagNameNS(ns, 'p')) {
    let t = '';
    for (const el of p.getElementsByTagName('*')) {
      if (el.namespaceURI !== ns) continue;
      if (el.localName === 't') t += el.textContent;
      else if (el.localName === 'tab') t += '\t';
      else if (el.localName === 'br' || el.localName === 'cr') t += '\n';
    }
    absaetze.push(t);
  }
  return absaetze.join('\n');
}

// Setzt die Textstücke von pdf.js wieder zu Zeilen zusammen (wie pypdf auf dem Mac)
async function pdfText(daten) {
  await skriptLaden('vendor/pdf.min.js');
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(daten), isEvalSupported: false }).promise;
  const zeilen = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const seite = await pdf.getPage(n);
    const inhalt = await seite.getTextContent();
    let zeile = '', y = null, xEnde = null;
    const neueZeile = () => { zeilen.push(zeile); zeile = ''; y = null; xEnde = null; };
    for (const it of inhalt.items) {
      if (typeof it.str !== 'string') continue;
      const [, , , , x, iy] = it.transform;
      if (y !== null && Math.abs(iy - y) > 2) neueZeile();
      if (it.str) {
        // Lücke zwischen zwei Stücken derselben Zeile → Leerzeichen
        if (zeile && xEnde !== null && x - xEnde > 1.5 && !/\s$/.test(zeile) && !/^\s/.test(it.str)) zeile += ' ';
        zeile += it.str;
        y = iy;
        xEnde = x + (it.width || 0);
      }
      if (it.hasEOL) neueZeile();
    }
    if (zeile) neueZeile();
    zeilen.push('');
  }
  if (!zeilen.some((z) => z.trim())) throw new Error('Die PDF enthält keinen Text (eingescannt?). Bitte als Text-PDF exportieren.');
  return zeilen.join('\n');
}
