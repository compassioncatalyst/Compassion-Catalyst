/* account.js — the "Your account" page (account.html).
   People who added or claimed an organization log in and land here.
   They can see where their requests stand and edit their listing.
   Phone, email, website and address changes wait for your approval (the database does this, see the setup SQL). */
(function () {
  var CC = window.CC, E = CC.esc, root = document.getElementById('page');
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var REVIEWED = ['phone', 'email', 'website', 'address', 'city', 'state', 'zip'];
  var S = { loading: true, session: null, profile: null, orgs: [], roles: {}, requests: [], reqNames: {}, changes: [], stash: null, open: null, recovery: false, busy: false, err: '' };
  var MARK = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="12" r="6.5"/><circle cx="15.5" cy="12" r="6.5"/><path d="M12 8.6v6.8M9.9 10.9h4.2"/></svg>';

  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 5000);
  }
  function shell(inner) {
    var links = '<a class="l" href="directory.html">Find help</a><a class="l" href="about.html">About</a>' +
      (S.profile && S.profile.is_admin ? '<a class="l" href="admin.html">Admin review</a>' : '') +
      (S.session ? '<button class="btn" data-act="signout">Log out</button>' : '<a class="l" href="login.html">Log in</a>');
    return '<header class="acct-top"><nav aria-label="Main"><a class="acct-brand" href="index.html">' + MARK + '<b>Compassion Catalyst</b></a>' + links + '</nav></header>' +
      '<main class="acct-main">' + inner + '</main><footer class="acct-foot">Questions? Email <a href="mailto:info@compassioncatalyst.org">info@compassioncatalyst.org</a></footer>';
  }
  function statusTag(o) {
    if (o.status === 'pending') return '<span class="tag dash">Waiting for review</span>';
    if (o.status === 'paused') return '<span class="tag">Paused (hidden from the directory)</span>';
    if (o.status === 'removed') return '<span class="tag">Removed</span>';
    return o.verified ? '<span class="tag solid">Verified · live</span>' : '<span class="tag blue">Live on the directory</span>';
  }
  function reqTag(r) {
    return r.status === 'approved' ? '<span class="tag solid">Approved</span>' : r.status === 'rejected' ? '<span class="tag">Not approved</span>' : '<span class="tag dash">Waiting for review</span>';
  }

  // ---------- loading ----------
  async function load() {
    S.loading = true; render();
    var uid = S.session.user.id, sb = CC.sb;
    var p = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    S.profile = p.data || { email: S.session.user.email };
    var mem = await sb.from('organization_members').select('organization_id, role').eq('user_id', uid);
    S.roles = {}; (mem.data || []).forEach(function (m) { S.roles[m.organization_id] = m.role; });
    var ids = Object.keys(S.roles);
    var mine = ids.length ? (await sb.from('organizations').select('*').in('id', ids)).data || [] : [];
    var made = (await sb.from('organizations').select('*').eq('created_by', uid)).data || [];
    var seen = {}; S.orgs = mine.concat(made).filter(function (o) { if (seen[o.id]) return false; seen[o.id] = 1; return true; });
    S.orgs.sort(function (a, b) { return a.name.localeCompare(b.name); });
    S.requests = (await sb.from('claim_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false })).data || [];
    S.reqNames = {}; S.orgs.forEach(function (o) { S.reqNames[o.id] = o.name; });
    var need = S.requests.map(function (r) { return r.organization_id; }).filter(function (id) { return !S.reqNames[id]; });
    if (need.length) ((await sb.from('directory_listings').select('id, name').in('id', need)).data || []).forEach(function (o) { S.reqNames[o.id] = o.name; });
    var editable = S.orgs.filter(function (o) { return canEdit(o); }).map(function (o) { return o.id; });
    S.changes = editable.length ? (await sb.from('pending_changes').select('*').in('organization_id', editable).eq('status', 'pending')).data || [] : [];
    S.stash = CC.stashed();
    S.loading = false; render();
  }
  function canEdit(o) { return S.roles[o.id] === 'owner' || S.roles[o.id] === 'admin'; }

  // ---------- screens ----------
  function render() {
    if (!CC.ok) { root.innerHTML = shell('<h1>Your account</h1><p class="alert">The site can’t reach the database right now. Please try again later.</p>'); return; }
    if (S.recovery) { root.innerHTML = shell(recoveryForm()); return; }
    if (!S.session) {
      root.innerHTML = shell('<h1>Your account</h1><div class="card"><p>Please log in to see your organization.</p><div class="row"><a class="btn btn-primary" href="login.html">Log in</a><a class="btn btn-secondary" href="signup.html">Add your organization</a><a class="btn btn-secondary" href="claim.html">Claim a listing</a></div></div>');
      return;
    }
    if (S.loading) { root.innerHTML = shell('<h1>Your account</h1><p class="muted">Loading…</p>'); return; }
    var name = (S.profile && S.profile.full_name) || '';
    var h = '<div><h1>' + (name ? 'Welcome, ' + E(name.split(' ')[0]) : 'Your account') + '</h1><p class="muted" style="margin-top:6px">Logged in as ' + E(S.session.user.email) + '</p></div>';
    if (S.err) h += '<p class="alert" role="alert">' + E(S.err) + '</p>';
    if (S.stash) h += stashCard();
    h += '<section style="display:flex;flex-direction:column;gap:14px"><h2>Your organizations</h2>';
    if (!S.orgs.length) h += '<div class="card white"><p>You don’t manage an organization yet. When a request below is approved, it shows up here.</p><div class="row"><a class="btn btn-secondary" href="signup.html">Add your organization</a><a class="btn btn-secondary" href="claim.html">Claim a listing</a></div></div>';
    S.orgs.forEach(function (o) { h += orgCard(o); });
    h += '</section>';
    if (S.requests.length) {
      h += '<section style="display:flex;flex-direction:column;gap:12px"><h2>Your requests</h2>';
      S.requests.forEach(function (r) {
        h += '<div class="item"><div class="row" style="justify-content:space-between"><strong style="font-size:18px">' + E(S.reqNames[r.organization_id] || 'Organization') + '</strong>' + reqTag(r) + '</div>' +
          '<span class="small muted">' + (r.kind === 'new_listing' ? 'New listing' : 'Claim') + ' · sent ' + CC.date(r.created_at) + '</span>' +
          (r.status === 'rejected' && r.reviewer_note ? '<span class="small">Note from our team: ' + E(r.reviewer_note) + '</span>' : '') + '</div>';
      });
      h += '</section>';
    }
    h += '<section class="card white"><h2 style="font-size:22px">Change your password</h2><form data-form="pw" class="row" style="align-items:flex-end"><div class="field" style="flex:1;min-width:220px"><label for="np">New password</label><input id="np" name="pw" type="password" autocomplete="new-password" class="input" minlength="8"></div><button class="btn btn-secondary" type="submit">Update password</button></form></section>';
    root.innerHTML = shell(h);
  }

  function stashCard() {
    var st = S.stash, d = st.data || {}, isNew = st.kind === 'new_listing', needFile = d.method === 'doc';
    return '<form data-form="stash" class="card" style="border-color:var(--color-accent-700)"><h2 style="font-size:22px">Finish sending your request</h2>' +
      '<p>' + (isNew ? 'Your new listing for <strong>' + E(d.name) + '</strong>' : 'Your claim for <strong>' + E(d.orgName) + '</strong>') + ' is saved on this device and hasn’t been sent yet.</p>' +
      (needFile ? '<div class="field"><label for="sf">Choose your document again' + (st.fileName ? ' (' + E(st.fileName) + ')' : '') + '</label><input id="sf" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" class="input"></div>' : '') +
      '<div class="row"><button class="btn btn-primary" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Sending…' : 'Send for review') + '</button><button class="btn btn-ghost" type="button" data-act="dropstash">Discard</button></div></form>';
  }

  function orgCard(o) {
    var open = S.open === o.id, edit = canEdit(o);
    var waiting = S.changes.filter(function (c) { return c.organization_id === o.id; });
    var h = '<div class="card white"><div class="row" style="justify-content:space-between;align-items:flex-start"><div style="display:flex;flex-direction:column;gap:6px"><h3 style="margin:0;font-size:24px">' + E(o.name) + '</h3>' +
      '<div class="row">' + statusTag(o) + (S.roles[o.id] ? '<span class="small muted">Your role: ' + E(S.roles[o.id]) + '</span>' : '') + '</div></div>' +
      (edit ? '<button class="btn ' + (open ? 'btn-secondary' : 'btn-primary') + '" data-act="toggle" data-id="' + o.id + '">' + (open ? 'Close' : 'Edit listing') + '</button>' : '') + '</div>';
    if (!edit && o.status === 'pending') h += '<p class="muted">We review every new listing by hand, usually within 3–5 business days. We’ll email you when it’s live.</p>';
    if (!edit && o.status !== 'pending') h += '<p class="muted">You can view this listing. Ask the owner if you need to make changes.</p>';
    if (waiting.length) h += '<div class="note">Waiting for review: ' + waiting.map(function (c) { return E(c.field) + ' → “' + E(c.new_value || '(blank)') + '”'; }).join(', ') + '</div>';
    if (open && edit) h += editor(o);
    return h + '</div>';
  }

  function inp(name, label, val, opt) {
    opt = opt || {};
    return '<div class="field"' + (opt.wide ? ' style="grid-column:1/-1"' : '') + '><label for="f-' + name + '">' + label + '</label>' +
      (opt.area ? '<textarea id="f-' + name + '" name="' + name + '" class="input">' + E(val) + '</textarea>' : '<input id="f-' + name + '" name="' + name + '" class="input" value="' + E(val) + '"' + (opt.type ? ' type="' + opt.type + '"' : '') + '>') +
      (opt.hint ? '<span class="small muted" style="display:block;margin-top:4px">' + opt.hint + '</span>' : '') + '</div>';
  }
  function editor(o) {
    var cats = o.categories || [], svc = o.services || {}, hours = Array.isArray(o.hours) && o.hours.length === 7 ? o.hours : ['', '', '', '', '', '', ''];
    var h = '<form data-form="org" data-id="' + o.id + '" style="display:flex;flex-direction:column;gap:18px;border-top:1px solid var(--color-divider);padding-top:18px">';
    h += '<div class="grid2">' + inp('about', 'About your organization', o.about, { area: true, wide: true }) +
      '<div class="field"><label for="f-availability">Availability right now</label><select id="f-availability" name="availability" class="input">' +
      ['Accepting', 'Limited', 'Waitlist', 'Full'].map(function (a) { return '<option' + (o.availability === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div>' +
      inp('neighborhood', 'Neighborhood', o.neighborhood) + inp('contact_name', 'Contact person', o.contact_name) + inp('contact_title', 'Their title', o.contact_title) + '</div>';
    h += '<fieldset style="border:0;padding:0;margin:0"><legend style="font-family:var(--font-heading);font-weight:600;font-size:20px;margin-bottom:8px">Kinds of help</legend><div class="cats">' +
      CC.CATS.map(function (c) { return '<label><input type="checkbox" name="cat" value="' + c[0] + '"' + (cats.indexOf(c[0]) >= 0 ? ' checked' : '') + '>' + E(c[1]) + '</label>'; }).join('') + '</div></fieldset>';
    h += '<div class="grid2">' + cats.map(function (k) { var lab = (CC.CATS.find(function (c) { return c[0] === k; }) || [k, k])[1];
      return inp('svc_' + k, 'Services: ' + E(lab), (svc[k] || []).join('\n'), { area: true, hint: 'One per line.' }); }).join('') + '</div>';
    h += '<fieldset style="border:0;padding:0;margin:0"><legend style="font-family:var(--font-heading);font-weight:600;font-size:20px;margin-bottom:8px">Hours</legend><div class="hours">' +
      DAYS.map(function (d, i) { return inp('h' + i, d, hours[i] || '', { hint: i === 0 ? 'Like “9 AM–4 PM” or “Closed”' : '' }); }).join('') + '</div></fieldset>';
    h += '<div class="grid2">' + inp('languages', 'Languages', (o.languages || []).join(', '), { hint: 'Separate with commas.' }) + inp('cost', 'Cost', o.cost) +
      inp('eligibility', 'Who you serve', (o.eligibility || []).join(', '), { hint: 'Separate with commas, like “Families, Seniors”.' }) + inp('what_to_bring', 'What to bring', o.what_to_bring, { area: true }) + '</div>';
    h += '<fieldset style="border:1px solid var(--color-divider);padding:16px;margin:0;display:flex;flex-direction:column;gap:12px"><legend style="font-family:var(--font-heading);font-weight:600;font-size:20px;padding:0 6px">Contact details</legend>' +
      '<p class="small muted">To protect people looking for help, changes here are checked by our team before they go live.' + (o.is_sensitive ? ' This listing’s address is never shown publicly.' : '') + '</p><div class="grid2">' +
      inp('phone', 'Phone', o.phone, { type: 'tel' }) + inp('email', 'Email', o.email, { type: 'email' }) + inp('website', 'Website', o.website, { type: 'url' }) +
      inp('address', 'Street address', o.address) + inp('city', 'City', o.city) + inp('state', 'State', o.state) + inp('zip', 'ZIP', o.zip) + '</div></fieldset>';
    h += '<div class="row"><button class="btn btn-primary" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving…' : 'Save changes') + '</button><span class="small muted">Saving also tells visitors your listing was recently updated.</span></div></form>';
    return h;
  }
  function recoveryForm() {
    return '<h1>Choose a new password</h1><form data-form="recover" class="card" style="max-width:480px"><div class="field"><label for="rp">New password</label><input id="rp" name="pw" type="password" autocomplete="new-password" class="input" minlength="8"></div><button class="btn btn-primary" type="submit">Save new password</button></form>';
  }

  // ---------- actions ----------
  root.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'signout') { await CC.signOut(); window.location.href = 'index.html'; }
    if (act === 'toggle') { var id = b.getAttribute('data-id'); S.open = S.open === id ? null : id; render(); }
    if (act === 'dropstash') { if (confirm('Discard this request? You’d need to fill it out again.')) { CC.clearStash(); S.stash = null; render(); } }
  });
  root.addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = e.target, kind = f.getAttribute('data-form'); S.err = '';
    try {
      if (kind === 'pw' || kind === 'recover') {
        var pw = f.pw.value; if (pw.length < 8) return toast('Please use at least 8 characters.');
        var r = await CC.sb.auth.updateUser({ password: pw }); if (r.error) throw r.error;
        toast('Your password was updated.'); S.recovery = false; f.reset(); if (kind === 'recover') load(); return;
      }
      if (kind === 'stash') {
        var st = S.stash, file = f.file && f.file.files[0];
        if (st.data.method === 'doc' && !file) return toast('Please choose your document first.');
        S.busy = true; render();
        if (st.kind === 'new_listing') await CC.submitNewListing(st.data, file); else await CC.submitClaim(st.data, file);
        CC.clearStash(); S.busy = false; toast('Sent. We’ll email you after we review it.'); return load();
      }
      if (kind === 'org') {
        var id = f.getAttribute('data-id'), o = S.orgs.find(function (x) { return x.id === id; });
        var val = function (n) { return f.elements[n] ? f.elements[n].value.trim() : ''; };
        var list = function (n) { return val(n).split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
        var cats = Array.prototype.slice.call(f.querySelectorAll('input[name=cat]:checked')).map(function (x) { return x.value; });
        var services = {}; cats.forEach(function (k) { services[k] = f.elements['svc_' + k] ? val('svc_' + k).split('\n').map(function (x) { return x.trim(); }).filter(Boolean) : ((o.services || {})[k] || []); });
        var upd = { about: val('about'), availability: val('availability'), neighborhood: val('neighborhood') || null, contact_name: val('contact_name') || null, contact_title: val('contact_title') || null,
          categories: cats, services: services, hours: DAYS.map(function (_d, i) { return val('h' + i) || 'Call for hours'; }),
          languages: list('languages').length ? list('languages') : ['English'], cost: val('cost') || null, eligibility: list('eligibility'), what_to_bring: val('what_to_bring') || null };
        var held = [];
        REVIEWED.forEach(function (k) { var nv = val(k) || null; if ((nv || '') !== (o[k] || '')) { upd[k] = nv; held.push(k); } });
        S.busy = true; render();
        var res = await CC.sb.from('organizations').update(upd).eq('id', id); if (res.error) throw res.error;
        S.busy = false; toast(held.length ? 'Saved. Your ' + held.join(', ') + ' change will go live after our team checks it.' : 'Saved. Your listing is updated.');
        return load();
      }
    } catch (err) { S.busy = false; S.err = CC.msg(err); render(); window.scrollTo(0, 0); }
  });

  // ---------- start ----------
  if (!CC.ok) return render();
  CC.sb.auth.onAuthStateChange(function (ev, session) {
    if (ev === 'PASSWORD_RECOVERY') { S.session = session; S.recovery = true; render(); }
  });
  CC.whenReady.then(function (session) {
    S.session = session;
    if (!session) { S.loading = false; return render(); }
    if (/type=recovery/.test(location.hash)) { S.recovery = true; return render(); }
    load().catch(function (err) { S.loading = false; S.err = CC.msg(err); render(); });
  });
})();
