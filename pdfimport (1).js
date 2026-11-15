/*
 * PDF bank statement import (beta).
 *
 * A PDF has no table data — only pieces of text placed at x/y coordinates. We rebuild the table:
 *   1. pdf.js (self-hosted, Apache-2.0) extracts text pieces with positions, in the browser.
 *   2. Pieces on the same baseline become one line.
 *   3. A line with known column names (Kuupäev / Date, Summa / Amount…) is the header.
 *      Each following line is split into columns by the x position of the header cells
 *      (right-aligned amounts are matched by their right edge).
 *   4. A line that has no date and sits right under the previous row is a wrapped
 *      description and is joined to that row.
 *   Fallback without a header: lines like "31.08.2026  Payee …  -12,50" — but only if the
 *   amounts carry a sign or a D/K mark; otherwise we refuse instead of guessing.
 *
 * The rows then go through the same analysis as CSV and Excel (statement.js).
 */
(function (root) {
  'use strict';
  var S = root.Statement || (typeof require !== 'undefined' ? require('./statement.js') : null);

  var MAX_PAGES = 60;
  var DATE_RE = /^(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})$/;
  var AMOUNT_RE = /^[+\-−]?\d[\d\s ]*([.,]\d{2})?$/;
  var MONEY_RE = /^[+\-−]?\d{1,3}(?:[\s ]?\d{3})*[.,]\d{2}(?:\s*(?:EUR|€))?$/i;   // 1 234,56 / -12.50 EUR

  /** Text pieces of one page → lines (top to bottom), each a list of cells sorted left to right. */
  function toLines(items) {
    var list = items.filter(function (i) { return i.str && i.str.trim() !== ''; })
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    list.forEach(function (it) {
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });
    lines.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); l.cells = toCells(l.items); });
    return lines;
  }

  /** Pieces that touch each other (small gap) form one cell. */
  function toCells(items) {
    var cells = [];
    items.forEach(function (it) {
      var c = cells[cells.length - 1];
      var gap = c ? it.x - (c.x + c.w) : Infinity;
      if (c && gap < 3.5) {
        c.text += (gap > 0.8 ? ' ' : '') + it.str.trim();
        c.w = it.x + it.w - c.x;
      } else {
        cells.push({ text: it.str.trim(), x: it.x, w: it.w });
      }
    });
    return cells;
  }

  function headerMap(line) { return S.mapColumns([line.cells.map(function (c) { return c.text; })]); }
  function isMoney(t) { return MONEY_RE.test(t.trim()); }
  function hasDateCell(line) { return line.cells.some(function (c) { return DATE_RE.test(c.text.trim()); }); }

  /**
   * Where each column starts. Headers are often centred over their column while the text in it is
   * left-aligned, so we look at the data: x positions where text regularly starts, and give each header
   * the nearest such position at or left of its centre.
   */
  function columnStarts(header, dataLines) {
    var counts = {};
    dataLines.forEach(function (l) {
      var seen = {};
      l.cells.forEach(function (c) {
        if (isMoney(c.text)) return;
        var k = Math.round(c.x / 3) * 3;
        if (!seen[k]) { counts[k] = (counts[k] || 0) + 1; seen[k] = true; }
      });
    });
    var min = Math.max(2, dataLines.length * 0.15);
    var clusters = Object.keys(counts).map(Number).filter(function (k) { return counts[k] >= min; }).sort(function (a, b) { return a - b; });
    var starts = [], prev = -Infinity;
    header.forEach(function (h) {
      var centre = h.x + h.w / 2, pick = null;
      clusters.forEach(function (k) { if (k > prev && k <= centre + 3) pick = k; });
      var s = pick !== null ? pick : Math.max(h.x, prev + 1);
      starts.push(s); prev = s;
    });
    return starts;
  }

  /** Which header column a cell belongs to. */
  function columnOf(cell, header, starts) {
    if (isMoney(cell.text)) {
      // Right-aligned money: the header whose right edge is closest to the number's right edge.
      var right = cell.x + cell.w, best = -1, bestD = Infinity;
      header.forEach(function (h, i) {
        var d = Math.abs((h.x + h.w) - right);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (bestD < 40) return best;
    }
    if (cell.x < starts[0] - 3) return -1;          // left of the first column, e.g. a row number "1", "2", …
    var col = 0;
    starts.forEach(function (s, i) { if (s - 3 <= cell.x) col = i; });
    return col;
  }

  /**
   * pdf.js sometimes returns text and the amount next to it as one piece ("…MUSTAMAE23,40").
   * If a piece reaches into the amount column and ends with a number, cut the number off.
   */
  function splitGluedAmounts(cells, header) {
    var amountCol = S.mapColumns([header.map(function (h) { return h.text; })]).amount;
    var h = header[amountCol], out = [];
    cells.forEach(function (c) {
      var m = c.text.match(/^(.*?\S)\s?([+\-−]?\d{1,3}(?:[\s ]?\d{3})*[.,]\d{2})$/);
      var reachesAmount = c.x < h.x - 6 && c.x + c.w > h.x;
      if (m && reachesAmount && !isMoney(c.text)) {
        var share = m[1].length / c.text.length;
        out.push({ text: m[1], x: c.x, w: c.w * share });
        out.push({ text: m[2], x: c.x + c.w * share, w: c.w * (1 - share) });
      } else out.push(c);
    });
    return out;
  }

  /**
   * pages: [[{ str, x, y, w, h }]] → { ok, rows } or { ok:false, error }.
   * Pure function: used by the browser and by the Node tests.
   */
  function itemsToRows(pages) {
    var total = pages.reduce(function (n, p) { return n + p.filter(function (i) { return i.str && i.str.trim(); }).length; }, 0);
    if (!total) return { ok: false, error: 'pdf_no_text' };

    // Pass 1: find the header and the lines below it (the header carries over to the next pages).
    var header = null, blocks = [];
    pages.forEach(function (items) {
      toLines(items).forEach(function (line) {
        if (headerMap(line)) { header = line.cells; blocks.push({ header: header, lines: [] }); return; }
        if (header) blocks[blocks.length - 1].lines.push(line);
      });
      if (header) blocks.push({ header: header, lines: [], pageBreak: true });
    });
    if (!header) return fallback(pages);

    var headerTexts = blocks[0].header.map(function (c) { return c.text; });
    var dateCol = S.mapColumns([headerTexts]).date;
    var dataLines = [];
    blocks.forEach(function (b) { b.lines.forEach(function (l) { if (hasDateCell(l)) dataLines.push(l); }); });
    var starts = columnStarts(blocks[0].header, dataLines);

    // Pass 2: split lines into columns; join wrapped lines to their row.
    var rows = [], prevY = null;
    blocks.forEach(function (b) {
      if (b.pageBreak) { prevY = null; return; }
      b.lines.forEach(function (line) {
        var row = new Array(b.header.length).fill('');
        splitGluedAmounts(line.cells, b.header).forEach(function (c) {
          var i = columnOf(c, b.header, starts);
          if (i < 0) return;
          row[i] = row[i] ? row[i] + ' ' + c.text : c.text;
        });
        if (DATE_RE.test((row[dateCol] || '').trim())) { rows.push(row); prevY = line.y; return; }
        // A wrapped line: right under the previous row, no date and no money in it
        // ("EUR closing balance …", turnover lines and footers have money or sit far away).
        var money = line.cells.some(function (c) { return isMoney(c.text); });
        if (rows.length && prevY !== null && !money && prevY - line.y < 16) {
          var last = rows[rows.length - 1];
          row.forEach(function (t, i) { if (t) last[i] = last[i] ? last[i] + ' ' + t : t; });
          prevY = line.y;
        } else {
          prevY = null;
        }
      });
    });

    if (rows.length) return { ok: true, rows: [headerTexts].concat(rows), mode: 'table' };
    return fallback(pages);
  }

  /** No recognisable header: read "date … amount" lines; needs a sign or D/K to know the direction. */
  function fallback(pages) {
    var rows = [['Kuupäev', 'Saaja/Maksja', 'Summa', 'Deebet/Kreedit']], directional = false;
    var re = /^(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})\s+(.+?)\s+([+\-−]?\d[\d\s ]*[.,]\d{2})\s*(?:EUR|€)?\s*([DKC])?$/i;
    pages.forEach(function (items) {
      toLines(items).forEach(function (line) {
        var text = line.cells.map(function (c) { return c.text; }).join(' ').replace(/\s+/g, ' ').trim();
        var m = text.match(re);
        if (!m) return;
        var dc = (m[4] || '').toUpperCase();
        if (/^[+\-−]/.test(m[3]) || dc) directional = true;
        rows.push([m[1], m[2], m[3], dc === 'C' ? 'K' : dc]);
      });
    });
    if (rows.length < 2) return { ok: false, error: 'unknown_format' };
    if (!directional) return { ok: false, error: 'pdf_no_sign' };
    return { ok: true, rows: rows, mode: 'lines' };
  }

  /** Browser: ArrayBuffer of a PDF → Promise<{ ok, rows } | { ok:false, error }>. */
  var lib = null;
  function load() {
    if (!lib) {
      lib = import('./vendor/pdfjs/pdf.min.mjs').then(function (m) {
        m.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs';
        return m;
      });
    }
    return lib;
  }

  function read(buffer) {
    var task = null, doc = null;
    var work = load().then(function (pdfjs) {
      task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, verbosity: 0 });
      return task.promise;
    }).then(function (d) {
      doc = d;
      var n = Math.min(doc.numPages, MAX_PAGES), jobs = [];
      for (var p = 1; p <= n; p++) {
        jobs.push(doc.getPage(p).then(function (page) { return page.getTextContent(); }).then(function (tc) {
          return tc.items.map(function (i) { return { str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height }; });
        }));
      }
      return Promise.all(jobs);
    }).then(itemsToRows, function (e) {
      return { ok: false, error: e && e.name === 'PasswordException' ? 'pdf_locked' : 'pdf_bad' };
    });
    // Never leave the user waiting forever.
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, error: 'pdf_bad' }); }, 30000); });
    return Promise.race([work, timeout]).then(function (result) {
      // Free pdf.js resources after every file, also after a failure: otherwise the next PDF can hang.
      try { if (doc) doc.destroy(); else if (task) task.destroy(); } catch (e) {}
      return result;
    });
  }

  var api = { itemsToRows: itemsToRows, read: read };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfImport = api;
})(this);
