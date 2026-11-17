/* admin-app.js — the Admin page (admin.html).
   PART 1: the page engine. PART 2: the Admin screens and buttons. PART 3: admin-bridge (Supabase).
   No passwords or secret keys are stored in this file. Only site admins can use it, and the
   database checks every action again (see the update SQL files). */

/* ==========================================================================
   PART 1 — A tiny page engine (plain JavaScript, no frameworks).
   It reads the page layout in screens.js, fills in the {{ … }} spots with
   live values from PART 2, and keeps the page up to date as people click
   and type. You normally never need to edit this part.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Small stand-in for the two helpers the app code expects ---------- */
  var FRAG = { fragment: true };
  function flat(list, out) {
    out = out || [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (Array.isArray(x)) flat(x, out); else out.push(x);
    }
    return out;
  }
  window.React = {
    Fragment: FRAG,
    createElement: function (type, props) {
      var kids = flat(Array.prototype.slice.call(arguments, 2));
      return { $el: true, t: type, p: props || {}, c: kids };
    },
    isValidElement: function (v) { return !!(v && v.$el); }
  };

  window.DCLogic = class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(update, cb) { if (this.__app) this.__app.setState(update, cb); }
    forceUpdate() { if (this.__app) this.__app.schedule(); }
    componentDidMount() {}
    componentDidUpdate() {}
    componentWillUnmount() {}
    renderVals() { return {}; }
  };

  /* ---- Reading {{ … }} values -------------------------------------------- */
  var IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  function resolve(vals, src) {
    var e = String(src).trim();
    if (!e) return undefined;
    if (e[0] === '(' && e[e.length - 1] === ')' && wraps(e)) return resolve(vals, e.slice(1, -1));
    var eq = topEq(e);
    if (eq) {
      var l = resolve(vals, e.slice(0, eq.i)), r = resolve(vals, e.slice(eq.i + eq.op.length));
      return eq.op === '===' ? l === r : eq.op === '!==' ? l !== r : eq.op === '==' ? l == r : l != r;
    }
    if (e[0] === '!') return !resolve(vals, e.slice(1));
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (e === 'null') return null;
    if (e === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
    if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) return e.slice(1, -1);
    return path(vals, e);
  }
  function wraps(e) {
    var d = 0;
    for (var i = 0; i < e.length - 1; i++) { if (e[i] === '(') d++; else if (e[i] === ')') { d--; if (d === 0) return false; } }
    return true;
  }
  function topEq(e) {
    var d = 0;
    for (var i = 0; i < e.length; i++) {
      var c = e[i];
      if (c === '[' || c === '(') d++;
      else if (c === ']' || c === ')') d--;
      else if (d === 0 && (c === '=' || c === '!') && e[i + 1] === '=') {
        if (i > 0 && (e[i - 1] === '=' || e[i - 1] === '!')) continue;
        if (!e.slice(0, i).trim()) continue;
        return { i: i, op: e[i + 2] === '=' ? c + '==' : c + '=' };
      }
    }
    return null;
  }
  function path(vals, e) {
    var h = e.match(IDENT);
    if (!h) return undefined;
    var cur = vals == null ? undefined : vals[h[0]], i = h[0].length;
    while (i < e.length) {
      if (e[i] === '.') {
        var m = e.slice(i + 1).match(IDENT) || e.slice(i + 1).match(/^\d+/);
        if (!m) return undefined;
        cur = cur == null ? undefined : cur[m[0]];
        i += 1 + m[0].length;
      } else if (e[i] === '[') {
        var dep = 1, j = i + 1;
        while (j < e.length && dep > 0) { if (e[j] === '[') dep++; else if (e[j] === ']') { dep--; if (dep === 0) break; } j++; }
        if (dep !== 0) return undefined;
        var key = resolve(vals, e.slice(i + 1, j));
        cur = cur == null ? undefined : cur[key];
        i = j + 1;
      } else return undefined;
    }
    return cur;
  }
  function attrGetter(raw) {
    var whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (whole) return function (v) { return resolve(v, whole[1]); };
    if (raw.indexOf('{{') >= 0) {
      var parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
      return function (v) { return parts.map(function (s, i) { if (i & 1) { var x = resolve(v, s); return x == null ? '' : x; } return s; }).join(''); };
    }
    return function () { return raw; };
  }

  /* ---- Hover styles (style-hover="…") become small CSS classes ----------- */
  var hoverSheet = null, hoverCache = {}, hoverN = 0;
  function hoverClass(kind, css) {
    var k = kind + '|' + css;
    if (hoverCache[k]) return hoverCache[k];
    if (!hoverSheet) { var el = document.createElement('style'); document.head.appendChild(el); hoverSheet = el.sheet; }
    var cls = 'h' + (hoverN++).toString(36);
    var decl = css.split(';').map(function (d) { return d.trim(); }).filter(Boolean)
      .map(function (d) { return /!\s*important$/i.test(d) ? d : d + ' !important'; }).join(';');
    hoverSheet.insertRule('.' + cls + ':' + kind + '{' + decl + '}', hoverSheet.cssRules.length);
    hoverCache[k] = cls;
    return cls;
  }

  /* ---- Turning screens.js into render functions -------------------------- */
  var RAW = { select: 'sc-raw-select', table: 'sc-raw-table', tbody: 'sc-raw-tbody', thead: 'sc-raw-thead', tfoot: 'sc-raw-tfoot', tr: 'sc-raw-tr', td: 'sc-raw-td', th: 'sc-raw-th', caption: 'sc-raw-caption' };
  var UNRAW = {}; Object.keys(RAW).forEach(function (k) { UNRAW[RAW[k]] = k; });
  var CAMEL = 'sc-camel-';
  function encode(html) {
    html = html.replace(/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g, function (_, sp, name, eq) {
      return sp + CAMEL + name.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }) + eq;
    });
    Object.keys(RAW).forEach(function (real) { html = html.replace(new RegExp('(</?)' + real + '(?=[\\s>])', 'gi'), '$1' + RAW[real]); });
    return html;
  }
  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function compile(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = encode(html);
    var kids = walkKids(tpl.content);
    return function (vals) { return build(kids, vals, ''); };
  }
  function walkKids(node) {
    var out = [];
    node.childNodes.forEach(function (c) { var b = walk(c); if (b) out.push(b); });
    return out;
  }
  function build(kids, vals, prefix) {
    var out = [];
    for (var j = 0; j < kids.length; j++) kids[j](vals, prefix + j, out);
    return out;
  }
  function walk(node) {
    if (node.nodeType === 3) return walkText(node);
    if (node.nodeType !== 1) return null;
    var tag = node.localName;
    if (tag === 'sc-if') {
      var test = attrGetter(node.getAttribute('value') || ''), ik = walkKids(node);
      return function (vals, key, out) {
        if (!test(vals)) return;
        for (var j = 0; j < ik.length; j++) ik[j](vals, key + '.' + j, out);
      };
    }
    if (tag === 'sc-for') {
      var list = attrGetter(node.getAttribute('list') || ''), as = node.getAttribute('as') || 'item', fk = walkKids(node);
      return function (vals, key, out) {
        var arr = list(vals);
        if (!Array.isArray(arr)) return;
        for (var i = 0; i < arr.length; i++) {
          var sub = Object.assign({}, vals); sub[as] = arr[i]; sub.$index = i;
          for (var j = 0; j < fk.length; j++) fk[j](sub, key + '.' + i + '.' + j, out);
        }
      };
    }
    return walkEl(node);
  }
  function walkText(node) {
    var txt = node.nodeValue || '';
    if (txt.indexOf('{{') < 0) {
      if (!txt.trim() && txt.indexOf(' ') < 0) return null;
      return function (vals, key, out) { out.push({ k: key, text: txt }); };
    }
    var parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
    return function (vals, key, out) {
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i], k = key + ':' + i;
        if (!(i & 1)) { if (p) out.push({ k: k, text: p }); continue; }
        pushValue(resolve(vals, p), k, out, true);
      }
    };
  }
  function pushValue(v, k, out, wrap) {
    if (v === undefined || v === null || typeof v === 'boolean') return;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) pushValue(v[i], k + '~' + i, out, false); return; }
    if (v && v.$el) { out.push(fromElement(v, k)); return; }
    if (wrap) out.push({ k: k, t: 'span', p: { className: 'sc-interp' }, c: [{ k: '0', text: String(v) }] });
    else out.push({ k: k, text: String(v) });
  }
  function fromElement(e, k) {
    if (e.t === FRAG) return { k: k, frag: true, c: kidsOf(e.c) };
    return { k: k, t: e.t, p: e.p, c: kidsOf(e.c) };
  }
  function kidsOf(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) pushValue(list[i], String(i), out, false);
    // unwrap fragments
    var res = [];
    out.forEach(function (n) { if (n.frag) n.c.forEach(function (c) { c.k = n.k + '/' + c.k; res.push(c); }); else res.push(n); });
    return res;
  }
  function walkEl(node) {
    var tag = UNRAW[node.localName] || node.localName;
    var getters = [], hovers = [];
    Array.prototype.forEach.call(node.attributes, function (a) {
      var key = a.name;
      if (key.indexOf(CAMEL) === 0) key = camel(key.slice(CAMEL.length));
      if (key.indexOf('hint-') === 0) return;
      if (key.indexOf('style-') === 0) { hovers.push(hoverClass(key.slice(6), a.value)); return; }
      if (key === 'class') key = 'className';
      else if (key === 'for') key = 'htmlFor';
      else if (/^on[a-z]/.test(key)) key = 'on' + key[2].toUpperCase() + key.slice(3);
      getters.push([key, attrGetter(a.value)]);
    });
    var kids = walkKids(node);
    return function (vals, key, out) {
      var p = {};
      for (var i = 0; i < getters.length; i++) p[getters[i][0]] = getters[i][1](vals);
      if (hovers.length) p.className = [p.className].concat(hovers).filter(Boolean).join(' ');
      out.push({ k: key, t: tag, p: p, c: build(kids, vals, '') });
    };
  }

  /* ---- Updating the real page (only what changed) ------------------------ */
  var SVG = 'http://www.w3.org/2000/svg';
  var UNITLESS = {}; ('animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth columnCount columns flex flexGrow flexShrink gridArea gridRow gridRowEnd gridRowStart gridColumn gridColumnEnd gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth WebkitLineClamp').split(' ').forEach(function (k) { UNITLESS[k] = 1; });
  var ATTR = { className: 'class', htmlFor: 'for', tabIndex: 'tabindex', readOnly: 'readonly', maxLength: 'maxlength', minLength: 'minlength', autoComplete: 'autocomplete', inputMode: 'inputmode', noValidate: 'novalidate', autoFocus: 'autofocus', colSpan: 'colspan', rowSpan: 'rowspan', spellCheck: 'spellcheck', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule', clipRule: 'clip-rule', strokeDasharray: 'stroke-dasharray' };
  var BOOL = { disabled: 1, hidden: 1, required: 1, multiple: 1, readonly: 1, novalidate: 1, autofocus: 1, open: 1 };
  function styleText(v) {
    if (v == null || v === false) return '';
    if (typeof v === 'string') return v;
    var s = '';
    for (var k in v) {
      var val = v[k];
      if (val == null || val === false || val === '') continue;
      var prop = k.indexOf('--') === 0 ? k : k.replace(/^(Webkit|Moz|ms)/, function (m) { return '-' + m.toLowerCase(); }).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
      s += prop + ':' + (typeof val === 'number' && val !== 0 && !UNITLESS[k] ? val + 'px' : val) + ';';
    }
    return s;
  }
  function eventType(el, name) {
    var n = name.slice(2).toLowerCase();
    if (n === 'change') {
      var t = el.localName;
      if (t === 'textarea') return 'input';
      if (t === 'input') { var ty = (el.getAttribute('type') || 'text').toLowerCase(); return (ty === 'checkbox' || ty === 'radio' || ty === 'file') ? 'change' : 'input'; }
      return 'change';
    }
    if (n === 'doubleclick') return 'dblclick';
    return n;
  }
  var app = null;
  function setProps(el, old, p) {
    var k, v, events = [];
    for (k in old) if (!(k in p)) apply(el, k, undefined, old[k]);
    for (k in p) {
      if (/^on[A-Z]/.test(k)) { events.push(k); continue; }
      if (k === 'value' || k === 'children' || k === 'key') continue;
      if (old[k] !== p[k] || k === 'checked') apply(el, k, p[k], old[k]);
    }
    for (var i = 0; i < events.length; i++) apply(el, events[i], p[events[i]], old[events[i]]);
  }
  function apply(el, k, v, ov) {
    if (k === 'ref') { if (v !== ov) { if (typeof ov === 'function') ov(null); if (typeof v === 'function') v(el); } return; }
    if (/^on[A-Z]/.test(k)) {
      var type = eventType(el, k);
      el.__ev = el.__ev || {};
      if (!(type in el.__ev)) {
        el.addEventListener(type, function (e) {
          var f = el.__ev[type];
          if (type === 'submit') e.preventDefault();
          if (typeof f === 'function') { f(e); if (app) app.schedule(); }
        });
      }
      el.__ev[type] = v;
      return;
    }
    if (k === 'style') { var st = styleText(v); if (el.__st !== st) { el.__st = st; if (st) el.setAttribute('style', st); else el.removeAttribute('style'); } return; }
    if (k === 'checked') { el.checked = !!v; return; }
    if (k === 'selected') { el.selected = !!v; return; }
    if (k === 'disabled' && 'disabled' in el) { el.disabled = !!v; return; }
    var name = ATTR[k] || k;
    var aria = name.indexOf('aria-') === 0 || name.indexOf('data-') === 0;
    if (v == null || (v === false && !aria)) el.removeAttribute(name);
    else if (v === true && !aria) el.setAttribute(name, '');
    else el.setAttribute(name, String(v));
  }
  function setValue(el, p) {
    if (!('value' in p)) return;
    var t = el.localName, v = p.value;
    if (t === 'input' || t === 'textarea' || t === 'select') {
      var s = v == null ? '' : String(v);
      if (el.value !== s) el.value = s;
    } else apply(el, 'value', v, undefined);
  }
  function same(n, v) { return v.text !== undefined ? n.nodeType === 3 : (n.nodeType === 1 && n.__t === v.t); }
  function create(v, ns) {
    if (v.text !== undefined) { var tn = document.createTextNode(v.text); tn.__k = v.k; return tn; }
    var ns2 = v.t === 'svg' ? SVG : ns;
    var el = ns2 ? document.createElementNS(ns2, v.t) : document.createElement(v.t);
    el.__t = v.t; el.__k = v.k; el.__p = {};
    if (v.p.type != null && v.t === 'input') el.setAttribute('type', v.p.type);
    setProps(el, {}, v.p);
    patchKids(el, v.c, ns2);
    setValue(el, v.p);
    el.__p = v.p;
    return el;
  }
  function update(n, v, ns) {
    if (v.text !== undefined) { if (n.data !== v.text) n.data = v.text; return; }
    var ns2 = v.t === 'svg' ? SVG : ns;
    setProps(n, n.__p || {}, v.p);
    patchKids(n, v.c, ns2);
    setValue(n, v.p);
    n.__p = v.p;
  }
  function unmount(n) {
    if (n.nodeType !== 1) return;
    if (n.__p && typeof n.__p.ref === 'function') n.__p.ref(null);
    for (var c = n.firstChild; c; c = c.nextSibling) unmount(c);
  }
  function patchKids(parent, vkids, ns) {
    var old = {}, nodes = parent.childNodes, i;
    for (i = 0; i < nodes.length; i++) if (nodes[i].__k != null) old[nodes[i].__k] = nodes[i];
    for (i = 0; i < vkids.length; i++) {
      var v = vkids[i], n = old[v.k];
      if (n && same(n, v)) { delete old[v.k]; update(n, v, ns); } else n = create(v, ns);
      var cur = nodes[i];
      if (cur !== n) parent.insertBefore(n, cur || null);
    }
    while (nodes.length > vkids.length) { var last = parent.lastChild; unmount(last); parent.removeChild(last); }
  }

  /* ---- Starting the app ---------------------------------------------------- */
  window.startApp = function (Component, mountEl, props, layoutHtml) {
    var render = compile(layoutHtml);
    var logic = new Component(props);
    var queued = false, cbs = [], mounted = false, prevState = logic.state;
    app = {
      setState: function (update, cb) {
        var prev = logic.state, patch = typeof update === 'function' ? update(prev, logic.props) : update;
        if (patch) logic.state = Object.assign({}, prev, patch);
        if (cb) cbs.push(cb);
        app.schedule();
      },
      schedule: function () { if (!queued) { queued = true; Promise.resolve().then(flush); } }
    };
    logic.__app = app;
    function draw() {
      var vals;
      try { vals = Object.assign({}, logic.props, logic.renderVals() || {}); }
      catch (e) { console.error('Page error:', e); return; }
      patchKids(mountEl, render(vals), null);
    }
    function flush() {
      queued = false;
      var ps = prevState; prevState = logic.state;
      draw();
      var list = cbs; cbs = [];
      try { if (mounted) logic.componentDidUpdate(logic.props, ps); } catch (e) { console.error(e); }
      list.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    }
    draw();
    mounted = true;
    prevState = logic.state;
    try { logic.componentDidMount(); } catch (e) { console.error(e); }
    return logic;
  };
})();

