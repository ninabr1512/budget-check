/*
 * Budget-fit check — calculation logic.
 * Pure functions only: no DOM, no network. Everything runs in the browser.
 * Kept separate from the UI so it can be tested on its own (see tests.js).
 */
(function (root) {
  'use strict';

  // Comfort-scale thresholds (share of net monthly income).
  // Sources and reasoning: see README.md, section "Methodology".
  var T = {
    DSTI_COMFORT: 20,   // ≤ 20% of income goes to debt payments → comfortable
    DSTI_EU: 30,        // > 30% is a common EU over-indebtedness indicator
    DSTI_RISK: 40,      // > 40% → risky (Eesti Pank hard cap for mortgages is 50%)
    LEFT_COMFORT: 20,   // ≥ 20% of income left over → comfortable
    LEFT_RISK: 10       // < 10% left over → risky
  };

  /**
   * Parse a user-typed number. Accepts "1 000,50", "1000.50", "1.000,50", "1,000.50".
   * Returns { value: number|null, error: string|null }.
   * Empty input → value null, no error (the caller decides if the field is required).
   */
  function parseAmount(raw) {
    if (raw === null || raw === undefined) return { value: null, error: null };
    var s = String(raw).trim();
    if (s === '') return { value: null, error: null };

    s = s.replace(/[\s  ']/g, '').replace(/€/g, ''); // spaces, NBSP, apostrophes, euro sign
    if (s.charAt(0) === '-') return { value: null, error: 'negative' };
    if (!/^[0-9.,]+$/.test(s)) return { value: null, error: 'not_a_number' };

    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // Both present: the last one is the decimal separator, the other is thousands.
      var dec = lastComma > lastDot ? ',' : '.';
      var thou = dec === ',' ? '.' : ',';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (lastComma > -1) {
      // Only commas: Baltic/European style, comma = decimal.
      if (s.split(',').length > 2) return { value: null, error: 'not_a_number' };
      s = s.replace(',', '.');
    } else if (s.split('.').length > 2) {
      return { value: null, error: 'not_a_number' };
    }

    var n = Number(s);
    if (!isFinite(n)) return { value: null, error: 'not_a_number' };
    if (n > 1e9) return { value: null, error: 'too_large' };
    return { value: Math.round(n * 100) / 100, error: null };
  }

  /**
   * Monthly payment of an annuity loan plus a fixed monthly fee.
   * payment = P × r / (1 − (1 + r)^−n) + fee,  r = annual rate / 12
   */
  function monthlyPayment(principal, annualRatePct, months, monthlyFee) {
    var fee = monthlyFee || 0;
    if (!(principal > 0) || !(months >= 1)) return fee > 0 && principal > 0 ? fee : 0;
    var r = (annualRatePct || 0) / 100 / 12;
    var base = r === 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months));
    return round2(base + fee);
  }

  /** Inverse of monthlyPayment: the largest principal for a given monthly payment. */
  function maxPrincipal(payment, annualRatePct, months, monthlyFee) {
    var base = payment - (monthlyFee || 0);
    if (!(base > 0) || !(months >= 1)) return 0;
    var r = (annualRatePct || 0) / 100 / 12;
    var p = r === 0 ? base * months : base * (1 - Math.pow(1 + r, -months)) / r;
    return Math.floor(p);
  }

  /**
   * Main assessment.
   * input: { income, housing, utilities, food, transport, debts, phone, kids, other, savings, newPayment }
   */
  function assess(input) {
    var income = input.income;
    if (!(income > 0)) return { zone: 'no_income' };

    var living = sum([input.housing, input.utilities, input.food, input.transport,
                      input.phone, input.kids, input.other]);
    var debts = input.debts || 0;
    var newPay = input.newPayment || 0;

    var dsti = (debts + newPay) / income * 100;
    var leftover = income - living - debts - newPay;
    var leftoverPct = leftover / income * 100;
    var afterSavings = leftover - (input.savings || 0);

    return {
      zone: zoneFor(dsti, leftover, leftoverPct),
      dsti: round1(dsti),
      leftover: round2(leftover),
      leftoverPct: round1(leftoverPct),
      afterSavings: round2(afterSavings),
      living: round2(living),
      debts: round2(debts),
      newPayment: round2(newPay),
      income: income,
      // Share of income for "needs" (living costs + all debt payments) — compare to 50 in 50/30/20.
      needsPct: round1((living + debts + newPay) / income * 100)
    };
  }

  /**
   * Zone rules, checked from worst to best — the first match wins.
   * Boundaries: exactly 20% DSTI is still "comfortable", exactly 30% is "tolerable",
   * exactly 40% is "strained". Exactly 20% left over is "comfortable", exactly 10% is "tolerable".
   */
  function zoneFor(dsti, leftover, leftoverPct) {
    if (leftover < 0) return 'doesnt_fit';
    if (dsti > T.DSTI_RISK || leftoverPct < T.LEFT_RISK) return 'risky';
    if (dsti > T.DSTI_EU) return 'strained';
    if (dsti > T.DSTI_COMFORT || leftoverPct < T.LEFT_COMFORT) return 'tolerable';
    return 'comfortable';
  }

  /** Largest new monthly payment that keeps the user in the green zone. */
  function maxComfortablePayment(input) {
    var income = input.income;
    if (!(income > 0)) return 0;
    var living = sum([input.housing, input.utilities, input.food, input.transport,
                      input.phone, input.kids, input.other]);
    var debts = input.debts || 0;
    var byDsti = income * T.DSTI_COMFORT / 100 - debts;
    var byLeftover = income * (1 - T.LEFT_COMFORT / 100) - living - debts;
    return Math.max(0, Math.floor(Math.min(byDsti, byLeftover) * 100) / 100);
  }

  /**
   * Suggestions:
   *  - the shortest longer term (same amount) that reaches the green zone;
   *  - the largest amount (same term) that stays in the green zone.
   */
  function suggestions(input, loan, termOptions) {
    var out = { longerTerm: null, maxAmount: null };
    var cap = maxComfortablePayment(input);

    out.maxAmount = maxPrincipal(cap, loan.rate, loan.term, loan.fee);

    var opts = (termOptions || [12, 24, 36, 48, 60, 72]).filter(function (t) { return t > loan.term; });
    for (var i = 0; i < opts.length; i++) {
      var pay = monthlyPayment(loan.amount, loan.rate, opts[i], loan.fee);
      var a = assess(Object.assign({}, input, { newPayment: pay }));
      if (a.zone === 'comfortable') { out.longerTerm = { term: opts[i], payment: pay }; break; }
    }
    return out;
  }

  /**
   * Read loan parameters from the link, e.g. ?amount=2000&term=36&rate=14.15&fee=6
   * Invalid or missing values fall back to defaults; the list of problems is returned too.
   */
  function readLoanParams(search, defaults, limits) {
    var params = new URLSearchParams(search || '');
    var loan = Object.assign({}, defaults);
    var problems = [];
    ['amount', 'term', 'rate', 'fee'].forEach(function (key) {
      if (!params.has(key)) return;
      var p = parseAmount(params.get(key));
      var lim = limits[key];
      if (p.value === null || p.value < lim.min || p.value > lim.max ||
          (key === 'term' && p.value % 1 !== 0)) {
        problems.push(key);
      } else {
        loan[key] = p.value;
      }
    });
    return { loan: loan, problems: problems, fromLink: params.has('amount') || params.has('term') };
  }

  function sum(arr) { return arr.reduce(function (s, v) { return s + (v || 0); }, 0); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }

  var api = {
    THRESHOLDS: T, parseAmount: parseAmount, monthlyPayment: monthlyPayment,
    maxPrincipal: maxPrincipal, assess: assess, zoneFor: zoneFor,
    maxComfortablePayment: maxComfortablePayment, suggestions: suggestions,
    readLoanParams: readLoanParams
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BudgetLogic = api;
})(this);
