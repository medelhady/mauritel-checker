/*
 * بوابة الدخول + apiFetch.
 * محليًا (بدون Supabase): لا شيء يظهر ويعمل كل شيء مباشرة.
 * على النسخة المنشورة: تظهر شاشة دخول (بريد + كلمة مرور) ويُرسل الرمز مع كل طلب /api.
 */
(function () {
  'use strict';
  var client = null;
  var authRequired = false;

  var overlay = document.getElementById('loginOverlay');
  var form = document.getElementById('loginForm');
  var msg = document.getElementById('loginMsg');
  var logoutBtn = document.getElementById('logoutBtn');

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('تعذّر تحميل مكتبة الدخول')); };
      document.head.appendChild(s);
    });
  }

  function showLogin() {
    return new Promise(function (resolve) {
      overlay.classList.remove('hidden');
      form.onsubmit = function (e) {
        e.preventDefault();
        msg.textContent = 'جارٍ الدخول…';
        client.auth.signInWithPassword({
          email: document.getElementById('loginEmail').value.trim(),
          password: document.getElementById('loginPass').value
        }).then(function (r) {
          if (r.error) { msg.textContent = 'بيانات الدخول غير صحيحة.'; return; }
          overlay.classList.add('hidden');
          msg.textContent = '';
          document.getElementById('loginPass').value = '';
          resolve();
        }).catch(function () { msg.textContent = 'تعذّر الاتصال.'; });
      };
    });
  }

  var ready = fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg || !cfg.authRequired) return;
    authRequired = true;
    return loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js').then(function () {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      logoutBtn.classList.remove('hidden');
      logoutBtn.onclick = function () { client.auth.signOut().then(function () { location.reload(); }); };
      return client.auth.getSession().then(function (r) {
        if (r.data && r.data.session) return;
        return showLogin();
      });
    });
  }).catch(function (e) {
    document.getElementById('loginMsg').textContent = String(e.message || e);
    overlay.classList.remove('hidden');
    return new Promise(function () { /* لا نكمل بدون دخول */ });
  });

  window.apiFetch = function (url, opts) {
    return ready.then(function () {
      opts = Object.assign({}, opts);
      if (!authRequired) return fetch(url, opts);
      return client.auth.getSession().then(function (r) {
        var token = r.data && r.data.session && r.data.session.access_token;
        opts.headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
        return fetch(url, opts).then(function (res) {
          if (res.status === 401) { client.auth.signOut().then(function () { location.reload(); }); }
          return res;
        });
      });
    });
  };
})();
