/* join.js — the "Join your team" page (join.html).
   A teammate who was invited from the dashboard opens this link, creates an account with the invited email
   (or logs in), and lands on the dashboard. The database adds them to the team only if their email
   matches an invite and is confirmed, so this page can't add anyone on its own. */
(function () {
  var CC = window.CC, E = CC.esc, root = document.getElementById('page');
  var MARK = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="12" r="6.5"/><circle cx="15.5" cy="12" r="6.5"/><path d="M12 8.6v6.8M9.9 10.9h4.2"/></svg>';
  var invited = ''; try { invited = (new URLSearchParams(location.search).get('email') || '').trim().toLowerCase(); } catch (e) {}
  var S = { err: '', busy: false, sent: false };

  function shell(inner) {
    return '<header class="acct-top"><nav aria-label="Main"><a class="acct-brand" href="index.html">' + MARK + '<b>Compassion Catalyst</b></a><a class="l" href="directory.html">Find help</a><a class="l" href="login.html">Log in</a></nav></header>' +
      '<main class="acct-main" style="max-width:560px">' + inner + '</main><footer class="acct-foot">Questions? Email <a href="mailto:info@compassioncatalyst.org">info@compassioncatalyst.org</a></footer>';
  }
  function render() {
    if (!CC.ok) { root.innerHTML = shell('<h1>Join your team</h1><p class="alert">The site can’t reach the database right now. Please try again later.</p>'); return; }
    if (S.sent) {
      root.innerHTML = shell('<h1>Check your email</h1><div class="card"><p>We sent a link to <strong>' + E(S.email) + '</strong>. Click it to confirm your address, and you’ll go straight to your team’s dashboard.</p></div>');
      return;
    }
    root.innerHTML = shell('<div><h1>Join your team</h1><p class="muted" style="margin-top:6px">Someone on your organization’s team invited you to help manage its listing. Create your account with the email address they invited.</p></div>' +
      (S.err ? '<p class="alert" role="alert">' + E(S.err) + '</p>' : '') +
      '<form data-form="join" class="card white" style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="field"><label for="jn">Your full name</label><input id="jn" name="name" class="input" autocomplete="name" required></div>' +
      '<div class="field"><label for="je">Email</label><input id="je" name="email" type="email" class="input" autocomplete="email" value="' + E(invited) + '" required></div>' +
      '<div class="field"><label for="jp">Create a password</label><input id="jp" name="pw" type="password" class="input" autocomplete="new-password" minlength="8" required><span class="small muted">At least 8 characters.</span></div>' +
      '<button class="btn btn-primary" type="submit" style="align-self:flex-start"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Creating your account…' : 'Join the team') + '</button>' +
      '<span class="small muted">Already have an account with this email? <a href="login.html">Log in</a> and you’ll be added automatically.</span></form>');
  }
  root.addEventListener('submit', async function (e) {
    var f = e.target; if (f.getAttribute('data-form') !== 'join') return;
    e.preventDefault();
    var el = f.elements, name = el['name'].value.trim(), email = el['email'].value.trim().toLowerCase(), pw = el['pw'].value;
    if (!name) { S.err = 'Please add your full name.'; return render(); }
    if (!/.+@.+\..+/.test(email)) { S.err = 'Please enter a valid email address.'; return render(); }
    if (pw.length < 8) { S.err = 'Please use a password with at least 8 characters.'; return render(); }
    S.busy = true; S.err = ''; render();
    try {
      var r = await CC.sb.auth.signUp({ email: email, password: pw, options: { data: { full_name: name }, emailRedirectTo: CC.SITE + 'dashboard.html' } });
      if (r.error) throw r.error;
      if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw new Error('That email already has an account. Please log in instead.');
      if (r.data.session) { window.location.href = 'dashboard.html'; return; }
      S.sent = true; S.email = email;
    } catch (err) { S.err = CC.msg(err); }
    S.busy = false; render();
  });
  CC.whenReady.then(function (s) { if (s) window.location.replace('dashboard.html'); else render(); });
})();
