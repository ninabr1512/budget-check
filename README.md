# Will this payment fit my budget?

A concept prototype by Nina Briantseva, not affiliated with ESTO.

**Problem.** A loan calculator shows the monthly payment ("€74.62 / month"), but people can't tell whether that payment is affordable once rent, food and their other loans are taken into account.
**Solution.** A budget-fit check that sits next to the calculator. The user enters rough monthly costs and gets a comfort scale, two clear numbers and concrete suggestions (a longer term, a smaller amount).

## How it works

- `index.html` + `app.js`: the UI (form, result, texts) and its behaviour.
- `logic.js`: pure calculation functions, with no access to the page or the network.
- `demo.html` + `demo.js`: a neutral loan calculator with the entry button. It shows the full flow: calculator → button → budget check with the amount and term passed in the link.
- `statement.js`: bank statement import. Parses CSV in the browser, finds the date/amount/debit-credit columns by header name (Estonian, English, Russian), sorts spending into categories by keywords (whole-word match: "esto" does not match "restoran"), turns totals into monthly averages and leaves out transfers between your own accounts.
- `xlsx.js` + `vendor/fflate.min.js`: Excel (.xlsx) import. An .xlsx file is a ZIP of XML files: fflate (MIT, 33 KB, self-hosted) unzips it in the browser, and a small reader takes the first sheet. A self-written reader instead of SheetJS: the npm version of SheetJS (0.18.5) has known vulnerabilities, and loading it from a CDN would break the "no external requests" rule.
- `sample.js` / `sample-statement.csv`: a fictional Swedbank-style statement (3 months) for the "try a sample" button.
- `photo.jpg`: photo by Gustavo Fring, Pexels.
- `tests.js`: edge-case tests for the logic. Run them with `node tests.js`.

No backend. Everything runs in the browser, so the line "we don't collect or store anything" is literally true.

Loan values can be passed in the link: `?amount=2000&term=36&rate=14.15&fee=6`.
Missing values fall back to defaults. Invalid ones also fall back, and the user sees a notice.

## Privacy: enforced, not just promised

- No backend, no analytics, no cookies, no fonts or scripts from other sites.
- Every page carries a Content Security Policy (`connect-src 'none'`, `default-src 'none'`, scripts only from its own files). The browser itself blocks any attempt to send data anywhere, so even a future bug could not leak what a user types or uploads.
- The bank statement is read with FileReader in memory and is gone when the tab closes.
- `<meta name="referrer" content="no-referrer">`: the loan values in the link are not passed on to other sites.

How to check: open DevTools → Network, fill in the form and upload a statement. The only requests are the page's own files.

## Calculation

- Monthly payment (annuity): `P × r / (1 − (1 + r)^−n) + monthly fee`, where `r = annual rate / 12`.
  Check: 2000 €, 36 months, 14.15%, 6 € fee → 74.50 € (the public calculator example shows 74.62 €).
- **Debt-service-to-income (DSTI)** = (current loan payments + new payment) / net income.
- **Left over** = net income − living costs − current loan payments − new payment.
  Living costs (6 fields in the UI, kept short on purpose): rent & utilities, food & household, transport, other regular costs.
  logic.js also supports separate utilities/phone/kids/savings fields if the form grows later.

## Comfort scale

Rules are checked from worst to best, and the first match wins.

| Zone | Condition |
|---|---|
| Doesn't fit | left over < 0 |
| Risky | DSTI > 40% or left over < 10% of income |
| Tight | DSTI > 30% (up to 40%) |
| Manageable | DSTI > 20% (up to 30%) or left over < 20% |
| Comfortable | DSTI ≤ 20% and left over ≥ 20% |

Exact boundaries: a DSTI of exactly 20% is Comfortable, exactly 30% is Manageable, exactly 40% is Tight.

## Methodology (sources)

- Eesti Pank: for housing loans, DSTI is capped at 50% of net income (stress-tested at a rate of at least 6%). This is a reference upper limit; it is not mandatory for consumer credit.
- European Commission study on over-indebtedness: spending more than 30% of income on debt repayments is a common over-indebtedness indicator. This sets the line between Manageable and Tight.
- 50/30/20 rule of thumb: used only as a hint about the share spent on essentials. It is not an official norm.
- EU Consumer Credit Directive 2023/2225: the creditworthiness assessment is done by the lender. That is why this tool is a self-check, not a credit decision.

## Edge cases covered by tests (58)

Input: empty, zero, negative, letters, special characters, `1 000,50` / `1000.50` / `1.000,50` / `1,000.50`, non-breaking spaces, the € sign, leading zeros, 1e9 and above.
Calculation: zero rate, 1-month term, zero amount, exact thresholds of 20/30/40% DSTI and 10/20% left over, left over exactly 0, costs above income, a payment above income, existing debts, the savings goal.
Suggestions: the suggested amount and the suggested term really land in the Comfortable zone; no room at all leads to 0.
Link: missing, invalid, negative, fractional or too-large parameters, a comma decimal, unknown parameters.
UI (checked manually): iPhone SE width, desktop, inline errors, a sticky result summary on mobile, a warning when only income is entered.

## Bank statement import: how it works

1. The user uploads a CSV or Excel (.xlsx) file, or drags it in. Max 5 MB. Old `.xls` and PDF get a clear message asking for CSV/Excel. The file is read with FileReader and never leaves the browser.
2. Excel: the first sheet is read, and Excel date numbers are converted to dates. CSV: the text is decoded as UTF-8; if that gives broken characters, it is decoded again as windows-1257 (Baltic encoding).
3. Non-transaction rows (opening/closing balance, turnover) are skipped.
4. Spending is grouped by payee, with a suggested category for each payee. The user can change any category or choose "Don't count".
5. "Fill in the form" fills the fields, adding chip fields (phone, subscriptions…) where needed. The user can still edit everything.

Known limits: tested on sample files built from typical export formats, not yet on real exports from every bank. The keyword list covers common Estonian merchants only.

## Next

- EN / RU / ET language switch.
- Metrics: click-through from the calculator, completion rate, application conversion by zone, changes to amount or term after a suggestion.
