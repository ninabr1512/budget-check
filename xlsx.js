/*
 * Minimal .xlsx reader — enough for bank statement exports.
 * An .xlsx file is a ZIP archive of XML files. We unzip it in the browser (fflate),
 * read the first worksheet and the shared strings, and return rows of text cells.
 * Nothing is uploaded anywhere.
 *
 * Not supported: old binary .xls files, formulas (their last saved value is used), merged-cell layout.
 */
(function (root) {
  'use strict';
  var fflate = root.fflate || (typeof require !== 'undefined' ? require('./vendor/fflate.min.js') : null);

  var MAX_UNZIPPED = 50 * 1024 * 1024; // protection against "zip bombs"

  function decodeXml(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, function (m, e) {
      var map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
      if (map[e.toLowerCase()]) return map[e.toLowerCase()];
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
  }

  // All text inside <t>…</t> of one element (rich text has several runs).
  function texts(xml) {
    var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(xml))) out += decodeXml(m[1]);
    return out;
  }

  function colIndex(ref) {
    var letters = (ref.match(/^[A-Z]+/i) || ['A'])[0].toUpperCase(), n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  /** ArrayBuffer/Uint8Array of an .xlsx → { ok, rows } or { ok:false, error } */
  function read(buffer) {
    var files;
    try {
      var total = 0;
      files = fflate.unzipSync(new Uint8Array(buffer), {
        filter: function (f) {
          total += f.originalSize || 0;
          return /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(f.name);
        }
      });
      if (total > MAX_UNZIPPED) return { ok: false, error: 'too_big' };
    } catch (e) {
      return { ok: false, error: 'xlsx_bad' };
    }
    var dec = new TextDecoder('utf-8');
    var str = function (name) { return files[name] ? dec.decode(files[name]) : ''; };

    // First sheet in workbook order → its file via the relationships file.
    var sheetPath = null;
    var wb = str('xl/workbook.xml'), rels = str('xl/_rels/workbook.xml.rels');
    var first = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
    if (first) {
      var rel = rels.match(new RegExp('<Relationship\\b[^>]*\\bId="' + first[1] + '"[^>]*\\bTarget="([^"]+)"'))
             || rels.match(new RegExp('<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="' + first[1] + '"'));
      if (rel) sheetPath = 'xl/' + rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    }
    if (!sheetPath || !files[sheetPath]) {
      sheetPath = Object.keys(files).filter(function (n) { return /^xl\/worksheets\/[^/]+\.xml$/.test(n); }).sort()[0];
    }
    if (!sheetPath) return { ok: false, error: 'xlsx_bad' };

    var shared = [], ss = str('xl/sharedStrings.xml'), reSi = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
    while ((m = reSi.exec(ss))) shared.push(texts(m[1]));

    var sheet = str(sheetPath), rows = [];
    var reRow = /<row\b[^>]*>([\s\S]*?)<\/row>/g, reCell = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, r;
    while ((r = reRow.exec(sheet))) {
      var row = [], c;
      reCell.lastIndex = 0;
      while ((c = reCell.exec(r[1]))) {
        var attrs = c[1], body = c[2] || '';
        var ref = (attrs.match(/\br="([A-Z]+\d+)"/i) || [])[1];
        var type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
        var v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        var val = '';
        if (type === 's') val = shared[+v] || '';
        else if (type === 'inlineStr') val = texts(body);
        else if (v !== undefined) val = decodeXml(v);
        var idx = ref ? colIndex(ref) : row.length;
        while (row.length < idx) row.push('');
        row[idx] = val;
      }
      if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row);
    }
    if (!rows.length) return { ok: false, error: 'empty' };
    return { ok: true, rows: rows };
  }

  var api = { read: read };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Xlsx = api;
})(this);
