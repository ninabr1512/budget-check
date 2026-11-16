// Page logic. Runs only in the browser; the page forbids all network requests (see the CSP meta tag).
  var RATE = 14.15, FEE = 6;
  var a = document.getElementById('amount'), t = document.getElementById('term');
  var eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
  var eur0 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  function update() {
    var amount = +a.value, term = +t.value;
    document.getElementById('amount-out').textContent = eur0.format(amount);
    document.getElementById('term-out').textContent = term + ' months';
    document.getElementById('pay').textContent = eur.format(BudgetLogic.monthlyPayment(amount, RATE, term, FEE));
    document.getElementById('check').href = 'index.html?amount=' + amount + '&term=' + term + '&rate=' + RATE + '&fee=' + FEE;
  }
  // Coming back from the budget check: restore amount and term from the link (clamped to the slider range and step).
  (function () {
    var q = new URLSearchParams(window.location.search);
    [[a, 'amount'], [t, 'term']].forEach(function (pair) {
      var el = pair[0], v = parseFloat(String(q.get(pair[1]) || '').replace(',', '.'));
      if (!isFinite(v)) return;
      var min = +el.min, max = +el.max, step = +el.step || 1;
      v = Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
      el.value = v;
    });
  })();
  a.addEventListener('input', update); t.addEventListener('input', update); update();
