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
  a.addEventListener('input', update); t.addEventListener('input', update); update();