/* ===== PART 2 — the Admin page ===== */
class Component extends DCLogic {
  state = Object.assign({
    tab: 'overview', q: '', toast: '', mini: false, lf: {}, lfOpen: false, lsort: '', crop: null, repStage: 'new', repCompose: false, repMsg: '', repMsgErr: '', mailF: 'open', mailQ: '', mailMine: false, mailPop: null, mailReply: '', mailErr: '',
    mails: [], asg: { open: false, member: '', sel: {} }, repPop: null, repNote: '', msgTo: null, msgText: '', msgErr: '',
    me: { name: '', title: 'Founder', email: '', phone: '', photo: '' },
    st: { name: '', email: '', contact: 'info@compassioncatalyst.org',
      alerts: { listing: true, claim: true, change: true, report: true, email: true, digest: false },
      inbox: { admin: true, reviewer: false, viewer: false, autoListing: true, autoUpdate: true },
      tpl: { listingQ: 'Thanks for reaching out! We can’t answer questions about a specific place’s hours, services or availability. Please call them directly; their phone number is on their listing at compassioncatalyst.org.\n\nIf something on a listing looks wrong, like the hours, phone number or address, you can tell us here: compassioncatalyst.org/directory.html. Open the listing and choose “Suggest a correction”. We check every report.\n\nIf it’s an emergency, call 911. For help finding other resources, call 211.',
        update: 'Thanks for keeping your listing current! Organizations can now update their own hours, services and details. Log in at compassioncatalyst.org/login.html and choose Edit listing. Phone, email and address changes are checked by our team before they go live. If you haven’t claimed your listing yet, you can do that at compassioncatalyst.org/claim.html.',
        status: 'Thanks for checking in! Your request is still being reviewed. We review every listing by hand, usually within 3–5 business days, and we’ll email you as soon as it’s done.' },
      site: { accept: true, pendingTag: true, reports: true },
      rules: { pause: 30, remove: 60, reports: 3, reverify: 6, keepMail: 12 },
      auto: { small: true, web: true, google: true, irs: true } }, teamEditing: false, teamOpen: {}, teamSel: 'all', rolesOpen: false, teamRange: 'week',
    teamLog: [], inv: { email: '', role: 'reviewer', err: '' },
    team: [], reqKind: 'all', reqView: 'compact', pop: null, boxTab: 'listings', listF: 'all',
    activity: [],
    requests: [],
    changes: [],
    reports: [],
    listings: [],
    chkStage: 'flag',
    checks: []
  }, window.CC_ADMIN_INIT || {});
  say(msg) { this.setState({ toast: msg }); clearTimeout(this._t); this._t = setTimeout(() => this.setState({ toast: '' }), 3000); }
  DET = window.CC_ADMIN_DET || {};
  CATL = {"food": "Food", "housing": "Housing & shelter", "utility": "Utility help", "clothing": "Clothing", "counseling": "Counseling & mental health", "recovery": "Addiction recovery", "transport": "Transportation", "jobs": "Jobs & career", "legal": "Legal aid", "medical": "Medical & dental", "dv": "Domestic violence support", "youth": "Youth & family", "senior": "Senior services", "reentry": "Re-entry support"};
  listShown() {
    const s = this.state, F = s.lf || {}, q = (s.q || '').trim().toLowerCase(), V = s.listF || 'all';
    const info = o => this.DET[o.id] || this.DET[o.name] || {};
    const hay = o => { const d = info(o); return (o.name + ' ' + o.place + ' ' + (d.about || '') + ' ' + (d.cats || []).map(k => this.CATL[k] || k).join(' ') + ' ' + Object.values(d.services || {}).flat().join(' ')).toLowerCase(); };
    let L = s.listings.filter(o => { const d = info(o);
      if (q && !q.split(/\s+/).every(w => hay(o).includes(w))) return false;
      if (V === 'unverified' && !(o.status === 'approved' && !o.verified)) return false;
      if (V === 'verified' && !o.verified) return false;
      if ((F.cats || []).length && !(F.cats).some(k => (d.cats || []).includes(k))) return false;
      if (F.faith === 'yes' && !d.faith) return false; if (F.faith === 'no' && d.faith) return false;
      if ((F.types || []).length && !F.types.includes(d.type || 'Nonprofit')) return false;
      if (F.hood && o.place !== F.hood) return false;
      if (F.accepting && (d.avail || 'Accepting') !== 'Accepting') return false;
      if (F.status && o.status !== F.status) return false;
      if (F.asg === 'none' && o.assignee) return false; if (F.asg && F.asg !== 'none' && o.assignee !== F.asg) return false;
      return true; });
    const so = s.lsort || (V === 'unverified' ? 'checked' : 'name');
    return L.sort((a, b) => so === 'checked' ? b.checked - a.checked : so === 'recent' ? a.checked - b.checked : a.name.localeCompare(b.name));
  }
  popList(kind, id) {
    const s = this.state;
    if (kind === 'req') { const k = (s.requests.find(x => x.id === id) || {}).kind; return s.requests.filter(x => x.kind === k).sort((a, b) => b.days - a.days).map(x => x.id); }
    if (s.tab === 'listings') return this.listShown().map(o => o.id);
    return s.listings.filter(o => o.status === 'approved' && !o.verified).sort((a, b) => b.checked - a.checked).map(o => o.id);
  }
  openPop(kind, id, list) {
    const s = this.state; list = list || this.popList(kind, id);
    const it = kind === 'req' ? s.requests.find(x => x.id === id) : s.listings.find(x => x.id === id);
    if (!it) return this.setState({ pop: null });
    const name = kind === 'req' ? it.org : it.name, key = kind + ':' + id;
    const D0 = this.DET[it.orgId || it.id] || this.DET[name] || { type: 'Nonprofit', faith: '', cats: [], hood: '', addr: '', phone: '', avail: 'Accepting', cap: '', hours: ['', '', '', '', '', '', ''], langs: ['English'], cost: 'Free', elig: [], docs: '', contact: ['', '', ''], about: '', services: {} };
    const f = Object.assign({ org: name, phone: it.phone || D0.phone, place: it.place || D0.hood || '', status: it.status || 'approved', type: D0.type || 'Nonprofit', faith: D0.faith || '', avail: D0.avail || 'Accepting', cap: D0.cap || '',
      about: D0.about || '', svc: Object.fromEntries(Object.keys(D0.services || {}).map(k => [k, (D0.services[k] || []).join('\n')])), elig: (D0.elig || []).join(', '), cost: D0.cost || '', langs: (D0.langs || []).join(', '), docs: D0.docs || '',
      hours: (D0.hours || []).slice(0, 7).concat(['', '', '', '', '', '', '']).slice(0, 7), addr: D0.addr || '', website: D0.website || '', applyUrl: D0.applyUrl || '', area: D0.area || '', st: D0.state || (/,\s*GA\b/.test(D0.addr || '') ? 'GA' : 'AL'), county: D0.county || '', sensitive: !!D0.sensitive, cName: (D0.contact || [])[0] || '', cRole: (D0.contact || [])[1] || '', cEmail: (D0.contact || [])[2] || '' },
      (s.det || {})[key] || {});
    this.setState({ pop: { kind, id, key, list, note: '', checks: {}, editing: false, f } });
  }
  popAdvance(P) { const rest = (P.list || []).filter(x => x !== P.id), i = (P.list || []).indexOf(P.id); const nxt = rest[Math.min(i, rest.length - 1)]; if (nxt) this.openPop(P.kind, nxt, rest); else this.setState({ pop: null }); }
  popVals() {
    const s = this.state, P = s.pop;
    if (!P) return { open: false };
    const setP = o => this.setState(st => ({ pop: Object.assign({}, st.pop, o) }));
    const setF = (k, v) => this.setState(st => ({ pop: Object.assign({}, st.pop, { f: Object.assign({}, st.pop.f, { [k]: v }) }) }));
    const close = () => this.setState({ pop: null });
    const C = { listings: 'oklch(0.55 0.16 250)', claims: 'oklch(0.58 0.19 27)', verify: 'oklch(0.80 0.15 85)' };
    const isReq = P.kind === 'req', r = isReq ? s.requests.find(x => x.id === P.id) : null, o = isReq ? null : s.listings.find(x => x.id === P.id);
    if (!r && !o) return { open: false };
    const isNew = isReq && r.kind === 'new_listing', isClaim = isReq && !isNew;
    const ck = isNew ? ['Called the phone number they gave', 'Checked it’s a real organization (website, IRS lookup or Google)', 'Looked over their document or reference']
      : isClaim ? ['Confirmed they work there (work email or a call to the listed number)', 'Looked over their document, if they sent one', 'Let the listing’s current contact know about the claim']
      : ['Called and reached someone there', 'Hours are correct', 'Phone number is correct', 'Services and who they serve are correct'];
    const fld = (k, label) => ({ id: 'pop-' + k, label, v: P.f[k] || '', on: e => setF(k, e.target.value) });
    const saveOrg = () => {
      this.setState(st => ({ det: Object.assign({}, st.det, { [P.key]: Object.assign({}, P.f) }) }));
      if (isReq) this.setState(st => ({ requests: st.requests.map(x => x.id === P.id ? Object.assign({}, x, { org: P.f.org, phone: P.f.phone, place: P.f.place }) : x),
        listings: isClaim ? st.listings.map(x => x.name === r.org ? Object.assign({}, x, { name: P.f.org, phone: P.f.phone }) : x) : st.listings }));
      else this.setState(st => ({ listings: st.listings.map(x => x.id === P.id ? Object.assign({}, x, { name: P.f.org, phone: P.f.phone, place: P.f.place, status: P.f.status }) : x) }));
    };
    const name = isReq ? r.org : o.name, F = P.f;
    const verified = !isReq && !!o.verified;
    const AVL = { Accepting: 'Accepting new people', Limited: 'Limited capacity', Waitlist: 'Waitlist', Full: 'Currently full' };
    const ph = F.phone || '';
    const L = { type: F.type, faith: F.faith, place: F.sensitive ? 'Location kept private' : F.place, verified, pending: !verified,
      availLabel: AVL[F.avail] || F.avail, cap: F.cap || 'Call to confirm current availability.', phone: ph, tel: 'tel:' + String(ph).replace(/\D/g, ''),
      about: F.about, groups: Object.keys(F.svc || {}).map(k => ({ label: this.CATL[k] || k, items: String(F.svc[k] || '').split('\n').map(x => x.trim()).filter(Boolean) })).filter(g => g.items.length),
      elig: F.elig || 'No restrictions', cost: F.cost, langs: F.langs, docs: F.docs,
      hours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => ({ d, h: (F.hours || [])[i] || '—' })),
      addr: F.sensitive ? 'Shared by phone only' : (F.addr || 'No address given'), sensitive: !!F.sensitive,
      contactName: F.cName || 'Main line', contactRole: F.cRole || '', contactEmail: F.cEmail || '' };
    const ef = (k, label, type) => ({ id: 'pe-' + k, label, type: type || 'text', v: F[k] || '', on: e => setF(k, e.target.value) });
    const E = {
      head: [ef('org', 'Organization name'), ef('type', 'Type'), ef('faith', 'Faith (leave blank if not faith-based)'), ef('place', 'Neighborhood or town'),
        ef('website', 'Website', 'url'), ef('applyUrl', 'Online application link (optional)', 'url'), ef('area', 'Service area (who it serves, e.g. Coweta County, GA)'), ef('st', 'State (2 letters)'), ef('county', 'County (for the County filter)')],
      avail: { v: F.avail, on: e => setF('avail', e.target.value) }, cap: ef('cap', 'What to expect'), phone: ef('phone', 'Phone', 'tel'),
      about: ef('about', 'About'),
      svc: Object.keys(this.CATL).map(k => ({ id: 'pe-svc-' + k, label: this.CATL[k], on: !!(F.svc || {})[k] || (F.svc || {})[k] === '', v: (F.svc || {})[k] || '',
        toggle: () => { const n = Object.assign({}, F.svc); if (k in n) delete n[k]; else n[k] = ''; setF('svc', n); },
        set: e => setF('svc', Object.assign({}, F.svc, { [k]: e.target.value })) })),
      elig: ef('elig', 'Who it’s for (separate with commas)'), cost: ef('cost', 'Cost'), langs: ef('langs', 'Languages (separate with commas)'), docs: ef('docs', 'What to bring'),
      hours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => ({ id: 'pe-h' + i, label: d, v: (F.hours || [])[i] || '', on: e => { const h = (F.hours || []).slice(); h[i] = e.target.value; setF('hours', h); } })),
      addr: ef('addr', 'Street address, city, ZIP'), sensitive: { on: !!F.sensitive, toggle: () => setF('sensitive', !F.sensitive) },
      cName: ef('cName', 'Contact name'), cRole: ef('cRole', 'Their title'), cEmail: ef('cEmail', 'Email', 'email')
    };
    return {
      open: true, isReq, isClaim, close: P.back ? () => this.setState({ pop: null, repPop: P.back.repPop, repStage: P.back.repStage || s.repStage }) : close, stop: e => e.stopPropagation(), L, E, notEditing: !P.editing,
      hasBack: !!P.back, backLabel: P.back ? P.back.label : '', goBack: () => this.setState({ pop: null, repPop: P.back.repPop, repStage: P.back.repStage || s.repStage }),
      ...(() => { const list = P.list || [P.id], i = list.indexOf(P.id), n = list.length; const nb = on => ({ minHeight: 40, fontSize: 15, padding: '0 12px', opacity: on ? 1 : 0.45, cursor: on ? 'pointer' : 'default' });
        return { hasNav: n > 1, posText: (i + 1) + ' of ' + n, noPrev: i <= 0, noNext: i >= n - 1, prevStyle: nb(i > 0), nextStyle: nb(i < n - 1),
          prev: () => { if (i > 0) this.openPop(P.kind, list[i - 1], list); }, next: () => { if (i < n - 1) this.openPop(P.kind, list[i + 1], list); } }; })(),
      editing: !!P.editing, editAria: P.editing ? 'true' : 'false', editLabel: P.editing ? 'Done editing' : 'Edit listing', toggleEdit: () => setP({ editing: !P.editing }),
      title: P.f.org || name, groupLabel: isNew ? 'New listing' : isClaim ? 'Claim' : o.verified ? 'Verified listing' : 'To verify',
      swatch: { width: 8, alignSelf: 'stretch', minHeight: 44, flex: 'none', background: isNew ? C.listings : isClaim ? C.claims : C.verify },
      meta: isReq ? (r.days === 0 ? 'Sent today' : 'Sent ' + r.days + (r.days === 1 ? ' day ago' : ' days ago')) : 'Last checked ' + (o.checked ? o.checked + ' days ago' : 'today'),
      person: isReq ? r.person : '', email: isReq ? r.email : '', mailto: isReq ? 'mailto:' + r.email : '', method: isReq ? r.method : '', hasDoc: isReq && !!r.hasDoc,
      fieldsTitle: isNew ? 'Their listing (you can fix details before approving)' : isClaim ? 'The listing they’re claiming' : 'Listing details',
      fields: [fld('org', 'Organization name'), fld('phone', 'Phone'), fld('place', 'Neighborhood')], hasStatus: !isReq,
      status: { v: P.f.status || 'approved', on: e => setF('status', e.target.value) },
      docOpen: P.docOpen === true, docAria: P.docOpen === true ? 'true' : 'false', docToggleLabel: P.docOpen === true ? 'Hide preview ▴' : 'Show preview ▾', toggleDoc: () => setP({ docOpen: P.docOpen !== true }),
      noDoc: isReq && !r.hasDoc, docName: isReq ? r.docName || '' : '', docMeta: isReq && r.hasDoc ? r.docKind + ' · ' + r.docSize + ' · uploaded ' + r.docDate : '',
      docHeader: 'INTERNAL REVENUE SERVICE', docDate: isReq ? r.docDate || '' : '', docTitle: isReq ? (r.docKind || 'Document') : '',
      proofTitle: isReq && /^Reference/.test(r.method || '') ? 'No document, they gave a reference' : 'No document attached',
      proofText: isReq ? (/^Reference/.test(r.method || '') ? r.method.replace(/^Reference:\s*/, '') + '. Reach out to that person to confirm.' : 'Ask them to upload proof, or confirm another way.') : '',
      deleteDoc: () => { this.setState(st => ({ requests: st.requests.map(x => x.id === P.id ? Object.assign({}, x, { hasDoc: false, method: 'Document (deleted after review)' }) : x) })); this.say('Document deleted.'); },
      allChecked: ck.every((_, i) => !!P.checks[i]), readyVerb: isNew ? 'approve this listing' : isClaim ? 'approve this claim' : 'mark it Verified',
      checks: ck.map((label, i) => ({ label, on: !!P.checks[i], toggle: () => setP({ checks: Object.assign({}, P.checks, { [i]: !P.checks[i] }) }) })),
      note: { v: P.note, on: e => setP({ note: e.target.value }) }, noteLabel: isReq ? 'Note to the person (they see it if you reject)' : 'Private note (only admins see it)',
      save: () => { saveOrg(); this.say('Changes saved.'); this.log('Edited ' + (P.f.org || name) + '.'); },
      primaryLabel: isNew ? 'Approve listing' : isClaim ? 'Approve claim' : o.verified ? 'Confirm still correct' : 'Mark Verified',
      primary: () => {
        saveOrg();
        if (isReq) { this.drop('requests', P.id, 'Approved.'); this.popAdvance(P); return; }
        this.setState(st => ({ listings: st.listings.map(x => x.id === P.id ? Object.assign({}, x, { verified: true, checked: 0 }) : x) })); this.popAdvance(P);
        this.say('Marked Verified.'); this.log('Marked ' + (P.f.org || name) + ' Verified.');
      },
      secondaryLabel: isReq ? 'Reject' : 'Pause listing',
      secondary: () => {
        if (isReq) { this.drop('requests', P.id, 'Rejected.'); this.popAdvance(P); return; }
        this.setState(st => ({ listings: st.listings.map(x => x.id === P.id ? Object.assign({}, x, { status: 'paused' }) : x) })); this.popAdvance(P);
        this.say('Listing paused.'); this.log('Paused ' + name + '.');
      }
    };
  }
  openMail(id) { this.setState(st => ({ mailPop: id, mailReply: '', mailErr: '', mails: st.mails.map(m => m.id === id ? Object.assign({}, m, { read: true }) : m) })); }
  repMove(id, stage, outcome) {
    const R = this.state.reports.find(x => x.id === id); if (!R) return;
    this.setState(st => ({ reports: st.reports.map(x => x.id === id ? Object.assign({}, x, { stage, outcome: outcome || x.outcome }) : x),
      teamLog: stage === 'resolved' ? [{ who: 'u1', act: 'report', what: R.org, days: 0 }].concat(st.teamLog) : st.teamLog }));
    this.say(stage === 'call' ? 'Moved to Need to call.' : stage === 'resolved' ? (outcome === 'dismissed' ? 'Report dismissed.' : 'Report resolved.') : 'Moved back to New reports.');
    if (stage === 'resolved') this.log((outcome === 'dismissed' ? 'Dismissed' : 'Resolved') + ' a report on ' + R.org + '.');
  }
  repActs(R) {
    const st = R.stage || 'new';
    if (st === 'new') return { primaryLabel: 'It’s right, needs a call', primary: () => this.repMove(R.id, 'call'), hasSecondary: true, secondaryLabel: 'Dismiss', secondary: () => this.repMove(R.id, 'resolved', 'dismissed'), stepHint: 'Step 1: read it. If it looks right, move it to Need to call.' };
    if (st === 'call') return { primaryLabel: 'Called and fixed', primary: () => this.repMove(R.id, 'resolved', 'fixed'), hasSecondary: true, secondaryLabel: 'Back to new', secondary: () => this.repMove(R.id, 'new'), stepHint: 'Step 2: call the organization, fix the listing, then mark it fixed.' };
    return { primaryLabel: 'Reopen', primary: () => this.repMove(R.id, 'new'), hasSecondary: false, secondaryLabel: '', secondary: () => {}, stepHint: 'Step 3: done.' };
  }
  log(text) {
    const m = text.match(/^Marked (.+) Verified\.$/);
    this.setState(s => ({ activity: [{ when: 'Just now', text }].concat(s.activity).slice(0, 8), teamLog: m ? [{ who: 'u1', act: 'verified', what: m[1], days: 0 }].concat(s.teamLog) : s.teamLog }));
  }
  teamAct(act, what) { this.setState(s => ({ teamLog: [{ who: 'u1', act, what, days: 0 }].concat(s.teamLog) })); }
  drop(key, id, msg) { const it = this.state[key].find(x => x.id === id); this.setState(s => ({ [key]: s[key].filter(x => x.id !== id) })); this.say(msg); if (it) { this.log(msg.replace(/\.$/, '') + ': ' + it.org + '.'); const act = key === 'reports' ? 'report' : key === 'changes' ? (msg.startsWith('Change approved') ? 'change' : 'rejected') : msg === 'Approved.' ? (it.kind === 'claim' ? 'claim' : 'listing') : 'rejected'; this.teamAct(act, it.org); } }
  HOW = { org: 'updated by the organization', fix: 'correction approved', team: 'team check-in', auto: 'auto-check' };
  agoTxt(d) { return !d ? 'today' : d === 1 ? 'yesterday' : d < 60 ? d + ' days ago' : Math.round(d / 30) + ' months ago'; }
  chkDue() { const lim = ((this.state.st.rules || {}).reverify || 6) * 30; return this.state.listings.filter(o => o.status === 'approved' && o.checked >= lim).sort((a, b) => b.checked - a.checked); }
  chkConfirm(name, how, msg, extra) {
    this.setState(st => ({ listings: st.listings.map(x => x.name === name ? Object.assign({}, x, { checked: 0, how }, extra || {}) : x) }));
    this.teamAct('checked', name); this.say(msg);
  }
  chkResolve(c, mode) {
    const drop = st => st.checks.filter(x => x.id !== c.id);
    if (mode === 'keep') { this.setState(st => ({ checks: drop(st) })); this.chkConfirm(c.org, 'team', 'Kept what we have. Last confirmed is now today.'); }
    else if (mode === 'use') { this.setState(st => ({ checks: drop(st) })); this.chkConfirm(c.org, 'team', 'Listing updated to the new ' + c.field.toLowerCase() + '. Last confirmed is now today.', c.field === 'Phone' ? { phone: c.found } : null); }
    else if (mode === 'call') { this.setState(st => ({ checks: drop(st), repStage: 'call', reports: st.reports.concat({ id: 'p' + c.id, stage: 'call', org: c.org, reason: 'Auto-check found a difference', details: c.field + ': our listing says “' + c.ours + '”, ' + c.source + ' says “' + c.found + '”.', sent: 'Today', days: 0, by: '', byEmail: '', field: c.field, shown: c.ours, earlier: 0 }) })); this.say('Moved to Reports › Need to call.'); }
    else if (mode === 'undo') { this.setState(st => ({ checks: st.checks.map(x => x.id === c.id ? Object.assign({}, x, { stage: 'flag' }) : x), chkStage: 'flag' })); this.say('Moved to Needs a look.'); }
  }
  chkOpen(name) { const o = this.state.listings.find(x => x.name === name); if (o) this.openPop('org', o.id, [o.id]); }
  chkQueue(swatch) {
    const s = this.state;
    return s.checks.filter(c => c.stage === 'flag').map(c => ({ name: c.org, groupLabel: 'Big difference', desc: c.field + ': “' + c.ours + '” vs “' + c.found + '”', meta: 'Found on ' + c.source + ' · ' + this.agoTxt(c.days), swatch, next: 'Next: decide which is right', open: () => this.setState({ tab: 'checks', chkStage: 'flag' }), act: () => this.setState({ tab: 'checks', chkStage: 'flag' }), actLabel: 'Review' }))
      .concat(this.chkDue().map(o => ({ name: o.name, groupLabel: 'Check-in due', desc: o.place + ' · ' + o.phone, meta: 'Last confirmed ' + this.agoTxt(o.checked), swatch, next: 'Next: call and confirm it’s still right', open: () => this.chkOpen(o.name), act: () => this.setState({ tab: 'checks', chkStage: 'due' }), actLabel: 'Review' })));
  }
  chkVals() {
    const s = this.state, stage = s.chkStage || 'flag', due = this.chkDue(), F = s.checks.filter(c => c.stage === 'flag'), A = s.checks.filter(c => c.stage === 'auto');
    const prim = { minHeight: 44, fontSize: 16, background: 'var(--color-accent-700)', borderColor: 'var(--color-accent-700)', color: 'var(--color-bg)' }, sec = { minHeight: 44, fontSize: 16 };
    const tagS = hi => ({ padding: '3px 10px', fontSize: 14, fontWeight: 600, border: '1px solid ' + (hi ? 'oklch(0.58 0.19 27)' : 'var(--color-neutral-600)'), color: hi ? 'oklch(0.45 0.17 27)' : 'var(--color-neutral-800)', background: hi ? 'oklch(0.96 0.03 27)' : 'transparent' });
    const lim = ((s.st.rules || {}).reverify || 6);
    const ways = [
      ['1', 'Organization updates', 'A claimed organization edits its listing or taps “Everything’s still right” on its dashboard.', s.listings.filter(o => o.how === 'org').length + ' listings confirmed this way', null],
      ['2', 'Suggested corrections', 'Anyone can suggest a correction from a listing. Your team checks it before anything changes.', s.reports.filter(r => r.stage !== 'resolved').length + ' waiting in Reports', () => this.setState({ tab: 'reports', repStage: 'new' }), 'Open Reports'],
      ['3', 'Team check-ins', 'Listings not confirmed in ' + lim + ' months come up here for a call.', due.length + ' due now', () => this.setState({ chkStage: 'due' }), 'See who’s due'],
      ['4', 'Auto-checks', 'Each week we compare listings with websites, Google and IRS records.', A.length + ' confirmed on their own · ' + F.length + ' need a look', () => this.setState({ chkStage: 'flag' }), 'See flags']
    ].map(([step, label, hint, stat, go, goLabel]) => ({ step: 'Way ' + step, label, hint, stat, hasGo: !!go, go, goLabel }));
    const cards = [['flag', 'Needs a look', 'Auto-check found a big difference.', F.length], ['due', 'Due for a check-in', 'Not confirmed in ' + lim + ' months or more.', due.length], ['auto', 'Confirmed automatically', 'Small differences. Date already updated.', A.length]].map(([k, label, hint, n]) => {
      const on = stage === k;
      return { label, hint, n, isFlag: k === 'flag', isDue: k === 'due', isAuto: k === 'auto', pressed: on ? 'true' : 'false', pick: () => this.setState({ chkStage: k }),
        style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', background: on ? 'var(--color-accent-100)' : 'var(--color-bg)', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), boxShadow: on ? 'inset 0 -3px 0 var(--color-accent-700)' : 'var(--shadow-sm)' },
        iconStyle: { display: 'grid', placeItems: 'center', width: 36, height: 36, flex: 'none', background: on ? 'var(--color-accent-700)' : 'var(--color-accent-100)', color: on ? 'var(--color-bg)' : 'var(--color-accent-800)' } }; });
    let items = [];
    if (stage === 'flag') items = F.map(c => ({ org: c.org, tag: 'Big difference', tagStyle: tagS(true), hasDiff: true, field: c.field, ours: c.ours, found: c.found, source: c.source, open: () => this.chkOpen(c.org),
      meta: c.why + ' Found ' + this.agoTxt(c.days) + '. The Last confirmed date won’t change until you decide.',
      acts: [{ label: 'Keep what we have', style: sec, go: () => this.chkResolve(c, 'keep') }, { label: 'Call them first', style: sec, go: () => this.chkResolve(c, 'call') }, { label: 'Use the new ' + c.field.toLowerCase(), style: prim, go: () => this.chkResolve(c, 'use') }] }));
    else if (stage === 'due') items = due.map(o => { const m = s.team.find(x => x.id === o.assignee); return { org: o.name, tag: 'Last confirmed ' + this.agoTxt(o.checked), tagStyle: tagS(false), hasDiff: false, open: () => this.chkOpen(o.name),
      meta: o.place + ' · ' + o.phone + ' · Last time: ' + (this.HOW[o.how] || 'never confirmed') + (m ? ' · Assigned to ' + (m.you ? 'you' : m.name) : ''),
      acts: [{ label: 'Open listing', style: sec, go: () => this.chkOpen(o.name) }].concat(m && m.you ? [] : [{ label: 'Assign to me', style: sec, go: () => { this.setState(st => ({ listings: st.listings.map(x => x.id === o.id ? Object.assign({}, x, { assignee: 'u1' }) : x) })); this.say('Assigned to you.'); } }])
        .concat([{ label: 'Called — it’s all still right', style: prim, go: () => this.chkConfirm(o.name, 'team', 'Confirmed. Last confirmed is now today.') }]) }; });
    else items = A.map(c => ({ org: c.org, tag: 'Small difference', tagStyle: tagS(false), hasDiff: true, field: c.field, ours: c.ours, found: c.found, source: c.source, open: () => this.chkOpen(c.org),
      meta: c.why + ' Confirmed automatically ' + this.agoTxt(c.days) + '.',
      acts: [{ label: 'Open listing', style: sec, go: () => this.chkOpen(c.org) }, { label: 'This isn’t small, move it to Needs a look', style: sec, go: () => this.chkResolve(c, 'undo') }] }));
    return { ways, cards, items, empty: !items.length, showLegend: stage !== 'due',
      emptyText: stage === 'flag' ? 'No big differences right now. Nice.' : stage === 'due' ? 'Every live listing was confirmed in the last ' + lim + ' months.' : 'Nothing was confirmed automatically this week.' };
  }
  renderVals() {
    const s = this.state;
    const mini = !!s.mini;
    const tabStyle = on => ({ display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : 'flex-start', gap: 12, width: '100%', minHeight: 48, padding: mini ? 0 : '0 16px', border: 0, borderLeft: '3px solid ' + (on ? 'var(--color-accent-700)' : 'transparent'), background: on ? 'var(--color-accent-100)' : 'transparent', color: on ? 'var(--color-accent-900)' : 'var(--color-text)', fontWeight: on ? 600 : 400, fontSize: 16, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' });
    const tag = (solid, blue) => ({ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', fontSize: 14, fontWeight: 600, border: '1px solid ' + (solid || blue ? 'var(--color-accent-700)' : 'var(--color-neutral-600)'), background: solid ? 'var(--color-accent-700)' : 'transparent', color: solid ? 'var(--color-bg)' : blue ? 'var(--color-accent-700)' : 'var(--color-neutral-800)' });
    const q = (s.q || '').trim().toLowerCase();
    const counts = {}; s.listings.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return {
      ...(() => { const all = [['overview', 'Overview', 0], ['requests', 'New listings & claims', s.requests.length], ['unverified', 'Unverified', s.listings.filter(o => o.status === 'approved' && !o.verified).length], ['inbox', 'Inbox', s.mails.filter(m => m.status === 'open' && !m.read).length], ['reports', 'Reports', s.reports.filter(r => r.stage !== 'resolved').length], ['changes', 'Contact changes', s.changes.length], ['checks', 'Listing checks', this.chkDue().length + s.checks.filter(c => c.stage === 'flag').length], ['team', 'My team', 0], ['listings', 'All listings', s.listings.length], ['settings', 'Settings', 0]];
        const mk = ([k, label, count]) =>
        { const unv = s.tab === 'listings' && s.listF === 'unverified'; const on = k === 'unverified' ? unv : k === 'listings' ? s.tab === 'listings' && !unv : s.tab === k; return { label, count, cur: on ? 'page' : 'false', aria: label + (count ? ', ' + count : ''), style: tabStyle(on),
          pick: () => this.setState(k === 'unverified' ? { tab: 'listings', listF: 'unverified', q: '' } : k === 'listings' ? { tab: 'listings', listF: 'all' } : k === 'requests' ? { tab: 'requests', reqKind: 'all' } : { tab: k }),
          isOverview: k === 'overview', isRequests: k === 'requests', isChanges: k === 'changes', isReports: k === 'reports', isChecks: k === 'checks', isInbox: k === 'inbox', isListings: k === 'listings', isUnverified: k === 'unverified', isTeam: k === 'team', isSettings: k === 'settings', isAccount: k === 'account',
          showLabel: !mini, hasCount: !mini && count > 0 && k !== 'listings', dot: mini && count > 0 && k !== 'listings' }; };
        const hide = window.CC_ADMIN_HIDE || []; return { tabs: all.filter(t => t[0] !== 'settings' && hide.indexOf(t[0]) < 0).map(mk), bottomTabs: all.filter(t => t[0] === 'settings').map(mk) }; })(),
      reqCards: [['all', 'All requests', 'Listings and claims together'], ['new_listing', 'New listings', 'Organizations asking to join'], ['claim', 'Claims', 'People claiming an organization']].map(([k, label, hint]) => {
        const on = (s.reqKind || 'all') === k, n = k === 'all' ? s.requests.length : s.requests.filter(r => r.kind === k).length;
        return { label, hint, n, isAll: k === 'all', isNew: k === 'new_listing', isClaim: k === 'claim', pressed: on ? 'true' : 'false', pick: () => this.setState({ reqKind: k }),
          style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', background: on ? 'var(--color-accent-100)' : 'var(--color-bg)', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), boxShadow: on ? 'inset 0 -3px 0 var(--color-accent-700)' : 'var(--shadow-sm)' },
          iconStyle: { display: 'grid', placeItems: 'center', width: 36, height: 36, flex: 'none', background: on ? 'var(--color-accent-700)' : 'var(--color-accent-100)', color: on ? 'var(--color-bg)' : 'var(--color-accent-800)' } }; }),
      reqDetailed: (s.reqView || 'compact') === 'detailed', reqCompact: (s.reqView || 'compact') === 'compact',
      reqCountText: (() => { const n = s.requests.filter(r => (s.reqKind || 'all') === 'all' || r.kind === s.reqKind).length; return n + ' waiting'; })(),
      reqViews: [['detailed', 'Detailed'], ['compact', 'Compact']].map(([k, label]) => { const on = (s.reqView || 'compact') === k; return { label, on: on ? 'true' : 'false', pick: () => this.setState({ reqView: k }), style: { minHeight: 40, padding: '0 14px', fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: on ? 'var(--color-accent-700)' : 'var(--color-bg)', color: on ? 'var(--color-bg)' : 'var(--color-text)', fontWeight: on ? 600 : 400 } }; }),
      ...(() => { const R = s.teamRange || 'week', max = R === 'week' ? 7 : R === 'month' ? 30 : 1e9;
        const log = s.teamLog.filter(e => e.days < max);
        const L = { reply: ['emails answered', 'Replied to'], verified: ['verified', 'Verified'], listing: ['listings approved', 'Approved new listing'], claim: ['claims approved', 'Approved claim'], report: ['reports resolved', 'Resolved a report on'], change: ['changes approved', 'Approved contact change for'], rejected: ['rejected', 'Rejected'], checked: ['checklists done', 'Checked'] };
        const RL = { owner: 'Owner', admin: 'Admin', reviewer: 'Reviewer', viewer: 'Viewer' };
        const ago = d => d === 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
        const count = (arr, a) => arr.filter(e => e.act === a).length;
        const KEEP = ['listing', 'verified', 'report'], LAB = { listing: 'Listing approved', verified: 'Verified', report: 'Report resolved', reply: 'Replied to' }, COL = { listing: 'var(--color-accent-900)', verified: 'var(--color-accent-700)', report: 'var(--color-accent-400)', reply: 'var(--color-accent-600)', all: 'var(--color-accent-700)' };
        const kept = log.filter(e => KEEP.includes(e.act)), who = id => s.team.find(m => m.id === id) || {};
        const sumOf = arr => [[count(arr, 'listing'), 'listing approved', 'listings approved'], [count(arr, 'verified'), 'verified', 'verified'], [count(arr, 'report'), 'report resolved', 'reports resolved']].map(([n, one, many]) => n + ' ' + (n === 1 ? one : many)).join(' · ');
        const members = s.team.filter(m => !m.invited || kept.some(e => e.who === m.id));
        const sel = members.some(m => m.id === s.teamSel) ? s.teamSel : 'all';
        const defs = [['all', 'All updates', kept.length, 'Everyone on your team']].concat(members.map(m => [m.id, m.you ? 'You' : m.name, kept.filter(e => e.who === m.id).length, RL[m.role] || m.role]));
        const shown = sel === 'all' ? kept : kept.filter(e => e.who === sel);
        const tov = {
          barStyle: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', border: '1px solid var(--color-neutral-400)', borderBottom: 0 },
          tabs: defs.map(([id, label, value, hint], i) => { const on = id === sel; return { label, value, hint, sel: on ? 'true' : 'false', swatch: { width: 8, height: 28, flex: 'none', background: id === 'all' ? COL.all : 'var(--color-accent-300)' }, go: () => this.setState({ teamSel: id }),
            style: { display: 'flex', alignItems: 'center', gap: 6, padding: '12px 18px', minWidth: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'inherit', border: 0, borderLeft: i ? '1px solid var(--color-neutral-400)' : 0, borderTop: '4px solid ' + (on ? 'var(--color-accent-700)' : 'transparent'), borderBottom: '1px solid ' + (on ? 'transparent' : 'var(--color-neutral-400)'), background: on ? 'var(--color-bg)' : 'var(--color-neutral-100)', marginBottom: -1, position: 'relative', zIndex: on ? 1 : 0 } }; }),
          title: sel === 'all' ? 'All team updates' : (who(sel).you ? 'Your updates' : who(sel).name + '’s updates'), summary: sumOf(shown),
          items: shown.map(e => ({ what: e.what, label: LAB[e.act], when: ago(e.days), by: sel === 'all' ? 'by ' + (who(e.who).you ? 'you' : who(e.who).name) : '', swatch: { width: 8, height: 28, flex: 'none', background: COL[e.act] } })),
          empty: shown.length === 0,
          groups: [['listing', 'Approved'], ['verified', 'Verified'], ['report', 'Reports resolved']].map(([a, label]) => { const its = shown.filter(e => e.act === a), open = !!(s.teamOpen || {})[a] && its.length > 0;
            return { label, n: its.length, has: its.length > 0, open, isListing: a === 'listing', isVerified: a === 'verified', isReport: a === 'report', isReply: a === 'reply',
              iconStyle: { display: 'grid', placeItems: 'center', width: 40, height: 40, flex: 'none', background: open ? 'var(--color-accent-700)' : 'var(--color-accent-100)', color: open ? 'var(--color-bg)' : 'var(--color-accent-800)', border: '1px solid ' + (open ? 'var(--color-accent-700)' : 'var(--color-accent-300)') }, aria: open ? 'true' : 'false', btn: open ? 'Hide' : 'See which ones', swatch: { width: 8, height: 28, flex: 'none', background: COL[a] },
              toggle: () => this.setState(st => ({ teamOpen: Object.assign({}, st.teamOpen, { [a]: !(st.teamOpen || {})[a] }) })),
              items: its.map(e => ({ what: e.what, when: ago(e.days), by: sel === 'all' ? 'by ' + (who(e.who).you ? 'you' : who(e.who).name) : '' })) }; })
        };
        return {
          tov,
          teamRanges: [['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([k, label]) => { const on = R === k; return { label, on: on ? 'true' : 'false', pick: () => this.setState({ teamRange: k }), style: { minHeight: 40, padding: '0 14px', fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: on ? 'var(--color-accent-700)' : 'var(--color-bg)', color: on ? 'var(--color-bg)' : 'var(--color-text)', fontWeight: on ? 600 : 400 } }; }),
          teamTotals: [['verified', 'Listings verified'], ['listing', 'New listings approved'], ['claim', 'Claims approved'], ['report', 'Reports resolved'], ['change', 'Contact changes approved']].map(([a, label]) => ({ label, n: count(log, a) })),
          teamCards: s.team.filter(m => !m.invited || log.some(e => e.who === m.id)).map(m => { const mine = log.filter(e => e.who === m.id);
            const ONE = { 'listings approved': 'listing approved', 'claims approved': 'claim approved', 'reports resolved': 'report resolved', 'changes approved': 'change approved', 'checklists done': 'checklist done' };
            const stats = Object.keys(L).map(a => [count(mine, a), L[a][0]]).filter(x => x[0]).map(x => x[0] + ' ' + (x[0] === 1 ? (ONE[x[1]] || x[1]) : x[1]));
            return { name: m.you ? 'You' : m.name, initials: m.you ? 'You' : m.name.split(' ').map(w => w[0]).join('').slice(0, 2), roleLabel: RL[m.role] || m.role, total: mine.length + (mine.length === 1 ? ' action' : ' actions'),
              stats, hasStats: mine.length > 0, none: mine.length === 0, recent: mine.slice(0, 4).map(e => L[e.act][1] + ' ' + e.what + ' · ' + ago(e.days)) }; })
        }; })(),
      roles: { aria: s.rolesOpen ? 'true' : 'false', hidden: s.rolesOpen ? 'false' : 'true', wrap: { display: 'grid', gridTemplateRows: s.rolesOpen ? '1fr' : '0fr', opacity: s.rolesOpen ? 1 : 0, marginBottom: s.rolesOpen ? 0 : -22, transition: 'grid-template-rows .35s ease, opacity .3s ease, margin-bottom .35s ease' }, toggle: () => this.setState({ rolesOpen: !s.rolesOpen }) },
      teamEdit: { on: !!s.teamEditing, aria: s.teamEditing ? 'true' : 'false', label: s.teamEditing ? 'Done' : 'Edit team', toggle: () => this.setState({ teamEditing: !s.teamEditing }) },
      isSettings: s.tab === 'settings', isAccount: false, goAccount: () => this.setState({ tab: 'settings' }),
      acct: (() => { const M = s.me, put = o => this.setState(st => ({ me: Object.assign({}, st.me, o) })), fld = k => ({ v: M[k], on: e => put({ [k]: e.target.value }) });
        return { name: fld('name'), title: fld('title'), email: fld('email'), phone: fld('phone'),
          photo: M.photo, hasPhoto: !!M.photo, noPhoto: !M.photo, initials: M.name ? M.name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'You',
          pick: e => { const inp = e.target, f = inp.files && inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const im = new Image(); im.onload = () => this.setState({ crop: { src: rd.result, w: im.naturalWidth, h: im.naturalHeight, z: 1, x: 0, y: 0 } }); im.src = rd.result; }; rd.readAsDataURL(f); try { inp.value = ''; } catch (err) {} },
          adjust: () => { if (M.photoSrc) { const im = new Image(); im.onload = () => this.setState({ crop: Object.assign({ src: M.photoSrc, w: im.naturalWidth, h: im.naturalHeight, z: 1, x: 0, y: 0 }, M.photoCrop || {}) }); im.src = M.photoSrc; } },
          removePhoto: () => { put({ photo: '', photoSrc: '', photoCrop: null }); this.say('Photo removed.'); },
          save: () => this.say('Your details were saved.'), logout: () => this.say('You’d be logged out here.') }; })(),
      set: (() => { const S = s.st, put = o => this.setState(st => ({ st: Object.assign({}, st.st, o) }));
        const sw = (group, key, label, hint) => { const on = !!S[group][key]; return { label, hint, aria: on ? 'true' : 'false', toggle: () => put({ [group]: Object.assign({}, S[group], { [key]: !on }) }),
          track: { position: 'relative', width: 44, height: 24, flex: 'none', borderRadius: 12, border: 0, padding: 0, cursor: 'pointer', background: on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)', transition: 'background .2s' },
          knob: { position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: 'var(--color-bg)', transition: 'left .2s' } }; };
        const fld = k => ({ v: S[k], on: e => put({ [k]: e.target.value }) });
        return { name: fld('name'), email: fld('email'), contact: fld('contact'),
          save: () => this.say('Settings saved.'), changePw: () => this.say('We emailed you a link to change your password.'),
          signOutAll: () => this.say('Signed out of all other devices.'), export: () => this.say('Your spreadsheet is downloading.'),
          alerts: [['listing', 'New listing submitted', 'When an organization uses Add your organization'], ['claim', 'New claim', 'When someone asks to manage a listing'], ['email', 'New email', 'When someone writes to info@ or another Compassion Catalyst address'], ['report', 'New report', 'When someone flags a listing'], ['digest', 'Daily summary', 'One email each morning instead of one per item']].map(([k, l, h]) => sw('alerts', k, l, h)),
          site: [['accept', 'Accept new listings', 'Turn off to pause the Add your organization form'], ['pendingTag', 'Show “Pending verification” on unverified listings', 'So visitors know to call ahead'], ['reports', 'Let visitors report incorrect info', 'Shows the Report link on every listing']].map(([k, l, h]) => sw('site', k, l, h)),
          autos: [['autoListing', 'Auto-answer questions about a listing', 'Emails asking about a place’s hours, services or availability get the “call them directly” reply and go to Auto-answered'], ['autoUpdate', 'Auto-answer listing update requests', 'Organizations asking you to change their listing get the “update it yourself” reply']].map(([k, l, h]) => sw('inbox', k, l, h)),
          tpls: [['listingQ', '“Call them directly” reply'], ['update', '“Update it yourself” reply'], ['status', '“Still in review” reply']].map(([k, label]) => ({ id: 'tpl-' + k, label, v: S.tpl[k], on: e => put({ tpl: Object.assign({}, S.tpl, { [k]: e.target.value }) }) })),
          inbox: [['admin', 'Admins can see the inbox', 'Read, reply, assign and file emails'], ['reviewer', 'Reviewers can see the inbox', 'Useful if they help answer questions'], ['viewer', 'Viewers can see the inbox', 'Look only, no replying']].map(([k, l, h]) => sw('inbox', k, l, h)),
          mailRules: [['keepMail', 'Delete emails after', 'Keeps people’s messages private and the inbox tidy', 'months']].map(([k, label, hint, unit]) => ({ id: 'rule-' + k, label, hint, unit, v: S.rules[k], on: e => put({ rules: Object.assign({}, S.rules, { [k]: +e.target.value || 1 }) }) })),
          rules: [['pause', 'Pause a listing after no reply for', 'If they don’t answer when you try to confirm', 'days'], ['remove', 'Remove a paused listing after', 'If it still isn’t fixed', 'days'], ['reports', 'Pause after this many confirmed reports', 'Repeated wrong information', 'reports'], ['reverify', 'Check in on a listing every', 'When a listing hasn’t been confirmed in this long, it shows under Listing checks › Due for a check-in', 'months']].map(([k, label, hint, unit]) => ({ id: 'rule-' + k, label, hint, unit, v: S.rules[k], on: e => put({ rules: Object.assign({}, S.rules, { [k]: +e.target.value || 1 }) }) })) }; })(),
      autoSet: [['small', 'Confirm small differences automatically', 'Spelling, “Inc.”, “Street” vs “St”. The Last confirmed date updates on its own.'], ['web', 'Compare with each organization’s website', 'Hours, phone and address'], ['google', 'Compare with Google business listings', 'Hours, phone, address and whether they’re marked closed'], ['irs', 'Compare names with IRS nonprofit records', 'Legal name and whether they’re still a registered nonprofit']].map(([k, label, hint]) => { const S = s.st, on = !!(S.auto || {})[k]; return { label, hint, aria: on ? 'true' : 'false', toggle: () => this.setState(st => ({ st: Object.assign({}, st.st, { auto: Object.assign({}, st.st.auto, { [k]: !on }) }) })),
        track: { position: 'relative', width: 44, height: 24, flex: 'none', borderRadius: 12, border: 0, padding: 0, cursor: 'pointer', background: on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)', transition: 'background .2s' }, knob: { position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: 'var(--color-bg)', transition: 'left .2s' } }; }),
      msg: (() => { const to = s.msgTo, mem = s.team.find(x => x.id === to), others = s.team.filter(x => !x.you);
        return { open: !!to, title: to === 'all' ? 'Message your team' : 'Message ' + (mem ? mem.name : ''), sub: to === 'all' ? 'Goes to all ' + others.length + ' teammates' : (mem ? mem.email : ''),
          toAll: () => this.setState({ msgTo: 'all', msgText: '', msgErr: '' }), close: () => this.setState({ msgTo: null }), stop: e => e.stopPropagation(), err: s.msgErr,
          text: { v: s.msgText, on: e => this.setState({ msgText: e.target.value, msgErr: '' }) },
          send: () => { if (!(s.msgText || '').trim()) return this.setState({ msgErr: 'Write a message first.' }); this.setState({ msgTo: null }); this.say(to === 'all' ? 'Message sent to your team.' : 'Message sent to ' + (mem ? mem.name : '') + '.'); } }; })(),
      rep: (() => { const list = s.reports.filter(r => (r.stage || 'new') === (s.repStage || 'new')).sort((a, b) => b.days - a.days), i = list.findIndex(x => x.id === s.repPop), R = list[i];
        if (!R) return { open: false };
        const go = j => this.setState({ repPop: list[j].id, repUpd: '', repNote: '', repCompose: false, repMsg: '', repMsgErr: '' }), after = () => { const rest = list.filter(x => x.id !== R.id); this.setState({ repPop: rest.length ? rest[Math.min(i, rest.length - 1)].id : null, repNote: '' }); };
        const L = s.listings.find(o => o.name === R.org);
        return { open: true, org: R.org, reason: R.reason, details: R.details, field: R.field || '—', shown: R.shown || '—',
          meta: (R.days === 0 ? 'Sent today' : R.days === 1 ? 'Sent 1 day ago' : 'Sent ' + R.days + ' days ago') + ' · ' + R.sent,
          by: R.by || 'Anonymous visitor', byEmail: R.byEmail, hasEmail: !!R.byEmail, mailto: 'mailto:' + R.byEmail,
          hasEarlier: R.earlier > 0, earlierText: R.earlier === 1 ? 'This listing had 1 other report confirmed this year. Your rule pauses a listing after 3.' : 'This listing had ' + R.earlier + ' other reports confirmed this year.',
          note: { v: s.repNote, on: e => this.setState({ repNote: e.target.value }) },
          hasNav: list.length > 1, pos: (i + 1) + ' of ' + list.length, noPrev: i <= 0, noNext: i >= list.length - 1, prev: () => { if (i > 0) go(i - 1); }, next: () => { if (i < list.length - 1) go(i + 1); },
          close: () => this.setState({ repPop: null, repCompose: false }), stop: e => e.stopPropagation(),
          composing: !!s.repCompose && !!R.byEmail, composeAria: s.repCompose ? 'true' : 'false', emailLabel: 'Email ' + (R.by || 'them').split(' ')[0],
          toggleCompose: () => this.setState({ repCompose: !s.repCompose, repMsg: s.repCompose ? '' : 'Hi ' + (R.by || '').split(' ')[0] + ',\n\nThank you for letting us know about ' + R.org + '. ', repMsgErr: '' }),
          msg: { v: s.repMsg, on: e => this.setState({ repMsg: e.target.value, repMsgErr: '' }) }, msgErr: s.repMsgErr,
          quick: [['Thanks, fixed', 'Hi ' + (R.by || '').split(' ')[0] + ',\n\nThank you for letting us know. We checked ' + R.org + ' and updated the listing.'], ['Thanks, looking into it', 'Hi ' + (R.by || '').split(' ')[0] + ',\n\nThank you for the heads-up about ' + R.org + '. We’re checking with them now and will update the listing if anything has changed.'], ['Need more details', 'Hi ' + (R.by || '').split(' ')[0] + ',\n\nThank you for your report about ' + R.org + '. Could you tell us a little more about what you noticed?']].map(([label, text]) => ({ label, use: () => this.setState({ repMsg: text, repMsgErr: '' }) })),
          sendMsg: () => { if (!(s.repMsg || '').trim()) return this.setState({ repMsgErr: 'Write your email first.' }); this.setState({ repCompose: false, repMsg: '' }); this.say('Email sent to ' + R.by + '.'); },
          stageLabel: { new: 'New', call: 'Need to call', resolved: R.outcome === 'dismissed' ? 'Resolved · Dismissed' : 'Resolved · Fixed' }[R.stage || 'new'],
          ...(() => { const A = this.repActs(R); return { primaryLabel: A.primaryLabel, primary: () => { A.primary(); after(); }, hasSecondary: A.hasSecondary, secondaryLabel: A.secondaryLabel, secondary: () => { A.secondary(); after(); } }; })(),
          pause: () => { if (!L) return; const was = L.status === 'paused'; this.setState(st => ({ listings: st.listings.map(x => x.id === L.id ? Object.assign({}, x, { status: was ? 'approved' : 'paused' }) : x) })); this.say(was ? 'Listing is live again.' : 'Listing paused. It’s hidden from Find help.'); if (!was) this.log('Paused ' + R.org + '.'); },
          ...(() => { const D = this.DET[R.orgId] || this.DET[R.org] || {}, c = D.contact || [], ph = (L && L.phone) || D.phone || '';
            const ups = (R.updates || []).map(u => { const m = s.team.find(x => x.id === u.who) || {}; return { who: m.you ? 'You' : (m.name || 'Team member'), when: u.when, text: u.text, initials: m.you ? 'You' : (m.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2),
              avatar: { width: 30, height: 30, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: m.you ? 'var(--color-accent-700)' : 'oklch(0.92 0.05 ' + (m.hue != null ? m.hue : 250) + ')', color: m.you ? 'var(--color-bg)' : 'oklch(0.35 0.08 ' + (m.hue != null ? m.hue : 250) + ')' } }; });
            const post = t => { this.setState(st => ({ repUpd: '', reports: st.reports.map(x => x.id === R.id ? Object.assign({}, x, { updates: (x.updates || []).concat({ who: 'u1', text: t, when: 'Just now' }) }) : x) })); this.say('Update posted for your team.'); };
            return { isCall: (R.stage || 'new') === 'call', phone: ph || 'No phone on file', tel: 'tel:' + String(ph).replace(/\D/g, ''), contactLine: [c[0] && c[0] !== 'Main line' ? 'Ask for ' + c[0] + (c[1] ? ', ' + c[1] : '') : 'Main line', D.hood].filter(Boolean).join(' · '),
              showUpdates: (R.stage || 'new') === 'call' || ups.length > 0, updates: ups, noUpdates: !ups.length, canPost: R.stage !== 'resolved',
              upd: { v: s.repUpd || '', on: e => this.setState({ repUpd: e.target.value }) },
              postUpdate: () => { const t = (s.repUpd || '').trim(); if (!t) return this.say('Write an update first.'); post(t); },
              quickUpd: [['No answer', 'Called, no answer.'], ['Left voicemail', 'Left a voicemail.'], ['Will call back', 'They asked us to call back later.']].map(([label, t]) => ({ label, use: () => post(t) })) }; })(),
          hasListing: !!L, pauseLabel: L && L.status === 'paused' ? 'Unpause listing' : 'Pause listing',
          viewListing: () => { if (!L) return; const back = { label: 'Back to report', repPop: R.id, repStage: s.repStage }; this.setState({ repPop: null }); this.openPop('org', L.id, [L.id]); this.setState(st => ({ pop: Object.assign({}, st.pop, { back }) })); },
          openListing: () => { if (L) { const back = { label: 'Back to report', repPop: R.id, repStage: s.repStage }; this.setState({ repPop: null }); this.openPop('org', L.id, [L.id]); this.setState(st => ({ pop: Object.assign({}, st.pop, { editing: true, back }) })); } else this.say('That listing isn’t in this sample.'); } }; })(),
      teamOpts: s.team.map(m => ({ id: m.id, name: m.you ? 'You' : m.name })),
      asg: (() => { const A = s.asg, put = o => this.setState(st => ({ asg: Object.assign({}, st.asg, o) })), q = (s.q || '').trim().toLowerCase();
        const shown = this.listShown();
        const nm = id => { const m = s.team.find(x => x.id === id); return m ? (m.you ? 'You' : m.name) : ''; };
        const picked = shown.filter(o => A.sel[o.id]), mem = s.team.find(x => x.id === A.member), un = s.listings.filter(o => !o.assignee).length;
        return { open: !!A.open, aria: A.open ? 'true' : 'false', btn: A.open ? 'Close' : 'Assign listings', toggle: () => put({ open: !A.open, member: '', sel: {} }),
          summary: un + (un === 1 ? ' listing has' : ' listings have') + ' no one assigned',
          members: s.team.map(m => { const on = A.member === m.id, n = s.listings.filter(o => o.assignee === m.id).length; return { name: m.you ? 'You' : m.name, sub: n + ' assigned', initials: m.you ? 'You' : m.name.split(' ').map(w => w[0]).join('').slice(0, 2), pressed: on ? 'true' : 'false',
            pick: () => put({ member: m.id, sel: Object.fromEntries(s.listings.filter(o => o.assignee === m.id).map(o => [o.id, true])) }),
            style: { display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px', minHeight: 48, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)', textAlign: 'left', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: on ? 'var(--color-accent-100)' : 'var(--color-bg)', boxShadow: on ? 'inset 0 -3px 0 var(--color-accent-700)' : 'none' },
            avatar: { width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: m.you ? 'var(--color-accent-700)' : 'oklch(0.92 0.05 ' + (m.hue != null ? m.hue : 250) + ')', color: m.you ? 'var(--color-bg)' : 'oklch(0.35 0.08 ' + (m.hue != null ? m.hue : 250) + ')' } }; }),
          hasMember: !!mem, total: shown.length, allOn: shown.length > 0 && picked.length === shown.length,
          toggleAll: () => put({ sel: picked.length === shown.length ? {} : Object.fromEntries(shown.map(o => [o.id, true])) }),
          rows: shown.map(o => ({ name: o.name, on: !!A.sel[o.id], current: o.assignee ? (o.assignee === A.member ? 'Already theirs' : 'Now: ' + nm(o.assignee)) : 'No one yet', toggle: () => put({ sel: Object.assign({}, A.sel, { [o.id]: !A.sel[o.id] }) }) })),
          applyLabel: mem ? 'Assign ' + picked.length + (picked.length === 1 ? ' listing' : ' listings') + ' to ' + (mem.you ? 'you' : mem.name.split(' ')[0]) : 'Assign',
          apply: () => { if (!mem) return; const ids = picked.map(o => o.id);
            this.setState(st => ({ asg: { open: false, member: '', sel: {} }, listings: st.listings.map(x => ids.includes(x.id) ? Object.assign({}, x, { assignee: mem.id }) : (x.assignee === mem.id && shown.some(o => o.id === x.id) ? Object.assign({}, x, { assignee: '' }) : x)) }));
            this.say(ids.length + (ids.length === 1 ? ' listing' : ' listings') + ' assigned to ' + (mem.you ? 'you' : mem.name) + '.'); } }; })(),
      inbox: (() => { const F = s.mailF || 'open', q = (s.mailQ || '').trim().toLowerCase();
        const inF = f => s.mails.filter(m => m.status === f);
        const list = inF(F).filter(m => (!s.mailMine || m.assignee === 'u1') && (!q || (m.from + ' ' + m.email + ' ' + m.subject + ' ' + m.body + ' ' + (m.org || '')).toLowerCase().includes(q))).sort((a, b) => a.days - b.days);
        const who = id => s.team.find(x => x.id === id);
        return { keep: s.st.rules.keepMail,
          folders: [['open', 'Open'], ['auto', 'Auto-answered'], ['done', 'Done'], ['archived', 'Archived'], ['spam', 'Spam']].map(([k, label]) => { const on = F === k; return { label, n: inF(k).length, on: on ? 'true' : 'false', pick: () => this.setState({ mailF: k }), style: { minHeight: 44, padding: '0 16px', fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: on ? 'var(--color-accent-700)' : 'var(--color-bg)', color: on ? 'var(--color-bg)' : 'var(--color-text)', fontWeight: on ? 600 : 400 } }; }),
          mine: { on: !!s.mailMine, toggle: () => this.setState({ mailMine: !s.mailMine }) }, q: { v: s.mailQ, on: e => this.setState({ mailQ: e.target.value }) },
          rows: list.map(m => { const a = who(m.assignee), unread = !m.read; return { from: m.from, email: m.email, subject: m.subject, preview: m.body.replace(/\n+/g, ' '), when: m.time, org: m.org, hasOrg: !!m.org,
            hasFiles: m.files.length > 0, files: m.files.length + (m.files.length === 1 ? ' file' : ' files'), replied: m.thread.some(t => t.me && t.who !== 'Automatic reply'), isAuto: !!m.auto && m.status === 'auto', autoLabel: m.auto === 'update' ? 'Sent “update it yourself”' : 'Sent “call them directly”', open: () => this.openMail(m.id),
            hasAssignee: !!a, assignee: a ? (a.you ? 'you' : a.name) : '', initials: a ? (a.you ? 'You' : a.name.split(' ').map(w => w[0]).join('').slice(0, 2)) : '',
            avatar: { width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, background: a && a.you ? 'var(--color-accent-700)' : 'oklch(0.92 0.05 ' + (a && a.hue != null ? a.hue : 250) + ')', color: a && a.you ? 'var(--color-bg)' : 'oklch(0.35 0.08 ' + (a && a.hue != null ? a.hue : 250) + ')' },
            dot: { width: 10, height: 10, borderRadius: '50%', flex: 'none', marginTop: 7, background: unread ? 'var(--color-accent-700)' : 'transparent' },
            fromStyle: { fontSize: 16, fontWeight: unread ? 700 : 500 }, subjStyle: { fontSize: 16, fontWeight: unread ? 600 : 400 },
            rowStyle: { display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '14px 16px', border: 0, borderBottom: '1px solid var(--color-divider)', background: unread ? 'var(--color-accent-100)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' } }; }),
          empty: list.length === 0, emptyText: q ? 'No emails match your search.' : { open: 'No open emails. Nice work.', auto: 'Nothing was auto-answered.', done: 'Nothing marked done yet.', archived: 'Nothing archived.', spam: 'No spam.' }[F] }; })(),
      mail: (() => { const F = s.mailF || 'open', q = (s.mailQ || '').trim().toLowerCase();
        const list = s.mails.filter(m => m.status === F && (!s.mailMine || m.assignee === 'u1') && (!q || (m.from + ' ' + m.subject + ' ' + m.body).toLowerCase().includes(q))).sort((a, b) => a.days - b.days);
        const M = s.mails.find(m => m.id === s.mailPop); if (!M) return { open: false };
        const i = list.findIndex(m => m.id === M.id), upd = o => this.setState(st => ({ mails: st.mails.map(m => m.id === M.id ? Object.assign({}, m, o) : m) }));
        const after = () => { const rest = list.filter(m => m.id !== M.id); const nx = rest[Math.min(Math.max(i, 0), rest.length - 1)]; if (nx) this.openMail(nx.id); else this.setState({ mailPop: null }); };
        const L = s.listings.find(o => o.name === M.org);
        const sendIt = done => { const t = (s.mailReply || '').trim(); if (!t) return this.setState({ mailErr: 'Write your reply first.' });
          this.setState(st => ({ mailReply: '', mailErr: '', teamLog: [{ who: 'u1', act: 'reply', what: M.from, days: 0 }].concat(st.teamLog), mails: st.mails.map(m => m.id === M.id ? Object.assign({}, m, { thread: m.thread.concat({ me: true, who: 'You', text: t, when: 'Just now' }), status: done ? 'done' : m.status }) : m) }));
          this.say('Reply sent to ' + M.from + '.'); if (done) after(); };
        return { open: true, subject: M.subject, from: M.from, email: M.email, mailto: 'mailto:' + M.email, to: M.to, when: (M.days === 0 ? 'Today, ' : '') + M.time,
          folder: { open: 'Inbox', auto: M.auto === 'update' ? 'Auto-answered · Listing update request' : 'Auto-answered · Question about a listing', done: 'Done', archived: 'Archived', spam: 'Spam' }[M.status],
          assignee: { v: M.assignee, on: e => { const v = e.target.value, a = s.team.find(x => x.id === v); upd({ assignee: v }); this.say(a ? 'Assigned to ' + (a.you ? 'you' : a.name) + '.' : 'Unassigned.'); } },
          org: { v: M.org, on: e => upd({ org: e.target.value }) }, orgOpts: s.listings.map(o => o.name).concat(s.requests.map(r => r.org)).filter((v, j, a) => a.indexOf(v) === j),
          hasOrgLink: !!L, openOrg: () => { if (L) { this.setState({ mailPop: null }); this.openPop('org', L.id, [L.id]); } },
          thread: [{ style: { display: 'flex', flexDirection: 'column', gap: 6 }, head: M.from + ' wrote · ' + M.time, text: M.body }].concat(M.thread.map(t => ({ style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', background: 'var(--color-accent-100)', borderLeft: '3px solid var(--color-accent-700)' }, head: t.who + (t.who === 'Automatic reply' ? ' sent · ' : ' replied · ') + t.when, text: t.text === 'AUTO_LISTINGQ' ? s.st.tpl.listingQ : t.text === 'AUTO_UPDATE' ? s.st.tpl.update : t.text }))),
          hasFiles: M.files.length > 0, files: M.files.map(f => ({ name: f.name, size: f.size, action: 'Open' })),
          canReply: M.status !== 'spam', quick: [['listingQ', 'Call them directly'], ['update', 'Update it yourself'], ['status', 'Still in review']].map(([k, label]) => ({ label, use: () => this.setState({ mailReply: s.st.tpl[k], mailErr: '' }) })), reply: { v: s.mailReply, on: e => this.setState({ mailReply: e.target.value, mailErr: '' }) }, err: s.mailErr,
          send: () => sendIt(false), sendDone: () => sendIt(true),
          doneLabel: M.status === 'done' ? 'Reopen' : 'Mark done', done: () => { if (M.status === 'done') { upd({ status: 'open' }); this.say('Moved back to Open.'); } else { upd({ status: 'done' }); this.say('Marked done.'); after(); } },
          archiveLabel: M.status === 'archived' ? 'Move to inbox' : 'Archive', archive: () => { if (M.status === 'archived') { upd({ status: 'open' }); this.say('Moved to the inbox.'); } else { upd({ status: 'archived' }); this.say('Archived.'); after(); } },
          spamLabel: M.status === 'spam' ? 'Not spam' : 'Mark as spam', spam: () => { if (M.status === 'spam') { upd({ status: 'open' }); this.say('Moved to the inbox.'); } else { upd({ status: 'spam' }); this.say('Marked as spam.'); after(); } },
          hasNav: list.length > 1 && i >= 0, pos: (i + 1) + ' of ' + list.length, noPrev: i <= 0, noNext: i >= list.length - 1,
          prev: () => { if (i > 0) this.openMail(list[i - 1].id); }, next: () => { if (i < list.length - 1) this.openMail(list[i + 1].id); },
          close: () => this.setState({ mailPop: null }), stop: e => e.stopPropagation() }; })(),
      isInbox: s.tab === 'inbox',
      crop: (() => { const K = s.crop; if (!K) return { open: false };
        const box = 280, base = box / Math.min(K.w, K.h), dw = K.w * base * K.z, dh = K.h * base * K.z;
        const left = (box - dw) / 2 + K.x * (dw - box) / 2, top = (box - dh) / 2 + K.y * (dh - box) / 2;
        const set = o => this.setState(st => ({ crop: Object.assign({}, st.crop, o) }));
        const sl = (k, min, max, step, show) => ({ v: K[k], min, max, step, show: show(K[k]), on: e => set({ [k]: +e.target.value }) });
        return { open: true, src: K.src, stop: e => e.stopPropagation(), cancel: () => this.setState({ crop: null }), reset: () => set({ z: 1, x: 0, y: 0 }),
          imgStyle: { position: 'absolute', left, top, width: dw, height: dh, maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' },
          zoom: sl('z', 1, 3, 0.05, v => Math.round(v * 100) + '%'), x: sl('x', -1, 1, 0.02, v => Math.round(v * 100)), y: sl('y', -1, 1, 0.02, v => Math.round(v * 100)),
          save: () => { const out = 256, f = out / box, im = new Image();
            im.onload = () => { const c = document.createElement('canvas'); c.width = out; c.height = out; const g = c.getContext('2d'); g.drawImage(im, left * f, top * f, dw * f, dh * f);
              this.setState(st => ({ crop: null, me: Object.assign({}, st.me, { photo: c.toDataURL('image/jpeg', 0.9), photoSrc: K.src, photoCrop: { z: K.z, x: K.x, y: K.y } }) })); this.say('Photo updated.'); };
            im.src = K.src; } }; })(),
      lf: (() => { const F = s.lf || {}, put = o => this.setState(st => ({ lf: Object.assign({}, st.lf, o) })), V = s.listF || 'all';
        const chip = on => ({ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38, padding: '0 12px', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: on ? 'var(--color-accent-700)' : 'var(--color-bg)', color: on ? 'var(--color-bg)' : 'var(--color-text)' });
        const seg = (cur, opts, set) => opts.map(([k, label]) => ({ label, on: cur === k ? 'true' : 'false', pick: () => set(k), style: Object.assign(chip(cur === k), { flex: 1, justifyContent: 'center', minHeight: 44 }) }));
        const tog = (key, k) => { const a = (F[key] || []).slice(), i = a.indexOf(k); if (i >= 0) a.splice(i, 1); else a.push(k); put({ [key]: a }); };
        const allHoods = s.listings.map(o => o.place).filter((v, i, a) => v && a.indexOf(v) === i).sort();
        const chips = [].concat((F.cats || []).map(k => ({ label: this.CATL[k], remove: () => tog('cats', k) })), (F.types || []).map(k => ({ label: k, remove: () => tog('types', k) })),
          F.faith ? [{ label: F.faith === 'yes' ? 'Faith-based' : 'Not faith-based', remove: () => put({ faith: '' }) }] : [], F.hood ? [{ label: F.hood, remove: () => put({ hood: '' }) }] : [],
          F.accepting ? [{ label: 'Accepting new people', remove: () => put({ accepting: false }) }] : [], V !== 'all' ? [{ label: V === 'verified' ? 'Verified' : 'Unverified', remove: () => this.setState({ listF: 'all' }) }] : [],
          F.status ? [{ label: { approved: 'Live', pending: 'Waiting for review', paused: 'Paused', removed: 'Removed' }[F.status], remove: () => put({ status: '' }) }] : [],
          F.asg ? [{ label: F.asg === 'none' ? 'Assigned to no one' : 'Assigned to ' + ((s.team.find(m => m.id === F.asg) || {}).you ? 'you' : (s.team.find(m => m.id === F.asg) || {}).name), remove: () => put({ asg: '' }) }] : []);
        const n = this.listShown().length;
        return { open: !!s.lfOpen, aria: s.lfOpen ? 'true' : 'false', toggle: () => this.setState({ lfOpen: !s.lfOpen }), btnLabel: chips.length ? 'Filters (' + chips.length + ')' : 'Filters',
          btnStyle: Object.assign(chip(!!s.lfOpen || chips.length > 0), { minHeight: 44, fontSize: 15, padding: '0 14px', gap: 8 }),
          chips, hasActive: chips.length > 0, clear: () => this.setState({ lf: {}, listF: 'all' }),
          countText: n + (n === 1 ? ' listing' : ' listings') + (chips.length || (s.q || '').trim() ? (n === 1 ? ' matches' : ' match') : ''), countShort: n + (n === 1 ? ' listing' : ' listings'),
          sort: { v: s.lsort || (V === 'unverified' ? 'checked' : 'name'), on: e => this.setState({ lsort: e.target.value }) },
          cats: Object.keys(this.CATL).map(k => { const on = (F.cats || []).includes(k); return { label: this.CATL[k], on: on ? 'true' : 'false', toggle: () => tog('cats', k), style: chip(on) }; }),
          types: ['Nonprofit', 'Church', 'Government', 'School'].map(k => { const on = (F.types || []).includes(k); return { label: k, on: on ? 'true' : 'false', toggle: () => tog('types', k), style: chip(on) }; }),
          faith: seg(F.faith || '', [['', 'Any'], ['yes', 'Yes'], ['no', 'No']], v => put({ faith: v })),
          ver: seg(V, [['all', 'Any'], ['verified', 'Verified'], ['unverified', 'Unverified']], v => this.setState({ listF: v })),
          hood: { v: F.hood || '', on: e => put({ hood: e.target.value }) }, hoods: allHoods,
          accepting: { v: !!F.accepting, on: e => put({ accepting: e.target.checked }) },
          status: { v: F.status || '', on: e => put({ status: e.target.value }) }, asg: { v: F.asg || '', on: e => put({ asg: e.target.value }) } }; })(),
      isTeam: s.tab === 'team', teamCount: s.team.length + (s.team.length === 1 ? ' person' : ' people'),
      team: s.team.map(m => ({ name: m.you ? 'You' : m.name, email: m.email, since: m.since, isYou: !!m.you, invited: !!m.invited, canEdit: !m.you, role: m.role, selId: 'role-' + m.id,
        photo: m.you ? s.me.photo : '', hasPhoto: !!(m.you && s.me.photo), noPhoto: !(m.you && s.me.photo),
        avatarStyle: { width: 40, height: 40, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 15, background: m.you ? 'var(--color-accent-700)' : 'oklch(0.92 0.05 ' + (m.hue != null ? m.hue : 250) + ')', color: m.you ? 'var(--color-bg)' : 'oklch(0.35 0.08 ' + (m.hue != null ? m.hue : 250) + ')' },
        message: () => this.setState({ msgTo: m.id, msgText: '', msgErr: '' }),
        roleLabel: { owner: 'Owner', admin: 'Admin', reviewer: 'Reviewer', viewer: 'Viewer' }[m.role] || m.role, status: m.invited ? 'Invite sent' : m.since.replace(/^(Owner since|Added)/, m.you ? 'Owner since' : 'Joined'),
        roleStyle: Object.assign({ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', fontSize: 13, fontWeight: 500, lineHeight: 1.3, whiteSpace: 'nowrap' }, m.role === 'owner' || m.role === 'admin' ? { background: 'var(--color-accent-700)', color: 'var(--color-bg)', border: '1px solid var(--color-accent-700)' } : m.role === 'reviewer' ? { background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', border: '1px solid var(--color-accent-300)' } : { background: 'var(--color-neutral-200)', color: 'var(--color-neutral-800)', border: '1px solid var(--color-neutral-400)' }),
        initials: m.you ? 'You' : m.name.split(' ').map(w => w[0]).join('').slice(0, 2),
        setRole: e => { const v = e.target.value; this.setState(st => ({ team: st.team.map(x => x.id === m.id ? Object.assign({}, x, { role: v }) : x) })); this.say('Role updated.'); this.log('Changed ' + m.name + '’s role to ' + v + '.'); },
        remove: () => { this.setState(st => ({ team: st.team.filter(x => x.id !== m.id) })); this.say('Removed from your team.'); this.log('Removed ' + m.name + ' from the team.'); } })),
      invite: { open: !!s.invOpen, aria: s.invOpen ? 'true' : 'false', toggle: () => this.setState({ invOpen: !s.invOpen, inv: { email: '', role: 'reviewer', err: '' } }), email: { v: s.inv.email, on: e => this.setState({ inv: Object.assign({}, s.inv, { email: e.target.value, err: '' }) }) }, role: { v: s.inv.role, on: e => this.setState({ inv: Object.assign({}, s.inv, { role: e.target.value }) }) }, err: s.inv.err,
        send: () => { const em = (s.inv.email || '').trim(); if (!/.+@.+\..+/.test(em)) return this.setState({ inv: Object.assign({}, s.inv, { err: 'Enter an email address.' }) });
          this.setState(st => ({ invOpen: false, inv: { email: '', role: 'reviewer', err: '' }, team: st.team.concat({ id: 'u' + Date.now(), name: em.split('@')[0], email: em, role: st.inv.role, since: 'Invited just now', invited: true }) })); this.say('Invite sent to ' + em + '.'); this.log('Invited ' + em + ' as ' + s.inv.role + '.'); } },
      isOverview: s.tab === 'overview',
      ...(() => { const unv = s.tab === 'listings' && s.listF === 'unverified';
        const T = {
          overview: ['Welcome back', 'Here’s what’s waiting on you and how the directory is doing.'],
          requests: ['New listings & claims', 'Organizations asking to join, and people asking to manage a listing. Nothing goes live until you approve it.'],
          changes: ['Contact changes', 'Phone, email, website and address edits from organizations. They stay hidden until you approve them.'],
          inbox: ['Inbox', 'Emails sent to your Compassion Catalyst addresses. Read, reply, assign and file them here.'],
          reports: ['Reports', 'Corrections people suggested and problems they flagged on a listing. Three steps: read it, call the organization, then mark it resolved.'],
          checks: ['Listing checks', 'Every listing shows the public a “Last confirmed” date. This is what keeps it fresh: small differences confirm themselves, big ones wait here for a person, and older listings come up for a check-in.'],
          listings: ['All listings', 'Every organization in the directory. Change a status, edit details or mark one Verified.'],
          settings: ['Settings', 'Your account, your password, and a copy of every listing.'],
          account: ['Your account', 'Your name, photo and log-in.'],
          team: ['My team', 'The people who help you run Compassion Catalyst, and what each of them is allowed to do.'],
          unverified: ['Unverified listings', 'Live listings you haven’t confirmed yet, longest-unchecked first. Call, check, then mark Verified.']
        }[unv ? 'unverified' : s.tab] || ['Admin', ''];
        return { pageTitle: T[0], pageSub: T[1] }; })(),
      box: (() => {
        const C = { listings: 'oklch(0.55 0.16 250)', claims: 'oklch(0.58 0.19 27)', verify: 'oklch(0.80 0.15 85)', inbox: 'var(--color-accent-700)', checks: 'oklch(0.55 0.11 190)' };
        const sw = k => ({ width: 8, height: 28, flex: 'none', background: C[k] });
        const age = d => d === 0 ? 'Sent today' : d === 1 ? 'Sent 1 day ago' : 'Sent ' + d + ' days ago';
        const oldest = (x, y) => y.days - x.days;
        const NL = s.requests.filter(r => r.kind === 'new_listing').sort(oldest), CL = s.requests.filter(r => r.kind === 'claim').sort(oldest);
        const TV = s.listings.filter(o => o.status === 'approved' && !o.verified).sort((x, y) => y.checked - x.checked);
        const defs = [['inbox', 'Unread emails', s.mails.filter(m => m.status === 'open' && !m.read).length, 'Sent to info@'], ['listings', 'New listings', NL.length, 'Waiting for approval'], ['claims', 'Claims', CL.length, 'People claiming an organization'], ['verify', 'To verify', TV.length, 'Live, not yet confirmed'], ['checks', 'Listing checks', s.checks.filter(c => c.stage === 'flag').length + this.chkDue().length, 'Big differences and check-ins']].filter(d => (window.CC_ADMIN_HIDE || []).indexOf(d[0]) < 0);
        const k = s.boxTab || 'listings';
        const reqItem = (r, kk) => ({ name: r.org, groupLabel: kk === 'listings' ? 'New listing' : 'Claim', desc: r.person + ' · ' + r.email, meta: age(r.days) + ' · Verify by: ' + r.method, swatch: sw(kk),
          next: kk === 'listings' ? 'Next: check it’s real, then approve' : 'Next: confirm they work there', open: () => this.openPop('req', r.id), act: () => this.openPop('req', r.id), actLabel: 'Review' });
        const UM = s.mails.filter(m => m.status === 'open' && !m.read).sort((a, b) => b.days - a.days);
        const items = k === 'checks' ? this.chkQueue(sw('checks')) : k === 'inbox' ? UM.map(m => ({ name: m.subject, groupLabel: 'Email', desc: m.from + ' · ' + m.email, meta: (m.days === 0 ? 'Today' : m.days === 1 ? 'Yesterday' : m.days + ' days ago') + (m.org ? ' · About ' + m.org : ''), swatch: sw('inbox'), next: 'Next: read and reply', open: () => this.openMail(m.id), act: () => this.openMail(m.id), actLabel: 'Read' })) : k === 'listings' ? NL.map(r => reqItem(r, 'listings')) : k === 'claims' ? CL.map(r => reqItem(r, 'claims')) :
          TV.map(o => ({ name: o.name, groupLabel: 'To verify', desc: o.place + ' · ' + o.phone, meta: 'Last checked ' + (o.checked ? o.checked + ' days ago' : 'today'), swatch: sw('verify'),
            next: 'Next: call them and confirm hours, phone and services', open: () => this.openPop('org', o.id),
            act: () => { this.setState(st => ({ listings: st.listings.map(x => x.id === o.id ? Object.assign({}, x, { verified: true, checked: 0 }) : x) })); this.say('Marked Verified.'); this.log('Marked ' + o.name + ' Verified.'); }, actLabel: 'Mark Verified' }));
        return {
          barStyle: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', border: '1px solid var(--color-neutral-400)', borderBottom: 0 },
          tabs: defs.map(([kk, label, value, hint], i) => { const on = kk === k; return { label, value, hint, sel: on ? 'true' : 'false', swatch: sw(kk), go: () => this.setState({ boxTab: kk }),
            style: { display: 'flex', alignItems: 'center', gap: 6, padding: '12px 18px', minWidth: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'inherit', border: 0, borderLeft: i ? '1px solid var(--color-neutral-400)' : 0, borderTop: '4px solid ' + (on ? C[kk] : 'transparent'), borderBottom: '1px solid ' + (on ? 'transparent' : 'var(--color-neutral-400)'), background: on ? 'var(--color-bg)' : 'var(--color-neutral-100)', marginBottom: -1, position: 'relative', zIndex: on ? 1 : 0 } }; }),
          title: k === 'checks' ? 'Listings that need a person to look' : k === 'inbox' ? 'Emails you haven’t read' : k === 'listings' ? 'New listings waiting for approval' : k === 'claims' ? 'People claiming an organization' : 'Organizations still to verify',
          unverifiedCount: s.listings.filter(o => o.status === 'approved' && !o.verified).length, seeUnverified: () => this.setState({ tab: 'listings', listF: 'unverified', q: '' }),
          seeAllLabel: k === 'checks' ? 'All listing checks' : k === 'inbox' ? 'Open inbox' : k === 'verify' ? 'All listings' : 'All requests', seeAll: () => this.setState(k === 'checks' ? { tab: 'checks', chkStage: 'flag' } : k === 'inbox' ? { tab: 'inbox', mailF: 'open' } : k === 'verify' ? { tab: 'listings', listF: 'all' } : { tab: 'requests', reqKind: k === 'claims' ? 'claim' : 'new_listing' }),
          items, empty: !items.length, emptyText: k === 'checks' ? 'Nothing needs a look. Every listing is fresh.' : k === 'inbox' ? 'You’ve read every email.' : k === 'listings' ? 'No new listings are waiting.' : k === 'claims' ? 'No one is claiming a listing right now.' : 'Every live listing is verified.'
        };
      })(),
      goListings: () => this.setState({ tab: 'listings' }),
      health: (() => { const live = s.listings.filter(o => o.status === 'approved'), v = live.filter(o => o.verified).length, pct = live.length ? Math.round(100 * v / live.length) : 0;
        const tone = pct >= 75 ? { c: 'oklch(0.55 0.14 150)', t: 'oklch(0.42 0.12 150)', w: 'Most are verified' } : pct >= 40 ? { c: 'oklch(0.75 0.15 75)', t: 'oklch(0.48 0.12 70)', w: 'About half verified' } : { c: 'oklch(0.58 0.19 27)', t: 'oklch(0.48 0.17 27)', w: 'Few verified yet' };
        return { verifiedText: v + ' of ' + live.length + ' (' + pct + '%)', toneWord: tone.w, toneStyle: { fontSize: 13, fontWeight: 600, color: tone.t }, numStyle: { fontWeight: 600, color: tone.t },
          bar: { display: 'block', height: '100%', width: Math.max(pct, 2) + '%', background: tone.c, transition: 'width .3s ease, background .3s ease' },
          rows: [['Waiting for review', s.listings.filter(o => o.status === 'pending').length], ['Paused (hidden)', s.listings.filter(o => o.status === 'paused').length], ['Removed', s.listings.filter(o => o.status === 'removed').length], ['Oldest unconfirmed', Math.max(0, ...live.filter(o => !o.verified).map(o => o.checked)) + ' days']].map(([label, value]) => ({ label, value })) }; })(),
      activity: s.activity,
      navStyle: { flex: mini ? '0 0 64px' : '1 1 236px', maxWidth: mini ? 64 : 236, minWidth: mini ? 64 : 200, borderRight: '1px solid var(--color-divider)', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 2, boxSizing: 'border-box', transition: 'max-width .2s ease' },
      toggleStyle: { display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : 'flex-start', gap: 10, width: '100%', minHeight: 44, padding: mini ? 0 : '0 12px', marginBottom: 8, border: 0, borderBottom: '1px solid var(--color-divider)', background: 'transparent', color: 'var(--color-neutral-800)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' },
      toggleNav: () => this.setState({ mini: !mini }), navOpen: !mini, navClosed: mini, navExpanded: mini ? 'false' : 'true', navToggleLabel: mini ? 'Expand menu' : 'Collapse menu',
      isRequests: s.tab === 'requests', isChanges: s.tab === 'changes', isReports: s.tab === 'reports', isChecks: s.tab === 'checks', chk: this.chkVals(), isListings: s.tab === 'listings',
      noRequests: !s.requests.filter(r => (s.reqKind || 'all') === 'all' || r.kind === s.reqKind).length, noChanges: !s.changes.length, noReports: !s.reports.filter(r => (r.stage || 'new') === (s.repStage || 'new')).length,
      requests: s.requests.filter(r => (s.reqKind || 'all') === 'all' || r.kind === s.reqKind).sort((x, y) => y.days - x.days).map(r => Object.assign({}, r, {
        kindLabel: r.kind === 'new_listing' ? 'New listing' : 'Claim', kindStyle: tag(false, r.kind === 'new_listing'),
        approveLabel: r.kind === 'new_listing' ? 'Approve listing' : 'Approve claim',
        hint: (r.kind === 'new_listing' ? 'Approving puts the listing on the directory and makes this person its owner.' : 'Approving makes this person the listing’s owner.') + ' Verified is set separately in “All listings”.',
        approve: () => this.drop('requests', r.id, 'Approved.'), reject: () => this.drop('requests', r.id, 'Rejected.'),
        open: () => this.openPop('req', r.id), ageText: r.days === 0 ? 'Today' : r.days === 1 ? '1 day' : r.days + ' days',
        swatch: { width: 6, height: 24, flex: 'none', background: r.kind === 'new_listing' ? 'oklch(0.55 0.16 250)' : 'oklch(0.58 0.19 27)' }
      })),
      changes: s.changes.map(c => Object.assign({}, c, { approve: () => this.drop('changes', c.id, 'Change approved and live.'), reject: () => this.drop('changes', c.id, 'Change rejected.') })),
      reports: s.reports.filter(r => (r.stage || 'new') === (s.repStage || 'new')).sort((a, b) => b.days - a.days).map(r => Object.assign({}, r, this.repActs(r), { open: () => this.setState({ repPop: r.id }), isDone: r.stage === 'resolved', outcomeLabel: r.outcome === 'dismissed' ? 'Dismissed' : 'Fixed' })),
      repCompact: (s.repStage || 'new') === 'resolved', repDetailed: (s.repStage || 'new') !== 'resolved',
      repEmpty: { new: 'No new reports.', call: 'No one to call right now.', resolved: 'Nothing resolved yet.' }[s.repStage || 'new'],
      repCards: [['new', 'New reports', 'Just came in. Read and decide.', 1], ['call', 'Need to call', 'Looks right. Call them to confirm and fix it.', 2], ['resolved', 'Resolved', 'Fixed or dismissed.', 3]].map(([k, label, hint, step]) => {
        const on = (s.repStage || 'new') === k, n = s.reports.filter(r => (r.stage || 'new') === k).length;
        return { label, hint, step, n, isNew: k === 'new', isCall: k === 'call', isDone: k === 'resolved', pressed: on ? 'true' : 'false', pick: () => this.setState({ repStage: k }),
          style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', background: on ? 'var(--color-accent-100)' : 'var(--color-bg)', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), boxShadow: on ? 'inset 0 -3px 0 var(--color-accent-700)' : 'var(--shadow-sm)' },
          iconStyle: { display: 'grid', placeItems: 'center', width: 36, height: 36, flex: 'none', background: on ? 'var(--color-accent-700)' : 'var(--color-accent-100)', color: on ? 'var(--color-bg)' : 'var(--color-accent-800)' } }; }),
      q: { v: s.q, on: e => this.setState({ q: e.target.value }) },
      summary: ['approved', 'pending', 'paused', 'removed'].map(k => (counts[k] || 0) + ' ' + k).join(' · ') + ' · ' + s.listings.filter(o => o.verified).length + ' verified',
      listings: this.listShown().map(o => ({
        asgId: 'asg-' + o.id, assignee: o.assignee || '', hasAssignee: !!o.assignee, ...(() => { const m = s.team.find(x => x.id === o.assignee); return m ? { assigneeName: m.you ? 'You' : m.name, initials: m.you ? 'You' : m.name.split(' ').map(w => w[0]).join('').slice(0, 2), avatar: { width: 24, height: 24, borderRadius: '50%', display: 'inline-grid', placeItems: 'center', fontSize: 10, fontWeight: 700, background: m.you ? 'var(--color-accent-700)' : 'oklch(0.92 0.05 ' + (m.hue != null ? m.hue : 250) + ')', color: m.you ? 'var(--color-bg)' : 'oklch(0.35 0.08 ' + (m.hue != null ? m.hue : 250) + ')' } } : {}; })(),
        setAssignee: e => { const v = e.target.value, m = s.team.find(x => x.id === v); this.setState(st => ({ listings: st.listings.map(x => x.id === o.id ? Object.assign({}, x, { assignee: v }) : x) })); this.say(m ? 'Assigned to ' + (m.you ? 'you' : m.name) + '.' : 'Unassigned.'); },
        name: o.name, sub: o.place + ' · ' + o.phone + (o.status === 'approved' ? ' · Last confirmed ' + this.agoTxt(o.checked) + (o.how ? ' (' + this.HOW[o.how] + ')' : '') : ''), edit: () => this.openPop('org', o.id), editNow: () => { this.openPop('org', o.id); this.setState(st => st.pop ? { pop: Object.assign({}, st.pop, { editing: true }) } : {}); }, status: o.status, selId: 'st-' + o.id,
        badge: o.verified ? 'Verified' : 'Not verified', badgeStyle: tag(o.verified, false),
        btnLabel: o.verified ? 'Remove Verified' : 'Mark Verified',
        btnStyle: o.verified ? { minHeight: 44, fontSize: 16 } : { minHeight: 44, fontSize: 16, background: 'var(--color-accent-700)', borderColor: 'var(--color-accent-700)', color: 'var(--color-bg)' },
        setStatus: e => { const v = e.target.value; this.setState(st => ({ listings: st.listings.map(x => x.id === o.id ? Object.assign({}, x, { status: v }) : x) })); this.say('Status updated.'); },
        toggle: () => { this.setState(st => ({ listings: st.listings.map(x => x.id === o.id ? Object.assign({}, x, { verified: !x.verified }) : x) })); this.say(o.verified ? 'Verified badge removed.' : 'Marked Verified.'); }
      })),
      pop: this.popVals(),
      toast: s.toast
    };
  }
}
/* ==========================================================================
   PART 3 — admin-bridge: connects the Admin page to Supabase.

   • Only accounts marked as site admins can use this page. Everyone else is sent away,
     and the database refuses their changes anyway (see the update SQL files).
   • Roles: Owner and Admin can approve, reject, verify, edit and manage the team.
     Reviewers can move reports along, post team updates and assign work. Viewers can only look.
   • Everything shown here comes from the database. Parts of the design that need things
     the site doesn't have yet (an email inbox, automatic listing checks) are hidden.
   ========================================================================== */
(function () {
  var CC = window.CC || { ok: false };
  var mount = document.getElementById('app');
  var app = null, ME = null, ROLE = 'viewer', ROWS = {}, REQS = {}, REPS = {};
  var DOCS = {}; // signed links to uploaded proof, by request id
  window.CC_ADMIN_HIDE = ['inbox', 'checks'];
  var RL = { owner: 'Owner', admin: 'Admin', reviewer: 'Reviewer', viewer: 'Viewer' };
  var CAN_APPROVE = function () { return ROLE === 'owner' || ROLE === 'admin'; };
  var CAN_WORK = function () { return CAN_APPROVE() || ROLE === 'reviewer'; };

  function say(html) { mount.innerHTML = '<div style="max-width:560px;margin:60px auto;padding:0 20px;font-size:18px;line-height:1.5">' + html + '</div>'; }
  function days(d) { return d ? Math.max(0, Math.floor((Date.now() - new Date(d)) / 864e5)) : 0; }
  function dId(uuid) { return uuid && ME && uuid === ME.uid ? 'u1' : (uuid || ''); }
  function uId(did) { return did === 'u1' ? ME.uid : (did || null); }
  function toast(m) { if (app) app.say(m); }
  function fail(e) { toast(CC.msg(e)); }

  // ---------- database rows → what the Admin screens use ----------
  function detOf(r) {
    var services = Object.assign({}, r.services && typeof r.services === 'object' ? r.services : {});
    (r.categories || []).forEach(function (k) { if (!services[k]) services[k] = []; }); // every category shows as ticked in the editor
    var hours = Array.isArray(r.hours) && r.hours.length === 7 ? r.hours.slice() : ['', '', '', '', '', '', ''];
    return { dbId: r.id, type: r.org_type || 'Nonprofit', faith: r.faith || '', cats: r.categories || [], hood: r.neighborhood || r.city || '',
      addr: [r.address, r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), phone: r.phone || '',
      avail: r.availability || 'Accepting', cap: '', hours: hours, langs: r.languages && r.languages.length ? r.languages : ['English'],
      cost: r.cost || '', elig: r.eligibility || [], docs: r.what_to_bring || '', contact: [r.contact_name || '', r.contact_title || '', r.email || ''],
      about: r.about || '', services: services, sensitive: !!r.is_sensitive,
      website: r.website || '', applyUrl: r.apply_url || '', area: r.service_area || '', state: r.state || '', county: r.county || '' };
  }
  function listingOf(r) {
    return { id: r.id, name: r.name, place: r.neighborhood || r.city || '', phone: r.phone || '', status: r.status, verified: !!r.verified,
      checked: days(r.last_confirmed_at || r.updated_at), how: '', assignee: dId(r.assigned_to) };
  }
  var METHOD = { email: 'Work email', phone: 'Call the listed phone', document: 'Document', reference: 'Reference' };
  function requestOf(q, accounts) {
    var o = ROWS[q.organization_id] || {}, acct = accounts[q.user_id] || '';
    var person = q.full_name + (q.role_title ? ', ' + q.role_title : '');
    if (acct && acct.toLowerCase() !== String(q.contact_email || '').toLowerCase()) person += ' · signed up as ' + acct;
    var file = q.document_path ? q.document_path.split('/').pop().replace(/^\d+-/, '') : '';
    return { id: q.id, orgId: q.organization_id, kind: q.kind, org: o.name || 'Unknown organization', phone: o.phone || '', place: o.neighborhood || o.city || '',
      person: person, email: q.contact_email, sent: CC.date(q.created_at), days: days(q.created_at),
      method: (METHOD[q.method] || q.method || '—') + (q.work_email ? ': ' + q.work_email : '') + (q.reference_note ? ': ' + q.reference_note : ''),
      hasDoc: !!q.document_path, docPath: q.document_path || '', docName: file, docKind: 'Uploaded file', docSize: '', docDate: CC.date(q.created_at) };
  }
  function reportOf(p, notes, all) {
    var o = ROWS[p.organization_id] || {};
    return { id: p.id, orgId: p.organization_id, org: o.name || 'Unknown organization', reason: p.reason, details: p.details || '(no details)',
      sent: CC.date(p.created_at), days: days(p.created_at), stage: p.stage || 'new', outcome: p.outcome || '', by: '', byEmail: '', field: '', shown: '',
      earlier: all.filter(function (x) { return x.organization_id === p.organization_id && x.id !== p.id; }).length,
      updates: (notes[p.id] || []).map(function (n) { return { who: dId(n.author), text: n.text, when: CC.date(n.created_at) }; }) };
  }

  async function loadAll() {
    var sb = CC.sb;
    var res = await Promise.all([
      sb.from('organizations').select('*').order('name'),
      sb.from('claim_requests').select('*').eq('status', 'pending').order('created_at'),
      sb.from('pending_changes').select('*').eq('status', 'pending').order('created_at'),
      sb.from('listing_reports').select('*').order('created_at', { ascending: false }).limit(500),
      sb.from('admin_notes').select('*').order('created_at'),
      sb.from('profiles').select('id, email, full_name, title, phone, admin_role, is_admin, created_at').eq('is_admin', true),
      sb.from('admin_activity').select('*').order('created_at', { ascending: false }).limit(500)
    ]);
    res.forEach(function (r) { if (r.error) throw r.error; });
    ROWS = {}; res[0].data.forEach(function (r) { ROWS[r.id] = r; });
    var DET = {}; res[0].data.forEach(function (r) { DET[r.id] = detOf(r); });
    var uids = res[1].data.map(function (q) { return q.user_id; }).filter(Boolean), accounts = {};
    if (uids.length) ((await sb.from('profiles').select('id, email').in('id', uids)).data || []).forEach(function (p) { accounts[p.id] = p.email; });
    var notes = {}; res[4].data.forEach(function (n) { if (n.report_id) (notes[n.report_id] = notes[n.report_id] || []).push(n); });
    var reports = res[3].data;
    var team = res[5].data.map(function (p, i) {
      var you = p.id === ME.uid;
      return { id: you ? 'u1' : p.id, uid: p.id, hue: [150, 30, 300, 200, 250][i % 5], name: you ? (p.full_name || 'You') : (p.full_name || p.email), email: p.email,
        role: p.admin_role || 'admin', since: (p.admin_role === 'owner' ? 'Owner' : 'Team member') + ' · account since ' + CC.date(p.created_at), you: you };
    }).sort(function (a, b) { return (b.you - a.you) || (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.name.localeCompare(b.name)); });
    var log = res[6].data;
    REQS = {}; res[1].data.forEach(function (q) { REQS[q.id] = q; });
    REPS = {}; reports.forEach(function (p) { REPS[p.id] = p; });
    return {
      DET: DET,
      state: {
        listings: res[0].data.map(listingOf),
        requests: res[1].data.map(function (q) { return requestOf(q, accounts); }),
        changes: res[2].data.map(function (c) { var o = ROWS[c.organization_id] || {}; return { id: c.id, orgId: c.organization_id, org: o.name || 'Unknown organization', field: c.field, from: c.old_value || '(blank)', to: c.new_value || '(blank)', sent: CC.date(c.created_at), days: days(c.created_at) }; }),
        reports: reports.map(function (p) { return reportOf(p, notes, reports); }),
        team: team,
        teamLog: log.filter(function (a) { return a.act !== 'note'; }).map(function (a) { return { who: dId(a.actor), act: a.act, what: a.what || '', days: days(a.created_at) }; }),
        activity: log.filter(function (a) { return a.act === 'note'; }).slice(0, 8).map(function (a) { return { when: CC.date(a.created_at), text: a.what || '' }; }),
        mails: [], checks: [], det: {}
      }
    };
  }

  async function start() {
    if (!CC.ok) return say('<h1 style="font-size:28px">We can’t reach the server</h1><p>Please try again in a few minutes.</p>');
    var session = await CC.whenReady;
    if (!session) { window.location.replace('login.html'); return; }
    var p = (await CC.sb.from('profiles').select('id, email, full_name, title, phone, is_admin, admin_role').eq('id', session.user.id).maybeSingle()).data;
    if (!p || !p.is_admin) return say('<h1 style="font-size:28px">This page is for the site’s team</h1><p>Your account doesn’t have access to the Admin page. If you think it should, ask the site owner to add your email.</p><p><a href="dashboard.html?org=1">Go to your dashboard</a> · <a href="index.html">Home</a></p>');
    ME = { uid: session.user.id, email: session.user.email };
    ROLE = p.admin_role || 'admin';
    var data = await loadAll();
    window.CC_ADMIN_INIT = Object.assign(data.state, {
      me: { name: p.full_name || '', title: p.title || '', email: session.user.email, phone: p.phone || '', photo: '' },
      st: Object.assign({}, new Component({}).state.st, { name: p.full_name || '', email: session.user.email })
    });
    window.CC_ADMIN_DET = data.DET;
    mount.textContent = '';
    app = window.app = window.startApp(Component, mount, {}, window.ADMIN_SCREENS);
  }

  async function refresh() {
    try { var data = await loadAll(); app.DET = data.DET; app._skipSave = true; app.setState(data.state); } catch (e) { fail(e); }
  }
  function logAct(act, what) {
    if (!CAN_WORK()) return;
    CC.sb.from('admin_activity').insert({ act: act, what: what || null }).then(function () {});
  }

  // ---------- actions ----------
  var baseDrop = Component.prototype.drop;
  Component.prototype.drop = function (key, id, msg) {
    var self = this, sb = CC.sb, P = this.state.pop, note = P && P.id === id ? (P.note || '').trim() : '';
    var q = null;
    if (key === 'requests') q = msg === 'Approved.' ? sb.rpc('approve_claim', { request_id: id }) : sb.rpc('reject_claim', { request_id: id, note: note || null });
    if (key === 'changes') q = /approved/i.test(msg) ? sb.rpc('approve_change', { change_id: id }) : sb.rpc('reject_change', { change_id: id, note: null });
    if (!q) return baseDrop.apply(this, arguments);
    if (!CAN_APPROVE()) return toast('Only Owners and Admins can approve or reject. Ask one of them.');
    baseDrop.apply(this, arguments);
    q.then(function (r) { if (r.error) { fail(r.error); } refresh(); });
  };
  var baseTeamAct = Component.prototype.teamAct;
  Component.prototype.teamAct = function (act, what) { baseTeamAct.apply(this, arguments); logAct(act, what); };
  var baseLog = Component.prototype.log;
  Component.prototype.log = function (text) {
    baseLog.apply(this, arguments);
    logAct('note', text);
    var m = String(text).match(/^Marked (.+) Verified\.$/); if (m) logAct('verified', m[1]);
  };
  var baseRepMove = Component.prototype.repMove;
  Component.prototype.repMove = function (id, stage, outcome) {
    if (!CAN_WORK()) return toast('Viewers can’t change reports.');
    baseRepMove.apply(this, arguments);
    var patch = { stage: stage, outcome: stage === 'resolved' ? (outcome || 'fixed') : null,
      status: stage === 'resolved' ? (outcome === 'dismissed' ? 'dismissed' : 'confirmed') : 'open',
      reviewed_at: stage === 'resolved' ? new Date().toISOString() : null, reviewed_by: stage === 'resolved' ? ME.uid : null };
    CC.sb.from('listing_reports').update(patch).eq('id', id).select('id').then(function (r) {
      if (r.error || !r.data || !r.data.length) { toast(r.error ? CC.msg(r.error) : 'That report couldn’t be updated.'); refresh(); }
      else if (stage === 'resolved') logAct('report', (REPS[id] && ROWS[REPS[id].organization_id] || {}).name);
    });
  };

  // ---------- buttons that need the real server ----------
  var baseRV = Component.prototype.renderVals;
  Component.prototype.renderVals = function () {
    var v = baseRV.apply(this, arguments);
    if (!v || !ME) return v;
    var self = this, s = this.state;
    if (v.acct) {
      v.acct.roleLabel = RL[ROLE] || ROLE;
      v.acct.loginEmail = ME.email;
      v.acct.logout = function () { CC.signOut().then(function () { window.location.href = 'index.html'; }, function () { window.location.href = 'index.html'; }); };
      v.acct.save = function () {
        var M = self.state.me, em = String(M.email || '').trim().toLowerCase();
        CC.sb.from('profiles').update({ full_name: (M.name || '').trim(), title: (M.title || '').trim() || null, phone: (M.phone || '').trim() || null }).eq('id', ME.uid).then(function (r) {
          if (r.error) return fail(r.error);
          self.setState(function (st) { return { team: st.team.map(function (m) { return m.you ? Object.assign({}, m, { name: (M.name || '').trim() || 'You' }) : m; }) }; });
          if (em && em !== ME.email.toLowerCase()) CC.sb.auth.updateUser({ email: em }).then(function (u) { toast(u.error ? CC.msg(u.error) : 'Saved. Click the links we sent to your old and new email to finish changing it.'); });
          else toast('Your details were saved.');
        });
      };
    }
    if (v.set) {
      v.set.changePw = function () { CC.forgot(ME.email).then(function (r) { toast(r.error ? CC.msg(r.error) : 'We emailed you a link to change your password.'); }); };
      v.set.signOutAll = function () { CC.sb.auth.signOut({ scope: 'others' }).then(function (r) { toast(r.error ? CC.msg(r.error) : 'Signed out of all other devices.'); }); };
      v.set.export = function () {
        var cols = ['name', 'status', 'verified', 'org_type', 'service_area', 'county', 'address', 'city', 'state', 'zip', 'phone', 'email', 'website', 'categories', 'about', 'last_confirmed_at'];
        var esc = function (x) { x = Array.isArray(x) ? x.join('; ') : (x == null ? '' : String(x)); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
        var csv = cols.join(',') + '\n' + Object.keys(ROWS).map(function (k) { var r = ROWS[k]; return cols.map(function (c) { return esc(r[c]); }).join(','); }).join('\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'compassion-catalyst-listings.csv'; document.body.appendChild(a); a.click(); a.remove();
        toast('Downloaded every listing as a spreadsheet file.');
      };
    }
    // Uploaded proof on a request
    if (v.pop && v.pop.isReq && s.pop) {
      var Q = (s.requests || []).find(function (x) { return x.id === s.pop.id; }) || {};
      var link = DOCS[Q.id];
      v.pop.docMeta = Q.hasDoc ? 'Private file · uploaded ' + Q.docDate : '';
      v.pop.docReady = !!(link && link.url); v.pop.docLoading = !link || link.loading; v.pop.docUrl = link && link.url || '';
      var getLink = function (cb) {
        if (link && link.url) return cb(link.url);
        DOCS[Q.id] = { loading: true };
        CC.sb.storage.from('claim-documents').createSignedUrl(Q.docPath, 600).then(function (r) {
          if (r.error) { DOCS[Q.id] = null; return fail(r.error); }
          DOCS[Q.id] = { url: r.data.signedUrl }; self.setState({}); if (cb) cb(r.data.signedUrl);
        });
      };
      if (Q.hasDoc && s.pop.docOpen === true && !link) getLink();
      v.pop.docFull = function () { getLink(function (u) { window.open(u, '_blank', 'noopener'); }); };
      v.pop.docDownload = function () { getLink(function (u) { var a = document.createElement('a'); a.href = u + '&download=' + encodeURIComponent(Q.docName || 'document'); a.click(); }); };
      var baseDel = v.pop.deleteDoc;
      v.pop.deleteDoc = function () {
        if (!CAN_APPROVE()) return toast('Only Owners and Admins can delete documents.');
        if (!confirm('Delete this document for good? Do this after you’ve reviewed it.')) return;
        CC.sb.storage.from('claim-documents').remove([Q.docPath]).then(function (r) { if (r.error) return fail(r.error); DOCS[Q.id] = null; baseDel(); });
      };
    }
    // Who can change the team
    if (v.teamEdit && !CAN_APPROVE()) v.teamEdit.toggle = function () { toast('Only Owners and Admins can change the team.'); };
    if (v.invite && !CAN_APPROVE()) v.invite.toggle = function () { toast('Only Owners and Admins can add people to the team.'); };
    return v;
  };

  // ---------- saving what changed ----------
  function splitAddr(s) {
    s = String(s || '').trim();
    var m = s.match(/^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/);
    if (m) return { address: m[1].trim() || null, city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] || null };
    m = s.match(/^(.*?),\s*([^,]+)$/);
    if (m) return { address: m[1].trim() || null, city: m[2].trim() };
    return { address: s || null };
  }
  function listOf(x) { return String(x || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean); }
  function formPatch(f) {
    var svc = {}, cats = [];
    Object.keys(f.svc || {}).forEach(function (k) { cats.push(k); svc[k] = String(f.svc[k] || '').split('\n').map(function (t) { return t.trim(); }).filter(Boolean); });
    var hours = (f.hours || []).map(function (h) { return String(h || '').trim(); });
    var p = Object.assign({
      name: String(f.org || '').trim(), org_type: f.type || null, faith: f.faith || null, neighborhood: f.place || null, phone: f.phone || null,
      availability: f.avail || 'Accepting', about: f.about || null, categories: cats, services: svc,
      eligibility: listOf(f.elig), cost: f.cost || null, languages: listOf(f.langs).length ? listOf(f.langs) : ['English'], what_to_bring: f.docs || null,
      hours: hours.some(Boolean) ? hours : [], is_sensitive: !!f.sensitive,
      contact_name: f.cName || null, contact_title: f.cRole || null, email: f.cEmail || null,
      website: f.website ? (/^https?:\/\//i.test(f.website) ? f.website : 'https://' + f.website) : null,
      service_area: f.area || null, county: f.county || null
    }, splitAddr(f.addr));
    if (f.st) p.state = String(f.st).trim().toUpperCase().slice(0, 2);
    var au = String(f.applyUrl || '').trim();
    if (!au) { p.apply_url = null; p.apply_mode = 'steps'; } else if (/^https?:\/\//i.test(au)) { p.apply_url = au; p.apply_mode = 'web'; }
    if (f.status && ['approved', 'pending', 'paused', 'removed'].indexOf(f.status) >= 0) p.status = f.status;
    if (!p.name) delete p.name;
    return p;
  }
  function saveOrg(orgId, patch, label) {
    if (!CAN_APPROVE()) { toast('Only Owners and Admins can change listings.'); return refresh(); }
    CC.sb.from('organizations').update(patch).eq('id', orgId).select('id').then(function (r) {
      if (r.error || !r.data || !r.data.length) { toast(r.error ? CC.msg(r.error) : 'Nothing was saved.'); return refresh(); }
      if (label) toast(label);
      CC.sb.from('organizations').select('*').eq('id', orgId).single().then(function (x) { if (x.data) { ROWS[orgId] = x.data; app.DET[orgId] = detOf(x.data); } });
    });
  }

  var baseDU = Component.prototype.componentDidUpdate;
  Component.prototype.componentDidUpdate = function (pp, ps) {
    if (baseDU) baseDU.apply(this, arguments);
    if (!ME || !ps) return;
    if (this._skipSave) { this._skipSave = false; return; }
    var s = this.state, sb = CC.sb;

    // Listings: status, Verified, assigned teammate
    if (ps.listings !== s.listings) {
      var before = {}; (ps.listings || []).forEach(function (o) { before[o.id] = o; });
      (s.listings || []).forEach(function (o) {
        var a = before[o.id]; if (!a || a === o) return;
        if (a.status !== o.status) saveOrg(o.id, { status: o.status });
        if (a.verified !== o.verified) {
          if (!CAN_APPROVE()) { toast('Only Owners and Admins can change Verified.'); refresh(); }
          else sb.rpc('set_verified', { org: o.id, is_verified: !!o.verified }).then(function (r) { if (r.error) { fail(r.error); refresh(); } });
        }
        if (a.assignee !== o.assignee) {
          if (!CAN_WORK()) { toast('Viewers can’t assign listings.'); return refresh(); }
          sb.from('organizations').update({ assigned_to: uId(o.assignee) }).eq('id', o.id).select('id').then(function (r) { if (r.error || !r.data || !r.data.length) { toast(r.error ? CC.msg(r.error) : 'Only Owners and Admins can assign listings.'); refresh(); } });
        }
      });
    }
    // Edited listing details (the "Edit listing" form)
    if (ps.det !== s.det) {
      Object.keys(s.det || {}).forEach(function (key) {
        if ((ps.det || {})[key] === s.det[key]) return;
        var parts = key.split(':'), orgId = parts[0] === 'req' ? (REQS[parts[1]] || {}).organization_id : parts[1];
        if (orgId) saveOrg(orgId, formPatch(s.det[key]));
      });
    }
    // Team updates on reports
    if (ps.reports !== s.reports) {
      var prevR = {}; (ps.reports || []).forEach(function (r) { prevR[r.id] = r; });
      (s.reports || []).forEach(function (r) {
        var a = prevR[r.id], n0 = a ? (a.updates || []).length : 0, ups = r.updates || [];
        ups.slice(n0).forEach(function (u) {
          if (u.who !== 'u1') return;
          if (!CAN_WORK()) return toast('Viewers can’t post updates.');
          sb.from('admin_notes').insert({ report_id: r.id, text: u.text }).then(function (x) { if (x.error) fail(x.error); });
        });
      });
    }
    // The team: roles, removals and new people
    if (ps.team !== s.team) {
      var now = {}; (s.team || []).forEach(function (m) { now[m.email.toLowerCase()] = m; });
      var was = {}; (ps.team || []).forEach(function (m) { was[m.email.toLowerCase()] = m; });
      var call = function (email, on, role, okMsg) {
        if (!CAN_APPROVE()) { toast('Only Owners and Admins can change the team.'); return refresh(); }
        sb.rpc('set_site_admin', { person_email: email, make_admin: on, new_role: role || 'admin' }).then(function (r) {
          if (r.error) toast(CC.msg(r.error)); else if (okMsg) toast(okMsg);
          refresh();
        });
      };
      Object.keys(was).forEach(function (k) { if (!now[k]) call(was[k].email, false, 'admin'); else if (now[k].role !== was[k].role) call(now[k].email, true, now[k].role); });
      Object.keys(now).forEach(function (k) { if (!was[k]) call(now[k].email, true, now[k].role, now[k].email + ' was added. They’ll see the Admin page next time they log in.'); });
    }
  };

  start().catch(function (e) { if (window.console) console.error(e); say('<h1 style="font-size:28px">Something went wrong</h1><p>' + CC.esc(CC.msg(e)) + '</p>'); });
})();
