# Validation file: Swedbank-style bank statement

**Files**
- `swedbank_validation_2026-08_10.csv`: UTF-8
- `swedbank_validation_2026-08_10_windows1257.csv`: the same data in the Baltic Windows encoding
- `swedbank_validation_2026-08_10.xlsx`: the same data as Excel, with real date/number cells and title rows above the header
- `english_signed_2026-08_10.xlsx`: English headers, signed amounts (no D/K column), plus a second sheet that must be ignored

- `swedbank_validation_2026-08_10.pdf`: a table-style PDF (header on every page, right-aligned amounts, wrapped descriptions, page footers)
- `signed_lines_2026-08_10.pdf`: a PDF without column headers, one line per transaction, signed amounts

- `swedbank_english_layout_2026-08_10.pdf`: a synthetic copy of a real Swedbank English PDF layout (headers centred over left-aligned columns, row numbers on the left, a Balance column, card payments wrapped over two lines, opening/closing balance and turnover lines, page footers). Fictional data.
- `swedbank_russian_windows1251.csv`: Swedbank-style export with Russian column names, in the Cyrillic Windows encoding
- `swedbank_validation_2026-08_10.xls`: real old binary Excel (BIFF8, written with xlwt): date cells, numbers, title rows, a second sheet to ignore
- `english_signed_libreoffice.xls`: real old binary Excel saved by LibreOffice (different record types)
- `html_table_saved_as.xls`: an HTML table with an `.xls` name (some banks export this as "Excel")
- `csv_saved_as.xls`: a CSV file with an `.xls` name

All these files must give the same result (PDF: within 5 cents because of rounding when summing monthly averages).

**Data**
- Fictional data for August to October 2026: 113 transactions. The account number is not real.
- Structure modelled on Swedbank Estonia's CSV export: `;` separator, every value in quotes, comma as the decimal separator, a D/K column, and service rows for the opening balance (10), turnover (82) and closing balance (86). Transaction-type codes are approximate.

## What the file checks

| # | Case | Row in the file | Expected behaviour |
|---|---|---|---|
| 1 | Service rows | Algsaldo, Käive ×2, Lõppsaldo | Skipped; not counted as income or spending |
| 2 | Salary + one-off bonus | Näidis Tööandja OÜ (K) | Counted as income: 3 × 1650 + 300 |
| 3 | Refund from a shop | SELVER AS "Tagastus" 12.80 (K) | Reduces Food; **not** income |
| 4 | Transfers between own accounts | "Oma kontode vaheline ülekanne", D and K | Not counted at all ("Don't count") |
| 5 | `;` and `"` inside a value | `Kohvik "Mõnus"; Kalamaja` | Read as one name; columns do not shift |
| 6 | Estonian letters, Š and Ž | Õunapuu, Pärnu, Žurnaal Šokolaad | Shown correctly in both encodings |
| 7 | Empty payee | ATM cash withdrawal | Grouped by description, category Other |
| 8 | Merchant only in the description | `'4500 **** **** 1234 09.09.26 RIMI MUSTAMAE` | Food |
| 9 | "Esto" inside another name | Restoran Esto-Kohvik | Food (a restaurant), **not** Current loans |
| 10 | Bolt Food vs Bolt ride | Bolt Food / BOLT.EU | Food / Transport |
| 11 | Utilities separate from rent | Elektrilevi, Eesti Energia, Korteriühistu | Utilities; the rent goes to Rent or mortgage |
| 12 | Chip categories | Telia, Spotify, Netflix, If, MyFitness, Lasteaed, Veterinaarkliinik | Added as chip fields automatically |

## Expected result (period = 3 months, monthly averages)

| Field | Exact | In the form (rounded) |
|---|---|---|
| Net income | 1 750.00 | 1750 |
| Rent or mortgage | 520.00 | 520 |
| Utilities | 170.28 | 170 |
| Food & household (incl. cafés and restaurants) | 434.02 | 434 |
| Transport | 113.02 | 113 |
| Current loan payments | 109.95 | 110 |
| Other regular costs | 35.23 | 35 |
| Phone & internet | 32.90 | 33 |
| Subscriptions | 21.98 | 22 |
| Insurance | 14.50 | 15 |
| Children | 45.00 | 45 |
| Pets | 14.00 | 14 |
| Sport & hobbies | 39.00 | 39 |

With the default loan (2000 €, 36 months, 14.15%, 6 € fee → 74.50 €/month):
- **Zone: Risky**
- Debts: 10.5% of income
- Left each month: €126 (7.2% of income, below the 10% threshold)
- Tip: "Your current costs and loans already leave little room…" (no longer term or smaller amount can reach the green zone)

## Bugs this file found (fixed)

PDF work found three more:
3. pdf.js returned a long description and the amount next to it as one piece of text ("…MUSTAMAE23,40"); the transaction was lost. Now the amount is split off.
4. A refund whose payee name differs slightly from the purchase ("SELVER AS · Tagastus" vs "SELVER AS · Kaardimakse") was dropped instead of lowering Food. Now refunds lower the category total.
5. After a broken PDF, the next PDF hung on "Reading PDF…" because pdf.js kept the failed document open. Now every document is closed after reading, with a 30-second timeout.

Found with a real bank file on an iPhone:
6. iOS greyed out .csv files in the file picker because of the `accept` filter. Removed; the type is now checked by the file's content.
7. On iOS Safari the upload button stopped responding after the picker was cancelled. The button is now a `<label>` for the file input, so the browser opens the picker natively.
8. A real export was rejected as "old .xls" by its name, and a Russian-language CSV wasn't recognised (Cyrillic encoding, Russian column names). Now the type is decided by the first bytes (ZIP → Excel, %PDF → PDF, OLE2 → real old .xls, otherwise text), text is tried in UTF-8, windows-1257 and windows-1251, and Russian/Latvian/Lithuanian column names are recognised. If columns still aren't recognised, the message lists the file's own column names.

9. A real Swedbank PDF (English) wasn't read: its column headers are centred while the text is left-aligned, so descriptions landed in the wrong column; row numbers stuck to the dates; and the payee column is called "From / To". Now column starts are taken from where text regularly starts in the data rows, row numbers are dropped, wrapped lines are joined only if they contain no money (so "closing balance" and turnover lines are not glued to the last transaction), and "From / To" is recognised. Checked on a real statement: 55 of 55 transactions read. The real file was used only for this check and was not kept.

10. Old binary Excel (.xls) was refused. Added a small reader (OLE2 container + BIFF8 records), checked cell by cell against the independent xlrd library on files written by two different programs.

11. Cafés, restaurants and grocery shops with unknown names went to Other (found on a real statement). Added general words (kohvik, coffee, café, restoran, restaurant, toidupood, pagar, pizza…) and common chains to Food. Expected values above updated: Food 434, Other 35; the zone does not change.

12. Payments to investment platforms (Bondora, Trade Republic, Lightyear, Mintos…) now count as a monthly cost in Other, so what is left each month is not overstated. Money coming back from them is not counted as income.

Earlier:

1. A refund from a shop was counted as income, and spending in that shop did not go down.
2. "Restoran Esto-Kohvik" was categorised as a loan payment, because the keyword "esto" matched the start of the word.

The expected values were computed independently of the tool's code (a separate Python script that applies the expected category to each row), then compared with the tool's output. Both encodings now match exactly.
