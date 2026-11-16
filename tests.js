// Edge-case tests for logic.js. Run: node tests.js
const L = require('./logic.js');
let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`));
}

// --- Number input
eq('parse: empty → null, no error', L.parseAmount(''), { value: null, error: null });
eq('parse: spaces only', L.parseAmount('   '), { value: null, error: null });
eq('parse: 1200', L.parseAmount('1200').value, 1200);
eq('parse: 1 000,50 (comma decimal + space)', L.parseAmount('1 000,50').value, 1000.5);
eq('parse: 1000.50 (dot decimal)', L.parseAmount('1000.50').value, 1000.5);
eq('parse: 1.000,50 (EU thousands)', L.parseAmount('1.000,50').value, 1000.5);
eq('parse: 1,000.50 (US thousands)', L.parseAmount('1,000.50').value, 1000.5);
eq('parse: non-breaking space', L.parseAmount('1 500').value, 1500);
eq('parse: euro sign', L.parseAmount('950 €').value, 950);
eq('parse: leading zeros 0050', L.parseAmount('0050').value, 50);
eq('parse: zero', L.parseAmount('0').value, 0);
eq('parse: negative', L.parseAmount('-100').error, 'negative');
eq('parse: letters', L.parseAmount('abc').error, 'not_a_number');
eq('parse: mixed 12a', L.parseAmount('12a').error, 'not_a_number');
eq('parse: special chars', L.parseAmount('<script>').error, 'not_a_number');
eq('parse: two commas 1,2,3', L.parseAmount('1,2,3').error, 'not_a_number');
eq('parse: two dots 1.2.3', L.parseAmount('1.2.3').error, 'not_a_number');
eq('parse: 1 000 000 000 ok', L.parseAmount('1 000 000 000').value, 1e9);
eq('parse: above 1e9', L.parseAmount('1000000001').error, 'too_large');
eq('parse: 1e5 notation rejected', L.parseAmount('1e5').error, 'not_a_number');

// --- Payment formula (matches the public example: 2000 € / 36 mo / 14.15% / 6 € fee ≈ 74.50)
eq('payment: 2000/36/14.15%/6€', L.monthlyPayment(2000, 14.15, 36, 6), 74.5);
eq('payment: zero rate', L.monthlyPayment(1200, 0, 12, 0), 100);
eq('payment: zero rate + fee', L.monthlyPayment(1200, 0, 12, 6), 106);
eq('payment: 1 month', L.monthlyPayment(1000, 12, 1, 0), 1010);
eq('payment: zero amount', L.monthlyPayment(0, 14, 36, 6), 0);
eq('maxPrincipal is inverse of payment', Math.abs(L.maxPrincipal(74.5, 14.15, 36, 6) - 2000) <= 1, true);
eq('maxPrincipal zero rate', L.maxPrincipal(106, 0, 12, 6), 1200);
eq('maxPrincipal: payment below fee → 0', L.maxPrincipal(5, 14, 36, 6), 0);

// --- Zones and exact thresholds (income 1000, everything else in newPayment/expenses)
const base = { income: 1000 };
const z = (o) => L.assess(Object.assign({}, base, o)).zone;
eq('no income → no_income', L.assess({ income: 0 }).zone, 'no_income');
eq('only income, no loan → comfortable', z({}), 'comfortable');
eq('DSTI exactly 20% → comfortable', z({ newPayment: 200 }), 'comfortable');
eq('DSTI 20.1% → tolerable', z({ newPayment: 201 }), 'tolerable');
eq('DSTI exactly 30% → tolerable', z({ newPayment: 300 }), 'tolerable');
eq('DSTI 30.1% → strained', z({ newPayment: 301 }), 'strained');
eq('DSTI exactly 40% → strained', z({ newPayment: 400 }), 'strained');
eq('DSTI 40.1% → risky', z({ newPayment: 401 }), 'risky');
eq('left over exactly 20% → comfortable', z({ housing: 700, newPayment: 100 }), 'comfortable');
eq('left over 19.9% → tolerable', z({ housing: 701, newPayment: 100 }), 'tolerable');
eq('left over exactly 10% → tolerable', z({ housing: 800, newPayment: 100 }), 'tolerable');
eq('left over 9.9% → risky', z({ housing: 801, newPayment: 100 }), 'risky');
eq('left over exactly 0 → risky (not doesnt_fit)', z({ housing: 900, newPayment: 100 }), 'risky');
eq('costs > income → doesnt_fit', z({ housing: 950, newPayment: 100 }), 'doesnt_fit');
eq('payment > income → doesnt_fit', z({ newPayment: 1500 }), 'doesnt_fit');
eq('existing debts count in DSTI', L.assess({ income: 1000, debts: 150, newPayment: 100 }).dsti, 25);
eq('savings do not change the zone', z({ newPayment: 100, savings: 900 }), 'comfortable');
eq('savings shown separately', L.assess({ income: 1000, newPayment: 100, savings: 300 }).afterSavings, 600);
eq('very large income does not break', z({ income: 1e9, newPayment: 74.5 }), 'comfortable');

// --- Suggestions
const budget = { income: 1000, housing: 400, food: 200, debts: 100 };
const loan = { amount: 3000, term: 24, rate: 14.15, fee: 6 };
const s = L.suggestions(budget, loan);
eq('suggested max amount keeps you comfortable',
   L.assess(Object.assign({}, budget, { newPayment: L.monthlyPayment(s.maxAmount, 14.15, 24, 6) })).zone, 'comfortable');
eq('suggested longer term is comfortable', s.longerTerm &&
   L.assess(Object.assign({}, budget, { newPayment: s.longerTerm.payment })).zone, 'comfortable');
eq('no room at all → max amount 0', L.suggestions({ income: 1000, housing: 900 }, loan).maxAmount, 0);

// --- Link parameters
const D = { amount: 2000, term: 36, rate: 14.15, fee: 6 };
const LIM = { amount: { min: 1, max: 1e6 }, term: { min: 1, max: 120 }, rate: { min: 0, max: 100 }, fee: { min: 0, max: 1000 } };
eq('URL: no params → defaults', L.readLoanParams('', D, LIM).loan, D);
eq('URL: valid params', L.readLoanParams('?amount=5000&term=48&rate=9.9&fee=0', D, LIM).loan, { amount: 5000, term: 48, rate: 9.9, fee: 0 });
eq('URL: invalid amount → default + problem', L.readLoanParams('?amount=abc&term=12', D, LIM), { loan: { amount: 2000, term: 12, rate: 14.15, fee: 6 }, problems: ['amount'], fromLink: true });
eq('URL: negative term rejected', L.readLoanParams('?term=-5', D, LIM).problems, ['term']);
eq('URL: fractional term rejected', L.readLoanParams('?term=12.5', D, LIM).problems, ['term']);
eq('URL: term above max rejected', L.readLoanParams('?term=999', D, LIM).problems, ['term']);
eq('URL: comma decimal in rate', L.readLoanParams('?rate=14,15', D, LIM).loan.rate, 14.15);
eq('URL: unknown params ignored', L.readLoanParams('?foo=bar', D, LIM).problems, []);

// --- Bank statement import (statement.js)
const S = require('./statement.js');
const fs = require('fs');
eq('csv: quoted cells with ; inside', S.parseCSV('"a;b";c\n1;2').rows, [['a;b', 'c'], ['1', '2']]);
eq('csv: doubled quotes', S.parseCSV('"say ""hi""",x\n1,2').rows[0][0], 'say "hi"');
eq('csv: CRLF + BOM', S.parseCSV('﻿a;b\r\n1;2\r\n').rows, [['a', 'b'], ['1', '2']]);
eq('csv: tab delimiter', S.parseCSV('a\tb\n1\t2').delimiter, '\t');
eq('signed: -12,50', S.parseSigned('-12,50'), -12.5);
eq('signed: 1 234.56', S.parseSigned('1 234.56'), 1234.56);
eq('signed: unicode minus', S.parseSigned('−8,00'), -8);
eq('signed: text → null', S.parseSigned('abc'), null);
eq('date: 31.01.2026', +S.parseDate('31.01.2026'), Date.UTC(2026, 0, 31));
eq('date: 2026-01-31', +S.parseDate('2026-01-31'), Date.UTC(2026, 0, 31));
eq('date: 31.02.2026 invalid', S.parseDate('31.02.2026'), null);
eq('category: ESTO → debts', S.categorize('ESTO AS'), 'debts');
eq('category: restoran is not ESTO (it is food)', S.categorize('Restoran Kohvik'), 'food');
eq('category: Bolt Food → food, Bolt ride → transport', [S.categorize('Bolt Food'), S.categorize('BOLT.EU/R/1')], ['food', 'transport']);
eq('category: Estonian letters (üür)', S.categorize('Korteri üür'), 'housing');
eq('category: Elektrilevi → utilities', S.categorize('Elektrilevi OÜ'), 'utilities');
eq('investment platforms → Other (not loans, not ignored)', ['BONDORA CAPITAL OÜ', 'TRADE REPUBLIC BANK GMBH', 'Lightyear Europe AS'].map(S.categorize), ['other', 'other', 'other']);
eq('money back from an investment platform is not income', (function () {
  const r = S.analyse('Kuupäev;Saaja/Maksja;Selgitus;Summa;Deebet/Kreedit\n01.09.2026;Tööandja OÜ;Palk;1000,00;K\n02.09.2026;BONDORA CAPITAL OÜ;Go&Grow;200,00;D\n20.09.2026;Go&Grow OÜ;Väljamakse;150,00;K\n');
  return [r.income, r.totals.other]; })(), [1000, 200]);
eq('category: own transfer ignored', S.categorize('Oma kontode vaheline ülekanne'), 'ignore');

const sample = S.analyse(fs.readFileSync(__dirname + '/sample-statement.csv', 'utf8'));
eq('sample: parsed, 3 months', [sample.ok, sample.months], [true, 3]);
eq('sample: income 1650/month (opening balance row skipped)', sample.income, 1650);
eq('sample: rent 520, utilities separate', [sample.totals.housing, Math.round(sample.totals.utilities)], [520, 74]);
eq('sample: own transfer not counted', sample.totals.ignore, undefined);

// LHV-style: comma-separated, English headers, signed amounts, no D/C column
const lhv = 'Date,Payee,Description,Amount,Currency\n2026-09-01,Employer OÜ,Salary,2000.00,EUR\n2026-09-03,RIMI EESTI,Card,-45.10,EUR\n2026-09-30,Telia,Phone,-20.00,EUR\n';
const l = S.analyse(lhv);
eq('signed-amount format: income and expenses', [l.ok, l.income, l.totals.food, l.totals.x_phone], [true, 2000, 45.1, 20]);
// Russian headers
const ru = 'Дата;Получатель;Назначение;Сумма\n01.10.2026;Работа;Зарплата;1500,00\n05.10.2026;Selver;Покупка;-30,00\n';
eq('russian headers', S.analyse(ru).totals.food, 30);

eq('refund from a shop reduces spending, not income', (function () {
  const r = S.analyse('Kuupäev;Saaja/Maksja;Summa;Deebet/Kreedit\n01.09.2026;Tööandja OÜ;1000,00;K\n02.09.2026;SELVER AS;50,00;D\n03.09.2026;SELVER AS;10,00;K\n');
  return [r.income, r.totals.food]; })(), [1000, 40]);
eq('category: "Restoran Esto-Kohvik" is not a loan', S.categorize('Restoran Esto-Kohvik'), 'food');
eq('category: cafés, restaurants and grocery shops → food',
   ['KATHARINENTHAL 10127', 'CAFFEINE KOHVIK 10111 TALLINN', 'GOURMETCOFFEEKADRIORG 1', 'Chou Chou 10126 Tallinn', 'SOLARISE TOIDUPOOD 10143 TALLINN'].map(S.categorize),
   ['food', 'food', 'food', 'food', 'food']);
eq('category: "kohvik" as a word inside a street name does not break other rules', S.categorize('Elektrilevi OÜ'), 'utilities');
eq('import: empty file', S.analyse('').error, 'empty');
eq('import: one line only', S.analyse('just text').error, 'not_csv');
eq('import: unknown columns', S.analyse('foo;bar\n1;2\n').error, 'unknown_format');
eq('import: header but no rows', S.analyse('Kuupäev;Summa\n').error, 'not_csv');
eq('import: rows with junk only', S.analyse('Kuupäev;Summa\nabc;xyz\n').error, 'no_transactions');

// --- Excel (.xlsx) import
const X = require('./xlsx.js');
const refCsv = S.analyse(fs.readFileSync(__dirname + '/validation/swedbank_validation_2026-08_10.csv', 'utf8'));
for (const f of ['swedbank_validation_2026-08_10.xlsx', 'english_signed_2026-08_10.xlsx']) {
  const x = X.read(fs.readFileSync(__dirname + '/validation/' + f));
  const r = S.analyseRows(x.rows);
  eq('xlsx: ' + f + ' gives the same result as CSV', [r.months, r.income, r.totals], [refCsv.months, refCsv.income, refCsv.totals]);
}
eq('xlsx: Excel date serial 46235 → 1 Aug 2026', +S.parseDate('46235'), Date.UTC(2026, 7, 1));
eq('xlsx: random bytes → xlsx_bad', X.read(new Uint8Array([1, 2, 3, 4, 5])).error, 'xlsx_bad');
eq('xlsx: text file renamed to .xlsx → xlsx_bad', X.read(Buffer.from('Kuupäev;Summa\n01.01.2026;5')).error, 'xlsx_bad');

// --- File type by content, encodings, HTML tables
const ref2 = S.analyse(fs.readFileSync(__dirname + '/validation/swedbank_validation_2026-08_10.csv', 'utf8'));
for (const f of ['swedbank_russian_windows1251.csv', 'html_table_saved_as.xls', 'csv_saved_as.xls']) {
  const r = S.analyseBytes(new Uint8Array(fs.readFileSync(__dirname + '/validation/' + f)));
  eq('bytes: ' + f + ' gives the same result as the reference CSV', [r.ok, r.income, r.totals], [true, ref2.income, ref2.totals]);
}
eq('sniff: PK → xlsx, %PDF → pdf, D0CF11E0 → old xls, text → text',
   [S.sniff(Buffer.from('PK\x03\x04')), S.sniff(Buffer.from('%PDF-1.7')), S.sniff(Buffer.from('d0cf11e0a1b11ae1', 'hex')), S.sniff(Buffer.from('Kuupäev;Summa'))],
   ['xlsx', 'pdf', 'xls', 'text']);
eq('russian headers incl. "Дата операции" and "Пояснение"',
   S.mapColumns([['Счёт клиента', 'Тип строки', 'Дата операции', 'Получатель/Плательщик', 'Пояснение', 'Сумма', 'Валюта', 'Дебет/Кредит']]),
   { date: 2, amount: 5, dc: 7, payee: 3, desc: 4, rowtype: 1, headerRow: 0 });
eq('unknown columns → the user sees their own column names',
   S.analyse('Foo;Bar;Baz\n1;2;3\n').columns, ['Foo', 'Bar', 'Baz']);

// --- Old binary Excel (.xls, BIFF8)
const XL = require('./xls.js');
for (const f of ['swedbank_validation_2026-08_10.xls', 'english_signed_libreoffice.xls']) {
  const x = XL.read(fs.readFileSync(__dirname + '/validation/' + f));
  const r = S.analyseRows(x.rows);
  eq('xls: ' + f + ' gives the same result as CSV', [r.ok, r.income, r.totals], [true, ref2.income, ref2.totals]);
}
eq('xls: second sheet is ignored (first sheet only)', XL.read(fs.readFileSync(__dirname + '/validation/swedbank_validation_2026-08_10.xls')).rows.some(r => r.includes('ignore me')), false);
eq('xls: Estonian letters from the shared strings', XL.read(fs.readFileSync(__dirname + '/validation/swedbank_validation_2026-08_10.xls')).rows[0][0], 'Konto väljavõte');
const xlsBytes = fs.readFileSync(__dirname + '/validation/swedbank_validation_2026-08_10.xls');
eq('xls: truncated file → error, no crash', XL.read(xlsBytes.subarray(0, 1500)).ok, false);
eq('xls: OLE header followed by junk → xls_bad', XL.read(Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(600, 7)])).error, 'xls_bad');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
