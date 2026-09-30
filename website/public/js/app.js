/* zenin — progressive enhancement only. Everything works without JS. */
(function () {
  'use strict';

  // ---- mobile nav -----------------------------------------------------
  var toggle = document.querySelector('[data-nav-toggle]');
  var links = document.getElementById('nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // ---- confirm before destructive submits -----------------------------
  document.addEventListener('submit', function (event) {
    var message = event.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) {
      event.preventDefault();
    }
  });

  // ---- auto-submit the filter selects ---------------------------------
  var filterRow = document.querySelector('.filters__row');
  if (filterRow) {
    filterRow.querySelectorAll('select').forEach(function (select) {
      select.addEventListener('change', function () {
        var form = select.closest('form');
        if (form) form.submit();
      });
    });
  }

  // ---- character counters ---------------------------------------------
  document.querySelectorAll('.field__label small').forEach(function (counter) {
    var field = counter.closest('.field');
    var input = field && field.querySelector('textarea, input');
    if (!input || !/^\d+$/.test(counter.textContent)) return;

    var max = input.getAttribute('maxlength');
    if (!max) return;

    counter.textContent = '0/' + max;
    input.addEventListener('input', function () {
      counter.textContent = input.value.length + '/' + max;
    });
    input.dispatchEvent(new Event('input'));
  });
})();
