/*
 * Bank statement import — parsing and categorisation.
 * Pure functions, no network: the file is read and processed only in the browser.
 *
 * Supported: CSV exports where the header row has a date column and an amount column
 * (Estonian, English or Russian names). Expense/income is taken from a debit/credit
 * column when there is one (Swedbank, SEB, LHV style), otherwise from the sign of the amount.
 */
(function (root) {
  'use strict';

  var MAX_BYTES = 5 * 1024 * 1024;

  // Header names, lower-case: Estonian, English, Russian, Latvian, Lithuanian.
  // A header cell matches if it equals a name, or (second pass) contains it — "Дата операции" contains "дата".
  var COLS = {
    date:   ['kuupäev', 'kuupaev', 'tehingu kuupäev', 'date', 'booking date', 'transaction date', 'value date',
             'дата', 'дата операции', 'дата проводки', 'datums', 'data'],
    amount: ['summa', 'amount', 'сумма', 'summa (eur)', 'amount (eur)', 'summa eur', 'сумма операции', 'suma'],
    dc:     ['deebet/kreedit', 'deebet/kreedit (d/c)', 'd/k', 'd/c', 'debit/credit', 'debit/credit (d/c)', 'дебет/кредит',
             'debets/kredīts', 'debetas/kreditas'],
    payee:  ['saaja/maksja', 'from/to', 'kellelt/kellele', 'saaja/maksja nimi', 'saaja/maksja name', 'payee', 'counterparty', 'beneficiary/payer',
             "beneficiary's/payer's name", 'beneficiary', 'получатель/плательщик', 'получатель', 'плательщик',
             'saņēmējs/maksātājs', 'gavėjas/mokėtojas'],
    desc:   ['selgitus', 'description', 'details', 'explanation', 'kirjeldus', 'назначение', 'назначение платежа',
             'пояснение', 'описание', 'детали', 'informācija', 'paskirtis'],
    rowtype:['reatüüp', 'reatuup', 'row type', 'тип строки', 'тип записи']
  };

  // Categories map to form fields. Order matters: the first rule that matches wins.
  // A keyword must start a word: "esto" matches "ESTO AS", but not "restoran".
  var RULES = [
    { cat: 'ignore',    words: ['oma kontode', 'own account', 'between own accounts', 'между своими счетами', 'перевод между счетами', 'starp saviem kontiem', 'hoius', 'investeer', 'kogumispension', 'bondora', 'go&grow', 'trade republic', 'lightyear', 'mintos', 'funderbeam', 'investment'] },
    { cat: 'debts',     words: ['esto as', 'esto.ee', 'inbank', 'bigbank', 'holm bank', 'tf bank', 'laen', 'liising', 'krediit', 'loan', 'järelmaks', 'kodulaen'] },
    { cat: 'food',      words: [
      // groceries
      'rimi', 'selver', 'prisma', 'maxima', 'lidl', 'coop', 'konsum', 'grossi', 'barbora', 'toidupood', 'toidukaubad', 'solarise toidu', 'kaubamaja toidu', 'stockmann',
      // eating out and delivery
      'bolt food', 'wolt', 'foodora', 'kohvik', 'kohvi', 'coffee', 'gourmetcoffee', 'caffeine', 'cafe', 'café', 'kafe', 'kafé', 'espresso',
      'restoran', 'restaurant', 'bistro', 'pagar', 'bakery', 'pizza', 'sushi', 'burger', 'kebab', 'trattoria',
      'mcdonald', 'hesburger', 'kfc', 'subway', 'katharinenthal', 'chou chou'] },
    { cat: 'x_phone',   words: ['telia', 'elisa', 'tele2', 'starman'] },
    { cat: 'x_subs',    words: ['netflix', 'spotify', 'apple.com', 'icloud', 'youtube', 'disney', 'hbo', 'storytel', 'adobe', 'openai', 'chatgpt', 'anthropic', 'go3', 'amazon prime'] },
    { cat: 'x_ins',     words: ['kindlustus', 'insurance', 'ergo', 'salva', 'gjensidige', 'compensa', 'seesam', 'if p&c'] },
    { cat: 'housing',   words: ['üür', 'rent', 'kinnisvarahaldus', 'üürileandja', 'ipotek', 'ипотек', 'hüpoteek', 'mortgage'] },
    { cat: 'utilities', words: ['korteriühistu', 'elektrilevi', 'eesti energia', 'enefit', 'tallinna vesi', 'adven', 'utilitas', 'eesti gaas', 'elering', 'imatra', 'kommunaal'] },
    { cat: 'transport', words: ['bolt', 'uber', 'elron', 'tallinna linnatransport', 'ühiskaart', 'circle k', 'neste', 'olerex', 'alexela', 'europark', 'parkimine', 'parking', 'lux express', 'citybee'] },
    { cat: 'x_sport',   words: ['myfitness', 'gym', 'fitness', 'jõusaal', 'stebby', 'tantsukool', 'ratsa'] },
    { cat: 'x_pets',    words: ['lemmikloom', 'zoo', 'veterinaar', 'loomakliinik', 'petcity'] },
    { cat: 'x_kids',    words: ['lasteaed', 'kindergarten', 'huvikool', 'lastehoid', 'school'] }
  ];
  RULES.forEach(function (r) {
    r.re = r.words.map(function (w) {
      return new RegExp('(^|[^\\p{L}\\d])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u');
    });
  });

  var SKIP_ROWS = /algsaldo|lõppsaldo|loppsaldo|käive|kaive|opening balance|closing balance|turnover|начальный (баланс|остаток)|конечный (баланс|остаток)|обороты|sākuma atlikums|beigu atlikums/i;

  /** Split CSV text into rows. Handles quotes, doubled quotes inside quotes, CRLF and a BOM. */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var delim = detectDelimiter(text);
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
    return { rows: rows, delimiter: delim };
  }

  function detectDelimiter(text) {
    var sample = text.split(/\r?\n/).slice(0, 10).join('\n');
    var best = ';', bestCount = 0;
    [';', ',', '\t'].forEach(function (d) {
      var n = 0, q = false;
      for (var i = 0; i < sample.length; i++) {
        if (sample[i] === '"') q = !q; else if (!q && sample[i] === d) n++;
      }
      if (n > bestCount) { best = d; bestCount = n; }
    });
    return best;
  }

  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/'); }

  /** Find the header row (within the first 15 rows) and the index of each known column. */
  function mapColumns(rows) {
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var cells = rows[r].map(norm), map = {}, used = {};
      [false, true].forEach(function (loose) {
        Object.keys(COLS).forEach(function (key) {
          if (map[key] !== undefined) return;
          for (var n = 0; n < COLS[key].length; n++) {
            for (var i = 0; i < cells.length; i++) {
              if (used[i] || !cells[i]) continue;
              var hit = loose ? cells[i].indexOf(COLS[key][n]) > -1 && COLS[key][n].length >= 4 : cells[i] === COLS[key][n];
              if (hit) { map[key] = i; used[i] = true; return; }
            }
          }
        });
      });
      if (map.date !== undefined && map.amount !== undefined) { map.headerRow = r; return map; }
    }
    return null;
  }

  /** The row that most looks like a header (most non-empty cells) — shown to the user when nothing matched. */
  function guessHeader(rows) {
    var best = [];
    rows.slice(0, 15).forEach(function (r) {
      var cells = r.map(function (c) { return String(c).trim(); }).filter(Boolean);
      if (cells.length > best.length) best = cells;
    });
    return best.slice(0, 12);
  }

  /** Amount that may be negative: "-12,50", "1 234.56", "−8,00". */
  function parseSigned(s) {
    s = String(s || '').replace(/[\s  €]/g, '').replace(/−/g, '-');
    if (s === '') return null;
    var neg = /^-/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/^[-+(]|\)$/g, '');
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc > -1) s = s.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return neg ? -n : n;
  }

  /** Dates: 31.01.2026, 2026-01-31, 31/01/2026, 31-01-2026. Returns a Date or null. */
  function parseDate(s) {
    s = String(s || '').trim();
    // Excel stores dates as a day count since 30.12.1899 (e.g. 46235 = 1 Aug 2026).
    if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5);
      return d;
    }
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return mk(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
    if (m) return mk(+m[3], +m[2], +m[1]);
    return null;
    function mk(y, mo, d) {
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      var dt = new Date(Date.UTC(y, mo - 1, d));
      return dt.getUTCMonth() === mo - 1 ? dt : null;
    }
  }

  function categorize(text) {
    var t = norm(text);
    for (var i = 0; i < RULES.length; i++) {
      for (var j = 0; j < RULES[i].re.length; j++) {
        if (RULES[i].re[j].test(t)) return RULES[i].cat;
      }
    }
    return 'other';
  }

  /**
   * Main entry: CSV text → { ok, error, months, income, groups, totals, count }.
   * groups: expenses grouped by payee, each with a suggested category the user can change.
   */
  function analyse(text) {
    if (!text || !String(text).trim()) return { ok: false, error: 'empty' };
    var parsed = parseCSV(text);
    if (parsed.rows.length < 2) return { ok: false, error: 'not_csv' };
    return analyseRows(parsed.rows);
  }

  /** Same analysis for rows that come from any source (CSV or Excel). */
  function analyseRows(rows) {
    var parsed = { rows: rows.map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : String(v); }); }) };
    if (parsed.rows.length < 2) return { ok: false, error: 'not_csv' };
    var map = mapColumns(parsed.rows);
    if (!map) return { ok: false, error: 'unknown_format', columns: guessHeader(parsed.rows) };

    var tx = [];
    for (var r = map.headerRow + 1; r < parsed.rows.length; r++) {
      var row = parsed.rows[r];
      var get = function (k) { return map[k] !== undefined ? (row[map[k]] || '').trim() : ''; };
      if (map.rowtype !== undefined && get('rowtype') && get('rowtype') !== '20') continue; // Swedbank: 20 = transaction
      var payee = get('payee'), desc = get('desc');
      if (SKIP_ROWS.test(payee + ' ' + desc)) continue;
      var date = parseDate(get('date')), amount = parseSigned(get('amount'));
      if (!date || amount === null || amount === 0) continue;

      var expense;
      var dc = norm(get('dc'));
      if (dc) expense = dc === 'd';                 // D = debit (money out), K / C = credit (money in)
      else expense = amount < 0;
      tx.push({ date: date, amount: Math.abs(amount), expense: expense, payee: payee, desc: desc });
    }
    if (!tx.length) return { ok: false, error: 'no_transactions' };

    // Period length in months, from the first to the last transaction (at least 1).
    var min = Math.min.apply(null, tx.map(function (t) { return +t.date; }));
    var max = Math.max.apply(null, tx.map(function (t) { return +t.date; }));
    // Statements are usually exported for whole months, so a value close to a whole number is rounded to it.
    var raw = ((max - min) / 864e5 + 1) / 30.44;
    var months = Math.max(1, Math.abs(raw - Math.round(raw)) <= 0.25 ? Math.round(raw) : Math.round(raw * 10) / 10);

    var incomeTotal = 0, groups = {}, order = [];
    function group(t, cat) {
      var name = t.payee || t.desc.slice(0, 40) || 'Unknown';
      var key = norm(name);
      if (!groups[key]) { groups[key] = { name: name, total: 0, count: 0, category: cat }; order.push(key); }
      return groups[key];
    }
    // Pass 1: money out.
    tx.forEach(function (t) {
      if (!t.expense) return;
      var g = group(t, categorize(t.payee + ' ' + t.desc));
      g.total += t.amount; g.count++;
    });
    // Pass 2: money in. A refund from a shop we know (or from a payee we already paid)
    // reduces spending there; everything else counts as income.
    tx.forEach(function (t) {
      if (t.expense) return;
      var cat = categorize(t.payee + ' ' + t.desc);
      if (cat === 'ignore') return;
      var known = groups[norm(t.payee || t.desc.slice(0, 40))];
      if (known || (cat !== 'other' && t.payee)) {
        var g = group(t, cat);
        g.total -= t.amount; g.count++;
      } else {
        incomeTotal += t.amount;
      }
    });

    var list = order.map(function (k) { return groups[k]; })
      .sort(function (a, b) { return b.total - a.total; })
      // A refund group can be negative; it then lowers its category total (never below 0, see totalsByCategory).
      .map(function (g) { g.monthly = round2(g.total / months); g.total = round2(g.total); return g; });

    return {
      ok: true, count: tx.length, months: months,
      income: round2(incomeTotal / months),
      groups: list,
      totals: totalsByCategory(list)
    };
  }

  /** Monthly totals per category from (possibly user-edited) groups. */
  function totalsByCategory(groups) {
    var t = {};
    groups.forEach(function (g) {
      if (g.category === 'ignore') return;
      t[g.category] = round2((t[g.category] || 0) + g.monthly);
    });
    Object.keys(t).forEach(function (k) { if (t[k] < 0) t[k] = 0; });
    return t;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /** What kind of file is this, by its first bytes (not by the name — banks often call CSV or HTML ".xls"). */
  function sniff(bytes) {
    var b = bytes;
    if (b[0] === 0x50 && b[1] === 0x4B) return 'xlsx';                                   // "PK" — a ZIP, i.e. .xlsx
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';  // "%PDF"
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'xls';  // old binary Excel
    return 'text';
  }

  /** Rows of an HTML <table> (some banks export this and call it .xls). */
  function htmlTableRows(html) {
    var rows = [], reTr = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, reTd = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi, tr, td;
    while ((tr = reTr.exec(html))) {
      var row = [];
      reTd.lastIndex = 0;
      while ((td = reTd.exec(tr[1]))) {
        row.push(td[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
          .replace(/\s+/g, ' ').trim());
      }
      if (row.some(Boolean)) rows.push(row);
    }
    return rows;
  }

  /**
   * Text file (CSV, or an HTML table) in an unknown encoding → analysis.
   * Tries UTF-8, then the Baltic (windows-1257) and Cyrillic (windows-1251) Windows encodings,
   * and keeps the first one in which the columns are recognised.
   */
  function analyseBytes(bytes) {
    var tried = [], encodings = ['utf-8', 'windows-1257', 'windows-1251'];
    for (var i = 0; i < encodings.length; i++) {
      var text;
      try { text = new TextDecoder(encodings[i]).decode(bytes); } catch (e) { continue; }
      if (i === 0 && text.indexOf('\uFFFD') === -1) encodings = ['utf-8'];   // valid UTF-8: no need to guess
      var r = /<table\b/i.test(text.slice(0, 5000)) ? analyseRows(htmlTableRows(text)) : analyse(text);
      r.encoding = encodings[i];
      if (r.ok) return r;
      tried.push({ r: r, cyr: (text.slice(0, 3000).match(/[\u0400-\u04FF]/g) || []).length, bad: text.indexOf('\uFFFD') > -1 });
    }
    // Nothing matched: report the attempt whose text looks most readable (for the "columns in your file" hint).
    tried.sort(function (a, b) { return (a.bad - b.bad) || (b.cyr - a.cyr); });
    return tried.length ? tried[0].r : { ok: false, error: 'read' };
  }

  var api = { MAX_BYTES: MAX_BYTES, parseCSV: parseCSV, mapColumns: mapColumns, parseSigned: parseSigned,
              parseDate: parseDate, guessHeader: guessHeader, categorize: categorize, analyse: analyse, analyseRows: analyseRows, analyseBytes: analyseBytes, sniff: sniff, htmlTableRows: htmlTableRows, totalsByCategory: totalsByCategory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Statement = api;
})(this);
