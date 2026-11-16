// PDF import tests. Run: node tests-pdf.mjs
// Uses the same pdf.js file as the website (vendor/pdfjs) to extract text, then pdfimport.js to rebuild the table.
import fs from 'fs';
import { createRequire } from 'module';
// Same pdf.js version as vendor/pdfjs, in its Node build (the browser build needs a browser).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const require = createRequire(import.meta.url);
const S = require('./statement.js');
globalThis.Statement = S;
const P = require('./pdfimport.js');

let pass = 0, fail = 0;
function eq(name, ok, detail) { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  → ' + detail)); }
function close(a, b) { return Object.keys(Object.assign({}, a, b)).every(k => Math.abs((a[k] || 0) - (b[k] || 0)) < 0.05); }

async function items(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height })));
  }
  return pages;
}

const ref = S.analyse(fs.readFileSync('validation/swedbank_validation_2026-08_10.csv', 'utf8'));
for (const [f, mode] of [['validation/swedbank_validation_2026-08_10.pdf', 'table'], ['validation/signed_lines_2026-08_10.pdf', 'lines'],
                         ['validation/swedbank_english_layout_2026-08_10.pdf', 'table']]) {
  const r = P.itemsToRows(await items(f));
  const a = r.ok ? S.analyseRows(r.rows) : {};
  eq(f + ' read as ' + mode, r.ok && r.mode === mode, JSON.stringify(r.error || r.mode));
  eq(f + ' → same transactions and totals as CSV', a.count === ref.count && a.income === ref.income && close(a.totals, ref.totals),
     JSON.stringify([a.count, a.income, a.totals]));
}

// Pure-function cases (no PDF file needed)
const line = (y, parts) => parts.map(([str, x, w]) => ({ str, x, y, w: w || str.length * 4.5 }));
eq('no text at all (scanned PDF) → pdf_no_text', P.itemsToRows([[]]).error === 'pdf_no_text', '');
eq('lines without sign or D/K → refuse instead of guessing',
   P.itemsToRows([line(700, [['05.09.2026', 40], ['Selver', 110], ['12,50', 500]])]).error === 'pdf_no_sign', '');
eq('glued "…MUSTAMAE23,40" is split into text and amount', (() => {
  const page = [
    ...line(750, [['Kuupäev', 40, 40], ['Saaja/Maksja', 105, 60], ['Selgitus', 265, 40], ['Summa', 440, 35], ['D/K', 500, 15]]),
    ...line(730, [['11.09.2026', 40, 46], ['RIMI MUSTAMAE23,40', 265, 210], ['D', 500, 6]])
  ];
  const r = P.itemsToRows([page]);
  return r.ok && r.rows[1][3] === '23,40' && r.rows[1][2] === 'RIMI MUSTAMAE';
})(), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
