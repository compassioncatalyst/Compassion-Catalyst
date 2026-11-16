/* connect.js — talks to your Supabase database.
   Every page loads this file after config.js and supabase.js.
   It only uses the PUBLISHABLE key from config.js. Never put a secret key (sb_secret_… or service_role) on the website. */
(function () {
  var CC = window.CC = {};
  var cfg = window.CC_CONFIG || {};
  CC.ok = !!(window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  CC.sb = CC.ok ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;
  CC.session = null;
  CC.SITE = location.origin + location.pathname.replace(/[^/]*$/, ''); // the folder this page lives in

  CC.whenReady = CC.ok ? CC.sb.auth.getSession().then(function (r) { CC.session = r.data.session; return CC.session; }).catch(function () { return null; }) : Promise.resolve(null);
  if (CC.ok) CC.sb.auth.onAuthStateChange(function (_e, s) { CC.session = s; });

  // ---- friendly error text ----
  CC.msg = function (err) {
    var m = (err && (err.message || err.error_description || err)) + '';
    if (/Invalid login credentials/i.test(m)) return 'That email and password don’t match. Check them, or use “Forgot password?”.';
    if (/Email not confirmed/i.test(m)) return 'Please confirm your email first. We sent you a link when you signed up.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries in a short time. Please wait a few minutes and try again.';
    if (/claim_requests_one_pending|duplicate key/i.test(m)) return 'You already have a request waiting for review for this organization.';
    if (/Password should be/i.test(m)) return 'Please use a password with at least 8 characters.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'We couldn’t reach the server. Check your internet connection and try again.';
    return m || 'Something went wrong. Please try again.';
  };

  // ---- accounts ----
  // Logs in, or creates a new account if this email is new.
  // Returns { session } when logged in, or { needsConfirm: true } when Supabase is waiting for the person to click the email link.
  CC.ensureSession = async function (email, password) {
    if (!CC.ok) throw new Error('The site isn’t connected to the database yet.');
    var cur = (await CC.sb.auth.getSession()).data.session;
    if (cur) return { session: cur };
    var r = await CC.sb.auth.signInWithPassword({ email: email, password: password });
    if (!r.error) return { session: r.data.session };
    if (/Email not confirmed/i.test(r.error.message)) return { needsConfirm: true };
    var up = await CC.sb.auth.signUp({ email: email, password: password, options: { emailRedirectTo: CC.SITE + 'account.html' } });
    if (up.error) throw up.error;
    if (up.data.session) return { session: up.data.session };
    if (up.data.user && up.data.user.identities && up.data.user.identities.length === 0)
      throw new Error('That email already has an account, but the password didn’t match. Try again, or use “Forgot password?” on the log-in page.');
    return { needsConfirm: true };
  };
  CC.signIn = function (email, password) { return CC.sb.auth.signInWithPassword({ email: email, password: password }); };
  CC.forgot = function (email) { return CC.sb.auth.resetPasswordForEmail(email, { redirectTo: CC.SITE + 'account.html' }); };
  CC.signOut = function () { return CC.sb.auth.signOut(); };

  // ---- requests that wait until the person confirms their email ----
  // (Saved in this browser only. They're sent the next time the person logs in here.)
  var KEY = 'cc-waiting-request';
  CC.stash = function (req) { try { localStorage.setItem(KEY, JSON.stringify(req)); } catch (e) {} };
  CC.stashed = function () { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  CC.clearStash = function () { try { localStorage.removeItem(KEY); } catch (e) {} };

  // ---- uploads (private "claim-documents" bucket, inside the person's own folder) ----
  CC.upload = async function (file) {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) throw new Error('That file is too big. Please use a file under 10 MB.');
    var uid = CC.session.user.id;
    var path = uid + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    var r = await CC.sb.storage.from('claim-documents').upload(path, file, { upsert: false });
    if (r.error) throw r.error;
    return path;
  };

  // ---- "Add your organization" ----
  // d = { name, type, faith, hood, phone, email, cats, services, serves, person, method, refOrg, refName }
  CC.submitNewListing = async function (d, file) {
    var docPath = d.method === 'doc' ? await CC.upload(file) : null;
    var ins = await CC.sb.from('organizations').insert({
      name: d.name.trim(), org_type: d.type || null, faith: d.faith === 'yes' ? 'Faith-based' : null,
      categories: d.cats || [], neighborhood: d.hood || null, phone: d.phone || null, email: d.email || null,
      about: d.services || null, eligibility: d.serves ? [d.serves] : [], status: 'pending', verified: false
    }).select('id').single();
    if (ins.error) throw ins.error;
    var req = await CC.sb.from('claim_requests').insert({
      organization_id: ins.data.id, kind: 'new_listing', full_name: d.person.trim(), contact_email: d.email.trim(),
      method: d.method === 'doc' ? 'document' : 'reference', document_path: docPath,
      reference_note: d.method === 'ref' ? [d.refOrg, d.refName].filter(Boolean).join(' — ') : null
    });
    if (req.error) throw req.error;
    await CC.saveName(d.person);
    return ins.data.id;
  };

  // ---- "Claim your listing" ----
  // d = { orgDbId, orgName, name, role, email, method ('email' | 'phone' | 'doc'), workEmail }
  CC.submitClaim = async function (d, file) {
    var docPath = d.method === 'doc' ? await CC.upload(file) : null;
    var r = await CC.sb.from('claim_requests').insert({
      organization_id: d.orgDbId, kind: 'claim', full_name: d.name.trim(), role_title: d.role || null, contact_email: d.email.trim(),
      method: d.method === 'doc' ? 'document' : d.method, work_email: d.method === 'email' ? d.workEmail.trim() : null, document_path: docPath
    });
    if (r.error) throw r.error;
    await CC.saveName(d.name);
  };
  CC.saveName = async function (name) {
    try { if (name && CC.session) await CC.sb.from('profiles').update({ full_name: name.trim() }).eq('id', CC.session.user.id); } catch (e) {}
  };

  // ---- "Report incorrect info" (anyone can send one, no account needed) ----
  CC.report = function (orgDbId, reason, details) {
    return CC.sb.from('listing_reports').insert({ organization_id: orgDbId, reason: reason, details: details || null });
  };

  // ---- the public directory ----
  CC.loadListings = async function () {
    if (!CC.ok) return null;
    var r = await CC.sb.from('directory_listings').select('*').order('name');
    if (r.error) throw r.error;
    return r.data;
  };

  // --- Turn one row from the "directory_listings" view into the shape the screens use ---
  var BUNDLED = {};
  function bundledByName() {
    if (Object.keys(BUNDLED).length) return BUNDLED;
    ((window.BBData && window.BBData.ORGS) || []).forEach(function (o) { if (o.id !== 'hope') BUNDLED[o.name.trim().toLowerCase()] = o; });
    return BUNDLED;
  }
  function pos(lat, lng) { // rough spot on the small map drawing, for listings that are new
    if (lat == null || lng == null) return { x: 50, y: 50 };
    return { x: Math.max(4, Math.min(96, (lng + 87.05) / 0.45 * 100)), y: Math.max(4, Math.min(96, (33.68 - lat) / 0.35 * 100)) };
  }
  function shortDate(d) { return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  CC.toOrg = function (r) {
    var b = bundledByName()[(r.name || '').trim().toLowerCase()];
    var o = Object.assign({ partners: [], cap: '', open: null, mi: null, x: 50, y: 50 }, b ? JSON.parse(JSON.stringify(b)) : {});
    var hours = Array.isArray(r.hours) && r.hours.length === 7 ? r.hours : (o.hours || ['Call for hours', 'Call for hours', 'Call for hours', 'Call for hours', 'Call for hours', 'Call for hours', 'Call for hours']);
    var addr = r.is_sensitive || !r.address ? null : r.address + ', ' + (r.city || 'Birmingham') + ', ' + (r.state || 'AL') + (r.zip ? ' ' + r.zip : '');
    var upd = r.last_confirmed_at || r.updated_at;
    Object.assign(o, {
      id: b ? b.id : 'db-' + r.id, dbId: r.id, name: r.name, type: r.org_type || o.type || 'Nonprofit', faith: r.faith || '',
      cats: r.categories || [], hood: r.neighborhood || o.hood || '', addr: addr, phone: r.phone || '',
      verified: !!r.verified, vDate: shortDate(r.verified_at), updated: shortDate(upd), updN: upd ? Math.max(0, Math.round((Date.now() - new Date(upd)) / 864e5)) : 0,
      avail: ['Accepting', 'Limited', 'Waitlist', 'Full'].indexOf(r.availability) >= 0 ? r.availability : 'Accepting',
      hours: hours, open: b ? o.open : null, langs: r.languages && r.languages.length ? r.languages : ['English'], cost: r.cost || 'Free',
      elig: r.eligibility && r.eligibility.length ? r.eligibility : ['No restrictions'], docs: r.what_to_bring || '',
      contact: [r.contact_name || 'Main line', r.contact_title || '', r.email || ''], about: r.about || '',
      services: r.services && typeof r.services === 'object' ? r.services : {}, sensitive: !!r.is_sensitive,
      lat: r.is_sensitive ? null : r.latitude, lng: r.is_sensitive ? null : r.longitude, website: r.website || '',
      claimed: !!r.is_claimed, hideAvail: r.show_availability === false, applyUrl: r.apply_url || ''
    });
    if (!b) Object.assign(o, pos(o.lat, o.lng));
    (o.cats || []).forEach(function (k) { if (!o.services[k]) o.services[k] = []; });
    return o;
  };

  // ---- tiny helpers for the account and admin pages ----
  CC.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  CC.date = function (d) { return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  CC.CATS = [['food', 'Food'], ['housing', 'Housing & shelter'], ['utility', 'Utility help'], ['clothing', 'Clothing'], ['counseling', 'Counseling & mental health'], ['recovery', 'Addiction recovery'], ['transport', 'Transportation'], ['jobs', 'Jobs & job training'], ['legal', 'Legal help'], ['health', 'Health care'], ['family', 'Family & children'], ['seniors', 'Seniors']];
  if (window.BBData && window.BBData.CATS) CC.CATS = window.BBData.CATS.map(function (c) { return [c.k, c.label]; });
})();
