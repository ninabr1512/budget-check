/*
 * Minimal reader for old binary Excel files (.xls, BIFF8 — Excel 97–2003).
 * Runs in the browser, no libraries, nothing is uploaded.
 *
 * Two layers:
 *   1. The file is an OLE2 "compound file" — a tiny file system with sectors and a FAT.
 *      We find the "Workbook" stream in it.
 *   2. The stream is a list of BIFF records. We read the shared strings (SST) and the cells of the
 *      first worksheet: text (LABELSST, LABEL), numbers (NUMBER, RK, MULRK) and formulas (their
 *      last calculated value).
 * Not supported: password-protected files, charts, formatting. Dates come out as Excel day numbers;
 * statement.js turns those into dates.
 */
(function (root) {
  'use strict';

  var END = 0xFFFFFFFE, FREE = 0xFFFFFFFF, MAX_CELLS = 200000;

  function fail(error) { return { ok: false, error: error }; }

  /** Compound file → bytes of the named stream (or null). */
  function readStream(bytes, names) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var u32 = function (o) { return dv.getUint32(o, true); };
    var u16 = function (o) { return dv.getUint16(o, true); };
    var ss = 1 << u16(0x1E), mss = 1 << u16(0x20);
    if (ss !== 512 && ss !== 4096) return null;
    var sectorOffset = function (id) { return (id + 1) * ss; };

    // FAT sector ids: 109 in the header, the rest in a chain of DIFAT sectors.
    var fatIds = [], i;
    for (i = 0; i < 109; i++) { var id = u32(0x4C + i * 4); if (id !== FREE && id !== END) fatIds.push(id); }
    var difat = u32(0x44), guard = 0;
    while (difat !== END && difat !== FREE && guard++ < 10000) {
      var off = sectorOffset(difat), per = ss / 4 - 1;
      if (off + ss > bytes.length) break;
      for (i = 0; i < per; i++) { var d = u32(off + i * 4); if (d !== FREE && d !== END) fatIds.push(d); }
      difat = u32(off + per * 4);
    }
    var fat = [];
    fatIds.forEach(function (fid) {
      var o = sectorOffset(fid);
      for (var k = 0; k < ss / 4 && o + k * 4 + 4 <= bytes.length; k++) fat.push(u32(o + k * 4));
    });

    function chain(start, table) {
      var out = [], cur = start, seen = {};
      while (cur !== END && cur !== FREE && cur < table.length && !seen[cur]) { seen[cur] = 1; out.push(cur); cur = table[cur]; }
      return out;
    }
    function readChain(start, size) {
      var ids = chain(start, fat), out = new Uint8Array(ids.length * ss);
      ids.forEach(function (sid, n) {
        var o = sectorOffset(sid);
        out.set(bytes.subarray(o, Math.min(o + ss, bytes.length)), n * ss);
      });
      return size !== undefined ? out.subarray(0, size) : out;
    }

    // Directory: 128-byte entries.
    var dir = readChain(u32(0x30)), ddv = new DataView(dir.buffer), entries = [];
    for (var e = 0; e + 128 <= dir.length; e += 128) {
      var nameLen = ddv.getUint16(e + 0x40, true), name = '';
      for (var c = 0; c < Math.max(0, nameLen / 2 - 1); c++) name += String.fromCharCode(ddv.getUint16(e + c * 2, true));
      entries.push({ name: name, type: dir[e + 0x42], start: ddv.getUint32(e + 0x74, true), size: ddv.getUint32(e + 0x78, true) });
    }
    var rootEntry = entries[0];
    var entry = entries.filter(function (en) { return en.type === 2 && names.indexOf(en.name) > -1; })[0];
    if (!entry) return entries.some(function (en) { return en.name === 'EncryptedPackage'; }) ? 'encrypted' : null;

    if (entry.size >= u32(0x38) || !rootEntry) return readChain(entry.start, entry.size);
    // Small stream: stored in the mini stream with its own mini FAT.
    var mini = readChain(rootEntry.start, rootEntry.size), miniFatBytes = readChain(u32(0x3C)), miniFat = [];
    for (i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(new DataView(miniFatBytes.buffer).getUint32(i, true));
    var ids = chain(entry.start, miniFat), out = new Uint8Array(ids.length * mss);
    ids.forEach(function (sid, n) { out.set(mini.subarray(sid * mss, sid * mss + mss), n * mss); });
    return out.subarray(0, entry.size);
  }

  /** Iterate BIFF records: [{ id, data }]. */
  function records(stream) {
    var list = [], dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength), o = 0;
    while (o + 4 <= stream.length) {
      var id = dv.getUint16(o, true), len = dv.getUint16(o + 2, true);
      list.push({ id: id, pos: o, data: stream.subarray(o + 4, Math.min(o + 4 + len, stream.length)) });
      o += 4 + len;
    }
    return list;
  }

  /** Reader over SST + CONTINUE records that knows where each record starts (strings may be split). */
  function sstReader(parts) {
    var p = 0, o = 0;
    function cur() { return parts[p]; }
    function next() { p++; o = 0; }
    function byte() { if (o >= cur().length) next(); return cur()[o++]; }
    function u16() { var a = byte(), b = byte(); return a | (b << 8); }
    function u32() { var a = u16(), b = u16(); return (a | (b << 16)) >>> 0; }
    function skip(n) { while (n > 0) { if (o >= cur().length) next(); var k = Math.min(n, cur().length - o); o += k; n -= k; } }
    function string() {
      var cch = u16(), flags = byte(), runs = 0, ext = 0, s = '';
      if (flags & 0x08) runs = u16();
      if (flags & 0x04) ext = u32();
      var high = flags & 0x01;
      while (s.length < cch) {
        if (o >= cur().length) { next(); high = byte() & 0x01; }   // continued in the next record: new flag byte
        if (high) { var lo = cur()[o++], hi = cur()[o++]; s += String.fromCharCode(lo | (hi << 8)); }
        else s += String.fromCharCode(cur()[o++]);
      }
      skip(runs * 4 + ext);
      return s;
    }
    return { string: string, u32: u32, done: function () { return p >= parts.length || (p === parts.length - 1 && o >= cur().length); } };
  }

  /** XLUnicodeString inside one record (LABEL, STRING, BOUNDSHEET name). */
  function shortString(data, at, lenBytes) {
    var cch = lenBytes === 1 ? data[at] : data[at] | (data[at + 1] << 8), o = at + lenBytes;
    var high = data[o++] & 0x01, s = '';
    for (var i = 0; i < cch && o < data.length; i++) {
      s += String.fromCharCode(high ? data[o] | (data[o + 1] << 8) : data[o]);
      o += high ? 2 : 1;
    }
    return s;
  }

  function rkValue(rk) {
    var v;
    if (rk & 2) v = rk >> 2;                                 // 30-bit signed integer
    else {
      var buf = new DataView(new ArrayBuffer(8));
      buf.setUint32(4, rk & 0xFFFFFFFC, true);               // top 30 bits of a double
      v = buf.getFloat64(0, true);
    }
    return rk & 1 ? v / 100 : v;
  }

  function num(v) { return String(Math.round(v * 1e6) / 1e6); }

  /** ArrayBuffer/Uint8Array of an .xls → { ok, rows } or { ok:false, error } */
  function read(buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes.length < 512 || bytes[0] !== 0xD0 || bytes[1] !== 0xCF) return fail('xls_bad');
    var stream;
    try { stream = readStream(bytes, ['Workbook', 'Book']); } catch (e) { return fail('xls_bad'); }
    if (stream === 'encrypted') return fail('xls_locked');
    if (!stream) return fail('xls_bad');

    var recs = records(stream), sst = [], firstSheet = null;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.id === 0x002F) return fail('xls_locked');                       // FILEPASS: password-protected
      if (r.id === 0x0085 && firstSheet === null) {                         // BOUNDSHEET
        var dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        if (r.data[5] === 0) firstSheet = dv.getUint32(0, true);           // type 0 = worksheet
      }
      if (r.id === 0x00FC) {                                                // SST (+ CONTINUE records)
        var parts = [r.data.subarray(8)], j = i + 1;
        while (j < recs.length && recs[j].id === 0x003C) parts.push(recs[j++].data);
        var unique = new DataView(r.data.buffer, r.data.byteOffset).getUint32(4, true);
        try { var rd = sstReader(parts); for (var n = 0; n < unique && !rd.done(); n++) sst.push(rd.string()); } catch (e) { /* keep what was read */ }
      }
    }
    if (firstSheet === null) return fail('xls_bad');

    var rows = [], cells = 0, pendingFormula = null;
    function put(row, col, val) {
      if (++cells > MAX_CELLS) return;
      while (rows.length <= row) rows.push([]);
      var rr = rows[row];
      while (rr.length < col) rr.push('');
      rr[col] = val;
    }
    for (i = 0; i < recs.length; i++) {
      r = recs[i];
      if (r.pos < firstSheet) continue;
      if (r.id === 0x000A && r.pos > firstSheet) break;                     // EOF of the sheet
      var d = r.data, v = new DataView(d.buffer, d.byteOffset, d.byteLength);
      if (d.length < 6) continue;
      var row = v.getUint16(0, true), col = v.getUint16(2, true);
      switch (r.id) {
        case 0x00FD: put(row, col, sst[v.getUint32(6, true)] || ''); break;                  // LABELSST
        case 0x0204: put(row, col, shortString(d, 6, 2)); break;                              // LABEL
        case 0x0203: put(row, col, num(v.getFloat64(6, true))); break;                        // NUMBER
        case 0x027E: put(row, col, num(rkValue(v.getUint32(6, true)))); break;                // RK
        case 0x00BD:                                                                           // MULRK
          for (var o = 4, c = col; o + 6 <= d.length - 2; o += 6, c++) put(row, c, num(rkValue(v.getUint32(o + 2, true))));
          break;
        case 0x0006:                                                                           // FORMULA: last value
          if (d[12] === 0xFF && d[13] === 0xFF) { if (d[6] === 0) pendingFormula = [row, col]; }
          else put(row, col, num(v.getFloat64(6, true)));
          break;
        case 0x0207:                                                                           // STRING (formula text result)
          if (pendingFormula) { put(pendingFormula[0], pendingFormula[1], shortString(d, 0, 2)); pendingFormula = null; }
          break;
      }
    }
    rows = rows.filter(function (rr) { return rr.some(function (x) { return String(x).trim() !== ''; }); });
    if (!rows.length) return fail('empty');
    return { ok: true, rows: rows };
  }

  var api = { read: read };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Xls = api;
})(this);
