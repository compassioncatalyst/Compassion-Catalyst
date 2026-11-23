/* connect.js — talks to your Supabase database.
   Every page loads this file after config.js and supabase.js.
   It only uses the PUBLISHABLE key from config.js. Never put a secret key (sb_secret_… or service_role) on the website. */
(function () {
  var CC = window.CC = {};
  var cfg = window.CC_CONFIG || {};
  CC.ok = !!(window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  // "Keep me logged in": when it's ticked, the log-in is saved on this device (localStorage).
  // Otherwise it lives only until the browser is closed (sessionStorage).
  var REMEMBER = 'cc-remember';
  function remembered() { try { return localStorage.getItem(REMEMBER) === '1'; } catch (e) { return false; } }
  function store() { try { return remembered() ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
  var authStorage = {
    getItem: function (k) { try { var s = store(); return s ? s.getItem(k) : null; } catch (e) { return null; } },
    setItem: function (k, v) { try { var s = store(); if (s) s.setItem(k, v); } catch (e) {} },
    removeItem: function (k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }
  };
  CC.setRemember = function (on) {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^sb-.*-auth-token/.test(k)) keys.push(k); }
      keys.forEach(function (k) { localStorage.removeItem(k); });
      if (on) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER);
    } catch (e) {}
  };
  CC.sb = CC.ok ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
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
    if (/row-level security.*claim_requests/i.test(m)) return 'This request has to be sent from an account that uses the email on the form. Log out, then try again with that email.';
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
    // Already logged in as this same person: keep going. Logged in as someone else (for example your admin
    // account): log that account out first, so the request is made with the email typed on the form.
    if (cur && String(cur.user.email || '').toLowerCase() === String(email || '').toLowerCase()) return { session: cur };
    if (cur) { await CC.sb.auth.signOut(); CC.session = null; }
    var r = await CC.sb.auth.signInWithPassword({ email: email, password: password });
    if (!r.error) return { session: r.data.session };
    if (/Email not confirmed/i.test(r.error.message)) return { needsConfirm: true };
    var up = await CC.sb.auth.signUp({ email: email, password: password, options: { emailRedirectTo: CC.SITE + 'dashboard.html' } });
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
  // d = everything from the 5-step form (see CC.listingRow below) plus person, method, refOrg, refName
  // Turns the sign-up form into the columns of the organizations table.
  CC.listingRow = function (d) {
    var lines = function (x) { return String(x || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean); };
    var services = {}; (d.cats || []).forEach(function (k) { services[k] = lines((d.svc || {})[k]); });
    var langs = (d.langs || []).concat(String(d.langOther || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
    var county = String(d.county || '').trim(); if (county && !/county$/i.test(county)) county += ' County';
    var st = d.st || null, zip = String(d.zip || '').trim() || null;
    var area = null;
    if (st === 'GA' && /^coweta/i.test(county)) area = 'Coweta County, GA';
    if (st === 'AL' && zip && ['350', '351', '352'].indexOf(zip.slice(0, 3)) >= 0) area = 'Birmingham, AL';
    var web = String(d.website || '').trim(); if (web && !/^https?:\/\//i.test(web)) web = 'https://' + web;
    var applyUrl = String(d.applyUrl || '').trim();
    return {
      name: String(d.name || '').trim(), org_type: d.type || null,
      faith: d.faith === 'yes' ? (String(d.faithName || '').trim() || 'Faith-based') : null,
      categories: d.cats || [], neighborhood: d.hood || null,
      address: String(d.addr || '').trim() || null, city: String(d.city || '').trim() || null, state: st, zip: zip,
      county: county || null, service_area: area, hide_address: !!d.hideAddr,
      phone: String(d.phone || '').trim() || null, email: String(d.email || '').trim() || null, website: web || null,
      contact_name: String(d.cname || '').trim() || null, contact_title: String(d.ctitle || '').trim() || null,
      about: String(d.about || d.services || '').trim() || null, services: services,
      hours: d.noHours ? [] : (d.hours || []).map(function (h) { return String(h || '').trim() || 'Closed'; }),
      languages: langs.length ? langs : ['English'], cost: d.cost || null, eligibility: d.elig || [],
      what_to_bring: String(d.docs || '').trim() || null, docs_title: String(d.docsTitle || '').trim() || null,
      apply_mode: d.applyMode === 'web' && /^https?:\/\//i.test(applyUrl) ? 'web' : 'steps',
      apply_url: d.applyMode === 'web' && /^https?:\/\//i.test(applyUrl) ? applyUrl : null,
      availability: ['Accepting', 'Limited', 'Waitlist', 'Full'].indexOf(d.avail) >= 0 ? d.avail : 'Accepting'
    };
  };
  CC.submitNewListing = async function (d, file) {
    var docPath = d.method === 'doc' ? await CC.upload(file) : null;
    var row = Object.assign(CC.listingRow(d), { status: 'pending', verified: false });
    var ins = await CC.sb.from('organizations').insert(row).select('id').single();
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
  // Edits made in "Preview and edit your listing" while it waits for review
  CC.updatePendingListing = async function (orgDbId, d) {
    var r = await CC.sb.from('organizations').update(CC.listingRow(d)).eq('id', orgDbId).select('id');
    if (r.error) throw r.error;
    if (!r.data || !r.data.length) throw new Error('This listing can’t be changed here anymore. If it was approved, edit it from your dashboard.');
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
      elig: r.eligibility && r.eligibility.length ? r.eligibility : ['No restrictions'], docs: r.what_to_bring || '', docsTitle: r.docs_title || '',
      contact: [r.contact_name || 'Main line', r.contact_title || '', r.email || ''], about: r.about || '',
      services: r.services && typeof r.services === 'object' ? r.services : {}, sensitive: !!r.is_sensitive,
      lat: r.is_sensitive ? null : r.latitude, lng: r.is_sensitive ? null : r.longitude, website: r.website || '',
      claimed: !!r.is_claimed, hideAvail: r.show_availability === false, applyUrl: r.apply_url || '',
      area: r.service_area || '', zip: r.is_sensitive ? '' : (r.zip || ''),
      st: CC.stateName(r.state || (r.service_area === 'Georgia' ? 'GA' : '')), county: r.county || ''
    });
    if (!b && !o.hood) o.hood = r.city || '';
    if (!b) Object.assign(o, pos(o.lat, o.lng));
    (o.cats || []).forEach(function (k) { if (!o.services[k]) o.services[k] = []; });
    return o;
  };

  // ---- service areas: who each listing serves ----
  // A listing's service_area is 'Nationwide', 'Georgia' / 'Alabama' (statewide), or a local area below.
  // To add a new local area, add it here with the first 3 digits of its ZIP codes.
  CC.AREAS = { 'Birmingham, AL': ['350', '351', '352'], 'Coweta County, GA': ['302'] };
  CC.stateOfZip = function (z) {
    var n = +String(z).slice(0, 3);
    if ((n >= 300 && n <= 319) || n === 398 || n === 399) return 'Georgia';
    if (n >= 350 && n <= 369) return 'Alabama';
    return '';
  };
  CC.servesZip = function (o, zip) {
    var a = o.area || '';
    if (!a || a === 'Nationwide') return true;
    if (a === 'Georgia' || a === 'Alabama') return CC.stateOfZip(zip) === a;
    var pre = CC.AREAS[a];
    if (pre) return pre.indexOf(String(zip).slice(0, 3)) >= 0;
    return !!o.zip && o.zip.slice(0, 3) === String(zip).slice(0, 3);
  };
  // ---- State and County filters ----
  var STATES = { AL: 'Alabama', GA: 'Georgia' };
  CC.stateName = function (s) { s = String(s || '').trim(); return STATES[s.toUpperCase()] || s; };
  // A listing matches the State / County filters if it's in that place, or serves all of it (statewide or nationwide).
  CC.placeMatch = function (o, f) {
    if (o.area === 'Nationwide') return true;
    if (f.st && o.st !== f.st) return false;
    if (f.county && o.county !== f.county && !(o.area === o.st || o.area === 'Georgia' || o.area === 'Alabama')) return false;
    return true;
  };
  // Adds the State / County choices to a page's values (v.dir).
  CC.placeVals = function (app, v) {
    if (!v || !v.dir) return;
    var f = app.state.filters || {}, orgs = app.state.orgs || [], st = {}, co = {};
    orgs.forEach(function (o) { if (o.st) st[o.st] = 1; if (o.county && (!f.st || o.st === f.st)) co[o.county] = 1; });
    v.dir.states = Object.keys(st).sort();
    v.dir.counties = Object.keys(co).sort();
    v.dir.countyAll = f.st ? 'All of ' + f.st : 'All counties';
    v.dir.st = { v: f.st || '', on: function (e) { var val = e.target.value; app.setState(function (s2) { return { filters: Object.assign({}, s2.filters, { st: val, county: '' }) }; }); } };
    v.dir.county = { v: f.county || '', on: function (e) { var val = e.target.value; app.setState(function (s2) { return { filters: Object.assign({}, s2.filters, { county: val }) }; }); } };
  };

  // The neighborhood filter lists the places the live listings are in.
  CC.setPlaces = function (orgs) {
    if (!window.BBData) return;
    var seen = {};
    (orgs || []).forEach(function (o) { if (o.hood && !o.sensitive) seen[o.hood] = 1; });
    var wide = ['Statewide (Georgia)', 'Nationwide'];
    window.BBData.HOODS = Object.keys(seen).filter(function (h) { return wide.indexOf(h) < 0; }).sort()
      .concat(wide.filter(function (h) { return seen[h]; }));
  };

  // ---- tiny helpers for the account and admin pages ----
  CC.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  CC.date = function (d) { return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  CC.CATS = [['food', 'Food'], ['housing', 'Housing & shelter'], ['utility', 'Utility help'], ['clothing', 'Clothing'], ['counseling', 'Counseling & mental health'], ['recovery', 'Addiction recovery'], ['transport', 'Transportation'], ['jobs', 'Jobs & job training'], ['legal', 'Legal help'], ['health', 'Health care'], ['family', 'Family & children'], ['seniors', 'Seniors']];
  if (window.BBData && window.BBData.CATS) CC.CATS = window.BBData.CATS.map(function (c) { return [c.k, c.label]; });
})();
