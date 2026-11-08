/* admin.js — the "Admin review" page (admin.html). Only accounts with is_admin = true in the profiles table can use it.
   The database checks this too, so other people can't approve anything even if they open this page. */
(function () {
  var CC = window.CC, E = CC.esc, root = document.getElementById('page');
  var S = { session: null, admin: false, tab: 'requests', loading: true, err: '', q: '', requests: [], changes: [], reports: [], orgs: [], names: {} };
  var MARK = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="12" r="6.5"/><circle cx="15.5" cy="12" r="6.5"/><path d="M12 8.6v6.8M9.9 10.9h4.2"/></svg>';
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 5000); }
  function shell(inner) {
    return '<header class="acct-top"><nav aria-label="Main"><a class="acct-brand" href="index.html">' + MARK + '<b>Compassion Catalyst</b></a>' +
      '<a class="l" href="directory.html">Find help</a><a class="l" href="account.html">Your account</a>' + (S.session ? '<button class="btn" data-act="signout">Log out</button>' : '') +
      '</nav></header><main class="acct-main">' + inner + '</main>';
  }

  async function load() {
    S.loading = true; render();
    var sb = CC.sb;
    var all = await Promise.all([
      sb.from('claim_requests').select('*').eq('status', 'pending').order('created_at'),
      sb.from('pending_changes').select('*').eq('status', 'pending').order('created_at'),
      sb.from('listing_reports').select('*').eq('status', 'open').order('created_at'),
      sb.from('organizations').select('id, name, status, verified, verified_at, phone, email, website, address, city, zip, is_sensitive, updated_at, last_confirmed_at').order('name')
    ]);
    all.forEach(function (r) { if (r.error) throw r.error; });
    S.requests = all[0].data; S.changes = all[1].data; S.reports = all[2].data; S.orgs = all[3].data;
    S.names = {}; S.orgs.forEach(function (o) { S.names[o.id] = o; });
    S.loading = false; render();
  }

  function render() {
    if (!CC.ok) { root.innerHTML = shell('<h1>Admin review</h1><p class="alert">The site can’t reach the database right now.</p>'); return; }
    if (!S.session) { root.innerHTML = shell('<h1>Admin review</h1><div class="card"><p>Please log in first.</p><a class="btn btn-primary" href="login.html" style="align-self:flex-start">Log in</a></div>'); return; }
    if (!S.admin) { root.innerHTML = shell('<h1>Admin review</h1><p class="alert">This page is only for the site’s administrators.</p>'); return; }
    var T = [['requests', 'New listings & claims', S.requests.length], ['changes', 'Contact changes', S.changes.length], ['reports', 'Reports', S.reports.length], ['listings', 'All listings', S.orgs.length]];
    var h = '<div><h1>Admin review</h1><p class="muted" style="margin-top:6px">Nothing goes live or gets the Verified badge until you approve it here.</p></div>';
    if (S.err) h += '<p class="alert" role="alert">' + E(S.err) + '</p>';
    h += '<div class="tabs" role="tablist">' + T.map(function (t) { return '<button role="tab" aria-selected="' + (S.tab === t[0]) + '" class="' + (S.tab === t[0] ? 'on' : '') + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + ' (' + t[2] + ')</button>'; }).join('') + '</div>';
    if (S.loading) h += '<p class="muted">Loading…</p>';
    else h += ({ requests: requestsTab, changes: changesTab, reports: reportsTab, listings: listingsTab })[S.tab]();
    root.innerHTML = shell(h);
  }
  function orgLine(id) { var o = S.names[id] || {}; return '<strong style="font-size:19px">' + E(o.name || 'Unknown organization') + '</strong>' + (o.phone ? ' <span class="small muted">· listed phone ' + E(o.phone) + '</span>' : ''); }
  function empty(t) { return '<div class="card white"><p class="muted">' + t + '</p></div>'; }

  function requestsTab() {
    if (!S.requests.length) return empty('No requests are waiting.');
    return S.requests.map(function (r) {
      var method = { email: 'Work email', phone: 'Call the listed phone', document: 'Document', reference: 'Reference' }[r.method] || r.method || '—';
      return '<div class="item"><div class="row" style="justify-content:space-between">' + orgLine(r.organization_id) + '<span class="tag ' + (r.kind === 'new_listing' ? 'blue' : '') + '">' + (r.kind === 'new_listing' ? 'New listing' : 'Claim') + '</span></div>' +
        '<dl class="kv"><dt>Person</dt><dd>' + E(r.full_name) + (r.role_title ? ', ' + E(r.role_title) : '') + '</dd><dt>Their email</dt><dd>' + E(r.contact_email) + '</dd><dt>How to verify</dt><dd>' + E(method) +
        (r.work_email ? ': ' + E(r.work_email) : '') + (r.reference_note ? ': ' + E(r.reference_note) : '') + '</dd><dt>Sent</dt><dd>' + CC.date(r.created_at) + '</dd></dl>' +
        '<div class="row">' + (r.document_path ? '<button class="btn btn-secondary" data-act="doc" data-path="' + E(r.document_path) + '">Open document</button><button class="btn btn-ghost" data-act="deldoc" data-path="' + E(r.document_path) + '">Delete document</button>' : '') +
        '<button class="btn btn-primary" data-act="approveClaim" data-id="' + r.id + '">' + (r.kind === 'new_listing' ? 'Approve listing' : 'Approve claim') + '</button>' +
        '<button class="btn btn-secondary" data-act="rejectClaim" data-id="' + r.id + '">Reject</button></div>' +
        '<span class="small muted">' + (r.kind === 'new_listing' ? 'Approving puts the listing on the directory and makes this person its owner.' : 'Approving makes this person the listing’s owner.') + ' Verified is set separately in “All listings”.</span></div>';
    }).join('');
  }
  function changesTab() {
    if (!S.changes.length) return empty('No contact changes are waiting.');
    return S.changes.map(function (c) {
      return '<div class="item"><div>' + orgLine(c.organization_id) + '</div><dl class="kv"><dt>Field</dt><dd>' + E(c.field) + '</dd><dt>Now</dt><dd>' + E(c.old_value || '(blank)') + '</dd><dt>Change to</dt><dd><strong>' + E(c.new_value || '(blank)') + '</strong></dd><dt>Asked</dt><dd>' + CC.date(c.created_at) + '</dd></dl>' +
        '<div class="row"><button class="btn btn-primary" data-act="approveChange" data-id="' + c.id + '">Approve</button><button class="btn btn-secondary" data-act="rejectChange" data-id="' + c.id + '">Reject</button></div></div>';
    }).join('');
  }
  function reportsTab() {
    if (!S.reports.length) return empty('No open reports.');
    return S.reports.map(function (r) {
      return '<div class="item"><div>' + orgLine(r.organization_id) + '</div><dl class="kv"><dt>Problem</dt><dd><strong>' + E(r.reason) + '</strong></dd><dt>Details</dt><dd>' + E(r.details || '(none)') + '</dd><dt>Sent</dt><dd>' + CC.date(r.created_at) + '</dd></dl>' +
        '<div class="row"><button class="btn btn-primary" data-act="report" data-v="confirmed" data-id="' + r.id + '">It’s right, needs fixing</button><button class="btn btn-secondary" data-act="report" data-v="dismissed" data-id="' + r.id + '">Dismiss</button></div>' +
        '<span class="small muted">Fix the listing in the Supabase Table Editor, or pause it in “All listings”.</span></div>';
    }).join('');
  }
  function listingsTab() {
    var q = S.q.trim().toLowerCase();
    var list = S.orgs.filter(function (o) { return !q || o.name.toLowerCase().indexOf(q) >= 0; });
    var counts = {}; S.orgs.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });
    var h = '<div class="row" style="justify-content:space-between"><div class="field" style="flex:1;min-width:220px;max-width:420px"><label for="aq">Search listings</label><input id="aq" class="input" data-act="search" value="' + E(S.q) + '"></div>' +
      '<span class="small muted">' + ['approved', 'pending', 'paused', 'removed'].map(function (k) { return (counts[k] || 0) + ' ' + k; }).join(' · ') + ' · ' + S.orgs.filter(function (o) { return o.verified; }).length + ' verified</span></div>';
    return h + list.map(function (o) {
      return '<div class="item"><div class="row" style="justify-content:space-between"><strong style="font-size:19px">' + E(o.name) + '</strong>' + (o.verified ? '<span class="tag solid">Verified ' + CC.date(o.verified_at) + '</span>' : '<span class="tag">Not verified</span>') + '</div>' +
        '<span class="small muted">' + E([o.address, o.city].filter(Boolean).join(', ') || (o.is_sensitive ? 'Private location' : 'No address')) + (o.phone ? ' · ' + E(o.phone) : '') + ' · updated ' + CC.date(o.last_confirmed_at || o.updated_at) + '</span>' +
        '<div class="row"><label class="small" for="st-' + o.id + '">Status</label><select id="st-' + o.id + '" class="input" style="width:auto;min-height:40px" data-act="status" data-id="' + o.id + '">' +
        [['approved', 'Live'], ['pending', 'Waiting for review'], ['paused', 'Paused (hidden)'], ['removed', 'Removed']].map(function (s) { return '<option value="' + s[0] + '"' + (o.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' +
        '<button class="btn ' + (o.verified ? 'btn-secondary' : 'btn-primary') + '" data-act="verify" data-id="' + o.id + '" data-v="' + (!o.verified) + '">' + (o.verified ? 'Remove Verified' : 'Mark Verified') + '</button></div></div>';
    }).join('');
  }

  async function run(p, done) {
    try { var r = await p; if (r && r.error) throw r.error; toast(done); await load(); } catch (err) { S.err = CC.msg(err); render(); window.scrollTo(0, 0); }
  }
  root.addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id'), sb = CC.sb; S.err = '';
    if (act === 'signout') { await CC.signOut(); window.location.href = 'index.html'; }
    if (act === 'tab') { S.tab = b.getAttribute('data-tab'); render(); }
    if (act === 'doc') {
      var r = await sb.storage.from('claim-documents').createSignedUrl(b.getAttribute('data-path'), 600);
      if (r.error) { S.err = CC.msg(r.error); return render(); }
      window.open(r.data.signedUrl, '_blank', 'noopener');
    }
    if (act === 'deldoc' && confirm('Delete this document for good? Do this after you’ve reviewed it.')) {
      var d = await sb.storage.from('claim-documents').remove([b.getAttribute('data-path')]);
      if (d.error) { S.err = CC.msg(d.error); return render(); }
      toast('Document deleted.'); b.remove();
    }
    if (act === 'approveClaim' && confirm('Approve this request?')) run(sb.rpc('approve_claim', { request_id: id }), 'Approved.');
    if (act === 'rejectClaim') { var n = prompt('Reason (optional). The person sees this note on their account page:'); if (n !== null) run(sb.rpc('reject_claim', { request_id: id, note: n || null }), 'Rejected.'); }
    if (act === 'approveChange') run(sb.rpc('approve_change', { change_id: id }), 'Change approved and live.');
    if (act === 'rejectChange') { var n2 = prompt('Reason (optional):'); if (n2 !== null) run(sb.rpc('reject_change', { change_id: id, note: n2 || null }), 'Change rejected.'); }
    if (act === 'report') run(sb.from('listing_reports').update({ status: b.getAttribute('data-v'), reviewed_at: new Date().toISOString(), reviewed_by: S.session.user.id }).eq('id', id), 'Report updated.');
    if (act === 'verify') {
      var v = b.getAttribute('data-v') === 'true';
      if (!v || confirm('Only mark this Verified if you have personally confirmed its details. Continue?')) run(sb.rpc('set_verified', { org: id, is_verified: v }), v ? 'Marked Verified.' : 'Verified badge removed.');
    }
  });
  root.addEventListener('change', function (e) {
    var el = e.target; if (el.getAttribute('data-act') !== 'status') return;
    run(CC.sb.from('organizations').update({ status: el.value }).eq('id', el.getAttribute('data-id')), 'Status updated.');
  });
  root.addEventListener('input', function (e) {
    if (e.target.getAttribute('data-act') !== 'search') return;
    S.q = e.target.value; var pos = e.target.selectionStart; render();
    var el = document.getElementById('aq'); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  });

  if (!CC.ok) return render();
  CC.whenReady.then(async function (session) {
    S.session = session;
    if (!session) { S.loading = false; return render(); }
    var p = await CC.sb.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle();
    S.admin = !!(p.data && p.data.is_admin);
    if (!S.admin) return render();
    load().catch(function (err) { S.loading = false; S.err = CC.msg(err); render(); });
  });
})();
