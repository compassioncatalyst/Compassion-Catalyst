/* account.js — account.html is only used for "Forgot password?" now.
   The link in the password email opens this page, where people choose a new password.
   Anyone who opens it any other way goes straight to their dashboard (or to log in). */
(function () {
  var CC = window.CC, root = document.getElementById('page');
  var MARK = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="12" r="6.5"/><circle cx="15.5" cy="12" r="6.5"/><path d="M12 8.6v6.8M9.9 10.9h4.2"/></svg>';
  var shown = false;

  function shell(inner) {
    return '<header class="acct-top"><nav aria-label="Main"><a class="acct-brand" href="index.html">' + MARK + '<b>Compassion Catalyst</b></a></nav></header>' +
      '<main class="acct-main">' + inner + '</main><footer class="acct-foot">Questions? Email <a href="mailto:info@compassioncatalyst.org">info@compassioncatalyst.org</a></footer>';
  }
  function form(err) {
    shown = true;
    root.innerHTML = shell('<h1>Choose a new password</h1>' +
      '<form data-form="recover" class="card" style="max-width:480px"><div class="field"><label for="rp">New password</label>' +
      '<input id="rp" name="pw" type="password" autocomplete="new-password" class="input" minlength="8"></div>' +
      '<span class="small muted">Use at least 8 characters.</span>' +
      (err ? '<p class="alert" role="alert">' + CC.esc(err) + '</p>' : '') +
      '<button class="btn btn-primary" type="submit">Save and open your dashboard</button></form>');
  }
  function leave(session) { window.location.replace(session ? 'dashboard.html' : 'login.html'); }

  root.addEventListener('submit', async function (e) {
    e.preventDefault();
    var pw = e.target.pw.value;
    if (pw.length < 8) return form('Please use at least 8 characters.');
    var r = await CC.sb.auth.updateUser({ password: pw });
    if (r.error) return form(CC.msg(r.error));
    window.location.replace('dashboard.html');
  });

  if (!CC.ok) { root.innerHTML = shell('<h1>Choose a new password</h1><p class="alert">The site can’t reach the database right now. Please try again later.</p>'); return; }
  var recovering = /type=recovery/.test(location.hash) || /[?&]code=/.test(location.search);
  CC.sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') form(); });
  CC.whenReady.then(function (session) {
    if (recovering) { if (session) form(); else setTimeout(function () { if (!shown) leave(CC.session); }, 2500); return; }
    if (!shown) leave(session);
  });
})();
