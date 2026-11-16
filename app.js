// Page logic. Runs only in the browser; the page forbids all network requests (see the CSP meta tag).
(function () {
  'use strict';
  var L = window.BudgetLogic;

  // Illustrative defaults, modelled on a publicly listed representative example of a small consumer loan.
  var DEFAULT_LOAN = { amount: 2000, term: 36, rate: 14.15, fee: 6 };
  var LIMITS = {
    amount: { min: 1, max: 1000000 }, term: { min: 1, max: 120 },
    rate: { min: 0, max: 100 }, fee: { min: 0, max: 1000 }
  };

  var LOAN_MAIN = [
    { key: 'amount', label: 'Amount', unit: '€' },
    { key: 'term',   label: 'Term', unit: 'months', mode: 'numeric' }
  ];
  var LOAN_EXTRA = [
    { key: 'rate', label: 'Interest rate per year', unit: '%' },
    { key: 'fee',  label: 'Monthly fee', unit: '€' }
  ];
  // Kept short on purpose: six fields cover a typical monthly budget.
  var BUDGET = [
    { key: 'income',    label: 'Net monthly income', note: 'after taxes', required: true, full: true },
    { key: 'housing',   label: 'Rent or mortgage' },
    { key: 'utilities', label: 'Utilities', note: 'power, heating, water' },
    { key: 'food',      label: 'Food & household' },
    { key: 'transport', label: 'Transport' },
    { key: 'debts',     label: 'Current loan payments' },
    { key: 'other',     label: 'Other regular costs', note: 'anything else monthly' }
  ];
  // Optional costs, added with a chip. Their sum is counted as living costs;
  // the savings goal is kept apart and does not change the zone.
  var EXTRAS = [
    { key: 'x_phone', label: 'Phone & internet' },
    { key: 'x_subs',  label: 'Subscriptions' },
    { key: 'x_ins',   label: 'Insurance' },
    { key: 'x_kids',  label: 'Children' },
    { key: 'x_pets',  label: 'Pets' },
    { key: 'x_sport', label: 'Sport & hobbies' },
    { key: 'x_save',  label: 'Savings goal', savings: true }
  ];
  var active = []; // extras currently shown, in the order they were added

  var ERR = {
    negative: 'Please enter a positive number.',
    not_a_number: 'Use numbers only, e.g. 1200 or 1 200,50.',
    too_large: 'That number is too large.',
    required: 'Enter your net monthly income.',
    zero_income: 'Income must be more than 0.',
    range: function (k) { return 'Allowed range: ' + LIMITS[k].min + '–' + LIMITS[k].max + '.'; },
    whole: 'Use whole months.'
  };

  var ZONES = {
    comfortable: { icon: '✓',  title: 'Comfortable', sub: 'The payment fits your budget well.' },
    tolerable:   { icon: '~',  title: 'Manageable',  sub: 'Affordable, but the margin is small.' },
    strained:    { icon: '!',  title: 'Tight',       sub: 'More than 30% of your income goes to debts.' },
    risky:       { icon: '!!', title: 'Risky',       sub: 'This could put real strain on your finances.' },
    doesnt_fit:  { icon: '×',  title: "Doesn't fit", sub: 'Costs and payments are higher than your income.' }
  };
  var ZONE_ORDER = ['comfortable', 'tolerable', 'strained', 'risky', 'doesnt_fit'];

  var $ = function (id) { return document.getElementById(id); };
  var eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var eur0 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  function pct(n) { return (Math.round(n * 10) / 10).toLocaleString('en-IE') + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function buildField(container, f) {
    var d = document.createElement('div');
    d.className = 'field' + (f.full ? ' full' : '');
    d.dataset.key = f.key;
    d.innerHTML =
      '<label class="box" for="' + f.key + '"><span class="lab">' + esc(f.label) + '</span>' +
      '<span class="row"><input id="' + f.key + '" inputmode="' + (f.mode || 'decimal') + '" autocomplete="off"' +
        (f.note ? ' placeholder="' + esc(f.note) + '"' : '') +
        (f.required ? ' aria-required="true"' : '') + ' aria-describedby="' + f.key + '-err' + (f.key === 'income' ? ' income-help' : '') + '">' +
      '<span class="unit">' + esc(f.unit || '€') + '</span></span></label>' +
      '<div class="err" id="' + f.key + '-err"></div>';
    if (f.removable) {
      d.classList.add('extra');
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'remove'; btn.innerHTML = '&times;';
      btn.setAttribute('aria-label', 'Remove ' + f.label);
      btn.addEventListener('click', function (e) { e.preventDefault(); removeExtra(f.key); });
      d.querySelector('.box').appendChild(btn);
    }
    if (f.before) container.insertBefore(d, f.before); else container.appendChild(d);
    return d;
  }

  function renderChips() {
    var wrap = $('chips');
    wrap.innerHTML = '';
    EXTRAS.forEach(function (x) {
      if (active.indexOf(x.key) > -1) return;
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'chip';
      c.innerHTML = '<span class="plus" aria-hidden="true">+</span>' + esc(x.label);
      c.setAttribute('aria-label', 'Add ' + x.label);
      c.addEventListener('click', function () { addExtra(x.key); });
      wrap.appendChild(c);
    });
    $('chips-wrap').hidden = active.length === EXTRAS.length;
  }

  function addExtra(key, silent) {
    var x = EXTRAS.filter(function (e) { return e.key === key; })[0];
    active.push(key);
    var otherField = document.querySelector('.field[data-key="other"]');
    var d = buildField($('budget-fields'), { key: x.key, label: x.label, removable: true, before: otherField });
    d.classList.add('added');
    renderChips();
    if (!silent) { $(x.key).focus(); render(); }
  }

  function removeExtra(key) {
    active = active.filter(function (k) { return k !== key; });
    var d = document.querySelector('.field[data-key="' + key + '"]');
    if (d) d.remove();
    renderChips();
    // Keep keyboard focus in a sensible place after the field disappears.
    var chip = Array.prototype.filter.call(document.querySelectorAll('.chip'), function (c) {
      return c.getAttribute('aria-label') === 'Add ' + EXTRAS.filter(function (e) { return e.key === key; })[0].label; })[0];
    if (chip) chip.focus();
    render();
  }
  LOAN_MAIN.forEach(function (f) { buildField($('loan-main'), f); });
  LOAN_EXTRA.forEach(function (f) { buildField($('loan-extra'), f); });
  BUDGET.forEach(function (f) { buildField($(f.key === 'income' ? 'income-fields' : 'budget-fields'), f); });
  renderChips();

  // Prefill loan from the link: ?amount=2000&term=36&rate=14.15&fee=6
  var fromUrl = L.readLoanParams(window.location.search, DEFAULT_LOAN, LIMITS);
  ['amount', 'term', 'rate', 'fee'].forEach(function (k) { $(k).value = String(fromUrl.loan[k]).replace('.', ','); });
  if (fromUrl.problems.length) {
    var n = $('link-notice'); n.hidden = false;
    n.textContent = 'Some values in the link were not valid (' + fromUrl.problems.join(', ') + '), so we used example values.';
  }

  function setError(key, msg) {
    document.querySelector('.field[data-key="' + key + '"]').classList.toggle('invalid', !!msg);
    $(key + '-err').textContent = msg || '';
    $(key).setAttribute('aria-invalid', msg ? 'true' : 'false');
    // An error inside the collapsed section must be visible.
    if (msg && (key === 'rate' || key === 'fee')) $('loan-more').open = true;
  }

  function readLoan() {
    var loan = {}, ok = true;
    ['amount', 'term', 'rate', 'fee'].forEach(function (k) {
      var p = L.parseAmount($(k).value), msg = '';
      if (p.error) msg = ERR[p.error];
      else if (p.value === null) msg = (k === 'fee' || k === 'rate') ? '' : ERR.range(k);
      else if (p.value < LIMITS[k].min || p.value > LIMITS[k].max) msg = ERR.range(k);
      else if (k === 'term' && p.value % 1 !== 0) msg = ERR.whole;
      setError(k, msg);
      if (msg) ok = false;
      loan[k] = p.value || 0;
    });
    return ok ? loan : null;
  }

  function readBudget(showRequired) {
    var b = {}, ok = true;
    BUDGET.forEach(function (f) {
      var p = L.parseAmount($(f.key).value), msg = '';
      if (p.error) msg = ERR[p.error];
      else if (f.required && p.value === null) msg = showRequired ? ERR.required : '';
      else if (f.required && p.value === 0) msg = ERR.zero_income;
      setError(f.key, msg);
      if (msg || (f.required && p.value === null)) ok = false;
      b[f.key] = p.value || 0;
    });
    b.savings = 0;
    active.forEach(function (key) {
      var x = EXTRAS.filter(function (e) { return e.key === key; })[0];
      var p = L.parseAmount($(key).value);
      setError(key, p.error ? ERR[p.error] : '');
      if (p.error) { ok = false; return; }
      if (x.savings) b.savings += p.value || 0;
      else b.other += p.value || 0;
    });
    return ok ? b : null;
  }

  var touchedIncome = false, hasResult = false, resultVisible = false, typing = false;
  // The summary bar stays out of the way while the user types (on phones it would cover the field above the keyboard).
  function updatePeek() { $('peek').hidden = !hasResult || resultVisible || typing; }
  document.addEventListener('focusin', function (e) { if (/^(INPUT|SELECT)$/.test(e.target.tagName)) { typing = true; updatePeek(); } });
  document.addEventListener('focusout', function () { setTimeout(function () {
    var el = document.activeElement; typing = !!el && /^(INPUT|SELECT)$/.test(el.tagName); updatePeek(); }, 0); });

  /** The number that actually decides the zone: what's left, or the share going to debts. */
  function limitingFactor(a) {
    var T = L.THRESHOLDS;
    var byDebts = a.dsti > T.DSTI_RISK ? 3 : a.dsti > T.DSTI_EU ? 2 : a.dsti > T.DSTI_COMFORT ? 1 : 0;
    var byLeft = a.leftover < 0 ? 4 : a.leftoverPct < T.LEFT_RISK ? 3 : a.leftoverPct < T.LEFT_COMFORT ? 1 : 0;
    if (a.leftover < 0) return eur0.format(-a.leftover) + ' short each month';
    return byLeft >= byDebts ? eur0.format(a.leftover) + ' left (' + pct(a.leftoverPct) + ')' : pct(a.dsti) + ' to debts';
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { resultVisible = e[0].isIntersecting; updatePeek(); }, { threshold: 0.25 })
      .observe($('result-card'));
  }

  function render() {
    var loan = readLoan();
    $('payment-out').textContent = loan ? eur.format(L.monthlyPayment(loan.amount, loan.rate, loan.term, loan.fee)) : '—';

    var budget = readBudget(touchedIncome);
    var out = $('result'), peek = $('peek');
    if (!loan || !budget) {
      hasResult = false; updatePeek();
      out.innerHTML = '<p class="empty">' + (!loan ? 'Check the loan details above.' :
        'Enter your income and main costs — the result appears here as you type.') + '</p>';
      return;
    }

    var payment = L.monthlyPayment(loan.amount, loan.rate, loan.term, loan.fee);
    var a = L.assess(Object.assign({}, budget, { newPayment: payment }));
    var z = ZONES[a.zone], color = 'var(--z-' + a.zone + ')';

    hasResult = true; updatePeek();
    peek.style.background = color;
    peek.innerHTML = '<span>' + z.title + ' · ' + limitingFactor(a) + '</span><span>See result ↓</span>';

    var tips = [], sug = null;
    if (a.living === 0 && a.debts === 0) {
      tips.push('<strong>No costs entered yet.</strong> Add at least rent, food and transport — otherwise the result looks better than it is.');
    } else if (a.zone !== 'comfortable') {
      // One suggestion only. Borrowing less comes first: a longer term also works, but costs more interest.
      var s = sug = L.suggestions(budget, loan);
      if (s.maxAmount > 0 && s.maxAmount < loan.amount) {
        tips.push('To stay comfortable over ' + loan.term + ' months, borrow up to <strong>' + eur0.format(s.maxAmount) + '</strong>.' +
          '<br><button type="button" class="tip-action" data-amount="' + s.maxAmount + '">Borrow ' + eur0.format(s.maxAmount) + ' instead</button>');
      } else if (s.longerTerm) {
        tips.push('Over <strong>' + s.longerTerm.term + ' months</strong> the payment drops to ' + eur.format(s.longerTerm.payment) + ' — comfortable, though you pay more interest in total.' +
          '<br><button type="button" class="tip-action" data-term="' + s.longerTerm.term + '">Switch to ' + s.longerTerm.term + ' months</button>');
      } else {
        tips.push('Your current costs and loans already leave little room. Lowering them would help more than changing this loan.');
      }
    }

    if (budget.savings > 0 && a.leftover >= 0) {
      tips.push(a.afterSavings >= 0
        ? 'After your savings goal of ' + eur0.format(budget.savings) + ', <strong>' + eur0.format(a.afterSavings) + '</strong> is left.'
        : 'Your savings goal of ' + eur0.format(budget.savings) + ' doesn\'t fit — you would be ' + eur0.format(-a.afterSavings) + ' short.');
    }

    out.innerHTML =
      '<div class="zone"><div class="icon" aria-hidden="true" style="background:' + color + '">' + z.icon + '</div>' +
        '<div><div class="title">' + z.title + '</div><div class="sub">' + z.sub + '</div></div></div>' +
      '<div class="scale" aria-hidden="true">' + ZONE_ORDER.map(function (k) {
        return '<span class="' + (k === a.zone ? 'on' : '') + '" style="background:var(--z-' + k + ')"></span>'; }).join('') + '</div>' +
      '<div class="scale-labels" aria-hidden="true">' + ZONE_ORDER.map(function (k) { return '<span>' + ZONES[k].title + '</span>'; }).join('') + '</div>' +
      '<div class="metrics">' +
        '<div class="metric"><div class="k">Goes to debts</div><div class="v">' + pct(a.dsti) + '</div><div class="s">of income · comfortable up to 20%</div></div>' +
        '<div class="metric"><div class="k">Left each month</div><div class="v">' + eur0.format(a.leftover) + '</div><div class="s">' + pct(a.leftoverPct) + ' of income · comfortable from 20%</div></div>' +
      '</div>' +
      (tips.length ? '<ul class="tips">' + tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' : '') +
      '<details class="how"><summary>How the scale works</summary><table>' +
        '<tr><td>Comfortable</td><td>Debts ≤ 20% of income and ≥ 20% left over</td></tr>' +
        '<tr><td>Manageable</td><td>Debts 20–30%, or 10–20% left over</td></tr>' +
        '<tr><td>Tight</td><td>Debts 30–40% — above a common EU over-indebtedness indicator (30%)</td></tr>' +
        '<tr><td>Risky</td><td>Debts over 40%, or less than 10% left over</td></tr>' +
        '<tr><td>Doesn\'t fit</td><td>Costs and payments exceed income</td></tr></table>' +
        '<p>For comparison: in Estonia, housing loans are capped at 50% of net income for all debt payments (Eesti Pank).</p></details>' +
      '';
  }

  // ---------- Bank statement import ----------
  var S = window.Statement;
  var CATS = [
    ['housing', 'Rent or mortgage'], ['utilities', 'Utilities'], ['food', 'Food & household'], ['transport', 'Transport'], ['debts', 'Current loans'],
    ['x_phone', 'Phone & internet'], ['x_subs', 'Subscriptions'], ['x_ins', 'Insurance'], ['x_kids', 'Children'],
    ['x_pets', 'Pets'], ['x_sport', 'Sport & hobbies'], ['other', 'Other'], ['ignore', "Don't count"]
  ];
  var CAT_LABEL = {}; CATS.forEach(function (c) { CAT_LABEL[c[0]] = c[1]; });
  var IMPORT_ERR = {
    empty: 'The file is empty.',
    not_csv: "This doesn't look like a CSV file.",
    unknown_format: "We couldn't find the date and amount columns.",
    no_transactions: 'No transactions found in this file.',
    too_big: 'The file is too large (max 5 MB).',
    wrong_type: 'Please choose a CSV, Excel or PDF file.',
    xls_bad: "We couldn't read this .xls file. Please try the CSV export, or save the file as .xlsx.",
    xls_locked: 'This Excel file is password-protected. Please save it without a password, or use the CSV export.',
    pdf_no_text: 'This PDF has no text — it is probably a scan. Please download the CSV or Excel export from your bank.',
    pdf_no_sign: "We found transactions, but this PDF doesn't show which are money in and which are money out. Please use the CSV or Excel export.",
    pdf_locked: 'This PDF is password-protected. Please download it without a password, or use CSV or Excel.',
    pdf_bad: "We couldn't read this PDF. Please use the CSV or Excel export.",
    xlsx_bad: "We couldn't read this Excel file. Try the CSV export instead.",
    read: "We couldn't read this file."
  };
  var current = null, showAll = false;

  function importMsg(text, kind) { var m = $('import-msg'); m.textContent = text || ''; m.className = 'import-msg' + (kind ? ' ' + kind : ''); }

  function handleFile(file) {
    if (!file) return;
    $('review').hidden = true;
    var name = file.name.toLowerCase();
    // Clearly not a statement (photo, video…): say so straight away.
    if (/^(image|video|audio)\//.test(file.type)) return importMsg(IMPORT_ERR.wrong_type, 'error');
    if (file.size > 20 * 1024 * 1024) return importMsg(IMPORT_ERR.too_big, 'error');
    var reader = new FileReader();
    reader.onerror = function () { importMsg(IMPORT_ERR.read, 'error'); };
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result);
      // The file type is decided by its content, not its name: banks often save CSV or HTML as ".xls".
      var kind = S.sniff(bytes);
      if (kind === 'pdf') {
        importMsg('Reading PDF…');
        return window.PdfImport.read(reader.result).then(function (x) {
          if (!x.ok) { $('review').hidden = true; return importMsg(IMPORT_ERR[x.error] || IMPORT_ERR.pdf_bad, 'error'); }
          showResult(S.analyseRows(x.rows), 'pdf');
        });
      }
      if (kind === 'xlsx') {
        var x = window.Xlsx.read(reader.result);
        if (!x.ok) { $('review').hidden = true; return importMsg(IMPORT_ERR[x.error] || IMPORT_ERR.read, 'error'); }
        return showResult(S.analyseRows(x.rows));
      }
      if (kind === 'xls') {
        var xl = window.Xls.read(reader.result);
        if (!xl.ok) { $('review').hidden = true; return importMsg(IMPORT_ERR[xl.error] || IMPORT_ERR.read, 'error'); }
        return showResult(S.analyseRows(xl.rows));
      }
      if (file.size > S.MAX_BYTES) return importMsg(IMPORT_ERR.too_big, 'error');
      showResult(S.analyseBytes(bytes));
    };
    reader.readAsArrayBuffer(file);
  }

  var detailsOpen = false;

  function analyseText(text) { showResult(S.analyse(text)); }

  var source = null;
  function showResult(r, from) {
    source = from || null;
    var loaded = !!(r && r.ok);
    $('import').classList.toggle('has-file', loaded);
    $('import-label').textContent = loaded ? 'Upload a different file' : 'Upload bank statement';
    if (!r.ok) {
      $('review').hidden = true;
      var msg = IMPORT_ERR[r.error] || IMPORT_ERR.read;
      if (r.error === 'unknown_format' && r.columns && r.columns.length) msg += ' Columns in your file: ' + r.columns.join(' · ');
      return importMsg(msg, 'error');
    }
    importMsg('');
    current = r; showAll = false; detailsOpen = false;
    applyImport();       // fill the form straight away
    renderReview();      // then show a short summary; the details are one click away
  }

  var PENCIL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="2"/></svg>';
  var CHEV = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderReview() {
    var r = current, el = $('review');
    var limit = showAll ? r.groups.length : 12;
    var opts = function (sel) { return CATS.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === sel ? ' selected' : '') + '>' + c[1] + '</option>'; }).join(''); };
    el.innerHTML =
      '<div class="rv-head"><div><strong><span class="ok-check" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m4.5 12.5 5 5L19.5 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Filled in from your statement</strong>' +
        '<p class="meta">' + r.count + ' transactions over ' + r.months + ' month' + (r.months === 1 ? '' : 's') + ' · monthly averages' +
        (source === 'pdf' ? ' · <strong>PDF (beta): please check the numbers</strong>' : '') + '</p></div>' +
        '<button type="button" class="btn-edit" id="rv-toggle" aria-expanded="' + detailsOpen + '" aria-controls="rv-details">' +
        (detailsOpen ? 'Hide details' : PENCIL + 'Review and adjust') + CHEV + '</button></div>' +
      '<div class="rv-details" id="rv-details"' + (detailsOpen ? '' : ' hidden') + '>' +
        '<p class="meta">Change a category if something landed in the wrong place — the form updates right away.</p>' +
        '<div class="rv-income"><span>Money in</span><strong>' + eur0.format(r.income) + ' / month</strong></div>' +
        '<ul class="rv-list">' + r.groups.slice(0, limit).map(function (g, i) {
          return '<li><span class="rv-name" title="' + esc(g.name) + '">' + esc(g.name) + ' <small>×' + g.count + '</small></span>' +
            '<span class="rv-amt">' + eur0.format(g.monthly) + '</span>' +
            '<select data-i="' + i + '" aria-label="Category for ' + esc(g.name) + '">' + opts(g.category) + '</select></li>';
        }).join('') + '</ul>' +
        (r.groups.length > limit ? '<p><button type="button" class="link-btn" id="rv-more">Show ' + (r.groups.length - limit) + ' more</button></p>' : '') +
      '</div>';
    el.hidden = false;
  }

  function applyImport() {
    var t = S.totalsByCategory(current.groups);
    var val = function (n) { return n > 0 ? String(Math.round(n)) : ''; };
    $('income').value = val(current.income);
    ['housing', 'utilities', 'food', 'transport', 'debts', 'other'].forEach(function (k) { $(k).value = val(t[k]); });
    EXTRAS.forEach(function (x) {
      if (x.savings) return;
      if (t[x.key] > 0) { if (active.indexOf(x.key) === -1) addExtra(x.key, true); $(x.key).value = val(t[x.key]); }
      else if (active.indexOf(x.key) > -1) $(x.key).value = '';
    });
    touchedIncome = true;
    render();
  }

  // The upload button is a <label for="file">, so the browser opens the picker itself (reliable on iOS).
  $('file').addEventListener('change', function (e) { handleFile(e.target.files[0]); e.target.value = ''; });
  // Hidden helper for reviewers: index.html?sample=1 loads a fictional statement.
  if (/[?&]sample=1/.test(window.location.search) && window.SAMPLE_STATEMENT) analyseText(window.SAMPLE_STATEMENT);
  $('review').addEventListener('change', function (e) {
    if (e.target.tagName === 'SELECT') { current.groups[+e.target.dataset.i].category = e.target.value; applyImport(); }
  });
  $('review').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'rv-more') { showAll = true; renderReview(); $('rv-details').querySelectorAll('select')[12].focus(); }
    else if (btn.id === 'rv-toggle') { detailsOpen = !detailsOpen; renderReview(); $('rv-toggle').focus(); }
  });
  var drop = $('import');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
  drop.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });

  $('result').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('tip-action')) {
      if (btn.dataset.amount) $('amount').value = btn.dataset.amount;
      if (btn.dataset.term) $('term').value = btn.dataset.term;
      render();
      $('result-h').focus();   // the result card is a live region, so the new zone is announced
    }
  });

  document.addEventListener('input', function (e) { if (e.target.id === 'income') touchedIncome = true; render(); });
  document.addEventListener('focusout', function (e) { if (e.target.id === 'income') { touchedIncome = true; render(); } });
  render();
})();
