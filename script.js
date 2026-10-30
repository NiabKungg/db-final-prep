/* เว็บติวสอบ Final DB — script.js */
(function () {
  'use strict';

  /* ---- Mobile drawer ---- */
  var hamburger = document.querySelector('.hamburger');
  var backdrop = document.querySelector('.backdrop');
  if (hamburger) {
    hamburger.addEventListener('click', function () {
      document.body.classList.toggle('nav-open');
    });
  }
  if (backdrop) {
    backdrop.addEventListener('click', function () {
      document.body.classList.remove('nav-open');
    });
  }
  document.querySelectorAll('.sidebar .nav-link').forEach(function (a) {
    a.addEventListener('click', function () {
      document.body.classList.remove('nav-open');
    });
  });

  /* ---- Active nav ---- */
  var path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar .nav-link').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === path) a.classList.add('active');
  });

  /* ---- Reading progress ---- */
  var bar = document.getElementById('progressBar');
  if (bar) {
    window.addEventListener('scroll', function () {
      var h = document.documentElement;
      var pct = (h.scrollTop) / (h.scrollHeight - h.clientHeight) * 100;
      bar.style.width = (pct || 0) + '%';
    }, { passive: true });
  }

  /* ---- Quiz ---- */
  document.querySelectorAll('.quiz').forEach(function (quiz) {
    var answer = parseInt(quiz.getAttribute('data-answer'), 10);
    var opts = quiz.querySelectorAll('.quiz-opt');
    opts.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        if (quiz.classList.contains('answered')) return;
        quiz.classList.add('answered');
        opts.forEach(function (b, j) {
          b.disabled = true;
          if (j === answer) b.classList.add('correct');
        });
        if (i !== answer) btn.classList.add('wrong');
      });
    });
  });

  /* ---- Checklist persistence (index) ---- */
  var list = document.getElementById('exam-checklist');
  if (list) {
    var KEY = 'db-final-checklist-v1';
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      var k = cb.getAttribute('data-key');
      if (saved[k]) { cb.checked = true; cb.closest('li').classList.add('done'); }
      cb.addEventListener('change', function () {
        saved[k] = cb.checked;
        cb.closest('li').classList.toggle('done', cb.checked);
        try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
      });
    });
  }
})();
