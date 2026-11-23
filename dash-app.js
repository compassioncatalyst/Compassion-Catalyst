/* dash-app.js — the organization dashboard (dashboard.html).
   PART 1: the page engine (you can ignore it).
   PART 2: the dashboard screens and buttons.
   PART 3: dash-bridge — logging in, loading your organization from Supabase, and saving changes.
   No passwords or secret keys are stored in this file. */

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

/* ==========================================================================
   PART 2 — The dashboard: what each part shows and what each button does.
   (Referrals, messages and projects are kept for later and are not shown yet.)
   ========================================================================== */
class Component extends DCLogic {
  ICONS = {
    arrowLeft: ['m12 19-7-7 7-7', 'M19 12H5'],
    pointer: ['M22 14a8 8 0 0 1-8 8', 'M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2', 'M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1', 'M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10', 'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'],
    search: [['circle', { cx: 11, cy: 11, r: 8 }], 'm21 21-4.3-4.3'],
    shieldCheck: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
    shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
    phone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'],
    pin: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0', ['circle', { cx: 12, cy: 10, r: 3 }]],
    clock: [['circle', { cx: 12, cy: 12, r: 10 }], 'M12 6v6l4 2'],
    utensils: ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7'],
    home: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    zap: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
    shirt: ['M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z'],
    userCheck: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', ['circle', { cx: 9, cy: 7, r: 4 }], 'm16 11 2 2 4-4'], star: ['M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'], heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
    sprout: ['M7 20h10', 'M10 20c5.5-2.5.8-6.4 3-10', 'M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z', 'M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z'],
    bus: ['M8 6v6', 'M15 6v6', 'M2 12h19.6', 'M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3', ['circle', { cx: 7, cy: 18, r: 2 }], 'M9 18h5', ['circle', { cx: 16, cy: 18, r: 2 }]],
    briefcase: ['M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', ['rect', { x: 2, y: 6, width: 20, height: 14, rx: 2 }]],
    scale: ['m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'M7 21h10', 'M12 3v18', 'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'],
    cross: ['M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', ['circle', { cx: 9, cy: 7, r: 4 }], 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    sun: [['circle', { cx: 12, cy: 12, r: 4 }], 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
    door: ['M13 4h3a2 2 0 0 1 2 2v14', 'M2 20h3', 'M13 20h9', 'M10 12v.01', 'M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z'],
    arrow: ['M5 12h14', 'm12 5 7 7-7 7'], back: ['m15 18-6-6 6-6'], check: ['M20 6 9 17l-5-5'], x: ['M18 6 6 18', 'm6 6 12 12'],
    half: [['circle', { cx: 12, cy: 12, r: 9 }], 'M12 3v18'],
    msg: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    send: ['M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z', 'm21.854 2.147-10.94 10.939'],
    flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
    menu: ['M4 12h16', 'M4 6h16', 'M4 18h16'], filter: ['M22 3H2l8 9.46V19l4 2v-8.54L22 3z'],
    list: ['M3 12h.01', 'M3 18h.01', 'M3 6h.01', 'M8 12h13', 'M8 18h13', 'M8 6h13'],
    map: ['M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z', 'M15 5.764v15', 'M9 3.236v15'],
    info: [['circle', { cx: 12, cy: 12, r: 10 }], 'M12 16v-4', 'M12 8h.01'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
    mail: [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }], 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
    church: ['M10 9h4', 'M12 7v5', 'M14 22v-4a2 2 0 0 0-4 0v4', 'M18 22V5.618a1 1 0 0 0-.553-.894l-4.553-2.277a2 2 0 0 0-1.788 0L6.553 4.724A1 1 0 0 0 6 5.618V22', 'm18 7 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9.382a1 1 0 0 1 .553-.894L6 8'],
    plus: ['M5 12h14', 'M12 5v14'],
    gear: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', ['circle', { cx: 12, cy: 12, r: 3 }]],
    compass: [['circle', { cx: 12, cy: 12, r: 10 }], 'm16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'],
    mark: [['circle', { cx: 8.5, cy: 12, r: 6.5 }], ['circle', { cx: 15.5, cy: 12, r: 6.5 }], 'M12 8.6v6.8', 'M9.9 10.9h4.2'],
    upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
    bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
    edit: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'],
    link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    grid: [['rect', { x: 3, y: 3, width: 7, height: 7 }], ['rect', { x: 14, y: 3, width: 7, height: 7 }], ['rect', { x: 14, y: 14, width: 7, height: 7 }], ['rect', { x: 3, y: 14, width: 7, height: 7 }]],
    inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
    clip: [['rect', { x: 8, y: 2, width: 8, height: 4, rx: 1 }], 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'],
    calendar: [['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }], 'M16 2v4', 'M8 2v4', 'M3 10h18'],
    megaphone: ['m3 11 18-5v12L3 14v-3z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'],
    folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
    trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'],
    layers: ['m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z', 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65']
  };
  AV = {
    Accepting: { label: 'Accepting referrals', icon: 'check', help: 'New referrals are welcome.', style: { background: 'transparent', color: 'var(--color-text)', border: '0', padding: '0', fontSize: 14, fontWeight: 600 } },
    Limited: { label: 'Limited capacity', icon: 'half', help: 'Referrers will see that you can take a few.', style: { background: 'transparent', color: 'var(--color-text)', border: '0', padding: '0', fontSize: 14, fontWeight: 600 } },
    Waitlist: { label: 'Waitlist', icon: 'clock', help: 'Referrals still come in, marked as waitlist.', style: { background: 'transparent', color: 'var(--color-text)', border: '0', padding: '0', fontSize: 14, fontWeight: 600 } },
    Full: { label: 'Currently full', icon: 'x', help: 'You are hidden from “Accepting referrals now” results.', style: { background: 'transparent', color: 'var(--color-text)', border: '0', padding: '0', fontSize: 14, fontWeight: 600 } }
  };
  STAGE = {
    Submitted: { background: 'var(--color-accent-700)', color: 'var(--color-bg)', border: '1px solid var(--color-accent-700)' },
    Seen: { background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', border: '1px solid var(--color-accent-300)' },
    Accepted: { background: 'transparent', color: 'var(--color-accent-800)', border: '1px solid var(--color-accent-700)' },
    'In progress': { background: 'transparent', color: 'var(--color-accent-800)', border: '1px solid var(--color-accent-700)' },
    Completed: { background: 'var(--color-neutral-200)', color: 'var(--color-neutral-800)', border: '1px solid var(--color-neutral-400)' },
    Declined: { background: 'transparent', color: 'var(--color-neutral-800)', border: '1px dashed var(--color-neutral-600)' },
    Redirected: { background: 'transparent', color: 'var(--color-neutral-800)', border: '1px dashed var(--color-neutral-600)' }
  };
  chipBase = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 13, fontWeight: 500, lineHeight: 1.3, whiteSpace: 'nowrap', alignSelf: 'flex-start' };
  URG = ['Urgent — today', 'This week', 'Flexible'];

  state = Object.assign({
    screen: 'dash', navMini: true, apply: { mode: 'steps', url: '' }, w: 1200, mobilePreview: false, guideOpen: false, toast: null, modal: null, menuOpen: false,
    filters: this.blankFilters(), sort: 'relevance', view: 'list', density: 'compact', favs: ['newground', 'firehouse', 'ridgeview', 'clinic', 'magnolia', 'mpower', 'zion', 'brendan', 'unitedway', 'legal', 'career'], filtersOpen: false, loading: false, homeQ: '', homeCat: '', homeZip: '', mapSel: null,
    orgId: 'hope', verPop: false, ref: this.blankRef(), refStep: 1, refErr: {}, refSending: false, lastRef: null,
    trackIn: '', trackCode: null, trackErr: '', prefs: { email: true, text: false, app: true },
    login: { email: 'denise@hopeharbor.example', pw: '', err: '', loading: false },
    signup: { step: 1, name: '', type: 'Church', faith: 'yes', hood: '', phone: '', email: '', cats: [], services: '', serves: '', method: 'doc', fileName: '', refOrg: '', refName: '', err: {} },
    // Dashboards this account can open (sample). kind 'admin' is the site's Admin page.
    myDash: [{ id: 'hope', kind: 'org', name: 'Hope Harbor Community Pantry', role: 'Admin', status: 'Live' }, { id: 'coats', kind: 'org', name: 'Woodlawn Winter Coat Closet', role: 'Staff', status: 'Waiting for approval',
      org: { name: 'Woodlawn Winter Coat Closet', type: 'Church', faith: 'Methodist', cats: ['clothing'], hood: 'Woodlawn', addr: '5520 1st Ave N, Birmingham, AL 35212', phone: '205-555-0188', verified: false, vDate: null, updated: 'Nov 12, 2026', updN: 6, avail: 'Accepting', hours: ['Closed', 'Closed', '4–7 PM', 'Closed', 'Closed', '9 AM–12 PM', 'Closed'], open: null, mi: 1.4, langs: ['English'], cost: 'Free', elig: ['No restrictions'], docs: 'Nothing needed. One coat per person each winter.', docsTitle: '', contact: ['Front desk', 'Coat closet volunteers', ''], about: 'A winter coat closet in the fellowship hall. Neighbors pick out a warm coat, hat and gloves, with sizes for kids and adults.', services: { clothing: ['Winter coats for all ages', 'Hats, gloves and scarves'] }, partners: [], x: 64, y: 32, cap: 'Open Wednesday evenings and Saturday mornings, November to March.' } },
      { id: 'circle', kind: 'org', name: 'Eastside Recovery Circle', role: 'Admin', status: 'Not approved', org: { name: 'Eastside Recovery Circle', type: 'Nonprofit', faith: '', cats: ['recovery'], hood: 'East Lake', addr: '', phone: '205-555-0193', verified: false, vDate: null, updated: 'Nov 10, 2026', updN: 8, avail: 'Accepting', hours: ['Call for hours', 'Call for hours', 'Call for hours', 'Call for hours', 'Call for hours', 'Call for hours', 'Call for hours'], open: null, mi: 3.1, langs: ['English'], cost: 'Free', elig: ['Adults 18+'], docs: '', docsTitle: '', contact: ['Main line', '', ''], about: 'Peer support meetings for adults in recovery.', services: { recovery: ['Weekly peer support meetings'] }, partners: [], x: 70, y: 22, cap: '' } },
      { id: 'admin', kind: 'admin', name: 'Compassion Catalyst Admin', role: 'Site admin', status: '', info: '3 requests waiting for review · 1 new report' }],
    // Sample folders: two filled in, the rest of the favorites aren't in a folder
    favFolders: [{ id: 'fold-housing', name: 'Housing partners', desc: 'Who we call first when a family needs a place to stay tonight.', icon: 'home' },
      { id: 'fold-health', name: 'Health & counseling', desc: 'Clinics and counselors we refer to most.', icon: 'cross' }],
    favFolderOf: { newground: 'fold-housing', firehouse: 'fold-housing', ridgeview: 'fold-housing', clinic: 'fold-health', magnolia: 'fold-health', mpower: 'fold-health' }, favOpenFolder: null, favExpanded: {}, favShow: { firehouse: ['phone', 'addr'], zion: ['phone', 'email'] }, favAllOpen: true, favDensity: 'compact',
    pickOpen: true, pickRemember: false, autoOpen: '', curDash: 'hope',
    dashTab: 'org', selRef: null, note: '', qFilter: 'all', needF: { cat: '', urg: '', status: '' }, selThread: null, msg: '',
    invite: { email: '', role: 'Staff', err: '' },
    settings: { name: 'Denise Carter', email: 'denise@hopeharbor.example', phone: '205-555-0142', n: { reports: { email: true, text: false, app: true }, checkin: { email: true, text: false, app: true }, team: { email: true, text: false, app: true }, favs: { email: false, text: false, app: true }, digest: { email: true, text: false, app: false } }, quiet: true, p: { showContact: true, shareCase: true, suggest: true, readReceipts: true, hideAddr: false }, twoStep: false },
    profile: { hours: 'Mon–Fri 9 AM–4 PM · Wed until 7 PM · Sat 8–11 AM', services: 'Client-choice grocery pantry, weekend backpacks for kids, seasonal coat closet', capacity: 'About 40 households a day. Short wait on Wednesday evenings.', contactName: 'Denise Carter', contactRole: 'Pantry Director', contactPhone: '205-555-0101', elig: 'No restrictions. Photo ID helpful but not required.' },
    about: { name: '', email: '', msg: '', err: {}, sent: false }
  }, this.dataState(), window.CC_DASH_INIT || {});

  dataState() {
    const D = window.BBData; if (!D) return { ready: false };
    const c = x => JSON.parse(JSON.stringify(x));
    Component.PII = { r1: { first: 'Tasha', last: 'Williams', phone: '205-555-0142', addr: { mode: 'home', street: '4419 1st Ave N', apt: 'Apt 3', city: 'Birmingham', zip: '35222' } },
      r2: { first: 'Luis', last: 'Hernández', phone: '205-555-0197', addr: { mode: 'home', street: '1208 Pike Ave', apt: '', city: 'Birmingham', zip: '35215' } },
      r3: { first: 'Renee', last: 'Thomas', phone: '', addr: { mode: 'nofixed', where: 'Staying with Family Promise at the Day Center while the family finds a new apartment' } },
      r4: { first: 'Gloria', last: 'Mitchell', phone: '205-555-0110', addr: { mode: 'home', street: '5520 Georgia Rd', apt: '', city: 'Birmingham', zip: '35212' } },
      r5: { first: 'Angela', last: '', phone: '205-555-0165', safety: true, addr: { mode: 'safety' } },
      r6: { first: 'Darnell', last: 'Moore', phone: '205-555-0133', addr: { mode: 'home', street: '732 Center St S', apt: '', city: 'Birmingham', zip: '35205' } },
      r7: { first: 'Kevin', last: 'Jackson', phone: '205-555-0178', addr: { mode: 'home', street: '2301 Avenue I', apt: 'Unit 12', city: 'Birmingham', zip: '35218' } },
      r8: { first: 'Mariana', last: 'Ortega', phone: '205-555-0121', addr: { mode: 'home', street: '1615 Ensley Ave', apt: '', city: 'Birmingham', zip: '35218' } },
      r9: { first: 'Paul', last: 'Harris', phone: '205-555-0154', addr: { mode: 'home', street: '1904 Avenue E', apt: 'Apt 2B', city: 'Birmingham', zip: '35218' } },
      r10: { first: 'Denise', last: 'Greene', phone: '205-555-0189', addr: { mode: 'home', street: '617 41st St N', apt: '', city: 'Birmingham', zip: '35222' }, whoLabel: 'The Greene family' } };
    const piiOf = x => { const p = Component.PII[x.id]; if (!p) return x; return Object.assign({}, x, { first: p.first, last: p.last, phone: p.phone, addr: p.addr, safety: !!p.safety, who: p.whoLabel || [p.first, p.last].filter(Boolean).join(' ') }); };
    return { ready: true, orgs: c(D.ORGS).map(o => o.id === 'hope' ? Object.assign({}, o, { appQs: [{ id: 'q1', q: 'How many people in the household will be eating from this grocery visit?', type: 'number', min: 1, max: 20, allowRange: true, req: true, opts: '' }, { id: 'q2', q: 'Can you get to our pantry in Woodlawn, or do you need a delivery?', type: 'choice', req: true, opts: 'I can come in, I need a delivery, Not sure yet' }, { id: 'q3', q: 'Any allergies or dietary needs we should know about?', type: 'text', maxWords: 100, req: false, opts: '' }] }) : o), referrals: c(D.REFERRALS).map(piiOf), needs: c(D.NEEDS), threads: c(D.THREADS), posts: c(D.POSTS).map(p => Object.assign({ urg: { p1: 'Urgent', p2: 'Urgent', p3: 'Within a few days', p4: 'No rush' }[p.id] || 'No rush' }, p)), vols: c(D.VOLS).concat(Component.BIG_PROJECTS.map((p, n) => Component.projVol(Component.BIG_EVENTS.find(e => e.id === p[0]), p[1], p[2], p[3], p[4], p[5], p[6], p[7], n + 1))), events: c(Component.BIG_EVENTS), projs: c(Component.SEED_PROJS), todos: c(Component.SEED_TODOS), todoF: 'today', todoAll: false, projF: 'open', projSel: null, projDraft: {}, evOpen: {}, volFilter: 'all', volQty: {}, volSort: 'soonest', volWhen: 'any', volRad: 'any', volShowFull: false, volLayout: 'rows', team: c(D.TEAM), mod: c(D.MOD) };
  }
  componentDidMount() {
    this._onMsg = e => { const d = e.data || {}; if (d.coMapReady) this.sendMap(); if (d.coMapPick) this.setState({ mapSel: d.coMapPick }); };
    window.addEventListener('message', this._onMsg);
    this._onTourMove = () => { if (this.state.modal && this.state.modal.kind === 'tour') { cancelAnimationFrame(this._tourRaf); this._tourRaf = requestAnimationFrame(() => this.measureTour()); } };
    window.addEventListener('resize', this._onTourMove); window.addEventListener('scroll', this._onTourMove, true);
    const ftick = () => { const el = this._feat; if (el && el.isConnected) { const half = el.scrollWidth / 2; this._fpos = (this._fpos ?? 0) + 0.4; if (this._fpos >= half) this._fpos -= half; el.scrollLeft = this._fpos; } this._fraf = requestAnimationFrame(ftick); };
    this._fraf = requestAnimationFrame(ftick);
    if (!this.state.ready) this._poll = setInterval(() => { if (window.BBData) { clearInterval(this._poll); this.setState(this.dataState()); } }, 50);
  }
  mapFrame = el => { this._mapEl = el; };
  sendMap() { const f = this._mapEl; if (f && f.contentWindow && this._mapPins) f.contentWindow.postMessage({ coMapPins: this._mapPins, sel: this._mapSel }, '*'); }
  componentDidUpdate(pp, ps) {
    this.sendMap();
    const tm = this.state.modal, tk = tm && tm.kind === 'tour' ? 'tour' + tm.step : '';
    if (tk && (tk !== this._tourKey || !this.state.tourRect)) { this._tourKey = tk; clearTimeout(this._tourT); this._tourT = setTimeout(() => this.measureTour(), 60); }
    if (!tk) this._tourKey = '';
    const k = this.state.dashTab + '|' + this.state.selRef;
    if (k !== this._lastDashKey) { this._lastDashKey = k; const m = document.querySelector('[data-dash-main]'); if (m) m.scrollTop = 0; }
  }
  featRef = el => { this._feat = el; this._fpos = 0; };
  carRef = el => { this._car = el; this._pos = undefined; };
  nudge(d) { const el = this._car; if (!el) return; const card = el.firstElementChild; this._nudge = (this._nudge || 0) + d * ((card ? card.offsetWidth : 200) + 18); }
  componentWillUnmount() { window.removeEventListener('message', this._onMsg); cancelAnimationFrame(this._raf); cancelAnimationFrame(this._fraf); clearInterval(this._poll); clearTimeout(this._tt); this.ro && this.ro.disconnect(); }
  frameRef = el => {
    if (!el || el === this._el) return; this._el = el; this.ro && this.ro.disconnect();
    this.ro = new ResizeObserver(e => { const w = Math.round(e[0].contentRect.width); if (Math.abs(w - this.state.w) > 2) this.setState({ w }); });
    this.ro.observe(el);
  };

  blankFilters() { return { q: '', cats: [], faith: 'any', types: [], hood: '', st: '', county: '', openNow: false, accepting: false, lang: '', cost: '', elig: '' }; }
  passInfo(r) {
    const p = r.log.slice().reverse().find(l => /^Passed to /.test(l.text));
    if (!p) return { passed: false };
    const m = p.text.match(/^Passed to (.+?)(?:\s+—\s+(.*?))?\.?$/);
    const to = r.passTo && this.org(r.passTo);
    return { passed: true, passFrom: this.org(r.to).name, passTo: to ? to.name : m ? m[1] : 'another organization', passNote: m && m[2] ? 'Reason: ' + m[2].replace(/\.$/, '') + '.' : 'They will contact you directly.' };
  }
  claimNeed(n, mode, partners, cnote) { const rid = 'u' + n.id, shared = mode === 'share' && partners.length, pn = partners.map(id => (this.org(id) || {}).name).filter(Boolean); this.setState(st => ({ modal: null, needs: st.needs.map(x => x.id === n.id ? Object.assign({}, x, { status: 'Claimed', mine: true }) : x), referrals: [{ id: rid, code: 'CC-2611-' + (5000 + st.referrals.length), to: 'hope', who: n.who, cat: n.cat, urgency: n.urg, desc: n.desc, household: n.household, lang: 'English', contact: 'Through the referrer', from: n.via, when: 'Just now', stage: 'Accepted', log: [{ t: n.ago, who: n.via.split(' · ')[0], text: 'Posted to Unclaimed needs: ' + n.why }, { t: 'Just now', who: 'Denise C.', text: 'Claimed from Unclaimed needs and accepted' }].concat(shared ? [{ t: 'Just now', who: 'Denise C.', text: 'Opened a shared case with ' + pn.join(', ') + (cnote ? ' — ' + cnote : '') }] : []), shared: shared ? 'CC-C-' + (200 + st.referrals.length) : undefined }].concat(st.referrals) })); this.toast(shared ? 'Claimed and shared with ' + pn.length + (pn.length === 1 ? ' organization' : ' organizations') + '. They’ve been invited to the case.' : 'Claimed. It’s now in your referrals as Accepted, and the referrer has been told.'); }
  blankRef() { return { orgId: null, forWho: 'self', ident: 'full', first: '', last: '', phone: '', phoneUnknown: false, addrMode: 'home', street: '', apt: '', city: 'Birmingham', zip: '', where: '', noPass: false, name: '', referrer: '', refName: '', refType: 'Organization or church', refOrg: '', refContact: '', cat: '', urgency: '', desc: '', household: '1', lang: 'English', contact: 'Phone call', contactVal: '', consent: false, send: 'one' }; }

  static APPLY_URLS = {};
  static CLAIMED = ['hope', 'steelcity', 'jimmiehale', 'greenleaf', 'firstlight', 'pathways', 'interfaith', 'fellowship', 'clinic', 'legal', 'career', 'zion', 'dreamcenter', 'unitedway'];
  ic(name, size = 18) {
    const d = this.ICONS[name] || [];
    return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flex: 'none', display: 'block' } },
      d.map((p, i) => typeof p === 'string' ? React.createElement('path', { key: i, d: p }) : React.createElement(p[0], Object.assign({ key: i }, p[1]))));
  }
  get D() { return window.BBData; }
  cat(k) { return (this.D.CATS.find(c => c.k === k) || { label: k, icon: 'info' }); }
  get(path) { const [a, b] = path.split('.'); return b === undefined ? this.state[a] : (this.state[a] || {})[b]; }
  upd(path, val) { const [a, b] = path.split('.'); if (b === undefined) this.setState({ [a]: val }); else this.setState(s => ({ [a]: Object.assign({}, s[a], { [b]: val }) })); }
  bind(path) { return { v: this.get(path) ?? '', on: e => this.upd(path, e.target.type === 'checkbox' ? e.target.checked : e.target.value) }; }
  segOf(path, opts) { const v = this.get(path); return opts.map(o => { const [val, label] = Array.isArray(o) ? o : [o, o]; return { label, on: v === val, pick: () => this.upd(path, val) }; }); }
  toggleIn(path, val) { const arr = this.get(path) || []; this.upd(path, arr.includes(val) ? arr.filter(x => x !== val) : arr.concat(val)); }
  chip(on) { return { display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '6px 12px', fontSize: 14, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-divider)'), background: on ? 'var(--color-accent-700)' : 'transparent', color: on ? 'var(--color-bg)' : 'var(--color-text)', textAlign: 'left' }; }
  setState(o, cb) { const ok = ['org', 'directory', 'favs', 'dashes', 'settings', 'profile'], fix = x => { if (!x) return x; if (x.screen && x.screen !== 'dash') x = Object.assign({}, x, { screen: 'dash' }); if (x.dashTab && !ok.includes(x.dashTab)) x = Object.assign({}, x, { dashTab: 'org' }); return x; }; const now = Date.now(); if (!this._capAt || now - this._capAt > 300) this._prevState = Object.assign({}, this.state); this._capAt = now; return super.setState(typeof o === 'function' ? (st, p) => fix(o(st, p)) : fix(o), cb); }
  go(screen, extra = {}) { this.setState(Object.assign({ screen, menuOpen: false, verPop: false, filtersOpen: false }, extra)); try { window.scrollTo(0, 0); } catch (e) {} }
  static BIG_EVENTS = [
    { id: 'e1', org: 'hope', mine: true, kind: 'Event', title: 'Woodlawn Thanksgiving Outreach', place: 'Hope Harbor Community Pantry · Woodlawn', desc: 'A week of getting Thanksgiving to 250 Woodlawn families: sorting donated groceries, packing boxes, delivering to homebound neighbors, and a sit-down community dinner on Thanksgiving Day.' },
    { id: 'e2', org: 'newground', kind: 'Event', title: 'Downtown Thanksgiving Serve Days', place: 'Brother Bryan Mission · Downtown', desc: 'Two days of prep and service for the mission’s Thanksgiving meal for about 300 guests, plus a coat and blanket table.' },
    { id: 'e3', org: 'greenleaf', kind: 'Event', title: 'Angel Tree Christmas', place: 'The Salvation Army · Southside', desc: 'Sorting, wrapping, and handing out Christmas gifts for more than 1,200 children whose families signed up for Angel Tree.' },
    { id: 'e4', org: 'dreamcenter', kind: 'Event', title: 'Christmas in the City', place: 'Birmingham Dream Center · Ensley', desc: 'A neighborhood Christmas week: a toy store where parents shop for free, caroling at two senior homes, and a Christmas Eve community meal.' }
  ];
  static BIG_PROJECTS = [
    ['e1', 'Grocery sort & stock', '2026-11-21', '9 AM – 12 PM', 15, 11, 'Serve project', ['Ages 12+ with an adult']],
    ['e1', 'Thanksgiving box packing', '2026-11-23', '4 – 7 PM', 20, 9, 'Serve project', ['No experience needed']],
    ['e1', 'Box delivery drivers', '2026-11-24', '10 AM – 2 PM', 12, 4, 'Serve project', ['Valid driver’s license', 'Own vehicle']],
    ['e1', 'Community Thanksgiving dinner', '2026-11-26', '11 AM – 3 PM', 25, 18, 'Event', ['Ages 14+']],
    ['e2', 'Pie baking & meal prep', '2026-11-25', '5 – 8 PM', 10, 6, 'Serve project', ['Food handler card helpful']],
    ['e2', 'Thanksgiving meal service', '2026-11-26', '10 AM – 2 PM', 30, 21, 'Event', ['Ages 14+']],
    ['e2', 'Coat & blanket table', '2026-11-26', '10 AM – 2 PM', 6, 2, 'Donation drive', ['No experience needed']],
    ['e3', 'Angel Tree toy sorting', '2026-12-05', '9 AM – 1 PM', 30, 12, 'Serve project', ['Ages 12+']],
    ['e3', 'Gift wrapping station', '2026-12-12', '10 AM – 4 PM', 24, 7, 'Serve project', ['No experience needed']],
    ['e3', 'Family distribution day', '2026-12-17', '8 AM – 2 PM', 40, 15, 'Event', ['Lifting up to 25 lb']],
    ['e4', 'Free toy store helpers', '2026-12-19', '9 AM – 3 PM', 20, 13, 'Event', ['Background check required']],
    ['e4', 'Caroling at senior homes', '2026-12-20', '2 – 5 PM', 16, 10, 'Event', ['All ages welcome']],
    ['e4', 'Christmas Eve community meal', '2026-12-24', '4 – 8 PM', 30, 8, 'Event', ['Ages 14+']]
  ];
  static TODAY = '2026-10-28';
  static SEED_TODOS = [
    { id: 'td1', t: 'Call Tasha back about a Saturday pickup time', caseId: 'r1', who: 'Denise Carter', due: '2026-10-28', done: false },
    { id: 'td2', t: 'Line up a Spanish-speaking volunteer for Luis’s pickup', caseId: 'r2', who: 'Kevin Ortiz', due: '2026-10-28', done: false },
    { id: 'td3', t: 'Pack Mariana’s grocery box (add baby formula and diapers)', caseId: 'r8', who: 'Ruth Green', due: '2026-10-28', done: false },
    { id: 'td4', t: 'Get coat sizes for the Thomas kids from Family Promise', caseId: 'r3', who: 'Denise Carter', due: '2026-10-27', done: false },
    { id: 'td5', t: 'Check in with Gloria about Saturday morning visits', caseId: 'r4', who: 'Sam Patel', due: '2026-10-31', done: false },
    { id: 'td6', t: 'Schedule the move-in delivery with Paul', caseId: 'r9', who: 'Kevin Ortiz', due: '2026-11-02', done: false },
    { id: 'td7', t: 'Send an update to Tasha’s case manager at Greater Birmingham Ministries', caseId: 'r1', who: 'Denise Carter', due: '2026-11-04', done: false },
    { id: 'td8', t: 'Close out Darnell’s case and log the grocery order', caseId: 'r6', who: 'Denise Carter', due: '2026-10-27', done: true }
  ];
  todoData(s) {
    const me = this.state.meName || 'Denise Carter', T0 = Component.TODAY, dp = iso => Component.dParts(iso);
    const isAdmin = ((s.team || []).find(m => m.name === me) || {}).role === 'Admin';
    const all = !!s.todoAll && isAdmin;
    const projT = [];
    (s.projs || []).filter(p => p.caseId).forEach(p => (p.tasks || []).forEach(t => projT.push({ id: p.id + ':' + t.id, t: t.t, caseId: p.caseId, who: t.who || '', due: t.due || '', done: !!t.done, projId: p.id, projTitle: p.title, tid: t.id })));
    const items = (s.todos || []).concat(projT).filter(t => all || t.who === me || (!t.who && !all));
    const grp = t => t.done ? 'done' : !t.due ? 'later' : t.due <= T0 ? 'today' : 'later';
    const F = s.todoF || 'today';
    const counts = { today: items.filter(t => grp(t) === 'today').length, later: items.filter(t => grp(t) === 'later').length, done: items.filter(t => t.done).length };
    const overdueN = items.filter(t => !t.done && t.due && t.due < T0).length;
    const toggle = t => { if (t.projId) this.setState(st => ({ projs: st.projs.map(p => p.id === t.projId ? Object.assign({}, p, { tasks: p.tasks.map(x => x.id === t.tid ? Object.assign({}, x, { done: !x.done }) : x) }) : p) })); else this.setState(st => ({ todos: st.todos.map(x => x.id === t.id ? Object.assign({}, x, { done: !x.done }) : x) })); if (!t.done) this.toast('Done: ' + t.t); };
    const setWho = (t, who) => { if (t.projId) this.setState(st => ({ projs: st.projs.map(p => p.id === t.projId ? Object.assign({}, p, { tasks: p.tasks.map(x => x.id === t.tid ? Object.assign({}, x, { who }) : x) }) : p) })); else this.setState(st => ({ todos: st.todos.map(x => x.id === t.id ? Object.assign({}, x, { who }) : x) })); };
    const ini = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const list = items.filter(t => grp(t) === F || (F === 'done' && t.done)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const rows = list.map(t => { const ref = (s.referrals || []).find(x => x.id === t.caseId), over = !t.done && t.due && t.due < T0;
      return { t: t.t, done: !!t.done, tStyle: { fontSize: 16, lineHeight: 1.35, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--color-neutral-700)' : 'var(--color-text)' },
        dueLabel: !t.due ? 'No due date' : over ? 'Overdue · ' + dp(t.due).date : t.due === T0 ? 'Today' : dp(t.due).date, dueStyle: { fontSize: 13, fontWeight: over ? 700 : 500, color: over ? 'var(--color-danger, #b42318)' : t.due === T0 ? 'var(--color-accent-800)' : 'var(--color-neutral-700)', whiteSpace: 'nowrap' },
        hasCase: !!ref, caseLabel: ref ? ref.who + ' · ' + ref.code : '', openCase: () => { if (ref) this.openRef(ref.id); },
        hasProj: !!t.projId, projLabel: t.projTitle || '', openProj: () => this.setState({ dashTab: 'projects', projSel: t.projId, projDraft: {} }),
        who: t.who || 'Unassigned', ini: ini(t.who || '?'), showWho: all, whoSel: { v: t.who || '', on: e => setWho(t, e.target.value) },
        toggle: () => toggle(t), canRemove: !t.projId, remove: () => { this.setState(st => ({ todos: st.todos.filter(x => x.id !== t.id) })); this.toast('To-do removed.'); } }; });
    return { rows, empty: !rows.length, emptyText: F === 'today' ? 'Nothing due today. Nice work.' : F === 'later' ? 'Nothing coming up yet.' : 'No finished to-dos yet.',
      seg: [['today', 'Today' + (counts.today ? ' (' + counts.today + ')' : '')], ['later', 'Upcoming' + (counts.later ? ' (' + counts.later + ')' : '')], ['done', 'Done']].map(([k, label]) => ({ label, on: F === k, pick: () => this.setState({ todoF: k }) })),
      isAdmin, viewSeg: [[false, 'My to-dos'], [true, 'Whole team']].map(([k, label]) => ({ label, on: all === k, pick: () => this.setState({ todoAll: k }) })),
      summary: overdueN ? overdueN + ' overdue' : (counts.today ? counts.today + ' due today' : 'All caught up today'), hasOverdue: overdueN > 0, staff: (s.team || []).map(m => m.name),
      add: () => this.modal({ kind: 'todoNew', tdT: '', tdCase: '', tdWho: me, tdDue: T0 }) };
  }
  static dParts(iso) {
    if (!iso) return { date: 'Date not set', mo: '', day: '—', wd: '' };
    const d = new Date(iso + 'T12:00:00'), MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return { date: WD[d.getDay()] + ', ' + MO[d.getMonth()] + ' ' + d.getDate(), mo: MO[d.getMonth()], day: String(d.getDate()), wd: WD[d.getDay()] };
  }
  static nowLabel() { const d = new Date(), MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return MO[d.getMonth()] + ' ' + d.getDate() + ', ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap; }
  static SEED_PROJS = [
    { id: 'pr1', kind: 'Volunteer project', title: 'Thanksgiving box packing', iso: '2026-11-21', endIso: '', time: '9 AM – 1 PM', place: 'Hope Harbor warehouse · Woodlawn', desc: 'Pack 300 Thanksgiving boxes (turkey, sides, and pie) for families on our pantry list, then stage them by pickup time.', status: 'Active', priority: 'High', lead: 'Denise Carter', need: 25, have: 18, vid: null,
      team: [{ name: 'Denise Carter', role: 'Project lead' }, { name: 'Kevin Ortiz', role: 'Logistics and truck pickup' }, { name: 'Sam Patel', role: 'Volunteer captain' }],
      tasks: [{ id: 't1', t: 'Confirm turkey pickup with the food bank', who: 'Kevin Ortiz', due: '2026-11-16', done: true }, { id: 't2', t: 'Print box labels and pickup slips', who: 'Ruth Green', due: '2026-11-18', done: false }, { id: 't3', t: 'Recruit 7 more volunteers', who: 'Sam Patel', due: '2026-11-19', done: false }, { id: 't4', t: 'Set up packing tables the night before', who: 'Kevin Ortiz', due: '2026-11-20', done: false }],
      notes: [{ id: 'n1', by: 'Kevin Ortiz', when: 'Nov 3, 4:10 PM', text: 'Food bank can deliver the turkeys Friday the 20th after 2 PM. They need a loading dock contact.' }, { id: 'n2', by: 'Denise Carter', when: 'Nov 1, 9:32 AM', text: 'Christ Health Center offered 40 bags of fresh produce. Add a produce station at the end of the line.' }],
      supplies: [{ id: 's1', item: 'Boxes', need: 300, have: 220 }, { id: 's2', item: 'Turkeys', need: 300, have: 180 }, { id: 's3', item: 'Pies', need: 300, have: 95 }, { id: 's4', item: 'Packing tape (rolls)', need: 20, have: 20 }],
      partners: ['newground', 'greenleaf'], budget: { planned: '1800', spent: '1140' },
      log: [{ when: 'Nov 3, 4:10 PM', by: 'Kevin Ortiz', text: 'Added a note' }, { when: 'Nov 2, 11:05 AM', by: 'Kevin Ortiz', text: 'Completed task: Confirm turkey pickup with the food bank' }, { when: 'Oct 28, 2:00 PM', by: 'Denise Carter', text: 'Project created' }] },
    { id: 'pr2', kind: 'Volunteer project', title: 'Winter coat drive sorting', iso: '2026-12-05', endIso: '2026-12-06', time: '10 AM – 3 PM', place: 'Hope Harbor fellowship hall · Woodlawn', desc: 'Sort donated coats by size, check for damage, and hang them on racks for the December 12 giveaway.', status: 'Planning', priority: 'Normal', lead: 'Ruth Green', need: 12, have: 3, vid: null,
      team: [{ name: 'Ruth Green', role: 'Project lead' }, { name: 'Sam Patel', role: 'Volunteer sign-ups' }],
      tasks: [{ id: 't1', t: 'Borrow 6 clothing racks', who: 'Ruth Green', due: '2026-11-30', done: false }, { id: 't2', t: 'Make size signs (kids, adult S–XXL)', who: '', due: '', done: false }],
      notes: [{ id: 'n1', by: 'Ruth Green', when: 'Nov 4, 1:20 PM', text: 'About 180 coats collected so far. Kids sizes 6–10 are running short.' }],
      supplies: [{ id: 's1', item: 'Clothing racks', need: 6, have: 2 }, { id: 's2', item: 'Hangers', need: 300, have: 140 }],
      partners: ['ridgeview'], budget: { planned: '250', spent: '40' },
      log: [{ when: 'Nov 4, 1:20 PM', by: 'Ruth Green', text: 'Added a note' }, { when: 'Nov 2, 3:45 PM', by: 'Ruth Green', text: 'Project created' }] },
    { id: 'pr3', kind: 'Volunteer project', title: 'Community garden fall cleanup', iso: '2026-11-14', endIso: '', time: '8 AM – 12 PM', place: 'Woodlawn community garden', desc: 'Pull summer beds, spread compost, and plant collards and onions for the spring pantry harvest.', status: 'Active', priority: 'Normal', lead: 'Kevin Ortiz', need: 10, have: 10, vid: null,
      team: [{ name: 'Kevin Ortiz', role: 'Project lead' }],
      tasks: [{ id: 't1', t: 'Order 2 yards of compost', who: 'Kevin Ortiz', due: '2026-11-10', done: true }, { id: 't2', t: 'Bring gloves and rakes from storage', who: 'Kevin Ortiz', due: '2026-11-13', done: false }],
      notes: [], supplies: [{ id: 's1', item: 'Work gloves (pairs)', need: 12, have: 12 }], partners: [], budget: { planned: '300', spent: '210' },
      log: [{ when: 'Nov 5, 8:15 AM', by: 'Kevin Ortiz', text: 'Completed task: Order 2 yards of compost' }, { when: 'Oct 30, 10:00 AM', by: 'Kevin Ortiz', text: 'Project created' }] },
    { id: 'pr4', kind: 'Volunteer project', title: 'Back-to-school backpack giveaway', iso: '2026-08-08', endIso: '', time: '9 AM – 12 PM', place: 'Hope Harbor parking lot · Woodlawn', desc: 'Filled and handed out 220 backpacks with school supplies to kids from pantry families.', status: 'Completed', priority: 'Normal', lead: 'Denise Carter', need: 20, have: 22, vid: null,
      team: [{ name: 'Denise Carter', role: 'Project lead' }, { name: 'Ruth Green', role: 'Supply drive' }, { name: 'Sam Patel', role: 'Volunteer captain' }],
      tasks: [{ id: 't1', t: 'Collect supply donations', who: 'Ruth Green', due: '2026-07-31', done: true }, { id: 't2', t: 'Fill backpacks', who: 'Sam Patel', due: '2026-08-07', done: true }],
      notes: [{ id: 'n1', by: 'Denise Carter', when: 'Aug 9, 10:00 AM', text: 'Gave out 220 backpacks. Next year order 40 more for middle schoolers.' }],
      supplies: [{ id: 's1', item: 'Backpacks', need: 220, have: 220 }], partners: ['greenleaf'], budget: { planned: '2000', spent: '1875' },
      log: [{ when: 'Aug 9, 10:05 AM', by: 'Denise Carter', text: 'Marked complete' }] },
    { id: 'pr5', kind: 'Case project', caseId: 'r9', title: 'Move-in starter kit for Paul', iso: '2026-11-12', endIso: '', time: '2 – 4 PM', place: 'Delivery to client’s new apartment · Ensley', desc: 'Paul was just housed after two years without a home. Put together a starter pantry, cleaning supplies, and basic kitchen items, then deliver and help unpack.', status: 'Active', priority: 'High', lead: 'Kevin Ortiz', need: 3, have: 2, vid: null,
      team: [{ name: 'Kevin Ortiz', role: 'Project lead · delivery' }, { name: 'Ruth Green', role: 'Shopping list and supplies' }],
      tasks: [{ id: 't1', t: 'Call Paul to confirm delivery window', who: 'Kevin Ortiz', due: '2026-11-09', done: true }, { id: 't2', t: 'Pack staples box (rice, beans, oil, canned goods)', who: 'Ruth Green', due: '2026-11-11', done: false }, { id: 't3', t: 'Pick up donated pots and pans from Family Promise', who: 'Kevin Ortiz', due: '2026-11-11', done: false }],
      notes: [{ id: 'n1', by: 'Kevin Ortiz', when: 'Nov 5, 3:30 PM', text: 'Paul has a stove but no microwave. Prefers afternoon delivery. Second-floor unit, no elevator.' }],
      supplies: [{ id: 's1', item: 'Staples box', need: 1, have: 0 }, { id: 's2', item: 'Pot and pan set', need: 1, have: 1 }, { id: 's3', item: 'Cleaning supply kit', need: 1, have: 0 }, { id: 's4', item: 'Dish set (4 place settings)', need: 1, have: 0 }],
      partners: ['ridgeview'], budget: { planned: '150', spent: '62' },
      log: [{ when: 'Nov 5, 3:30 PM', by: 'Kevin Ortiz', text: 'Added a note' }, { when: 'Nov 5, 3:10 PM', by: 'Kevin Ortiz', text: 'Completed task: Call Paul to confirm delivery window' }, { when: 'Nov 4, 10:00 AM', by: 'Kevin Ortiz', text: 'Project created from case CC-2611-4803' }] },
    { id: 'pr6', kind: 'Case project', caseId: 'r10', title: 'Weekly grocery boxes · Greene family', iso: '2026-11-06', endIso: '2026-12-31', time: 'Fridays, 3 – 5 PM pickup', place: 'Hope Harbor Community Pantry · Woodlawn', desc: 'Family of five on a reduced income. Pack a grocery box every Friday through the end of the year, with extra produce for the kids. Holiday boxes the weeks of Thanksgiving and Christmas.', status: 'Active', priority: 'Normal', lead: 'Ruth Green', need: 2, have: 2, vid: null,
      team: [{ name: 'Ruth Green', role: 'Project lead · weekly packing' }, { name: 'Sam Patel', role: 'Backup packer' }],
      tasks: [{ id: 't1', t: 'Box 1 · Nov 6', who: 'Ruth Green', due: '2026-11-06', done: true }, { id: 't2', t: 'Box 2 · Nov 13', who: 'Ruth Green', due: '2026-11-13', done: false }, { id: 't3', t: 'Box 3 · Nov 20 (Thanksgiving box)', who: 'Sam Patel', due: '2026-11-20', done: false }, { id: 't4', t: 'Box 4 · Nov 27', who: 'Ruth Green', due: '2026-11-27', done: false }, { id: 't5', t: 'Check in with the family about December needs', who: 'Ruth Green', due: '2026-11-30', done: false }],
      notes: [{ id: 'n1', by: 'Ruth Green', when: 'Nov 6, 4:45 PM', text: 'Mrs. Greene picked up box 1. Youngest has a peanut allergy, so no peanut butter in future boxes.' }],
      supplies: [{ id: 's1', item: 'Weekly boxes packed', need: 8, have: 1 }], partners: [], budget: { planned: '480', spent: '60' },
      log: [{ when: 'Nov 6, 4:45 PM', by: 'Ruth Green', text: 'Added a note' }, { when: 'Nov 6, 4:40 PM', by: 'Ruth Green', text: 'Completed task: Box 1 · Nov 6' }, { when: 'Nov 2, 9:00 AM', by: 'Ruth Green', text: 'Project created from case CC-2611-4791' }] },
    { id: 'pr7', kind: 'Case project', caseId: 'r7', title: 'Work-ready kit for Kevin J.', iso: '2026-11-08', endIso: '', time: 'By Sunday evening', place: 'Pickup at Hope Harbor · Woodlawn', desc: 'Kevin starts a warehouse job Monday. Find steel-toe boots (size 11), two pairs of work pants, and a lunch box so he is ready for day one.', status: 'Planning', priority: 'High', lead: 'Denise Carter', need: 1, have: 0, vid: null,
      team: [{ name: 'Denise Carter', role: 'Project lead' }],
      tasks: [{ id: 't1', t: 'Ask The Salvation Army about work boots in size 11', who: 'Denise Carter', due: '2026-11-07', done: false }, { id: 't2', t: 'Text Kevin a pickup time', who: 'Denise Carter', due: '2026-11-07', done: false }],
      notes: [], supplies: [{ id: 's1', item: 'Steel-toe boots, size 11', need: 1, have: 0 }, { id: 's2', item: 'Work pants (34x32)', need: 2, have: 1 }, { id: 's3', item: 'Lunch box', need: 1, have: 1 }],
      partners: ['greenleaf'], budget: { planned: '120', spent: '0' },
      log: [{ when: 'Nov 6, 9:20 AM', by: 'Denise Carter', text: 'Project created from case CC-2611-4824' }] }
  ];
  pager(list, key, size) {
    const s = this.state, N = Math.ceil(list.length / size), p = Math.min(s[key] || 0, Math.max(0, N - 1)), a = p * size;
    const btn = on => ({ width: 40, height: 40, display: 'inline-grid', placeItems: 'center', padding: 0, border: '1px solid var(--color-neutral-400)', background: 'var(--color-bg)', color: on ? 'var(--color-accent-700)' : 'var(--color-neutral-500)', cursor: on ? 'pointer' : 'not-allowed', opacity: on ? 1 : .5 });
    return { items: list.slice(a, a + size), show: N > 1, label: list.length ? 'Showing ' + (a + 1) + '–' + Math.min(a + size, list.length) + ' of ' + list.length : '', page: 'Page ' + (p + 1) + ' of ' + Math.max(1, N), prevDis: p === 0, nextDis: p >= N - 1, prevStyle: btn(p > 0), nextStyle: btn(p < N - 1),
      prev: () => { if (p > 0) this.setState({ [key]: p - 1 }); }, next: () => { if (p < N - 1) this.setState({ [key]: p + 1 }); } };
  }
  editVol(v) {
    const SKL = ['No experience needed', 'Lifting up to 25 lb', 'Spanish speaking', 'Driver with own vehicle', 'Cooking / food handler card', 'Childcare experience', 'Medical or nursing', 'Tutoring', 'Carpentry / repairs', 'Tech help', 'Event setup'];
    const AGES = ['Ages 12+ with an adult', 'Ages 14+', 'Ages 16+', 'Adults only (18+)'], sk = v.skills || [], kind = String(v.kind || '');
    const sub = v.sub || (kind.includes(' · ') ? kind.split(' · ')[1] : (['Ongoing', 'Skilled help', 'Donation drive'].includes(kind) ? kind : ''));
    this.modal({ kind: 'volPost', editId: v.id, vKind: kind.startsWith('Serve project') ? 'Serve project' : 'Event', vSub: sub, vSkillDesc: v.skillDesc || '', vTitle: v.title, vIso: v.iso, vTime: v.time || '', vPlace: v.place || '', vNeed: String(v.need || ''), vDesc: v.descRaw != null ? v.descRaw : (v.desc || ''),
      vSkills: sk.filter(x => SKL.includes(x)), vOther: sk.filter(x => !SKL.includes(x) && !AGES.includes(x) && x !== 'Background check required').join(', '), vAge: sk.find(x => AGES.includes(x)) || 'All ages', vBg: sk.includes('Background check required'), vRecurring: !!v.recurring, vContact: v.contact || 'Denise Carter · denise@hopeharbor.example' });
  }
  projForm(p, kind, caseId, extra) {
    this.modal(p ? { kind: 'projForm', pKind: p.kind || 'Volunteer project', pCase: p.caseId || '', editId: p.id, pTitle: p.title, pIso: p.iso, pEnd: p.endIso || '', pTime: p.time || '', pPlace: p.place || '', pDesc: p.desc || '', pNeed: String(p.need || ''), pLead: p.lead || '', pStatus: p.status, pPri: p.priority || 'Normal', pTeam: JSON.parse(JSON.stringify(p.team || [])), pTasks: JSON.parse(JSON.stringify(p.tasks || [])), pSup: JSON.parse(JSON.stringify(p.supplies || [])), pPartners: (p.partners || []).slice(), pPlanned: (p.budget || {}).planned || '', pSpent: (p.budget || {}).spent || '', pNotes: JSON.parse(JSON.stringify(p.notes || [])) }
      : Object.assign({ kind: 'projForm', pKind: kind || 'Volunteer project', pCase: caseId || '', pTitle: '', pIso: '', pEnd: '', pTime: '', pPlace: 'Hope Harbor Community Pantry · Woodlawn', pDesc: '', pNeed: '', pLead: 'Denise Carter', pStatus: 'Planning', pPri: 'Normal', pTeam: [{ name: 'Denise Carter', role: 'Project lead' }], pTasks: [], pSup: [], pPartners: [], pPlanned: '', pSpent: '', pNotes: [], pEvent: '' }, extra || {}));
  }
  projData(s) {
    const P = s.projs || [], F = s.projF || 'open', dp = iso => Component.dParts(iso);
    const ST = { Planning: { background: 'var(--color-accent-100)', color: 'var(--color-accent-900)', border: '1px solid var(--color-accent-300)' }, Active: { background: 'var(--color-accent-700)', color: 'var(--color-bg)', border: '1px solid var(--color-accent-700)' }, 'On hold': { background: 'var(--color-neutral-200)', color: 'var(--color-neutral-800)', border: '1px solid var(--color-neutral-400)' }, Completed: { background: 'transparent', color: 'var(--color-neutral-700)', border: '1px dashed var(--color-neutral-500)' } };
    const tagS = st => Object.assign({ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }, ST[st] || ST.Planning);
    const bar = h => ({ display: 'block', height: h || 6, background: 'var(--color-neutral-300)', position: 'relative', overflow: 'hidden' });
    const fill = (pct, done, ok) => ({ display: 'block', position: 'absolute', inset: 0, width: Math.min(100, pct) + '%', background: ok ? 'var(--color-success, #2f8f4e)' : done ? 'var(--color-neutral-600)' : 'var(--color-accent-700)' });
    const okS = ok => ok ? { color: 'var(--color-success, #2f8f4e)', fontWeight: 600 } : { color: 'var(--color-neutral-700)' };
    const range = p => dp(p.iso).date + (p.endIso && p.endIso !== p.iso ? ' – ' + dp(p.endIso).date : '');
    const list = P.filter(p => F === 'all' || (F === 'case' ? p.kind === 'Case project' : F === 'done' ? p.status === 'Completed' : p.status !== 'Completed')).slice().sort((a, b) => F === 'done' ? b.iso.localeCompare(a.iso) : a.iso.localeCompare(b.iso));
    const pg = this.pager(list, 'projPg', 5);
    const rows = pg.items.map(p => { const d = dp(p.iso), need = +p.need || 0, have = Math.min(+p.have || 0, need), pct = need ? Math.round(have / need * 100) : 0, tk = p.tasks || [], td = tk.filter(t => t.done).length;
      const cr = p.caseId ? (s.referrals || []).find(x => x.id === p.caseId) : null;
      return { id: p.id, isCase: !!cr, caseTag: cr ? 'Case · ' + cr.who : '', mo: d.mo, day: d.day, title: p.title, status: p.status, statusStyle: tagS(p.status), kind: p.kind || 'Volunteer project', date: range(p), time: p.time || 'Time not set', have, need, hasNeed: need > 0,
        leftLabel: need ? (need - have > 0 ? (need - have) + ' still needed' : 'Fully staffed') : '', bar: bar(6), fill: fill(pct, have >= need, need > 0 && have >= need), leftStyle: okS(need > 0 && have >= need), meta: (p.team || []).length + ' on team · ' + (tk.length ? td + ' of ' + tk.length + ' tasks done' : 'No tasks yet'),
        open: () => { this.setState({ projSel: p.id, projDraft: {} }); try { const m = document.querySelector('[data-dash-main]'); if (m) m.scrollTop = 0; } catch (e) {} } }; });
    const myEv = (s.events || []).filter(e => e.mine);
    const evRows = F !== 'events' ? [] : myEv.map(e => { const ps = (s.vols || []).filter(v => v.event === e.id).sort((a, b) => a.iso.localeCompare(b.iso)), need = ps.reduce((n, v) => n + v.need, 0), have = ps.reduce((n, v) => n + Math.min(v.have, v.need), 0), f = ps[0], l = ps[ps.length - 1];
      return { iso: f ? f.iso : '', title: e.title, mo: f ? (f.mo === l.mo ? f.mo : f.mo + '–' + l.mo) : '', day: f ? (f.iso === l.iso ? f.day : f.day + '–' + l.day) : '—', dayStyle: { fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: f && f.iso !== l.iso ? 20 : 26, whiteSpace: 'nowrap', lineHeight: 1.1 }, dateRange: f ? (f.date === l.date ? f.date : f.date + ' – ' + l.date) : 'No dates yet', place: e.place || '', projectsLabel: ps.length + (ps.length === 1 ? ' project' : ' projects') + ' included', have, need, leftLabel: need - have > 0 ? (need - have) + ' still needed' : 'Full', bar: bar(6), fill: fill(need ? Math.round(have / need * 100) : 0, need && have >= need), open: () => this.modal({ kind: 'evView', eid: e.id }) }; }).sort((a, b) => a.iso.localeCompare(b.iso));
    const cn = { open: P.filter(p => p.status !== 'Completed').length, done: P.filter(p => p.status === 'Completed').length };
    const isEv = F === 'events';
    const out = { rows: isEv ? [] : rows, evRows, isEv, evEmpty: isEv && !evRows.length, newEvent: () => this.modal({ kind: 'event', fromProj: true, evTitle: '', evPlace: 'Hope Harbor Community Pantry · Woodlawn', evDesc: '', projects: [{ title: '', iso: '', time: '', need: '' }, { title: '', iso: '', time: '', need: '' }] }), pager: isEv ? { show: false } : pg, empty: !isEv && !rows.length, emptyText: F === 'case' ? 'No case projects yet. Use “New project” and choose Case project.' : F === 'done' ? 'No completed projects yet.' : 'No open projects. Start one with “New project”.', summary: cn.open + ' open · ' + cn.done + ' completed',
      seg: [['open', 'Open (' + cn.open + ')'], ['case', 'Case projects (' + P.filter(p => p.kind === 'Case project').length + ')'], ['events', 'Big events (' + myEv.length + ')'], ['done', 'Completed (' + cn.done + ')'], ['all', 'All']].map(([k, label]) => ({ label, on: F === k, pick: () => this.setState({ projF: k, projPg: 0 }) })),
      newProj: () => this.projForm(null), listView: true, has: false, sel: {} };
    const p = P.find(x => x.id === s.projSel); if (!p) return out;
    out.listView = false; out.has = true;
    const Dr = s.projDraft || {}, d = dp(p.iso), me = 'Denise Carter';
    const setP = (patch, log) => this.setState(st => ({ projs: st.projs.map(x => x.id === p.id ? Object.assign({}, x, typeof patch === 'function' ? patch(x) : patch, log ? { log: [{ when: Component.nowLabel(), by: me, text: log }].concat(x.log || []) } : {}) : x) }));
    const setD = o => this.setState(st => ({ projDraft: Object.assign({}, st.projDraft, o) }));
    const bd = k => ({ v: Dr[k] == null ? '' : Dr[k], on: e => setD({ [k]: e.target.value, err: '' }) });
    const ini = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const need = +p.need || 0, have = +p.have || 0, pct = need ? Math.round(Math.min(have, need) / need * 100) : 0;
    const tk = p.tasks || [], td = tk.filter(t => t.done).length, team = p.team || [], names = team.map(m => m.name);
    const avail = (s.team || []).filter(m => !names.includes(m.name)).map(m => m.name);
    const orgsAvail = s.orgs.filter(o => o.id !== 'hope' && !(p.partners || []).includes(o.id)).map(o => ({ id: o.id, name: o.name }));
    const vol = p.vid ? (s.vols || []).find(v => v.id === p.vid) : null;
    const B = p.budget || {}, plan = +B.planned || 0, spent = +B.spent || 0, rem = plan - spent;
    const money = n => '$' + Math.abs(n).toLocaleString();
    const err = Dr.err || '', errAt = Dr.errAt || '';
    const cref = p.caseId ? (s.referrals || []).find(x => x.id === p.caseId) : null;
    out.sel = {
      back: () => this.setState({ projSel: null }),
      isCase: !!cref, caseCode: cref ? cref.code : '', caseWho: cref ? cref.who : '', caseCat: cref ? this.cat(cref.cat).label : '', caseStage: cref ? cref.stage : '', caseDesc: cref ? cref.desc : '', caseMeta: cref ? 'Household of ' + cref.household + ' · ' + cref.lang + ' · prefers ' + String(cref.contact || '').toLowerCase() + ' · referred by ' + cref.from : '',
      openCase: () => { if (cref) this.openRef(cref.id); },
      title: p.title, kind: p.kind || 'Volunteer project', mo: d.mo, day: d.day, dateLabel: range(p), time: p.time || 'Time not set', place: p.place || 'Location not set', desc: p.desc || 'No description yet. Use “Edit details” to add one.',
      status: p.status, statusStyle: tagS(p.status), priority: (p.priority || 'Normal') + ' priority', priHigh: p.priority === 'High', lead: p.lead || 'No lead yet',
      statusSeg: ['Planning', 'Active', 'On hold', 'Completed'].map(k => ({ label: k, on: p.status === k, pick: () => setP({ status: k }, 'Status changed to ' + k) })),
      edit: () => this.projForm(p),
      hasVol: !!vol, noVol: !vol, volTitle: vol ? vol.title : '', volLabel: vol ? Math.min(vol.have, vol.need) + ' of ' + vol.need + ' signed up' : '',
      viewVol: () => { if (vol) this.modal({ kind: 'volView', vid: vol.id }); },
      postVol: () => this.modal({ kind: 'volPost', vKind: 'Serve project', vTitle: p.title, vIso: p.iso, vTime: p.time || '', vPlace: p.place || '', vNeed: String(Math.max(1, need - have) || ''), vDesc: p.desc || '', vSkills: [], vOther: '', vAge: 'All ages', vBg: false, vRecurring: false, vContact: me + ' · denise@hopeharbor.example', linkProj: p.id }),
      completeLabel: p.status === 'Completed' ? 'Reopen project' : 'Mark complete', complete: () => setP({ status: p.status === 'Completed' ? 'Active' : 'Completed' }, p.status === 'Completed' ? 'Project reopened' : 'Marked complete'),
      dup: () => { const id = 'pr' + Date.now(); this.setState(st => ({ projs: [Object.assign(JSON.parse(JSON.stringify(p)), { id, title: p.title + ' (copy)', status: 'Planning', have: 0, vid: null, notes: [], tasks: tk.map(t => Object.assign({}, t, { done: false })), supplies: (p.supplies || []).map(u => Object.assign({}, u, { have: 0 })), budget: { planned: B.planned || '', spent: '' }, log: [{ when: Component.nowLabel(), by: me, text: 'Project created from “' + p.title + '”' }] })].concat(st.projs), projSel: id, projDraft: {} })); this.toast('Project duplicated.'); },
      del: () => { this.setState(st => ({ projs: st.projs.filter(x => x.id !== p.id), projSel: null })); this.toast('“' + p.title + '” deleted.'); },
      details: [['Date', range(p)], ['Time', p.time || 'Not set'], ['Where', p.place || 'Not set'], ['Project lead', p.lead || 'Not set'], ['Priority', p.priority || 'Normal'], ['Volunteers needed', need ? String(need) : 'Not set']].map(([k, v]) => ({ k, v })),
      volsLabel: Math.min(have, need) + ' of ' + need + ' volunteers', volsLeft: need ? (need - have > 0 ? (need - have) + ' still needed' : 'Fully staffed') : 'Set how many you need in Edit details', bar: bar(8), fill: fill(pct, need && have >= need, need > 0 && have >= need), volsLeftStyle: okS(need > 0 && have >= need),
      haveIn: { v: String(have), on: e => setP({ have: Math.max(0, +e.target.value || 0) }) },
      team: team.map(m => ({ name: m.name, role: m.role || 'Team member', ini: ini(m.name), isLead: m.name === p.lead, notLead: m.name !== p.lead,
        makeLead: () => setP({ lead: m.name }, m.name + ' is now the project lead'),
        remove: () => setP(x => ({ team: x.team.filter(y => y.name !== m.name), lead: x.lead === m.name ? '' : x.lead, tasks: (x.tasks || []).map(t => t.who === m.name ? Object.assign({}, t, { who: '' }) : t) }), m.name + ' removed from the team') })),
      teamN: team.length, teamEmpty: !team.length, memOpts: avail, hasMemOpts: avail.length > 0, allOnTeam: !avail.length, mem: { v: Dr.mem || avail[0] || '', on: e => setD({ mem: e.target.value }) }, role: bd('role'),
      addMem: () => { const n = Dr.mem && avail.includes(Dr.mem) ? Dr.mem : avail[0]; if (!n) return; setP(x => ({ team: (x.team || []).concat({ name: n, role: (Dr.role || '').trim() || 'Team member' }) }), n + ' added to the team'); setD({ mem: '', role: '' }); },
      tasks: tk.map(t => ({ t: t.t, done: !!t.done, meta: [t.who, t.due ? 'Due ' + dp(t.due).date : ''].filter(Boolean).join(' · '), hasMeta: !!(t.who || t.due), tStyle: { fontSize: 16, lineHeight: 1.35, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--color-neutral-700)' : 'var(--color-text)' },
        toggle: () => setP(x => ({ tasks: x.tasks.map(y => y.id === t.id ? Object.assign({}, y, { done: !y.done }) : y) }), (t.done ? 'Reopened task: ' : 'Completed task: ') + t.t),
        remove: () => setP(x => ({ tasks: x.tasks.filter(y => y.id !== t.id) }), 'Removed task: ' + t.t) })),
      tasksLabel: td + ' of ' + tk.length + ' done', tasksEmpty: !tk.length, taskBar: bar(6), taskFill: fill(tk.length ? Math.round(td / tk.length * 100) : 0, false),
      task: bd('task'), taskWho: bd('taskWho'), taskDue: bd('taskDue'), whoOpts: names,
      addTask: () => { const t = (Dr.task || '').trim(); if (!t) return setD({ err: 'Write the task first.', errAt: 'task' }); setP(x => ({ tasks: (x.tasks || []).concat({ id: 't' + Date.now(), t, who: Dr.taskWho || '', due: Dr.taskDue || '', done: false }) }), 'Added task: ' + t); setD({ task: '', taskWho: '', taskDue: '' }); },
      taskErr: errAt === 'task' ? err : '', hasTaskErr: errAt === 'task' && !!err,
      notes: (p.notes || []).map(n => ({ by: n.by, ini: ini(n.by), when: n.when, text: n.text, remove: () => setP(x => ({ notes: x.notes.filter(y => y.id !== n.id) }), 'Deleted a note') })), notesEmpty: !(p.notes || []).length, notesN: (p.notes || []).length,
      note: bd('note'), addNote: () => { const t = (Dr.note || '').trim(); if (!t) return setD({ err: 'Write a note first.', errAt: 'note' }); setP(x => ({ notes: [{ id: 'n' + Date.now(), by: me, when: Component.nowLabel(), text: t }].concat(x.notes || []) }), 'Added a note'); setD({ note: '' }); },
      noteErr: errAt === 'note' ? err : '', hasNoteErr: errAt === 'note' && !!err,
      sup: (p.supplies || []).map(u => { const n = +u.need || 0, h = +u.have || 0; return { item: u.item, needLabel: 'of ' + n, left: n - h > 0 ? (n - h) + ' still needed' : 'All in', bar: bar(6), fill: fill(n ? Math.round(Math.min(h, n) / n * 100) : 0, h >= n),
        have: { v: String(h), on: e => setP(x => ({ supplies: x.supplies.map(y => y.id === u.id ? Object.assign({}, y, { have: Math.max(0, +e.target.value || 0) }) : y) })) },
        remove: () => setP(x => ({ supplies: x.supplies.filter(y => y.id !== u.id) }), 'Removed supply: ' + u.item) }; }),
      supEmpty: !(p.supplies || []).length, supItem: bd('supItem'), supQty: bd('supQty'),
      addSup: () => { const it = (Dr.supItem || '').trim(), q = +Dr.supQty; if (!it || !(q > 0)) return setD({ err: 'Add the item and how many you need.', errAt: 'sup' }); setP(x => ({ supplies: (x.supplies || []).concat({ id: 's' + Date.now(), item: it, need: q, have: 0 }) }), 'Added supply: ' + it); setD({ supItem: '', supQty: '' }); },
      supErr: errAt === 'sup' ? err : '', hasSupErr: errAt === 'sup' && !!err,
      partners: (p.partners || []).map(id => { const o = this.org(id), nm = o ? o.name : id; return { name: nm, remove: () => setP(x => ({ partners: x.partners.filter(y => y !== id) }), nm + ' removed as a partner') }; }),
      partnersEmpty: !(p.partners || []).length, orgOpts: orgsAvail, hasOrgOpts: orgsAvail.length > 0, partner: { v: Dr.partner || (orgsAvail[0] || {}).id || '', on: e => setD({ partner: e.target.value }) },
      addPartner: () => { const id = Dr.partner && orgsAvail.some(o => o.id === Dr.partner) ? Dr.partner : (orgsAvail[0] || {}).id; if (!id) return; const o = this.org(id); setP(x => ({ partners: (x.partners || []).concat(id) }), (o ? o.name : id) + ' added as a partner'); setD({ partner: '' }); },
      planned: { v: B.planned == null ? '' : String(B.planned), on: e => setP(x => ({ budget: Object.assign({}, x.budget, { planned: e.target.value }) })) },
      spent: { v: B.spent == null ? '' : String(B.spent), on: e => setP(x => ({ budget: Object.assign({}, x.budget, { spent: e.target.value }) })) },
      remLabel: plan || spent ? (rem >= 0 ? money(rem) + ' left' : money(rem) + ' over budget') : 'No budget set', remStyle: { fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 24, color: rem < 0 ? 'var(--color-danger, #b42318)' : 'var(--color-text)' },
      budBar: bar(8), budFill: fill(plan ? Math.round(spent / plan * 100) : 0, false),
      log: (p.log || []).slice(0, 10).map(l => ({ when: l.when, by: l.by || '', text: l.text })), logEmpty: !(p.log || []).length
    };
    return out;
  }
  static projVol(ev, title, iso, time, need, have, kind, skills, n) {
    const d = new Date(iso + 'T12:00:00'), MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return { id: ev.id + '-p' + n, event: ev.id, iso, postedN: 3, kind, org: ev.org, mine: !!ev.mine, title, date: WD[d.getDay()] + ', ' + MO[d.getMonth()] + ' ' + d.getDate(), mo: MO[d.getMonth()], day: String(d.getDate()), wd: WD[d.getDay()], time, place: ev.place, desc: ev.title + ' · ' + title, skills, need, have, signups: [] };
  }
  toast(msg, opts) {
    // Info-only messages stay short; anything that changed data stays up longer with Undo.
    const INFO = ['This person asked not to have', 'Write a note first', 'Add a short title', 'Flow 1', 'Flow 2', 'Deactivation needs', 'Preparing your data export', 'We sent a password reset link', 'You have been logged out', 'Signed out of all other devices', 'Leader contacts copied', 'Undone'];
    const info = (opts && opts.info) || INFO.some(p => String(msg).startsWith(p));
    const SKIP = ['toast', 'toastUndo', 'screen', 'dashTab', 'modal', 'menuOpen', 'w', 'verPop', 'filtersOpen'];
    const base = (this._prevState && Date.now() - (this._capAt || 0) < 1000) ? this._prevState : this.state;
    const snap = info ? null : Object.keys(base).reduce((o, k) => { if (!SKIP.includes(k)) o[k] = base[k]; return o; }, {});
    this._undoSnap = snap;
    this.setState({ toast: msg, toastUndo: !!snap });
    clearTimeout(this._tt); this._tt = setTimeout(() => { this._undoSnap = null; this.setState({ toast: null, toastUndo: false }); }, info ? 3400 : 8000);
  }
  undoToast() {
    const snap = this._undoSnap; if (!snap) return;
    this._undoSnap = null; clearTimeout(this._tt);
    this.setState(Object.assign({}, snap, { modal: null, toast: 'Undone. Everything is back the way it was.', toastUndo: false }));
    this._tt = setTimeout(() => this.setState({ toast: null }), 3000);
  }
  favVals() {
    const ids = this.state.favs || [];
    const list = ids.map(id => this.org(id)).filter(Boolean).map(o => Object.assign(this.dec(o), {
      phoneHref: 'tel:' + (o.phone || '').replace(/\D/g, ''), email: (o.contact || [])[2] || '', mailHref: 'mailto:' + ((o.contact || [])[2] || ''), hasEmail: !!(o.contact || [])[2],
      catLine: o.cats.map(k => this.cat(k).label).join(' · '), todayLine: 'Today: ' + (o.hours[2] || 'Call for hours'),
      stop: e => { if (e && e.stopPropagation) e.stopPropagation(); },
      view: e => { if (e && e.stopPropagation) e.stopPropagation(); this.openOrg(o.id); },
      remove: e => { if (e && e.stopPropagation) e.stopPropagation(); this.setState(st => ({ favs: (st.favs || []).filter(x => x !== o.id) })); this.toast('Removed ' + o.name + ' from favorites.'); } }));
    // Folders (optional): each favorite can go in one folder
    const FF = this.state.favFolders || [], FO = this.state.favFolderOf || {}, open = FF.find(f => f.id === this.state.favOpenFolder) || null;
    const moveF = (id, d) => this.setState(st => { const a = (st.favFolders || []).slice(), i = a.findIndex(f => f.id === id), j = i + d; if (i < 0 || j < 0 || j >= a.length) return null; const x = a[i]; a[i] = a[j]; a[j] = x; return { favFolders: a }; });
    const arrowSt = dis => ({ minHeight: 36, minWidth: 36, padding: 0, fontSize: 17, color: dis ? 'var(--color-neutral-400)' : 'var(--color-accent-700)', cursor: dis ? 'default' : 'pointer' });
    const S0 = this.state, dragging = S0.favDrag;
    const baseCard = { border: '1px solid var(--color-neutral-400)', background: 'var(--color-bg)', boxShadow: 'var(--shadow-sm)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, cursor: 'pointer' };
    // Click a row to drop down the basics; click the name to go straight to the public listing
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], TODAY = 2;
    const rowDrop = (o, key) => { const on = S0.favRowOpen === key, raw = this.org(o.id) || {}, C = raw.contact || [];
      const person = C[0] && C[0] !== 'Main line' ? C[0] : '', web = String(raw.website || '').trim(), hrs = raw.hours || [];
      const addr = raw.sensitive ? 'Shared when you call, for everyone’s safety' : raw.addr || ((raw.hood || 'Address') + ' · call for the address');
      o.ci = { hasPerson: !!person, person, hasTitle: !!(person && C[1]), title: C[1] || '', hasHow: !person && !!C[1], how: C[1] || '',
        hasWeb: !!web, web: web.replace(/^https?:\/\//, '').replace(/\/$/, ''), webHref: /^https?:/.test(web) ? web : 'https://' + web,
        addr, hasMap: !raw.sensitive && !!raw.addr, mapHref: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(raw.addr || ''),
        week: [TODAY].map(i => ({ day: 'Today (' + DAYS[i] + ')', hours: hrs[i] || 'Call for hours',
          style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 8px', fontWeight: i === TODAY ? 600 : 400, background: i === TODAY ? 'var(--color-bg)' : 'transparent', borderLeft: '3px solid ' + (i === TODAY ? 'var(--color-accent-700)' : 'transparent') } })) };
      // Contact boxes on the row: each organization can show phone, email, website and/or address
      const em = (raw.contact || [])[2] || '', avail = [['phone', 'Phone', !!raw.phone], ['email', 'Email', !!em], ['web', 'Website', !!web], ['addr', 'Address', !raw.sensitive && !!raw.addr]].filter(a => a[2]);
      const shown = ((S0.favShow || {})[o.id] || ['phone']).filter(k => avail.some(a => a[0] === k));
      const setShow = v => this.setState(st => ({ favShow: Object.assign({}, st.favShow, { [o.id]: v }) }));
      const CHIP = { phone: { icon: this.ic('phone', 16), label: raw.phone, href: 'tel:' + String(raw.phone || '').replace(/[^0-9+]/g, ''), target: '_self', title: 'Call ' + raw.name },
        email: { icon: this.ic('mail', 16), label: em, href: 'mailto:' + em, target: '_self', title: 'Email ' + raw.name },
        web: { icon: this.ic('link', 16), label: 'Website', href: o.ci.webHref, target: '_blank', title: 'Open their website' },
        addr: { icon: this.ic('pin', 16), label: 'Directions', href: o.ci.mapHref, target: '_blank', title: 'Directions to ' + (raw.addr || '') } };
      o.chips = shown.map(k => CHIP[k]);
      const pk = S0.favPick === key;
      Object.assign(o.ci, { picking: on && pk, notPicking: !pk, startPick: () => this.setState({ favPick: key }), donePick: () => this.setState({ favPick: null }),
        opts: avail.map(([k, label]) => ({ label, on: shown.includes(k), toggle: () => setShow(shown.includes(k) ? shown.filter(x => x !== k) : avail.map(a => a[0]).filter(x => x === k || shown.includes(x))) })) });
      Object.assign(o, { rowOpen: on, rowAria: on ? 'true' : 'false', toggleRow: () => this.setState(st => ({ favRowOpen: st.favRowOpen === key ? null : key })),
        chev: { flex: 'none', fontSize: 15, color: 'var(--color-accent-700)', transition: 'transform .2s', transform: on ? 'rotate(90deg)' : 'none' } }); return o; };
    const fileTo = (orgId, fid) => { this.setState(st => ({ favFolderOf: Object.assign({}, st.favFolderOf, { [orgId]: fid }), favDrag: null, favOver: null })); };
    list.forEach(o => { const id = o.id;
      o.rowStyle = Object.assign({ display: 'flex', alignItems: 'center', gap: '8px 16px', flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid var(--color-divider)', cursor: FF.length && !open ? 'grab' : 'pointer' }, dragging === id ? { opacity: .45 } : {});
      o.cardStyle = Object.assign({}, baseCard, dragging === id ? { opacity: .45, cursor: 'grabbing' } : {}, FF.length && !open ? { cursor: 'grab' } : {});
      o.dragStart = e => { try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch (x) {} this.setState({ favDrag: id }); };
      o.unfile = e => { if (e && e.stopPropagation) e.stopPropagation(); fileTo(id, ''); this.toast(o.name + ' taken out of this folder.'); };
      rowDrop(o, 'all:' + id);
      o.folder = { v: FO[id] || '', on: e => { const v = e.target.value; this.setState(st => ({ favFolderOf: Object.assign({}, st.favFolderOf, { [id]: v }) })); const f = FF.find(x => x.id === v); this.toast(f ? o.name + ' moved to ' + f.name + '.' : o.name + ' taken out of its folder.'); } }; });
    const EXP = S0.favExpanded || {};
    const folders = FF.map((f, i) => { const inF = list.filter(o => FO[o.id] === f.id), n = inF.length, over = S0.favOver === f.id, ex = !!EXP[f.id]; return {
      isOver: over && !!dragging, expanded: ex, aria: ex ? 'true' : 'false', empty: ex && !n, tAdd: i === 0 ? 'fav-add' : '', tEdit: i === 0 ? 'fav-edit' : '',
      toggle: () => this.setState(st => ({ favExpanded: Object.assign({}, st.favExpanded, { [f.id]: !(st.favExpanded || {})[f.id] }) })),
      add: e => { if (e && e.stopPropagation) e.stopPropagation(); this.modal({ kind: 'folderAdd', fid: f.id, sel: [] }); },
      orgs: inF.map(o => rowDrop(Object.assign({}, o), 'f:' + o.id)).map(o => Object.assign(o, { unfileHere: e => { if (e && e.stopPropagation) e.stopPropagation(); fileTo(o.id, ''); this.toast(o.name + ' taken out of ' + f.name + '.'); } })),
      wrapStyle: { border: (dragging ? '2px dashed ' : '1px solid ') + (over && dragging ? 'var(--color-accent-700)' : dragging ? 'var(--color-accent-500)' : 'var(--color-accent-300)'), borderLeft: '6px solid var(--color-accent-700)', boxShadow: ex ? 'var(--shadow-md)' : 'var(--shadow-sm)', background: 'var(--color-accent-100)', transition: 'box-shadow .15s, border-color .15s' },
      headStyle: { display: 'flex', alignItems: 'center', gap: 16, width: '100%', minHeight: 84, padding: '14px 20px', border: 0, background: over && dragging ? 'var(--color-accent-200)' : 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' },
      chev: { flex: 'none', fontSize: 20, color: 'var(--color-accent-700)', transition: 'transform .2s', transform: ex ? 'rotate(90deg)' : 'none' },
      cardStyle: { border: (dragging ? '2px dashed ' : '1px solid ') + (over && dragging ? 'var(--color-accent-700)' : dragging ? 'var(--color-accent-400)' : 'var(--color-neutral-400)'), background: over && dragging ? 'var(--color-accent-100)' : 'var(--color-bg)', boxShadow: 'var(--shadow-sm)', padding: dragging ? '15px 17px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', minWidth: 0, transition: 'background .15s, border-color .15s' },
      dragOver: e => { if (!this.state.favDrag) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (x) {} if (this.state.favOver !== f.id) this.setState({ favOver: f.id }); },
      dragLeave: () => { if (this.state.favOver === f.id) this.setState({ favOver: null }); },
      drop: e => { e.preventDefault(); let id = this.state.favDrag; try { id = id || e.dataTransfer.getData('text/plain'); } catch (x) {} if (!id) return; const o = list.find(x => x.id === id); fileTo(id, f.id); this.toast((o ? o.name : 'It') + ' added to ' + f.name + '.'); },
      name: f.name, desc: f.desc || '', hasDesc: !!f.desc, icon: this.ic(f.icon || 'folder', 22), countText: n === 1 ? '1 organization' : n + ' organizations',
      open: () => this.setState({ favOpenFolder: f.id }), edit: e => { if (e && e.stopPropagation) e.stopPropagation(); this.modal({ kind: 'folder', fid: f.id, fname: f.name, fdesc: f.desc || '', ficon: f.icon || 'folder', fpos: String(i) }); },
      up: e => { if (e && e.stopPropagation) e.stopPropagation(); moveF(f.id, -1); }, down: e => { if (e && e.stopPropagation) e.stopPropagation(); moveF(f.id, 1); },
      isFirst: i === 0, isLast: i === FF.length - 1, upStyle: arrowSt(i === 0), downStyle: arrowSt(i === FF.length - 1) }; });
    const shown = open ? list.filter(o => FO[o.id] === open.id) : list;
    const oi = open ? FF.indexOf(open) : -1;
    return { list: shown, has: list.length > 0, none: !list.length, countText: open ? (shown.length === 1 ? '1 organization in this folder' : shown.length + ' organizations in this folder') : (list.length === 1 ? '1 saved organization' : list.length + ' saved organizations'),
      hasFolders: FF.length > 0, showFolders: FF.length > 0 && !open, inFolder: !!open, folderEmpty: !!open && !shown.length, showAllHeading: FF.length > 0 && !open, folders,
      folderOpts: FF.map(f => ({ id: f.id, name: f.name })), closeFolder: () => this.setState({ favOpenFolder: null }),
      collapsible: FF.length > 0 && !open, notCollapsible: !(FF.length > 0 && !open), total: list.length,
      showList: !(FF.length > 0 && !open) || !!this.state.favAllOpen, allAria: this.state.favAllOpen ? 'true' : 'false',
      toggleAll: () => this.setState(st => ({ favAllOpen: !st.favAllOpen })),
      chev: { display: 'inline-block', fontSize: 16, color: 'var(--color-accent-700)', transition: 'transform .2s', transform: this.state.favAllOpen ? 'rotate(90deg)' : 'none' },
      compact: (this.state.favDensity || 'compact') === 'compact', detailed: this.state.favDensity === 'detailed',
      densitySeg: [['compact', 'Compact', 'Short rows'], ['detailed', 'Detailed', 'Full cards with email and hours']].map(([k, label, tip]) => ({ label, tip, on: (this.state.favDensity || 'compact') === k, pick: () => this.setState({ favDensity: k }) })),
      canDrag: FF.length && !open ? 'true' : 'false', dragEnd: () => this.setState({ favDrag: null, favOver: null }), showMove: FF.length > 0 && !open,
      folderHint: 'Drag an organization onto a folder to add it. Arrows change the order.',
      cur: open ? { name: open.name, desc: open.desc || '', hasDesc: !!open.desc, icon: this.ic(open.icon || 'folder', 26), add: () => this.modal({ kind: 'folderAdd', fid: open.id, sel: [] }), edit: () => this.modal({ kind: 'folder', fid: open.id, fname: open.name, fdesc: open.desc || '', ficon: open.icon || 'folder', fpos: String(oi) }) } : {},
      newFolder: () => this.modal({ kind: 'folder', fid: null, fname: '', fdesc: '', ficon: 'folder', fpos: String(FF.length) }),
      goFind: () => this.setState({ dashTab: 'directory', view: 'list', density: 'compact', mapSel: null }) };
  }
  // The big "wasn't approved" pop-up, with the option to delete that dashboard
  deniedVals(M) {
    const s = this.state, d = (s.myDash || []).find(x => x.id === M.did) || { name: 'this organization' };
    const setM = o => this.setState(st => ({ modal: Object.assign({}, st.modal, o) }));
    return { ask: M.step !== 'confirm', confirm: M.step === 'confirm', name: d.name,
      title: 'We couldn’t approve ' + d.name, text: 'Thanks for wanting to serve your neighbors. After reviewing your request, our team wasn’t able to approve this listing. Nothing about it is public.',
      note: d.note || 'We couldn’t confirm the phone number or address you gave. If you have a document showing your organization’s address, reply to our email and we’ll take another look.',
      startDelete: () => setM({ step: 'confirm' }), cancelDelete: () => setM({ step: 'ask' }),
      doDelete: () => {
        this.setState(st => {
          const rest = (st.myDash || []).filter(x => x.id !== d.id), next = rest.find(x => x.kind === 'org') || rest[0];
          const saved = Object.assign({}, st.dashSaved || {}), nextOrg = next && (saved[next.id] || next.org);
          return { myDash: rest, modal: null, notice: null, curDash: next ? next.id : st.curDash, dashTab: 'org', pickOpen: false, autoOpen: st.autoOpen === d.id ? '' : st.autoOpen,
            orgs: next && nextOrg ? st.orgs.map(o => o.id === 'hope' ? Object.assign({}, nextOrg, { id: 'hope' }) : o) : st.orgs };
        });
        this.toast(d.name + ' was deleted from your account.');
      } };
  }
  // "Add organizations" to a folder: pick from your favorites
  folderAddVals(M) {
    const s = this.state, FF = s.favFolders || [], FO = s.favFolderOf || {}, f = FF.find(x => x.id === M.fid) || { name: '' }, sel = M.sel || [];
    const favs = (s.favs || []).map(id => this.org(id)).filter(Boolean).filter(o => FO[o.id] !== f.id);
    const set = o => this.setState(st => ({ modal: Object.assign({}, st.modal, o) }));
    return { title: 'Add to ' + f.name, none: !favs.length, nothing: !sel.length, saveLabel: sel.length ? 'Add ' + sel.length + (sel.length === 1 ? ' organization' : ' organizations') : 'Add',
      list: favs.map(o => { const inF = FF.find(x => x.id === FO[o.id]); return { name: o.name, sub: inF ? 'Now in ' + inF.name : (o.cats || []).map(k => this.cat(k).label).slice(0, 2).join(' · '), on: sel.includes(o.id),
        toggle: () => set({ sel: sel.includes(o.id) ? sel.filter(x => x !== o.id) : sel.concat(o.id) }) }; }),
      save: () => { if (!sel.length) return; this.setState(st => { const of = Object.assign({}, st.favFolderOf); sel.forEach(id => { of[id] = f.id; }); return { favFolderOf: of, modal: null }; }); this.toast(sel.length + (sel.length === 1 ? ' organization' : ' organizations') + ' added to ' + f.name + '.'); } };
  }
  // The "New folder" / "Edit folder" pop-up on Favorites
  folderModalVals(M) {
    const FF = this.state.favFolders || [], isNew = !M.fid;
    const set = o => this.setState(st => ({ modal: Object.assign({}, st.modal, o) }));
    const ICONS = [['folder', 'Folder'], ['home', 'Housing'], ['utensils', 'Food'], ['shirt', 'Clothing'], ['cross', 'Health'], ['users', 'Families'], ['briefcase', 'Jobs'], ['scale', 'Legal'], ['bus', 'Transportation'], ['church', 'Churches'], ['sprout', 'Recovery'], ['shield', 'Safety'], ['sun', 'Seasonal'], ['flag', 'Priority'], ['zap', 'Urgent'], ['star', 'Favorites']].filter(([k]) => this.ICONS[k]);
    return { title: isNew ? 'New folder' : 'Edit folder', saveLabel: isNew ? 'Create folder' : 'Save', err: M.err || '', canDelete: !isNew, noDelete: isNew,
      name: { v: M.fname || '', on: e => set({ fname: e.target.value, err: '' }) }, desc: { v: M.fdesc || '', on: e => set({ fdesc: e.target.value }) },
      icons: ICONS.map(([k, label]) => { const on = (M.ficon || 'folder') === k; return { label, on: on ? 'true' : 'false', svg: this.ic(k, 20), pick: () => set({ ficon: k }),
        style: { width: 44, height: 44, display: 'grid', placeItems: 'center', cursor: 'pointer', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: on ? 'var(--color-accent-700)' : 'var(--color-bg)', color: on ? 'var(--color-bg)' : 'var(--color-accent-800)' } }; }),
      // Which saved organizations go in this folder
      ...(() => { const FO = this.state.favFolderOf || {}, favs = (this.state.favs || []).map(id => this.org(id)).filter(Boolean);
        const sel = M.fsel || (M.fid ? favs.filter(o => FO[o.id] === M.fid).map(o => o.id) : []);
        return { hasFavs: favs.length > 0, noFavs: !favs.length, orgCount: sel.length === 1 ? '1 organization' : sel.length + ' organizations',
          orgs: favs.map(o => { const inF = FF.find(x => x.id === FO[o.id] && x.id !== M.fid); return { name: o.name, on: sel.includes(o.id),
            sub: inF ? 'Now in ' + inF.name + (sel.includes(o.id) ? ' · moves here when you save' : '') : (o.cats || []).map(k => this.cat(k).label).slice(0, 2).join(' · '),
            toggle: () => set({ fsel: sel.includes(o.id) ? sel.filter(x => x !== o.id) : sel.concat(o.id) }) }; }) }; })(),
      save: () => {
        const name = (M.fname || '').trim();
        if (!name) return set({ err: 'Give the folder a name.' });
        if (FF.some(f => f.id !== M.fid && f.name.toLowerCase() === name.toLowerCase())) return set({ err: 'You already have a folder with that name.' });
        const rec = { id: M.fid || 'f' + Date.now(), name, desc: (M.fdesc || '').trim(), icon: M.ficon || 'folder' };
        const old = FF.findIndex(f => f.id === rec.id), next = FF.slice();
        if (old >= 0) next[old] = rec; else next.push(rec);
        const FO0 = this.state.favFolderOf || {}, favIds = this.state.favs || [];
        const sel = M.fsel || (M.fid ? favIds.filter(id => FO0[id] === M.fid) : []);
        this.setState(st => { const of = Object.assign({}, st.favFolderOf);
          Object.keys(of).forEach(k => { if (of[k] === rec.id && !sel.includes(k)) delete of[k]; });
          sel.forEach(id => { of[id] = rec.id; });
          return { favFolders: next, favFolderOf: of, modal: null, favExpanded: Object.assign({}, st.favExpanded, { [rec.id]: true }) }; });
        const k = sel.length === 1 ? '1 organization' : sel.length + ' organizations';
        this.toast(isNew ? 'Folder “' + name + '” created' + (sel.length ? ' with ' + k + '.' : '. Add organizations any time with “Add organizations”.') : 'Folder saved.');
      },
      del: () => {
        const f = FF.find(x => x.id === M.fid); if (!f) return;
        this.setState(st => { const of = Object.assign({}, st.favFolderOf); Object.keys(of).forEach(k => { if (of[k] === f.id) delete of[k]; }); return { favFolders: FF.filter(x => x.id !== f.id), favFolderOf: of, favOpenFolder: st.favOpenFolder === f.id ? null : st.favOpenFolder, modal: null }; });
        this.toast('Folder “' + f.name + '” deleted. The organizations in it are still in your favorites.');
      } };
  }
  apVals() {
    const A = this.state.apply || { mode: 'steps', url: '' }, set = o => this.setState(st => ({ apply: Object.assign({}, st.apply, o) }));
    const url = (A.url || '').trim(), urlOk = /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url);
    const eff = A.mode === 'web' && urlOk ? 'web' : 'steps';
    const O = [['steps', 'Show next steps', 'People see your phone, email and address so they can reach you. This is the default.'], ['web', 'Apply on our website', 'Send people to the online application you already use.']]; // 'Contact us here' (form) is on hold until the full dashboard is built; its code stays below.
    return { opts: O.map(([k, label, hint]) => { const on = A.mode === k; return { label, hint, on, pick: () => set({ mode: k }),
        style: { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 12px', cursor: 'pointer', background: on ? 'var(--color-accent-100)' : 'var(--color-bg)', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), boxShadow: on ? 'inset 0 0 0 1px var(--color-accent-700)' : 'none' } }; }),
      isWeb: A.mode === 'web', isForm: A.mode === 'form', url: { v: A.url || '', on: e => set({ url: e.target.value }) },
      hasUrlErr: A.mode === 'web' && !!url && !urlOk, urlErr: 'Enter the full link, starting with https://', noUrl: A.mode === 'web' && !url,
      btnLabel: eff === 'web' ? 'Apply on their website' : eff === 'form' ? 'Contact them here' : 'See next steps',
      preview: () => this.modal({ kind: 'applyPrev', mode: eff, url, who: 'self', by: {}, ans: {}, errs: {} }) };
  }
  afVals(M) {
    const HO = this.org(M.oid || 'hope') || {}, setM = o => this.setState(st => ({ modal: Object.assign({}, st.modal, o) })), E = M.errs || {}, by = M.by || {}, other = M.who === 'other';
    const clr = k => Object.assign({}, E, { [k]: '' });
    const f = k => ({ v: M[k] || '', on: e => setM({ [k]: e.target.value, errs: clr(k) }) });
    const qs = (HO.appQs || []).map(q => { const v = (M.ans || {})[q.id] || '', setA = x => this.setState(st => ({ modal: Object.assign({}, st.modal, { ans: Object.assign({}, st.modal.ans, { [q.id]: x }), errs: Object.assign({}, st.modal.errs, { ['q_' + q.id]: '' }) }) })), isChoice = q.type === 'choice' || q.type === 'yesno';
      return { id: 'af-' + q.id, label: q.q + (q.req ? ' *' : ''), isChoice, isInput: !isChoice, type: q.type === 'number' ? 'number' : 'text', v: String(v), on: e => setA(e.target.value),
        choices: isChoice ? (q.type === 'yesno' ? ['Yes', 'No'] : (q.opts || '').split(',').map(x => x.trim()).filter(Boolean)).map(c => ({ label: c, name: 'af-' + q.id, on: v === c, pick: () => setA(c) })) : [],
        err: E['q_' + q.id] || '', hasErr: !!E['q_' + q.id] }; });
    const send = () => { const e = {};
      if (other && !(M.rn || '').trim()) e.rn = 'Enter your name and organization.';
      if (!(M.fn || '').trim() || !(M.ln || '').trim()) e.fn = 'Enter a first and last name.';
      if (!by.email && !by.text && !by.call) e.by = 'Pick at least one way to reach ' + (other ? 'them' : 'you') + '.';
      if (by.email && !/^\S+@\S+\.\S+$/.test((M.em || '').trim())) e.em = 'Enter an email address so they can write back.';
      if ((by.text || by.call) && (M.ph || '').replace(/\D/g, '').length < 10) e.ph = 'Enter a 10-digit phone number.';
      (HO.appQs || []).forEach(q => { if (q.req && !String((M.ans || {})[q.id] || '').trim()) e['q_' + q.id] = 'Please answer this question.'; });
      if (!M.ok) e.ok = 'Check the box to agree before sending.';
      if (Object.keys(e).length) return setM({ errs: e });
      setM({ sent: true, errs: {} }); };
    const ways = [by.email && 'email', by.text && 'text message', by.call && 'phone'].filter(Boolean);
    const e = {}; ['rn', 'fn', 'em', 'ph', 'by', 'ok'].forEach(k => { e[k] = E[k] || ''; e['has_' + k] = !!E[k]; });
    const email = (HO.contact || [])[2] || '';
    return { isPreview: !M.oid, isSteps: M.mode === 'steps', isWeb: M.mode === 'web', isForm: M.mode === 'form', name: HO.name || 'This organization',
      phone: HO.phone, phoneHref: 'tel:' + (HO.phone || '').replace(/\D/g, ''), email, hasEmail: !!email, mailHref: 'mailto:' + email,
      contactLine: [(HO.contact || [])[0], (HO.contact || [])[1]].filter(Boolean).join(', '), addr: HO.sensitive ? 'Location shared when you call' : HO.addr,
      today: 'Open today ' + ((HO.hours || [])[2] || 'call for hours'), docs: HO.docs || 'Call ahead to confirm hours and what to bring.', url: M.url || '',
      elig: (HO.elig && HO.elig.length ? HO.elig : ['Anyone who needs help']),
      whoOpts: [['self', 'For myself or my family'], ['other', 'I’m referring someone else']].map(([k, label]) => ({ label, on: (M.who || 'self') === k, pick: () => setM({ who: k }) })),
      other, nameLabel: other ? 'Their name' : 'Your name', emLabel: other ? 'Their email' : 'Your email', phLabel: other ? 'Their phone number' : 'Your phone number', byLabel: other ? 'Best way to reach them' : 'Best way to reach you',
      rn: f('rn'), fn: f('fn'), ln: f('ln'), em: f('em'), ph: f('ph'), cm: f('cm'), cmOpen: !!M.cmOpen, cmClosed: !M.cmOpen, openCm: () => setM({ cmOpen: true }),
      byOpts: [['email', 'Email'], ['text', 'Text message'], ['call', 'Phone call']].map(([k, label]) => ({ label, on: !!by[k], toggle: () => setM({ by: Object.assign({}, by, { [k]: !by[k] }), errs: clr('by') }) })),
      ok: { v: !!M.ok, on: () => setM({ ok: !M.ok, errs: clr('ok') }) }, qs, e, send, sent: !!M.sent, notSent: !M.sent,
      reachText: ways.length ? (ways.length > 1 ? ways.slice(0, -1).join(', ') + ' or ' + ways[ways.length - 1] : ways[0]) : 'phone' };
  }
  modal(m) { this.setState({ modal: Object.assign({ reason: '', note: '', q: '', pick: '', text: '', title: '', type: 'Supply request', urg: 'No rush', err: '' }, m) }); }
  org(id) { return this.state.orgs.find(o => o.id === id); }

  dec(o) {
    const av = this.AV[o.avail], cl = o.claimed != null ? !!o.claimed : Component.CLAIMED.includes(o.id);
    const aUrl = cl ? (o.applyUrl || Component.APPLY_URLS[o.id] || '') : '';
    const mine = o.id === 'hope';
    const DC = ({ Accepting: ['#2f8f4e', '#22703c', '47,143,78'], Limited: ['#c98a10', '#8a5a00', '201,138,16'], Waitlist: ['#3b6fb6', '#2c5490', '59,111,182'], Full: ['#b4443a', '#8c2f27', '180,68,58'] })[o.avail] || ['#777', '#444', '119,119,119'];
    const dotIcon = React.createElement('span', { 'aria-hidden': 'true', style: { display: 'inline-block', width: 9, height: 9, background: DC[0], borderRadius: '50%', boxShadow: '0 0 0 3px rgba(' + DC[2] + ',.18)', flex: '0 0 auto' } });
    const dotStyle = Object.assign({}, this.chipBase, av.style, { gap: 8, color: DC[1] });
    return Object.assign({}, o, {
      tourId: o.id === 'hope' ? 'result-own' : 'result', isFaith: !!o.faith, pending: !o.verified, claimed: cl, showAvail: cl && !o.hideAvail,
      dirAvailStyle: dotStyle, dirAvailIcon: dotIcon, availDotColor: DC[1],
      applyLabel: mine ? this.apVals().btnLabel : aUrl ? 'Apply on their website' : 'See next steps',
      apply: e => { if (e && e.stopPropagation) e.stopPropagation(); return mine ? this.apVals().preview() : this.modal({ kind: 'applyPrev', mode: aUrl ? 'web' : 'steps', oid: o.id, url: aUrl }); },
      chips: o.cats.map(k => ({ label: this.cat(k).label, icon: this.ic(this.cat(k).icon, 16) })),
      availLabel: av.label, availStyle: dotStyle, availIcon: dotIcon,
      today: o.hours[2], openWord: o.open == null ? '' : o.open ? 'Open now' : 'Closed now', todayHours: o.hours[2], hasHours: o.open != null || (o.hours[2] && o.hours[2] !== 'Call for hours'), statusLine: o.open == null ? 'Today ' + o.hours[2] : (o.open ? 'Open now' : 'Closed now') + ' · Today ' + o.hours[2], openLabel: o.open == null ? 'Today ' + o.hours[2] : o.open ? 'Open now' : 'Closed now',
      openDot: { width: 9, height: 9, flex: 'none', borderRadius: '50%', background: o.open ? 'var(--color-accent-700)' : 'transparent', border: '1.5px solid ' + (o.open ? 'var(--color-accent-700)' : 'var(--color-neutral-600)') },
      place: o.sensitive ? 'Location kept private' : o.mi == null ? o.hood : o.hood + ' · ' + o.mi + ' mi',
      view: () => this.openOrg(o.id), refer: () => this.startRef(o.id)
    });
  }
  // "Which dashboard?" for accounts connected to more than one organization (or to the Admin page)
  pickVals() {
    const s = this.state, list = s.myDash || [], first = (s.settings && s.settings.name || '').split(' ')[0];
    const cur = list.find(d => d.id === s.curDash) || list[0] || { name: '' };
    const open = d => {
      const auto = s.pickOpen && s.pickRemember ? d.id : s.autoOpen;
      this.setState(st => {
        const out = { pickOpen: false, autoOpen: auto };
        if (d.kind === 'admin' || d.id === st.curDash) return out;
        // Put away the dashboard that's open, and bring in the one picked
        const saved = Object.assign({}, st.dashSaved || {}), curOrg = st.orgs.find(o => o.id === 'hope');
        saved[st.curDash] = curOrg;
        const nextOrg = saved[d.id] || d.org;
        const waiting = d.status === 'Waiting for approval';
        return Object.assign(out, { curDash: d.id, dashSaved: saved, dashTab: 'org', pubView: false, orgEdit: null,
          orgs: nextOrg ? st.orgs.map(o => o.id === 'hope' ? Object.assign({}, nextOrg, { id: 'hope' }) : o) : st.orgs,
          notice: waiting ? { kind: 'wait', title: 'Your listing is waiting for approval', text: 'Our team is reviewing ' + d.name + '. You can keep editing it while you wait. It goes live once it’s approved.', canDismiss: false }
            : d.status === 'Not approved' ? { kind: 'wait', title: 'This request wasn’t approved', text: 'We weren’t able to approve ' + d.name + '. You can delete this dashboard from Your dashboards or Settings.', canDismiss: false } : null,
          modal: d.status === 'Not approved' ? { kind: 'denied', did: d.id, step: 'ask' } : st.modal });
      });
      if (s.pickOpen && s.pickRemember) this.toast(d.name + ' will open automatically when you log in. Change this any time in Settings.');
      else if (d.kind === 'admin') this.toast('Opening the Admin page…');
      else if (!s.pickOpen) this.toast('Switched to ' + d.name + '.');
    };
    const orgOf = d => d.id === cur.id ? this.org('hope') : ((s.dashSaved || {})[d.id] || d.org || (d.id === 'hope' ? this.org('hope') : null));
    const infoOf = d => { if (d.kind === 'admin') return d.info || ''; const o = orgOf(d); if (!o) return ''; const cats = (o.cats || []).map(k => this.cat(k).label).slice(0, 2).join(' & '); return [cats, o.hood, o.updated ? 'Updated ' + o.updated : ''].filter(Boolean).join(' · '); };
    const CH = { 'Live': { background: 'oklch(0.96 0.04 150)', color: 'oklch(0.40 0.12 150)', border: '1px solid oklch(0.80 0.09 150)', dot: 'oklch(0.60 0.14 150)' }, 'Waiting for approval': { background: 'oklch(0.97 0.05 85)', color: 'oklch(0.45 0.11 70)', border: '1px dashed oklch(0.72 0.13 80)', dot: 'oklch(0.75 0.15 80)' }, 'Not approved': { background: 'oklch(0.96 0.03 27)', color: 'oklch(0.48 0.17 27)', border: '1px solid oklch(0.82 0.08 27)', dot: 'oklch(0.58 0.19 27)' } };
    const items = list.map(d => ({ name: d.name, line: d.kind === 'admin' ? 'Review listings, claims and reports' : [d.role === 'Admin' ? 'You’re an admin' : 'You’re on the team (' + d.role + ')'].filter(Boolean).join(' · '),
      hasChip: d.kind !== 'admin', chip: { 'Live': 'Live', 'Waiting for approval': 'Waiting for review', 'Not approved': 'Not approved' }[d.status] || d.status || 'Live',
      chipStyle: Object.assign({ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, padding: '4px 10px', whiteSpace: 'nowrap' }, CH[d.status] || CH.Live),
      chipStyleSm: Object.assign({ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '2px 8px', marginTop: 4, whiteSpace: 'nowrap' }, CH[d.status] || CH.Live),
      chipDot: { width: 8, height: 8, borderRadius: '50%', flex: 'none', background: (CH[d.status] || CH.Live).dot },
      info: infoOf(d), infoStyle: { fontSize: 14, color: d.kind === 'admin' ? 'var(--color-accent-200)' : 'var(--color-neutral-700)' }, infoSmall: { fontSize: 13, color: d.kind === 'admin' ? 'var(--color-accent-200)' : 'var(--color-neutral-700)' },
      icon: this.ic(d.kind === 'admin' ? 'shield' : 'home', 22), isAuto: s.autoOpen === d.id,
      // The Compassion Catalyst Admin page is shown in dark blue
      card: d.kind === 'admin' ? { border: '1px solid var(--color-accent-900)', background: 'var(--color-accent-900)', color: 'var(--color-bg)', boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '18px 20px', textAlign: 'left', font: 'inherit', cursor: 'pointer' }
        : { border: '1px solid var(--color-neutral-400)', background: 'var(--color-bg)', color: 'inherit', boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '18px 20px', textAlign: 'left', font: 'inherit', cursor: 'pointer' },
      iconBig: { flex: 'none', width: 48, height: 48, display: 'grid', placeItems: 'center', background: d.kind === 'admin' ? 'var(--color-accent-800)' : 'var(--color-accent-100)', color: d.kind === 'admin' ? 'var(--color-bg)' : 'var(--color-accent-800)', border: '1px solid ' + (d.kind === 'admin' ? 'var(--color-accent-700)' : 'var(--color-accent-300)') },
      iconSmall: { flex: 'none', width: 36, height: 36, display: 'grid', placeItems: 'center', background: d.kind === 'admin' ? 'var(--color-accent-800)' : 'var(--color-accent-100)', color: d.kind === 'admin' ? 'var(--color-bg)' : 'var(--color-accent-800)' },
      lineStyle: { fontSize: 15, color: d.kind === 'admin' ? 'var(--color-accent-200)' : 'var(--color-neutral-800)' },
      lineSmall: { fontSize: 14, color: d.kind === 'admin' ? 'var(--color-accent-200)' : 'var(--color-neutral-700)' },
      arrowStyle: { flex: 'none', color: d.kind === 'admin' ? 'var(--color-bg)' : 'var(--color-accent-700)' },
      switchBtn: Object.assign({ minHeight: 40, fontSize: 15 }, d.kind === 'admin' ? { background: 'var(--color-bg)', color: 'var(--color-accent-900)', borderColor: 'var(--color-bg)' } : {}),
      hereStyle: { fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, color: d.kind === 'admin' ? 'var(--color-bg)' : 'var(--color-accent-800)' },
      row: { display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '12px 20px', borderBottom: '1px solid var(--color-divider)', background: d.kind === 'admin' ? 'var(--color-accent-900)' : 'transparent', color: d.kind === 'admin' ? 'var(--color-bg)' : 'inherit' }, isCur: d.id === cur.id, notCur: d.id !== cur.id, open: () => open(d) }));
    return { show: !!s.pickOpen && list.length > 1, many: list.length > 1, list: items, orgList: items.filter((x, k) => list[k].kind !== 'admin'), adminList: items.filter((x, k) => list[k].kind === 'admin'), hasAdmin: list.some(x => x.kind === 'admin'), curName: cur.name, hello: first ? 'Welcome back, ' + first + '.' : 'Welcome back.',
      remember: { v: !!s.pickRemember, on: e => this.setState({ pickRemember: e.target.checked }) },
      autoOpts: [{ id: '', label: 'Ask me which dashboard to open' }].concat(list.map(d => ({ id: d.id, label: 'Always open ' + d.name }))).map(a => ({ label: a.label, on: (s.autoOpen || '') === a.id,
        pick: () => { this.setState({ autoOpen: a.id }); this.toast(a.id ? 'Saved. ' + a.label.replace('Always open ', '') + ' will open when you log in.' : 'Saved. We’ll ask which dashboard to open each time you log in.'); } })) };
  }
  // The welcome tour on the dashboard
  // The overview tour (shown the first time someone logs in) and a short tour for each page.
  // Each step: title, text, what to light up, how the page should look, and (for "click" steps) what the person clicks.
  tourSteps(which) {
    const name = (this.org('hope') || {}).name || 'your organization', many = (this.state.myDash || []).length > 1;
    const firstF = ((this.state.favFolders || [])[0] || {}).id || null, hasF = !!firstF;
    const ORG = { dashTab: 'org', pubView: false }, DIR = { dashTab: 'directory', view: 'list', density: 'compact', mapSel: null, pubView: false }, FAV = { dashTab: 'favs', pubView: false, favOpenFolder: null, favAllOpen: true, favExpanded: {} }, SET = { dashTab: 'settings', pubView: false }, DSH = { dashTab: 'dashes', pubView: false };
    const T = {
      overview: [
        { welcome: true, title: 'Welcome to your dashboard', body: 'This is where ' + name + ' keeps its listing up to date, and where your team finds help for the people you serve. Here’s a 30-second look around.' + (this.state.tourPending ? ' Your listing isn’t public yet, but you can set everything up now.' : ''), set: ORG },
        { title: 'My organization', body: 'Your listing lives here: exactly what people see when they find you. Edit any part of it, set your availability, and invite your team.', target: 'nav-org', set: ORG },
        { title: 'Find help', body: 'Search every organization in the directory for the people you serve, by need and by area.', target: 'nav-directory', set: ORG },
        { title: 'Favorites', body: 'The organizations your team refers people to most, saved in one place. You can sort them into folders.', target: 'nav-favs', set: ORG }
      ].concat(many ? [{ title: 'Your dashboards', body: 'Your account is connected to more than one dashboard. Switch between them here.', target: 'nav-dashes', set: ORG }] : []).concat([
        { title: 'Settings', body: 'Your account, notifications, privacy choices and password.', target: 'nav-settings', set: ORG },
        { title: 'Want the details?', body: 'Every page has a small “Tour this page” link next to its title. Use it any time for a closer look at what that page can do.', target: 'page-tour', set: ORG }
      ]),
      org: [
        { title: 'This is your listing', body: 'Everything here is what people see when they find you. Use the Edit links beside each part (name, description, services, hours, location, contact) to change it.', target: 'listing', set: ORG },
        { title: 'See it like the public does', body: '“View as the public” opens your finished listing, exactly the way neighbors will see it.', target: 'public', set: ORG },
        { title: 'Tell people if you can help right now', body: 'Choose Accepting, Limited, Waitlist or Full. It shows on your listing as a colored dot, so people know before they call.', target: 'avail', set: ORG },
        { title: 'Choose how people apply', body: 'Show your next steps (phone, email, address), or send people straight to your own online application.', target: 'apply', set: ORG },
        { title: 'Bring in your team', body: 'Invite teammates and choose what each one can do.', target: 'team', set: ORG }
      ],
      directory: [
        { title: 'Search for what someone needs', body: 'Type a need (like “rent help” or “groceries”), an organization’s name, or a neighborhood.', target: 'dir-search', set: DIR },
        { title: 'Narrow it down', body: 'Filters let you pick the state and county, the kind of help, who it’s for, and who’s open or accepting people right now.', target: 'dir-filters', set: DIR },
        { title: 'List or map', body: 'Switch between a list and a map. In the list, choose Detailed for full cards or Compact for short rows.', target: 'dir-view', set: DIR },
        { title: 'Open a listing', body: 'Every organization has a full listing with its services, hours, and how to reach them.', target: 'result', click: 'Click this organization to open it', set: DIR },
        { title: 'How to reach them', body: 'Their next steps (or their own application) and their phone number are always right here.', target: 'pub-actions', set: null },
        { title: 'Save it to Favorites', body: 'Organizations your team refers people to often can be saved, so they’re one click away.', target: 'pub-fav', click: 'Click the star to save it', press: true, set: null },
        { title: 'Head back', body: 'That’s a listing. Click here to go back to your results.', target: 'pub-close', click: 'Click here to go back', set: null }
      ],
      favs: [
        { title: 'Everything you saved', body: 'Each one shows their name, what they do and their phone number. Switch to Detailed to see email, where they are and today’s hours too.', target: 'favcard', set: FAV },
        { title: 'See their full listing', body: 'Click anywhere on an organization to open everything about them: services, hours, who it’s for, and how to apply.', target: 'favcard', set: FAV },
        { title: 'Find more organizations', body: '“Find more in Find help” takes you to the directory. Tap the star on any organization there and it shows up here.', target: 'fav-find', set: FAV },
        { title: 'Folders (optional)', body: hasF ? 'Sort your favorites into folders, like “Housing partners”. Click “New folder” any time to make another.' : 'Want to sort your favorites, like “Housing partners” or “Food”? Click “New folder”. Give it a name, a short description and an icon, and check the organizations to put in it. Folders are optional; your favorites work fine without them.', target: 'fav-new', set: FAV },
        { title: 'Your folders', body: 'Each folder is a row with its icon, name, description and how many organizations are in it. Click a folder to drop it down and see what’s inside.', target: 'fav-folder', set: FAV, when: hasF },
        { title: 'Put organizations in a folder', body: 'Drag any saved organization and drop it on a folder. Or open a folder and click “Add organizations” to check off the ones you want.', target: 'favcard', set: FAV, when: hasF },
        { title: 'Inside a folder: add organizations', body: 'When a folder is open, click “Add organizations” to pick several favorites at once with checkboxes.', target: 'fav-add', set: Object.assign({}, FAV, { favExpanded: { [firstF]: true } }), when: hasF },
        { title: 'Edit or remove', body: '“Edit folder” lets you rename it, change its description or icon, check which organizations are in it, or delete it. Deleting a folder never removes anything from your favorites. Each organization in a folder also has “Remove from folder”, and the ↑ ↓ arrows change the order of your folders.', target: 'fav-edit', set: Object.assign({}, FAV, { favExpanded: { [firstF]: true } }), when: hasF }
      ],
      settings: [
        { title: 'Your account', body: 'Your name, email and phone number. Change them here any time.', target: 'set-account', set: SET },
        { title: 'Notifications', body: 'Choose how you hear about corrections, check-in reminders and team changes: email, text, or just here on your dashboard.', target: 'set-notes', set: SET, optional: true },
        { title: 'Privacy & sharing', body: 'Decide what the public sees, like your contact person or your street address.', target: 'set-privacy', set: SET },
        { title: 'See the tour again', body: 'Start the welcome tour again from here whenever you like.', target: 'set-tour', set: SET },
        { title: 'Security', body: 'Change your password, or sign out on your other devices.', target: 'set-security', set: SET }
      ],
      dashes: [
        { title: 'Your dashboards', body: 'Every dashboard your account is connected to. “Switch to this dashboard” opens a different one.', target: 'dash-list', set: DSH },
        { title: 'When you log in', body: 'Choose to be asked each time, or to always open one dashboard automatically.', target: 'dash-auto', set: DSH }
      ]
    };
    const S = T[which] || T.overview;
    // leave out steps whose part isn't on the page (for example, no folders yet)
    return S.filter(x => x.when !== false && (!x.optional || this.tourTarget(x.target)));
  }
  tourVals(M) { return this.tourLayer(); }
  // The guided tour: dims the page, lights up the part each step talks about, and points to it
  tourLayer() {
    const s = this.state, M = s.modal || {};
    if (M.kind !== 'tour') return { show: false };
    const S = this.tourSteps(M.tour), i = Math.min(M.step || 0, S.length - 1), last = i === S.length - 1, step = S[i];
    const hasWelcome = !!(S[0] && S[0].welcome), real = S.length - (hasWelcome ? 1 : 0), num = i + (hasWelcome ? 0 : 1);
    const go = (n, viaClick) => {
      if (n == null) return this.setState({ modal: null, tourRect: null });
      const st = S[n].set, extra = Object.assign({}, st || {});
      // coming back to a listing step: reopen the listing that was opened earlier
      if (!st && !viaClick && this._tourOrg) Object.assign(extra, { pubView: true, orgId: this._tourOrg, dashTab: 'directory' });
      this.setState(Object.assign(viaClick ? {} : extra, { modal: { kind: 'tour', tour: M.tour, step: n } }));
    };
    const ease = 'cubic-bezier(.4,0,.2,1)';
    const vw = window.innerWidth || 1200, vh = window.innerHeight || 800, W = Math.min(360, vw - 32);
    const R = step.target && s.tourRect ? s.tourRect : null;
    let card = { position: 'fixed', zIndex: 96, width: W, boxSizing: 'border-box', background: 'var(--color-bg)', border: '1px solid var(--color-neutral-400)', boxShadow: '0 18px 50px rgba(0,0,0,.3)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12, transition: 'left .5s ' + ease + ', top .5s ' + ease + ', width .5s ' + ease };
    let spot = null, arrow = null, hit = null;
    if (R) {
      const p = 8, x = R.left - p, y = R.top - p, w = R.width + p * 2, h = R.height + p * 2;
      spot = { position: 'fixed', left: x, top: y, width: w, height: h, borderRadius: 6, pointerEvents: 'none', transition: 'left .5s ' + ease + ', top .5s ' + ease + ', width .5s ' + ease + ', height .5s ' + ease, boxShadow: '0 0 0 9999px rgba(15,23,32,.6), 0 0 0 3px #b5d9fd', animation: 'tourring 1.6s ease-out infinite' };
      hit = { position: 'fixed', zIndex: 96, left: x, top: y, width: w, height: h, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', borderRadius: 6 };
      const A = { position: 'absolute', width: 16, height: 16, background: 'var(--color-bg)', transform: 'rotate(45deg)', transition: 'top .5s ' + ease + ', left .5s ' + ease };
      const cy = y + h / 2, cx = x + w / 2, gap = 18, estH = step.click ? 300 : 250;
      if (vw - (x + w) >= W + gap + 16) { const top = Math.max(16, Math.min(vh - estH - 16, cy - 90)); Object.assign(card, { left: x + w + gap, top }); arrow = Object.assign(A, { left: -9, top: Math.max(16, Math.min(estH - 32, cy - top - 8)), borderLeft: '1px solid var(--color-neutral-400)', borderBottom: '1px solid var(--color-neutral-400)' }); }
      else if (x >= W + gap + 16) { const top = Math.max(16, Math.min(vh - estH - 16, cy - 90)); Object.assign(card, { left: x - gap - W, top }); arrow = Object.assign(A, { right: -9, top: Math.max(16, Math.min(estH - 32, cy - top - 8)), borderRight: '1px solid var(--color-neutral-400)', borderTop: '1px solid var(--color-neutral-400)' }); }
      else if (vh - (y + h) >= estH + gap) { const left = Math.max(16, Math.min(vw - W - 16, cx - W / 2)); Object.assign(card, { left, top: y + h + gap }); arrow = Object.assign(A, { top: -9, left: Math.max(16, Math.min(W - 32, cx - left - 8)), borderLeft: '1px solid var(--color-neutral-400)', borderTop: '1px solid var(--color-neutral-400)' }); }
      else { const left = Math.max(16, Math.min(vw - W - 16, cx - W / 2)); Object.assign(card, { left, top: Math.max(16, y - gap - estH) }); arrow = Object.assign(A, { bottom: -9, left: Math.max(16, Math.min(W - 32, cx - left - 8)), borderRight: '1px solid var(--color-neutral-400)', borderBottom: '1px solid var(--color-neutral-400)' }); }
    } else {
      const CW = Math.min(460, vw - 32);
      Object.assign(card, { width: CW, left: Math.round((vw - CW) / 2), top: Math.max(16, Math.round(vh / 2 - 170)), padding: '26px 28px' });
    }
    // "Click" steps: clicking the lit-up part (or Next) does the real thing, then the tour moves on
    const doClick = () => {
      const el = this.tourTarget(step.target);
      if (el && !(step.press && el.getAttribute('aria-pressed') === 'true')) el.click();
      if (step.target === 'result') setTimeout(() => { this._tourOrg = this.state.orgId; }, 0);
      setTimeout(() => go(last ? null : i + 1, true), 60);
    };
    return { show: true, hasTarget: !!R, noTarget: !R, spot, arrow, card, hit, isWelcome: !!step.welcome, count: real,
      clickable: !!(step.click && R), clickHint: step.click || '', clickLabel: step.click || '', doClick,
      stepText: step.welcome ? 'Quick tour' : (M.tour && M.tour !== 'overview' ? 'This page · ' : '') + num + ' of ' + real, title: step.title, body: step.body, titleSize: step.welcome ? '30px' : '22px',
      hasBack: i > 0, back: () => go(i - 1), next: () => step.click ? doClick() : go(last ? null : i + 1), skip: () => go(null),
      nextLabel: step.welcome ? 'Show me around' : last ? (M.tour && M.tour !== 'overview' ? 'Done' : 'Get started') : step.click ? 'Do it for me' : 'Next',
      stop: e => { if (e && e.stopPropagation) e.stopPropagation(); },
      dots: S.slice(hasWelcome ? 1 : 0).map((_, k) => ({ style: { width: k === num - 1 ? 18 : 6, height: 6, borderRadius: 4, background: k === num - 1 ? 'var(--color-accent-700)' : 'var(--color-neutral-400)', transition: 'width .3s ' + ease } })) };
  }
  tourTarget(id) { return Array.from(document.querySelectorAll('[data-tour="' + id + '"]')).find(x => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0; }); }
  // Smoothly scrolls the step's part into view (the light glides along with it), then measures it
  measureTour(tries) {
    const M = this.state.modal || {};
    if (M.kind !== 'tour') return;
    const S = this.tourSteps(M.tour), step = S[Math.min(M.step || 0, S.length - 1)] || {}, id = step.target;
    if (!id) { if (this.state.tourRect) this.setState({ tourRect: null }); return; }
    const el = this.tourTarget(id);
    if (!el) { if ((tries || 0) < 15) { clearTimeout(this._tourT); this._tourT = setTimeout(() => this.measureTour((tries || 0) + 1), 100); } return; }
    const key = id + ':' + M.step;
    if (this._tourScrolled !== key) {
      this._tourScrolled = key;
      const b0 = el.getBoundingClientRect(), vh = window.innerHeight;
      if (b0.top < 80 || b0.bottom > vh - 80) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    }
    const b = el.getBoundingClientRect(), cur = this.state.tourRect;
    const nr = { id, left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(Math.min(b.height, window.innerHeight * 0.7)) };
    if (!cur || cur.id !== nr.id || cur.left !== nr.left || cur.top !== nr.top || cur.width !== nr.width || cur.height !== nr.height) this.setState({ tourRect: nr });
  }
  // State and County filters. A listing matches if it's in that place, or serves all of it (statewide or nationwide).
  static ST = { AL: 'Alabama', GA: 'Georgia' };
  stOf(o) { return o.st || Component.ST[((o.addr || '').match(/,\s*([A-Z]{2})\b[^,]*$/) || [])[1]] || (o.area === 'Georgia' || o.area === 'Alabama' ? o.area : ''); }
  countyOf(o) { return o.county || (this.stOf(o) === 'Alabama' && !o.area ? 'Jefferson County' : ''); }
  placeOk(o, f) {
    if (window.CC && CC.placeMatch) return CC.placeMatch(o, f);
    if (o.area === 'Nationwide') return true;
    if (f.st && this.stOf(o) !== f.st) return false;
    if (f.county && this.countyOf(o) !== f.county && !(o.area === 'Georgia' || o.area === 'Alabama')) return false;
    return true;
  }
  openOrg(id) { if (this.state.screen === 'dash') return this.setState({ pubView: true, orgId: id, verPop: false }); const d = this.state.screen === 'dash'; this.go('listing', { orgId: id, fromDash: d, fromTab: d ? this.state.dashTab : null }); }
  startRef(id) {
    const o = id && this.org(id); const fc = this.state.filters.cats[0];
    this.go('refer', { ref: Object.assign(this.blankRef(), { orgId: id || null, cat: o ? (fc && o.cats.includes(fc) ? fc : o.cats[0]) : (fc || ''), send: id ? 'one' : 'few' }), refStep: 1, refErr: {} });
  }
  results() {
    const f = this.state.filters, stop = ['help', 'need', 'needs', 'for', 'with', 'the', 'and', 'someone', 'a', 'my', 'in'];
    const words = f.q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stop.includes(w));
    let list = this.state.orgs.filter(o => {
      if (words.length) { const hay = (o.name + ' ' + o.about + ' ' + o.cats.map(k => this.cat(k).label).join(' ') + ' ' + Object.values(o.services).flat().join(' ') + ' ' + o.hood).toLowerCase(); if (!words.some(w => hay.includes(w) || hay.includes(w.replace(/s$/, '')))) return false; }
      if (f.cats.length && !f.cats.some(c => o.cats.includes(c))) return false;
      if (f.faith === 'yes' && !o.faith) return false; if (f.faith === 'no' && o.faith) return false;
      if (f.types.length && !f.types.includes(o.type)) return false;
      if (!this.placeOk(o, f)) return false;
      if (f.hood && o.hood !== f.hood) return false;
      if (f.openNow && !o.open) return false;
      if (f.accepting && !(o.avail === 'Accepting' || o.avail === 'Limited')) return false;
      if (f.lang && !o.langs.includes(f.lang)) return false;
      if (f.cost && o.cost !== f.cost) return false;
      if (f.elig && !o.elig.includes(f.elig)) return false;
      return true;
    });
    const rank = { Accepting: 0, Limited: 1, Waitlist: 2, Full: 3 };
    if (this.state.sort === 'nearest') list.sort((a, b) => (a.mi ?? 99) - (b.mi ?? 99));
    else if (this.state.sort === 'recent') list.sort((a, b) => b.updN - a.updN);
    else list.sort((a, b) => (b.verified - a.verified) || (rank[a.avail] - rank[b.avail]));
    return list;
  }
  runSearch = e => {
    e && e.preventDefault && e.preventDefault();
    this.go('directory', { filters: Object.assign(this.blankFilters(), { q: this.state.homeQ, cats: this.state.homeCat ? [this.state.homeCat] : [] }), loading: true, view: 'list' });
    setTimeout(() => this.setState({ loading: false }), 650);
  };
  searchCat(k) { this.setState({ homeQ: '', homeCat: k }); this.go('directory', { filters: Object.assign(this.blankFilters(), { cats: [k] }), loading: true, view: 'list' }); setTimeout(() => this.setState({ loading: false }), 650); }

  steps(stage) {
    const S = ['Submitted', 'Seen', 'Accepted', 'In progress', 'Completed']; let arr;
    if (stage === 'Declined' || stage === 'Redirected') arr = [['Submitted', 'done'], ['Seen', 'done'], [stage, 'end']];
    else { const i = S.indexOf(stage); arr = S.map((l, j) => [l, j < i ? 'done' : j === i ? (stage === 'Completed' ? 'done' : 'current') : 'todo']); }
    return arr.map(([label, st]) => {
      const done = st === 'done' || st === 'end', cur = st === 'current', act = done || cur;
      return { label, sub: cur ? 'Current step' : done ? 'Done' : 'Not yet',
        bar: { height: 3, background: act ? 'var(--color-accent-700)' : 'var(--color-divider)' },
        mk: { width: 26, height: 26, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '50%', border: '1.5px solid ' + (act ? 'var(--color-accent-700)' : 'var(--color-neutral-500)'), background: done ? 'var(--color-accent-700)' : 'transparent', color: 'var(--color-bg)' },
        icon: done ? this.ic(st === 'end' ? (stage === 'Declined' ? 'x' : 'arrow') : 'check', 14) : cur ? React.createElement('span', { style: { width: 10, height: 10, borderRadius: '50%', background: 'var(--color-accent-700)' } }) : null,
        lbl: { fontSize: 15, fontWeight: cur ? 700 : 500, color: act ? 'var(--color-text)' : 'var(--color-neutral-700)' } };
    });
  }
  decRef(r) {
    return Object.assign({}, r, { catLabel: this.cat(r.cat).label, isUrgent: r.urgency.startsWith('Urgent'), stageLabel: r.stage === 'Submitted' ? 'New' : r.stage,
      stageStyle: Object.assign({}, this.chipBase, this.STAGE[r.stage]), isShared: !!r.shared, rowBg: r.stage === 'Completed' ? 'var(--color-neutral-200)' : 'transparent', open: () => r.shared ? this.openCase() : this.openRef(r.id) });
  }
  settingsVals() {
    const S = this.state.settings, set = (path, v) => this.setState(st => { const n = JSON.parse(JSON.stringify(st.settings)); const k = path.split('.'); let o = n; k.slice(0, -1).forEach(x => o = o[x]); o[k[k.length - 1]] = v; return { settings: n }; });
    const sw = (on) => ({ width: 40, height: 22, flex: 'none', position: 'relative', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-500)'), background: on ? 'var(--color-accent-700)' : 'var(--color-neutral-200)', borderRadius: 11, cursor: 'pointer', padding: 0, transition: 'background .15s' });
    const knob = (on) => ({ position: 'absolute', top: 2, left: on ? 20 : 2, width: 16, height: 16, borderRadius: 8, background: 'var(--color-bg)', transition: 'left .15s', boxShadow: 'var(--shadow-sm)' });
    const notif = [['reports', 'Suggested corrections', 'When someone suggests a correction to your listing'], ['checkin', 'Listing check-in reminders', 'When it’s time to confirm your listing is still right'], ['team', 'Team changes', 'When someone joins your team, leaves, or changes roles'], ['favs', 'Favorite organization updates', 'When an organization you favorited changes its availability or hours'], ['digest', 'Weekly summary', 'A short recap every Monday morning']].map(([k, label, hint]) => ({ label, hint, ch: ['email', 'text', 'app'].map(c => ({ c, aria: label + ' by ' + ({ email: 'email', text: 'text', app: 'in-app' })[c], on: S.n[k][c] ? 'true' : 'false', style: sw(S.n[k][c]), knob: knob(S.n[k][c]), go: () => set('n.' + k + '.' + c, !S.n[k][c]) })) }));
    const priv = [['showContact', 'Show our contact person on the public listing', 'Name, role, and phone appear on your listing. Turn off to show only the main line.'], ['hideAddr', 'Hide our street address publicly', 'Shows “Address shared after contact” instead. Recommended for shelters and safety services.']].map(([k, label, hint]) => ({ label, hint, aria: label, on: S.p[k] ? 'true' : 'false', style: sw(S.p[k]), knob: knob(S.p[k]), go: () => set('p.' + k, !S.p[k]) }));
    const one = (k, label, hint) => ({ label, hint, aria: label, on: S[k] ? 'true' : 'false', style: sw(S[k]), knob: knob(S[k]), go: () => set(k, !S[k]) });
    return { name: { v: S.name, on: e => set('name', e.target.value) }, email: { v: S.email, on: e => set('email', e.target.value) }, phone: { v: S.phone, on: e => set('phone', e.target.value) },
      save: e => { e.preventDefault(); this.toast('Account details saved.'); }, notif, priv,
      quiet: one('quiet', 'Quiet hours (9 PM – 7 AM)', 'No texts overnight. Everything still shows in the app.'), twoStep: one('twoStep', 'Two-step verification', 'Ask for a code from your phone when signing in on a new device.'),
      changePw: () => this.toast('We sent a password reset link to ' + S.email + '.'), signOutAll: () => this.toast('Signed out of all other devices.'), download: () => this.toast('Preparing your data export. We’ll email it within a day.'), deactivate: () => this.toast('Deactivation needs an Admin and a confirmation email. (Prototype)'), editListing: () => this.setState({ dashTab: 'org', selRef: null }) };
  }
  openCase() {
    this.setState({ dashTab: 'cases', selRef: null });
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  openCasePop(id) { this.setState({ casePop: true, ovPop: false, selRef: id, caseSel: null }); }
  openPop(id) {
    this.setState(s => ({ ovPop: true, casePop: false, selRef: id, note: '', referrals: s.referrals.map(r => r.id === id && r.stage === 'Submitted' ? Object.assign({}, r, { stage: 'Seen', log: r.log.concat({ t: 'Just now', who: 'Denise C.', text: 'Opened and marked as seen' }) }) : r) }));
  }
  openRef(id) {
    this.setState(s => ({ dashTab: 'referrals', selRef: id, note: '', referrals: s.referrals.map(r => r.id === id && r.stage === 'Submitted' ? Object.assign({}, r, { stage: 'Seen', log: r.log.concat({ t: 'Just now', who: 'Denise C.', text: 'Opened and marked as seen' }) }) : r) }));
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  setStage(id, stage, text, toast) {
    this.setState(s => ({ referrals: s.referrals.map(r => r.id === id ? Object.assign({}, r, { stage: stage || r.stage, log: r.log.concat({ t: 'Just now', who: 'Denise C.', text, internal: !stage }) }) : r) }));
    if (toast) this.toast(toast);
  }
  refNext = () => {
    const r = this.state.ref, st = this.state.refStep, err = {}, RO = r.orgId && this.org(r.orgId), RQ = (RO && RO.appQs) || [], RN = RQ.length ? 4 : 3;
    if (st === 1) {
      if (!(r.first || '').trim()) err.first = 'Add a first name.';
      if (!(r.last || '').trim() && r.addrMode !== 'safety') err.last = 'Add a last name so the organization knows who to expect.';
      if (!(r.phoneUnknown && r.forWho === 'other') && (r.phone || '').replace(/\D/g, '').length < 10) err.phone = 'Add a 10-digit phone number' + (r.forWho === 'other' ? ', or check “I don’t know their number.”' : '.');
      if (r.forWho === 'other') { if (!r.refName.trim()) err.refName = 'Add your name.'; if (!r.refContact.trim()) err.refContact = 'Add a phone or email so the organization can reach you.'; if (r.refType === 'Organization or church' && !r.refOrg.trim()) err.refOrg = 'Add the organization name, or choose another option.'; }
    }
    if (st === 2) {
      if (!r.cat) err.cat = 'Choose the kind of help needed.';
      if (!r.urgency) err.urgency = 'Choose how soon help is needed.';
      if (r.desc.trim().length < 10) err.desc = 'Add a sentence or two about the need.';
      if (r.contact === 'Email' && !/.+@.+\..+/.test(r.contactVal.trim())) err.contactVal = 'Add an email address.';
      const SAFE_CATS = ['dv', 'housing', 'legal', 'counseling'];
      if (r.addrMode === 'safety' && !SAFE_CATS.includes(r.cat)) err.addr = 'The safety option is only for domestic violence, housing and shelter, legal aid, or counseling. Choose another option.';
      else if (r.addrMode === 'home') { if (!(r.street || '').trim()) err.street = 'Add the street address.'; if (!/^\d{5}$/.test((r.zip || '').trim())) err.zip = 'Add a 5-digit ZIP code.'; if (!(r.city || '').trim()) err.city = 'Add the city.'; }
      else if (r.addrMode === 'nofixed' && !(r.where || '').trim()) err.where = 'Tell the organization where they can usually be found.';
      else if (r.addrMode === 'unknown' && r.forWho !== 'other') err.addr = 'Choose another option.';
    }
    if (RQ.length && st === 3) RQ.forEach(q => { { const a = (r.answers || {})[q.id]; if (q.req && (Array.isArray(a) ? !a.length : !String(a || '').trim())) err['q_' + q.id] = q.multi ? 'Choose at least one.' : q.type === 'number' ? ((r.answers || {})[q.id + '_r'] ? 'Enter both numbers for the estimate.' : 'Enter a number.') : 'Please answer this question.'; else if (q.type === 'number' && a !== undefined && a !== '') { const A2 = r.answers || {}, ranged = q.allowRange && A2[q.id + '_r'], nums = ranged ? [+A2[q.id + '_lo'], +A2[q.id + '_hi']] : [+a], bad = nums.some(n => isNaN(n) || (q.min != null && n < q.min) || (q.max != null && n > q.max)); if (bad) err['q_' + q.id] = 'Enter a number' + (q.min != null && q.max != null ? ' from ' + q.min + ' to ' + q.max : '') + '.'; else if (ranged && nums[0] > nums[1]) err['q_' + q.id] = 'The first number should be smaller than the second.'; }
      else if ((q.type === 'text' || q.type === 'long') && a && String(a).trim().split(/\s+/).length > (+q.maxWords || (q.type === 'long' ? 150 : 25))) err['q_' + q.id] = 'Please keep this to ' + (+q.maxWords || (q.type === 'long' ? 150 : 25)) + ' words or fewer.'; } });
    if (st === RN && !r.consent) err.consent = 'Please confirm the person agreed to be referred.';
    if (Object.keys(err).length) return this.setState({ refErr: err });
    if (st < RN) { this.setState({ refStep: st + 1, refErr: {} }); try { window.scrollTo(0, 0); } catch (e) {} return; }
    this.setState({ refSending: true });
    setTimeout(() => {
      const s = this.state, o = r.orgId && this.org(r.orgId), few = this.matches(r);
      const targets = r.send === 'few' ? (o ? [o].concat(few) : few) : [o];
      const code = 'CC-2611-' + (4822 + s.referrals.length);
      const who = [r.first.trim(), (r.last || '').trim()].filter(Boolean).join(' ');
      const addr = r.addrMode === 'home' ? { mode: 'home', street: r.street.trim(), apt: (r.apt || '').trim(), city: r.city.trim(), zip: r.zip.trim() } : r.addrMode === 'nofixed' ? { mode: 'nofixed', where: r.where.trim() } : { mode: r.addrMode };
      const nr = { answers: RQ.map(q => [q.q, [].concat((r.answers || {})[q.id] || []).join(', ') || '—']), id: 'r' + Date.now(), code, to: targets[0] ? targets[0].id : 'hope', who: r.forWho === 'self' ? who + ' (self)' : who, first: r.first.trim(), last: (r.last || '').trim(), phone: r.forWho === 'other' && r.phoneUnknown ? '' : r.phone.trim(), addr, safety: r.addrMode === 'safety', noPass: !!r.noPass, contactVal: r.contactVal, cat: r.cat, urgency: r.urgency, desc: r.desc, household: r.household, lang: r.lang, contact: r.contact, from: r.forWho === 'self' ? 'Self-referral' : [r.refName, r.refType === 'Organization or church' ? r.refOrg : r.refType, r.refContact].filter(Boolean).join(' · '), when: 'Just now', stage: 'Submitted',
        log: [{ t: 'Just now', who: 'Co-mission Catalyst', text: 'Referral sent to ' + targets.map(t => t.name).join(', ') }] };
      this.setState({ referrals: [nr].concat(s.referrals), lastRef: { code, orgs: targets.map(t => t.name).join(', '), urgent: r.urgency.startsWith('Urgent') }, refSending: false });
      this.go('refDone');
    }, 900);
  };
  matches(r) { return this.state.orgs.filter(o => o.id !== r.orgId && r.cat && o.cats.includes(r.cat) && o.verified && o.avail !== 'Full').slice(0, 2); }

  renderVals() {
    const s = this.state, narrow = s.w < 760, wide = !narrow, brand = this.props.brandName || 'Co-mission Catalyst';
    const I = {}; Object.keys(this.ICONS).forEach(k => I[k] = this.ic(k, k === 'mark' ? 24 : 18));
    I.bigCheck = this.ic('check', 36); I.markLg = this.ic('mark', 40);
    const spinner = React.createElement('span', { 'aria-hidden': true, style: { width: 18, height: 18, border: '2px solid currentColor', borderRightColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'bbspin .7s linear infinite' } });
    const pk = this.pickVals();
    const tour = this.tourLayer();
    const base = { tour, pk, brand, I, spinner, narrow, wide, frameRef: this.frameRef, ready: !!s.ready,
      frameStyle: s.mobilePreview ? { maxWidth: 390, margin: '0 auto', minHeight: '100vh', background: 'var(--color-bg)', boxShadow: 'var(--shadow-lg)', position: 'relative' } : { minHeight: '100vh', background: 'var(--color-bg)', position: 'relative' } };
    if (!s.ready) return base;
    const D = this.D, PUBLIC = ['home', 'directory', 'listing', 'refer', 'refDone', 'track', 'about', 'login', 'signup', 'pending'];
    const scr = {}; PUBLIC.concat(['dash', 'mod', 'system', 'exit']).forEach(k => scr[k] = s.screen === k);
    const nav = {}; ['home', 'directory', 'track', 'about', 'login', 'signup', 'mod', 'system'].forEach(k => nav[k] = () => this.go(k));
    nav.dash = () => this.go('dash', { dashTab: 'overview', selRef: null });
    nav.directory = () => this.go('directory', { view: 'list', density: 'compact', mapSel: null });
    nav.referNow = () => this.startRef(null);
    nav.allOrgs = () => this.go('directory', { filters: this.blankFilters() });
    const linkStyle = a => ({ background: 'none', border: 0, borderBottom: '2px solid ' + (a ? 'var(--color-bg)' : 'transparent'), cursor: 'pointer', fontSize: 16, minHeight: 44, padding: '0 4px', color: 'var(--color-bg)', fontWeight: a ? 600 : 400 });
    const pubLinks = [['directory', 'Find help'], ['track', 'Track a referral'], ['about', 'About'], ['login', 'For organizations']].map(([k, label]) => {
      const a = s.screen === k || (k === 'directory' && s.screen === 'listing') || (k === 'login' && ['signup', 'pending'].includes(s.screen));
      return { label, go: nav[k], style: linkStyle(a), mstyle: { display: 'flex', alignItems: 'center', width: '100%', minHeight: 52, padding: '0 20px', background: a ? 'var(--color-accent-800)' : 'transparent', border: 0, borderBottom: '1px solid var(--color-accent-800)', fontSize: 17, textAlign: 'left', cursor: 'pointer', color: 'var(--color-bg)' } };
    });
    const catOptions = D.CATS.map(c => ({ k: c.k, label: c.label }));
    const count = k => s.orgs.filter(o => o.cats.includes(k)).length;
    const quickCats = ['food', 'housing', 'utility', 'clothing', 'counseling', 'recovery', 'transport', 'jobs', 'medical', 'youth'].map(k => ({ label: this.cat(k).label, icon: this.ic(this.cat(k).icon, 40), count: count(k) + ' organizations', go: () => this.searchCat(k) }));
    const per = narrow ? 2 : 5, total = quickCats.length, idx = s.catIdx || 0, gap = 18, pos = idx + total;
    const catCar = { items: quickCats.concat(quickCats, quickCats).map((c, i) => Object.assign({}, c, { dup: i < total || i >= 2 * total ? 'true' : undefined, cell: { flex: '0 0 calc((100% - ' + (per - 1) * gap + 'px) / ' + per + ')', minWidth: 0, display: 'flex', opacity: i >= pos && i < pos + per ? 1 : 0, transition: s.catNoAnim ? 'none' : 'opacity .3s ease', pointerEvents: i >= pos && i < pos + per ? 'auto' : 'none' } })),
      trackStyle: { display: 'flex', gap, transform: 'translateX(calc(' + (-pos) + ' * ((100% - ' + (per - 1) * gap + 'px) / ' + per + ' + ' + gap + 'px)))', transition: s.catNoAnim ? 'none' : 'transform .3s cubic-bezier(.65,0,.35,1)' },
      cellStyle: { flex: '0 0 calc((100% - ' + (per - 1) * gap + 'px) / ' + per + ')', minWidth: 0, display: 'flex' },
      settle: e => { if (e.target !== e.currentTarget) return; const cur = this.state.catIdx || 0, n = ((cur % total) + total) % total; if (n !== cur) { this.setState({ catIdx: n, catNoAnim: true }); requestAnimationFrame(() => requestAnimationFrame(() => this.setState({ catNoAnim: false }))); } },
      next: () => this.setState(st => ({ catIdx: (st.catIdx || 0) + 1, catNoAnim: false })), prev: () => this.setState(st => ({ catIdx: (st.catIdx || 0) - 1, catNoAnim: false })) };
    const popular = ['food', 'utility', 'housing', 'clothing', 'recovery'].map(k => ({ label: this.cat(k).label, icon: this.ic(this.cat(k).icon, 16), go: () => this.searchCat(k) }));
    const fv = s.orgs.filter(o => o.verified).map(o => this.dec(o)); const featured = fv.concat(fv).map((o, i) => Object.assign({}, o, { dup: i >= fv.length ? 'true' : undefined }));
    const featCardStyle = { flex: '0 0 ' + (narrow ? 'calc(85% - 11px)' : 'calc((100% - 44px) / 3)'), border: '1px solid var(--color-neutral-400)', background: 'var(--color-neutral-100)', boxShadow: 'var(--shadow-sm)', padding: 20, gap: 12 };

    // directory
    const res = this.results(), f = s.filters;
    const favs = s.favs || [];
    const favBits = id => { const on = favs.includes(id), nm = (this.org(id) || {}).name || ''; return { favOn: on ? 'true' : 'false', favIcon: on ? '★' : '☆', favLabel: on ? 'Favorited' : 'Add to favorites', favAria: on ? 'Remove ' + nm + ' from favorites' : 'Add ' + nm + ' to favorites',
      favStyle: { background: 'none', border: 0, padding: '2px 4px', minWidth: 32, minHeight: 32, fontSize: 20, lineHeight: 1, cursor: 'pointer', flex: '0 0 auto', color: on ? 'var(--color-accent-700)' : 'var(--color-neutral-600)' },
      toggleFav: e => { if (e && e.stopPropagation) e.stopPropagation(); this.setState(st => { const F = st.favs || []; return { favs: F.includes(id) ? F.filter(x => x !== id) : F.concat(id) }; }); } }; };
    const results = res.map((o, i) => Object.assign(this.dec(o), { n: i + 1 }, favBits(o.id)));
    const favList = results.filter(o => favs.includes(o.id));
    const restResults = results.filter(o => !favs.includes(o.id));
    const noFavsText = favs.length ? 'None of your favorites match this search or these filters.' : 'Open an organization and choose “Add to favorites” to keep it here.';
    const worked = [['zion', 14], ['greenleaf', 9], ['brendan', 7], ['ridgeview', 5], ['career', 3]].filter(([id]) => this.org(id)).map(([id, c]) => Object.assign(this.dec(this.org(id)), { count: c + ' referrals together' }));
    const fCats = D.CATS.map(c => ({ label: c.label, icon: this.ic(c.icon, 16), on: f.cats.includes(c.k), style: this.chip(f.cats.includes(c.k)), toggle: () => this.toggleIn('filters.cats', c.k) }));
    const typeChips = ['Church', 'Nonprofit', 'Government'].map(t => ({ label: t, on: f.types.includes(t), style: this.chip(f.types.includes(t)), toggle: () => this.toggleIn('filters.types', t) }));
    const active = [];
    if (f.q) active.push(['“' + f.q + '”', () => this.upd('filters.q', '')]);
    f.cats.forEach(k => active.push([this.cat(k).label, () => this.toggleIn('filters.cats', k)]));
    if (f.faith !== 'any') active.push([f.faith === 'yes' ? 'Faith-based only' : 'Not faith-based', () => this.upd('filters.faith', 'any')]);
    f.types.forEach(t => active.push([t, () => this.toggleIn('filters.types', t)]));
    [['county', f.county], ['st', f.st], ['hood', f.hood], ['lang', f.lang], ['cost', f.cost], ['elig', f.elig]].forEach(([k, v]) => v && active.push([v, () => this.upd('filters.' + k, '')]));
    if (f.openNow) active.push(['Open now', () => this.upd('filters.openNow', false)]);
    if (f.accepting) active.push(['Accepting applications now', () => this.upd('filters.accepting', false)]);
    const activeChips = active.map(([label, remove]) => ({ label, remove, aria: 'Remove filter ' + label }));
    const mapSel = s.mapSel && results.find(o => o.id === s.mapSel);
    const GEO = { hope: [33.5398, -86.7468], zion: [33.5163, -86.8812], greenleaf: [33.4932, -86.8379], brendan: [33.5318, -86.7208], newground: [33.5226, -86.7748], cornerstone: [33.5012, -86.7987], legal: [33.5191, -86.8079], clinic: [33.4986, -86.7932], career: [33.5372, -86.8067], shades: [33.4797, -86.7905], senior: [33.5224, -86.8102], housing: [33.5212, -86.8122], ridgeview: [33.5653, -86.7149] };
    this._mapPins = results.filter(o => !o.sensitive && (o.lat || GEO[o.id])).map(o => ({ id: o.id, n: o.n, name: o.name, lat: o.lat || GEO[o.id][0], lng: o.lng || GEO[o.id][1] })); this._mapSel = s.mapSel;
    const mapPins = results.filter(o => !o.sensitive).map(o => ({ n: o.n, name: o.name, pick: () => this.setState({ mapSel: o.id }),
      style: { position: 'absolute', left: o.x + '%', top: o.y + '%', transform: 'translate(-50%,-50%)', width: 34, height: 34, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--color-accent-700)', background: s.mapSel === o.id ? 'var(--color-accent-700)' : 'var(--color-bg)', color: s.mapSel === o.id ? 'var(--color-bg)' : 'var(--color-accent-800)', boxShadow: 'var(--shadow-sm)' } }));
    const dir = {
      favList, restResults, noFavsText, hasFavs: favList.length > 0, favCompact: favList.length > 0 && s.density === 'compact', favDetailed: favList.length > 0 && (s.density || 'detailed') === 'detailed', noFavs: favList.length === 0, worked,
      q: this.bind('filters.q'), results, hasResults: !s.loading && results.length > 0, noResults: !s.loading && results.length === 0, loading: s.loading,
      showList: !s.loading && results.length > 0 && s.view === 'list', showMap: !s.loading && results.length > 0 && s.view === 'map',
      summary: results.length + (results.length === 1 ? ' organization' : ' organizations') + (s.homeZip ? ' near ' + s.homeZip : ' near you'),
      viewSeg: this.segOf('view', [['list', 'List'], ['map', 'Map']]), densitySeg: [['detailed', 'Detailed', 'Full cards'], ['compact', 'Compact', 'Short rows with key info']].map(([k, label, tip]) => ({ label, tip, on: (s.density || 'detailed') === k, pick: () => this.setState({ density: k }) })), detailed: (s.density || 'detailed') === 'detailed', compact: s.density === 'compact', showDensity: s.view !== 'map', sort: this.bind('sort'),
      fCats, typeChips, faithSeg: this.segOf('filters.faith', [['any', 'Any'], ['yes', 'Faith-based'], ['no', 'Not faith-based']]),
      costSeg: this.segOf('filters.cost', [['', 'Any'], ['Free', 'Free'], ['Sliding scale', 'Sliding scale']]),
      st: { v: f.st || '', on: e => { const v = e.target.value; this.setState(st2 => ({ filters: Object.assign({}, st2.filters, { st: v, county: '' }) })); } },
      county: { v: f.county || '', on: e => { const v = e.target.value; this.setState(st2 => ({ filters: Object.assign({}, st2.filters, { county: v }) })); } },
      states: [...new Set(s.orgs.map(o => this.stOf(o)).filter(Boolean))].sort(), counties: [...new Set(s.orgs.filter(o => !f.st || this.stOf(o) === f.st).map(o => this.countyOf(o)).filter(Boolean))].sort(),
      countyAll: f.st ? 'All of ' + f.st : 'All counties',
      hood: this.bind('filters.hood'), lang: this.bind('filters.lang'), elig: this.bind('filters.elig'), openNow: this.bind('filters.openNow'), accepting: this.bind('filters.accepting'),
      hoods: D.HOODS, langs: D.LANGS, eligs: D.ELIG, activeChips, hasActive: activeChips.length > 0,
      clear: () => this.setState({ filters: this.blankFilters(), homeZip: '' }),
      layoutStyle: wide ? { display: 'flex', flexDirection: 'column', gap: 22 } : { display: 'block' },
      filterStyle: wide ? (s.filtersOpen ? { border: '1px solid var(--color-neutral-400)', background: 'var(--color-bg)', boxShadow: 'var(--shadow-md)', padding: '20px 22px' } : { display: 'none' }) : s.filtersOpen ? { position: 'fixed', inset: 0, zIndex: 70, background: 'var(--color-bg)', overflowY: 'auto', padding: 20 } : { display: 'none' },
      drawerOpen: narrow && s.filtersOpen, openFilters: () => this.setState({ filtersOpen: true }), toggleFilters: () => this.setState({ filtersOpen: !s.filtersOpen }), filtersExpanded: s.filtersOpen ? 'true' : 'false', filterInner: wide ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '20px 28px', alignItems: 'start' } : { display: 'flex', flexDirection: 'column', gap: 22 }, filterBtnStyle: { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 16px', fontSize: 16, cursor: 'pointer', border: '1px solid ' + (s.filtersOpen ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: s.filtersOpen && wide ? 'var(--color-accent-700)' : 'var(--color-bg)', color: s.filtersOpen && wide ? 'var(--color-bg)' : 'var(--color-text)' }, closeFilters: () => this.setState({ filtersOpen: false }),
      filtersLabel: 'Filters' + (activeChips.length ? ' (' + activeChips.length + ')' : ''), showLabel: 'Show ' + results.length + ' results',
      mapPins, mapSel: mapSel || null, hasMapSel: !!mapSel, privateCount: results.filter(o => o.sensitive).length, hasPrivate: results.some(o => o.sensitive),
      tryFood: () => this.setState({ filters: Object.assign(this.blankFilters(), { cats: ['food'] }) })
    };

    // listing
    const lo = this.dec(this.org(s.orgId));
    const mkL = lo => Object.assign(lo, { hasMap: !lo.sensitive && !!lo.addr && !!(lo.lat || GEO[lo.id]), mapSrc: 'co-map.html#one=' + (lo.lat || (GEO[lo.id] || [])[0]) + ',' + (lo.lng || (GEO[lo.id] || [])[1]), availBox: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 14, fontWeight: 500, color: lo.availDotColor || 'var(--color-text)', fontWeight: 600, gap: 8 },
      showFav: s.pubView ? s.orgId !== 'hope' : !!s.fromDash, favBtn: favBits(s.orgId),
      addrLine: lo.sensitive ? 'Address shared after contact' : lo.addr || (lo.hood + ' · No walk-in address listed — call or visit online'), hasAddr: !lo.sensitive && !!lo.addr, mapHref: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lo.addr || ''), hasAddr2: !lo.sensitive && !!lo.addr2, phoneHref: /^[0-9+(]/.test(lo.phone) ? 'tel:' + lo.phone : 'https://' + lo.phone,
      noHours: !(lo.hours || []).some(h => h && !/call for hours|no hours/i.test(h)), hasHours: (lo.hours || []).some(h => h && !/call for hours|no hours/i.test(h)),
      hoursRows: D.ORGS && ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => ({ d, h: lo.hours[i], today: i === 2, style: { display: 'grid', gridTemplateColumns: '112px 1fr', gap: 12, padding: '9px 12px', borderBottom: '1px solid var(--color-divider)', borderLeft: '3px solid ' + (i === 2 ? 'var(--color-accent-700)' : 'transparent'), background: i === 2 ? 'var(--color-accent-100)' : (i % 2 ? 'var(--color-neutral-100)' : 'transparent'), fontWeight: i === 2 ? 600 : 400, fontVariantNumeric: 'tabular-nums' } })),
      groups: Object.keys(lo.services).map(k => ({ label: this.cat(k).label, icon: this.ic(this.cat(k).icon, 20), items: lo.services[k] })),
      partnerOrgs: (lo.partners || []).map(id => this.dec(this.org(id))),
      langList: lo.langs.join(', '), docsTitle: (lo.docsTitle || '').trim() || 'Good to know', eligList: lo.elig.join(' · '),
      contactName: lo.contact[0], contactRole: lo.contact[1], contactEmail: lo.contact[2],
      notSensitive: !lo.sensitive, vDateText: lo.vDate || 'not yet confirmed', verifiedLine: lo.verified ? 'Verified · Checked ' + lo.vDate : ''
    });
    const listing = mkL(lo);

    // referral flow
    const r = s.ref, ro = r.orgId ? this.dec(this.org(r.orgId)) : null, few = this.matches(r);
    const RQ = (ro && ro.appQs) || [], RN = RQ.length ? 4 : 3;
    const refer = {
      org: ro, hasOrg: !!ro, noOrg: !ro, title: ro ? 'Apply for help at ' + ro.name : 'Apply for help', orgName: ro ? ro.name : '',
      sQ: RQ.length > 0 && s.refStep === 3, stepsGrid: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(' + RN + ',1fr)', gap: 8 },
      qs: RQ.map(q => { const v = (r.answers || {})[q.id] || '', setA = val => this.setState(st => ({ ref: Object.assign({}, st.ref, { answers: Object.assign({}, st.ref.answers || {}, { [q.id]: val }) }) })); return { q: q.q, reqLabel: q.req ? '' : '(optional)', name: 'rq-' + q.id, v, on: e => setA(e.target.value), isNum: q.type === 'number', canRange: q.type === 'number' && !!q.allowRange, ranged: q.type === 'number' && !!q.allowRange && !!(r.answers || {})[q.id + '_r'], exact: q.type === 'number' && !(q.allowRange && (r.answers || {})[q.id + '_r']),
        nMin: q.min == null ? '' : q.min, nMax: q.max == null ? '' : q.max, nHint: q.min != null && q.max != null ? q.min + '–' + q.max : 'Enter a number',
        toggleRanged: () => this.setState(st => { const A = Object.assign({}, st.ref.answers || {}); A[q.id + '_r'] = !A[q.id + '_r']; A[q.id] = ''; A[q.id + '_lo'] = ''; A[q.id + '_hi'] = ''; return { ref: Object.assign({}, st.ref, { answers: A }) }; }),
        lo: { v: (r.answers || {})[q.id + '_lo'] || '', on: e => this.setState(st => { const A = Object.assign({}, st.ref.answers || {}); A[q.id + '_lo'] = e.target.value; A[q.id] = A[q.id + '_lo'] && A[q.id + '_hi'] ? A[q.id + '_lo'] + '–' + A[q.id + '_hi'] + ' (estimate)' : ''; return { ref: Object.assign({}, st.ref, { answers: A }) }; }) },
        hi: { v: (r.answers || {})[q.id + '_hi'] || '', on: e => this.setState(st => { const A = Object.assign({}, st.ref.answers || {}); A[q.id + '_hi'] = e.target.value; A[q.id] = A[q.id + '_lo'] && A[q.id + '_hi'] ? A[q.id + '_lo'] + '–' + A[q.id + '_hi'] + ' (estimate)' : ''; return { ref: Object.assign({}, st.ref, { answers: A }) }; }) },
        isText: (q.type === 'text' || q.type === 'long') && (+(q.maxWords || (q.type === 'long' ? 150 : 25))) <= 25, isLong: (q.type === 'text' || q.type === 'long') && (+(q.maxWords || (q.type === 'long' ? 150 : 25))) > 25, isWritten: q.type === 'text' || q.type === 'long', wordLabel: (String(v || '').trim() ? String(v).trim().split(/\s+/).length : 0) + ' / ' + (q.maxWords || (q.type === 'long' ? 150 : 25)) + ' words', isSingle: q.type === 'yesno' || (q.type === 'choice' && !q.multi), isMulti: q.type === 'choice' && !!q.multi, choices: (q.type === 'yesno' ? ['Yes', 'No'] : (q.choices && q.choices.length ? q.choices : (q.opts || '').split(',').map(x => x.trim()).filter(Boolean))).map(c => { const arr = Array.isArray(v) ? v : (v ? [v] : []); return q.type === 'choice' && q.multi ? { label: c, on: arr.includes(c), pick: () => setA(arr.includes(c) ? arr.filter(x => x !== c) : arr.concat(c)) } : { label: c, on: v === c, pick: () => setA(c) }; }), err: (s.refErr || {})['q_' + q.id] || '' }; }),
      s1: s.refStep === 1, s2: s.refStep === 2, s3: s.refStep === RN, err: s.refErr, sending: s.refSending, notSending: !s.refSending,
      steps: ['Who it’s for', 'The need'].concat(RQ.length ? ['More questions'] : [], ['Consent & send']).map((l, i) => { const n = i + 1, a = n <= s.refStep; return { n: '0' + n, label: l, cur: n === s.refStep ? 'step' : undefined, bar: { height: 3, background: a ? 'var(--color-accent-700)' : 'var(--color-divider)' }, lbl: { fontSize: 14, fontWeight: n === s.refStep ? 700 : 500, color: a ? 'var(--color-text)' : 'var(--color-neutral-700)' } }; }),
      stepText: 'Step ' + s.refStep + ' of ' + RN,
      forWho: this.segOf('ref.forWho', [['self', 'Myself'], ['other', 'Someone else']]), isOther: r.forWho === 'other', identQ: r.forWho === 'self' ? 'How should we list your name?' : 'How should we name them?',
      ident: [['full', 'Full name'], ['first', 'First name only'], ['anon', 'Anonymous (initials only)']].map(([v, l]) => ({ label: l, on: r.ident === v, pick: () => this.upd('ref.ident', v) })),
      nameLabel: r.forWho === 'self' ? (r.ident === 'full' ? 'Your full name' : r.ident === 'first' ? 'Your first name' : 'Your initials') : (r.ident === 'full' ? 'Their full name' : r.ident === 'first' ? 'Their first name' : 'Their initials'),

      first: this.bind('ref.first'), last: this.bind('ref.last'), phone: this.bind('ref.phone'), phoneUnknown: this.bind('ref.phoneUnknown'), phoneOff: r.forWho === 'other' && !!r.phoneUnknown, phoneOn: !(r.forWho === 'other' && r.phoneUnknown),
      firstLabel: r.forWho === 'self' ? 'Your first name' : 'Their first name', lastLabel: r.forWho === 'self' ? 'Your last name' : 'Their last name', phoneLabel: r.forWho === 'self' ? 'Your phone number' : 'Their phone number', lastOptional: r.addrMode === 'safety',
      addrQ: r.forWho === 'self' ? 'Where do you live?' : 'Where do they live?',
      addrModes: [['home', r.forWho === 'self' ? 'I have a home address' : 'They have a home address'], ['nofixed', 'No fixed address (staying in a shelter, car, outside, or with friends)']].concat(r.forWho === 'other' ? [['unknown', 'I don’t know their address']] : []).concat(['dv', 'housing', 'legal', 'counseling'].includes(r.cat) ? [['safety', 'I have a safety concern and can’t share an address right now']] : []).map(([v, l]) => ({ label: l, on: r.addrMode === v, pick: () => v === 'safety' ? this.modal({ kind: 'safetyWarn' }) : this.setState(st => ({ ref: Object.assign({}, st.ref, { addrMode: v }), refErr: Object.assign({}, st.refErr, { addr: '' }) })) })),
      addrHome: r.addrMode === 'home', addrNoFixed: r.addrMode === 'nofixed', addrUnknown: r.addrMode === 'unknown', addrSafety: r.addrMode === 'safety',
      street: this.bind('ref.street'), apt: this.bind('ref.apt'), city: this.bind('ref.city'), zip: this.bind('ref.zip'), where: this.bind('ref.where'),
      safetyNote: ['dv', 'housing', 'legal', 'counseling'].includes(r.cat) ? '' : 'Choosing domestic violence, housing and shelter, legal aid, or counseling adds a safety option here.', hasSafetyNote: !['dv', 'housing', 'legal', 'counseling'].includes(r.cat),
      noPass: this.bind('ref.noPass'), noPassOn: !!r.noPass, orgName0: ro ? ro.name : 'the organization',
      name: this.bind('ref.name'), referrer: this.bind('ref.referrer'), refName: this.bind('ref.refName'), refType: this.bind('ref.refType'), refOrg: this.bind('ref.refOrg'), refContact: this.bind('ref.refContact'), refTypes: ['Organization or church', 'Friend or neighbor', 'Family member', 'No organization'], hasRefOrg: r.refType === 'Organization or church', cat: this.bind('ref.cat'), desc: this.bind('ref.desc'), household: this.bind('ref.household'), lang: this.bind('ref.lang'), contactVal: this.bind('ref.contactVal'), consent: this.bind('ref.consent'),
      urg: this.segOf('ref.urgency', this.URG), contact: this.segOf('ref.contact', ['Phone call', 'Text', 'Email', 'Through me']),
      needsContact: r.contact === 'Email', contactLabel: r.forWho === 'self' ? 'Your email' : 'Their email',
      descCount: r.desc.length + ' / 300', households: ['1', '2', '3', '4', '5', '6', '7', '8+'], langs: D.LANGS,
      sendOpts: (ro ? [['one', 'Send only to ' + ro.name]] : []).concat(few.length ? [['few', 'Send to a few matching organizations' + (ro ? ' (this one plus ' + few.length + ' more)' : '')]] : []).map(([v, l]) => ({ label: l, on: r.send === v, pick: () => this.upd('ref.send', v) })),
      fewNames: few.map(o => o.name).join(' · '), showFew: r.send === 'few' && few.length > 0,
      summary: [['For', (r.forWho === 'self' ? 'Applying for self · ' : '') + ([r.first, r.last].filter(Boolean).join(' ') || '—')], ['Phone', r.forWho === 'other' && r.phoneUnknown ? 'Not known' : (r.phone || '—')], ['Address', r.addrMode === 'home' ? [r.street, r.apt, r.city, 'AL ' + r.zip].filter(x => x && x.trim()).join(', ') : r.addrMode === 'nofixed' ? 'No fixed address · ' + (r.where || '') : r.addrMode === 'unknown' ? 'Not known' : 'Not shared (safety concern)'], ['Need', r.cat ? this.cat(r.cat).label : '—'], ['How soon', r.urgency || '—'], ['Household', r.household + (r.household === '1' ? ' person' : ' people')], ['Language', r.lang], ['Best contact', r.contact + (r.contact === 'Email' && r.contactVal ? ' · ' + r.contactVal : '')], ['Passing on', r.noPass ? 'Don’t pass to other organizations' : 'Can be passed to another organization if needed']].concat(RQ.map(q => [q.q, [].concat((r.answers || {})[q.id] || []).join(', ') || '—'])).map(([k, v]) => ({ k, v })),
      next: this.refNext, nextLabel: s.refStep === RN ? 'Send application' : 'Continue',
      back: () => s.refStep > 1 ? this.setState({ refStep: s.refStep - 1, refErr: {} }) : (ro ? this.openOrg(ro.id) : this.go('directory')),
      backLabel: s.refStep > 1 ? 'Back' : 'Cancel'
    };
    const lr = s.lastRef || { code: '', orgs: '', urgent: false };
    const refDone = Object.assign({}, lr, { track: () => this.go('track', { trackIn: lr.code, trackCode: lr.code, trackErr: '' }), again: () => this.startRef(null), responseTime: lr.urgent ? 'Urgent referrals are flagged at the top of each organization’s list. Most respond the same day.' : 'Most organizations respond within 1 business day.' });

    // track
    const tr = s.trackCode && s.referrals.find(x => x.code.toLowerCase() === s.trackCode.toLowerCase());
    const track = { input: this.bind('trackIn'), err: s.trackErr, hasErr: !!s.trackErr,
      go: e => { e.preventDefault(); const c = s.trackIn.trim(); const hit = s.referrals.find(x => x.code.toLowerCase() === c.toLowerCase()); this.setState(hit ? { trackCode: hit.code, trackErr: '' } : { trackCode: null, trackErr: c ? 'We couldn’t find “' + c + '”. Check for typos — numbers look like CC-2611-4810.' : 'Enter the reference number from your confirmation.' }); },
      res: tr ? Object.assign({ code: tr.code, org: this.org(tr.to).name, stage: tr.stage, steps: this.steps(tr.stage), updates: tr.log.filter(l => !l.internal).slice().reverse(), stageStyle: Object.assign({}, this.chipBase, this.STAGE[tr.stage]) }, this.passInfo(tr), tr.passTo ? { org: this.org(tr.passTo).name, stage: tr.passStage, steps: this.steps(tr.passStage), stageStyle: Object.assign({}, this.chipBase, this.STAGE[tr.passStage]) } : {}) : null, has: !!tr,
      sample: () => this.setState({ trackIn: 'CC-2611-4810' }),
      email: this.bind('prefs.email'), text: this.bind('prefs.text'), app: this.bind('prefs.app'), save: () => this.toast('Notification settings saved.') };

    // about
    const ab = s.about;
    const about = { name: this.bind('about.name'), email: this.bind('about.email'), msg: this.bind('about.msg'), err: ab.err, sent: ab.sent, notSent: !ab.sent,
      send: e => { e.preventDefault(); const err = {}; if (!ab.name.trim()) err.name = 'Please add your name.'; if (!/.+@.+\..+/.test(ab.email)) err.email = 'Please add an email we can reply to.'; if (ab.msg.trim().length < 5) err.msg = 'Please write a short message.'; this.setState({ about: Object.assign({}, ab, { err, sent: !Object.keys(err).length }) }); } };

    // login / signup
    const lg = s.login;
    const login = { email: this.bind('login.email'), pw: this.bind('login.pw'), err: lg.err, hasErr: !!lg.err, loading: lg.loading, notLoading: !lg.loading,
      go: e => { e.preventDefault(); if (!/.+@.+/.test(lg.email)) return this.upd('login.err', 'Enter the email your organization signed up with.'); if (!lg.pw) return this.upd('login.err', 'Enter your password. (Prototype: any password works.)'); this.setState({ login: Object.assign({}, lg, { err: '', loading: true }) }); setTimeout(() => { this.setState({ login: Object.assign({}, this.state.login, { loading: false }) }); nav.dash(); }, 800); } };
    const su = s.signup;
    const signup = { s1: su.step === 1, s2: su.step === 2, s3: su.step === 3, err: su.err, stepText: 'Step ' + su.step + ' of 3',
      steps: ['About your organization', 'Services', 'Verification'].map((l, i) => { const a = i + 1 <= su.step; return { n: '0' + (i + 1), label: l, bar: { height: 3, background: a ? 'var(--color-accent-700)' : 'var(--color-divider)' }, lbl: { fontSize: 14, fontWeight: i + 1 === su.step ? 700 : 500, color: a ? 'var(--color-text)' : 'var(--color-neutral-700)' } }; }),
      name: this.bind('signup.name'), type: this.bind('signup.type'), hood: this.bind('signup.hood'), phone: this.bind('signup.phone'), email: this.bind('signup.email'), services: this.bind('signup.services'), serves: this.bind('signup.serves'), refOrg: this.bind('signup.refOrg'), refName: this.bind('signup.refName'),
      faith: this.segOf('signup.faith', [['yes', 'Yes, faith-based'], ['no', 'No']]), types: ['Church', 'Nonprofit', 'Government', 'School'], hoods: D.HOODS,
      cats: D.CATS.map(c => ({ label: c.label, icon: this.ic(c.icon, 16), style: this.chip(su.cats.includes(c.k)), on: su.cats.includes(c.k), toggle: () => this.toggleIn('signup.cats', c.k) })),
      methods: [['doc', 'Upload a document', 'IRS letter, church bulletin, or letterhead with your address'], ['ref', 'A reference from a verified organization', 'Someone already in the network who knows your work']].map(([v, l, h]) => ({ label: l, hint: h, on: su.method === v, pick: () => this.upd('signup.method', v) })),
      isDoc: su.method === 'doc', isRef: su.method === 'ref', fileName: su.fileName, hasFile: !!su.fileName, noFile: !su.fileName,
      pickFile: () => this.upd('signup.fileName', 'ministry-letterhead.pdf'), verifiedOrgs: s.orgs.filter(o => o.verified).map(o => o.name),
      back: () => su.step > 1 ? this.upd('signup.step', su.step - 1) : this.go('login'), backLabel: su.step > 1 ? 'Back' : 'Cancel', nextLabel: su.step === 3 ? 'Request verification' : 'Continue',
      next: () => { const err = {}; if (su.step === 1) { if (!su.name.trim()) err.name = 'Add your organization’s name.'; if (!/.+@.+\..+/.test(su.email)) err.email = 'Add an email for your organization.'; } if (su.step === 2 && !su.cats.length) err.cats = 'Choose at least one kind of help you offer.'; if (su.step === 3) { if (su.method === 'doc' && !su.fileName) err.file = 'Add a document, or choose a reference instead.'; if (su.method === 'ref' && (!su.refOrg || !su.refName.trim())) err.ref = 'Choose the organization and add the person’s name.'; }
        if (Object.keys(err).length) return this.upd('signup.err', err); if (su.step < 3) return this.setState({ signup: Object.assign({}, su, { step: su.step + 1, err: {} }) }); this.go('pending'); },
      orgName: su.name || 'Your organization' };

    // dashboard
    const hopeR = s.referrals.filter(x => x.to === 'hope');
    const unread = s.threads.reduce((a, t) => a + t.unread, 0);
    const newN = hopeR.filter(x => ['Submitted', 'Seen'].includes(x.stage)).length;
    const openNeeds = s.needs.filter(n => n.status === 'Unclaimed' && !n.notFit && (!(s.needRad ?? 25) || n.mi <= (s.needRad ?? 25))).length;
    const tabs = [['org', 'My organization', 'home'], ['directory', 'Find help', 'search'], ['favs', 'Favorites', 'star']].concat((s.myDash || []).length > 1 ? [['dashes', 'Your dashboards', 'grid']] : []).concat([['settings', 'Settings', 'gear']]);
    const tab = {}; tabs.forEach(([k]) => tab[k] = s.dashTab === k); tab.history = s.dashTab === 'history'; tab.profile = s.dashTab === 'profile'; tab.cases = s.dashTab === 'cases';
    const mini = wide && s.navMini;
    const dashTabs = tabs.map(([k, label, icon, n]) => { const a = s.dashTab === k; return { tour: 'nav-' + k, label, icon: this.ic(icon, 18), count: n, hasCount: !!n, showLabel: !mini, dot: mini && !!n, aria: mini ? label + (n ? ', ' + n + ' new' : '') : undefined, tip: mini ? label : undefined, cur: a ? 'page' : undefined, go: () => { this.setState(Object.assign(k === 'directory' ? { view: 'list', density: 'compact', mapSel: null } : {}, { dashTab: k, selRef: k === 'referrals' && !s.ovPop && !s.casePop ? s.selRef : null, ovPop: false, casePop: false, selThread: k === 'messages' ? null : s.selThread })); try { window.scrollTo(0, 0); } catch (e) {} },
      style: Object.assign({ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 12px', border: 0, cursor: 'pointer', fontSize: 15, color: a ? 'var(--color-accent-900)' : 'var(--color-text)', background: a ? 'var(--color-accent-100)' : 'transparent', textAlign: 'left' }, narrow ? { flex: 'none', borderBottom: '2px solid ' + (a ? 'var(--color-accent-700)' : 'transparent') } : Object.assign({ width: '100%', borderLeft: '2px solid ' + (a ? 'var(--color-accent-700)' : 'transparent') }, mini ? { justifyContent: 'center', padding: 0, minHeight: 48 } : {}, k === (tabs.some(x => x[0] === 'dashes') ? 'dashes' : 'settings') ? { marginTop: 'auto' } : {})) }; });
    const hope = this.dec(this.org('hope'));
    const qf = s.qFilter;
    const kindOf = x => x.shared ? 'shared' : /^Self/.test(x.from || '') ? 'app' : 'ref', ck = s.caseKind || 'all';
    const KD = [['all', 'All cases', 'list', 'Every case and its status'], ['app', 'Applications', 'users', 'Individuals who applied'], ['ref', 'Referrals', 'inbox', 'Sent by other organizations'], ['shared', 'Shared cases', 'layers', 'Working with partners']];
    const caseCards = KD.map(([k, label, icon, hint]) => { const list = k === 'all' ? hopeR : hopeR.filter(x => kindOf(x) === k), on = ck === k, openN = list.filter(x => !['Completed', 'Declined', 'Redirected'].includes(x.stage)).length;
      return { label, hint, icon: this.ic(icon, 20), n: list.length, openLabel: openN + ' open', on, pressed: on ? 'true' : 'false', pick: () => this.setState({ caseKind: k, qFilter: 'all', sharedF: 'show' }),
        style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', background: on ? 'var(--color-accent-100)' : 'var(--color-bg)', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), boxShadow: on ? 'inset 0 -3px 0 var(--color-accent-700)' : 'var(--shadow-sm)' },
        iconStyle: { display: 'grid', placeItems: 'center', width: 36, height: 36, flex: 'none', background: on ? 'var(--color-accent-700)' : 'var(--color-accent-100)', color: on ? 'var(--color-bg)' : 'var(--color-accent-800)' } }; });
    const KL = { app: 'Application', ref: 'Referral', shared: 'Shared case' };
    const queue = hopeR.filter(x => ck === 'all' || kindOf(x) === ck).filter(x => qf === 'all' || (qf === 'new' && ['Submitted', 'Seen'].includes(x.stage)) || (qf === 'active' && ['Accepted', 'In progress'].includes(x.stage)) || (qf === 'closed' && ['Completed', 'Declined', 'Redirected'].includes(x.stage))).filter(x => { const sf = s.sharedF || 'show'; return sf !== 'only' || (!!x.shared && !['Completed', 'Declined', 'Redirected'].includes(x.stage)); }).map(x => Object.assign(this.decRef(x), { kindLabel: KL[kindOf(x)], isApp: kindOf(x) === 'app', isRefK: kindOf(x) === 'ref' }));
    const sr = s.selRef && s.referrals.find(x => x.id === s.selRef);
    let selPrimary = [], selSecondary = [];
    if (sr) {
      const pass = () => sr.noPass ? this.toast('This person asked not to have their information passed on. Let them know they’ll need to apply somewhere else.') : this.modal({ kind: 'pass', target: 'ref', id: sr.id }), decline = () => this.modal({ kind: 'decline', id: sr.id });
      if (['Submitted', 'Seen'].includes(sr.stage)) { selPrimary = [{ label: 'Accept referral', go: () => this.setStage(sr.id, 'Accepted', 'Accepted. We will reach out within 1 business day.', 'Referral accepted. The referrer has been notified.') }]; selSecondary = [{ label: 'Decline…', go: decline }, { label: 'Pass to another organization…', go: pass }]; }
      else if (sr.stage === 'Accepted') { selPrimary = [{ label: 'Mark in progress', go: () => this.setStage(sr.id, 'In progress', 'Started helping.', 'Marked in progress.') }]; selSecondary = [{ label: 'Pass to another organization…', go: pass }, { label: 'Decline…', go: decline }]; }
      else if (sr.stage === 'In progress') { selPrimary = [{ label: 'Mark completed', go: () => this.setStage(sr.id, 'Completed', 'Completed. Thank you for serving.', 'Referral completed.') }]; selSecondary = [{ label: 'Pass to another organization…', go: pass }]; }
    }
    const A = sr ? (sr.addr || {}) : {};
    const sel = sr ? Object.assign(this.decRef(sr), { fullName: [sr.first, sr.last].filter(Boolean).join(' ') || sr.who, phoneLabel: sr.phone || 'Not given', hasPhone: !!sr.phone, phoneHref: 'tel:' + String(sr.phone || '').replace(/\D/g, ''), addrLabel: A.mode === 'home' ? [A.street, A.apt].filter(Boolean).join(', ') + ' · ' + A.city + ', AL ' + A.zip : A.mode === 'nofixed' ? 'No fixed address · ' + (A.where || '') : A.mode === 'unknown' ? 'Not known. Ask when you follow up.' : A.mode === 'safety' ? 'Not shared (safety concern)' : 'Not given', isSafety: !!sr.safety, isNoPass: !!sr.noPass, hasContactInfo: true, caseProjs: (s.projs || []).filter(p => p.caseId === sr.id).map(p => ({ title: p.title, status: p.status, statusStyle: Object.assign({ padding: '1px 7px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }, p.status === 'Active' ? { background: 'var(--color-accent-700)', color: 'var(--color-bg)' } : p.status === 'Completed' ? { border: '1px dashed var(--color-neutral-500)', color: 'var(--color-neutral-700)' } : { background: 'var(--color-accent-100)', color: 'var(--color-accent-900)' }), open: () => this.setState({ dashTab: 'projects', projSel: p.id, projDraft: {}, casePop: false, ovPop: false }) })), noCaseProjs: !(s.projs || []).some(p => p.caseId === sr.id), newCaseProj: () => this.projForm(null, 'Case project', sr.id, { pTitle: this.cat(sr.cat).label + ' for ' + sr.who, pDesc: sr.desc, pPri: sr.urgency.startsWith('Urgent') ? 'High' : 'Normal', pNeed: '' }), steps: this.steps(sr.stage), log: sr.log.slice().reverse().map(l => Object.assign({}, l, { tag: l.internal ? 'Internal note' : '', isInternal: !!l.internal })),
      facts: [['Need', this.cat(sr.cat).label], ['How soon', sr.urgency], ['Household', sr.household + (sr.household === '1' ? ' person' : ' people')], ['Language', sr.lang], ['Best contact', sr.contact], ['Referred by', sr.from], ['Received', sr.when]].concat(sr.answers || []).map(([k, v]) => ({ k, v })),
      closed: ['Completed', 'Declined', 'Redirected'].includes(sr.stage) }) : null;
    const rad = s.needRad ?? 25;
    const hopeCats = (this.org('hope') || {}).cats || [], urgRank = u => u.startsWith('Urgent') ? 0 : u === 'This week' ? 1 : 2;
    const sortK = s.needSort || 'relevance', claimedLast = (a, b) => (a.status === 'Claimed') - (b.status === 'Claimed');
    const sorters = { relevance: (a, b) => claimedLast(a, b) || (hopeCats.includes(b.cat) - hopeCats.includes(a.cat)) || urgRank(a.urg) - urgRank(b.urg) || a.mi - b.mi, closest: (a, b) => claimedLast(a, b) || a.mi - b.mi, urgent: (a, b) => claimedLast(a, b) || urgRank(a.urg) - urgRank(b.urg) || a.mi - b.mi, waiting: (a, b) => claimedLast(a, b) || b.age - a.age };
    const needs = s.needs.slice().sort(sorters[sortK] || sorters.relevance).filter(n => (!rad || n.mi <= rad) && (!s.needF.cat || n.cat === s.needF.cat) && (!s.needF.urg || n.urg === s.needF.urg) && (!s.needF.status || n.status === s.needF.status)).map(n => Object.assign({}, n, {
      catLabel: this.cat(n.cat).label, catIcon: this.ic(this.cat(n.cat).icon, 16), isUrgent: n.urg.startsWith('Urgent'), isOrg: n.kind === 'Organization', isNeighbor: n.kind !== 'Organization',
      fit: !n.notFit, isNotFit: !!n.notFit, notFitNote: n.notFit ? 'You marked this “not a fit”: ' + n.notFit : '', canAct: !n.notFit && n.status === 'Unclaimed', isMatch: hopeCats.includes(n.cat), distLabel: n.mi < 10 ? n.mi.toFixed(1) + ' mi away' : Math.round(n.mi) + ' mi away', statusLabel: n.status === 'Claimed' ? (n.mine ? 'Claimed by you' : 'Claimed by ' + n.claimedBy) : 'Unclaimed',
      statusStyle: Object.assign({}, this.chipBase, n.status === 'Unclaimed' ? this.STAGE.Submitted : this.STAGE.Accepted),
      cardStyle: { padding: 20, gap: 12, opacity: n.notFit ? 0.6 : 1, border: '1px solid var(--color-neutral-400)', background: 'var(--color-neutral-100)', boxShadow: 'var(--shadow-sm)' },
      help: () => this.modal({ kind: 'claim', nid: n.id, mode: 'solo', partners: [], cnote: '' }),
      pass: () => this.modal({ kind: 'pass', target: 'need', id: n.id }), notFit: () => this.modal({ kind: 'notfit', id: n.id }), ask: () => this.modal({ kind: 'ask', id: n.id, who: n.who }),
      undo: () => this.setState(st => ({ needs: st.needs.map(x => x.id === n.id ? Object.assign({}, x, { notFit: '' }) : x) })) }));
    const thOpen = !!s.selThread && s.threads.some(t => t.id === s.selThread), th = s.threads.find(t => t.id === s.selThread) || s.threads[0];
    const subjOf = t => t.subject || (t.msgs[0].text.split(/[.?!]/)[0].split(' ').slice(0, 7).join(' ') + (t.msgs[0].text.split(' ').length > 7 ? '…' : ''));
    const threads = s.threads.map(t => { const a = thOpen && t.id === th.id, un = t.unread > 0 && !a; return Object.assign({}, t, { subject: subjOf(t), time: t.msgs[t.msgs.length - 1].t, last: t.msgs[t.msgs.length - 1].text, hasUnread: un, go: () => this.setState(st => ({ selThread: t.id, threads: st.threads.map(x => x.id === t.id ? Object.assign({}, x, { unread: 0 }) : x) })),
      fromStyle: { fontWeight: un ? 700 : 500, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, subjStyle: { fontSize: 14, fontWeight: un ? 600 : 400, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }, timeStyle: { fontSize: 12, flex: 'none', fontWeight: un ? 700 : 400, color: un ? 'var(--color-accent-800)' : 'var(--color-neutral-700)' },
      style: { display: 'flex', flexDirection: 'column', gap: 3, width: '100%', textAlign: 'left', padding: '12px 14px', border: 0, borderBottom: '1px solid var(--color-divider)', borderLeft: '3px solid ' + (a ? 'var(--color-accent-700)' : 'transparent'), background: a ? 'var(--color-accent-100)' : un ? 'var(--color-bg)' : 'transparent', opacity: un || a ? 1 : 0.62, cursor: 'pointer', color: 'var(--color-text)' } }); });
    const ini = n => n.replace(/^(Rev\.|Sister|Elder|Dr\.|Ms\.|Mr\.)\s+/, '').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const thread = Object.assign({}, th, { subject: subjOf(th), msgs: th.msgs.map(m => { const from = m.mine ? 'Denise C. · Hope Harbor' : th.person; return Object.assign({}, m, { from, to: m.mine ? 'To ' + th.person : 'To Hope Harbor Community Pantry', initials: ini(m.mine ? 'Denise Carter' : th.person), avatar: { width: 36, height: 36, flex: 'none', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, borderRadius: '50%', background: m.mine ? 'var(--color-accent-700)' : 'var(--color-neutral-200)', color: m.mine ? 'var(--color-bg)' : 'var(--color-text)' } }); }) });
    const HP = s.hiddenPosts || [], hidePost = id => { this.toast('Post hidden from your view.'); this.setState(st => ({ hiddenPosts: (st.hiddenPosts || []).concat(id) })); }, unhidePost = id => this.setState(st => ({ hiddenPosts: (st.hiddenPosts || []).filter(x => x !== id) }));
    const hiddenPostsN = s.posts.filter(p => p.type !== 'Volunteers' && HP.includes(p.id)).length;
    const postsView = { hiddenN: hiddenPostsN, showing: !!s.showHiddenPosts, btn: (s.showHiddenPosts ? 'Back to all posts' : 'Hidden posts') + (s.showHiddenPosts ? '' : ' (' + hiddenPostsN + ')'), toggle: () => this.setState(st => ({ showHiddenPosts: !st.showHiddenPosts })), none: !!s.showHiddenPosts && hiddenPostsN === 0,
      detailed: (s.postLayout || 'detailed') === 'detailed', compact: s.postLayout === 'compact', seg: [['detailed', 'Detailed'], ['compact', 'Compact']].map(([k, label]) => ({ label, on: (s.postLayout || 'detailed') === k, pick: () => this.setState({ postLayout: k }) })) };
    const PURG = { Urgent: 0, 'Within a few days': 1, 'Within a few weeks': 2, 'No rush': 3 }, PS = s.postSort || 'newest', pIdx = id => s.posts.findIndex(x => x.id === id), pMi = p => { const o = s.orgs.find(o2 => o2.name === p.org); return o && o.mi != null ? o.mi : 99; };
    const PSORT = ({ newest: (a, b) => pIdx(a.id) - pIdx(b.id), urgent: (a, b) => (PURG[a.urg] ?? 3) - (PURG[b.urg] ?? 3) || pIdx(a.id) - pIdx(b.id), nearest: (a, b) => pMi(a) - pMi(b), needs: (a, b) => (a.replies || 0) - (b.replies || 0), popular: (a, b) => (b.replies || 0) - (a.replies || 0), type: (a, b) => a.type.localeCompare(b.type) })[PS] || ((a, b) => 0);
    const PF = Object.assign({ types: [], urgs: [], status: 'all', by: 'all', dist: '50', fav: false }, s.postF || {}); const orgOf = name => s.orgs.find(o => o.name === name) || {};
    const setPF = o => this.setState(st => ({ postF: Object.assign({ types: [], urgs: [], status: 'all', by: 'all', dist: '50', fav: false }, st.postF || {}, o) }));
    const pfN = (PF.urgs.length ? 1 : 0) + (PF.types.length ? 1 : 0) + (PF.status !== 'all' ? 1 : 0) + (PF.by !== 'all' ? 1 : 0) + (PF.dist !== '50' ? 1 : 0) + (PF.fav ? 1 : 0);
    Object.assign(postsView, { fOpen: !!s.postFOpen, fAria: s.postFOpen ? 'true' : 'false', fToggle: () => this.setState(st => ({ postFOpen: !st.postFOpen })), fN: pfN || '', fClear: () => this.setState({ postF: null }), sort: { v: PS, on: e => this.setState({ postSort: e.target.value }) }, dist: { v: PF.dist, on: e => setPF({ dist: e.target.value }) }, favOnly: { v: !!PF.fav, on: e => setPF({ fav: e.target.checked }) },
      types: ['Supply request', 'Event', 'Partnership'].map(k => { const on = PF.types.includes(k); return { label: k, on: on ? 'true' : 'false', style: this.chip(on), toggle: () => setPF({ types: on ? PF.types.filter(x => x !== k) : PF.types.concat(k) }) }; }),
      urgs: ['Urgent', 'Within a few days', 'Within a few weeks', 'No rush'].map(k => { const on = PF.urgs.includes(k); return { label: k, on: on ? 'true' : 'false', style: this.chip(on), toggle: () => setPF({ urgs: on ? PF.urgs.filter(x => x !== k) : PF.urgs.concat(k) }) }; }),
      status: [['all', 'All'], ['open', 'Not messaged yet'], ['done', 'Messaged']].map(([k, label]) => ({ label, on: PF.status === k, pick: () => setPF({ status: k }) })),
      by: [['all', 'Everyone'], ['others', 'Other organizations'], ['us', 'Us']].map(([k, label]) => ({ label, on: PF.by === k, pick: () => setPF({ by: k }) })) });
    const posts = s.posts.filter(p => p.type !== 'Volunteers' && (s.showHiddenPosts ? HP.includes(p.id) : !HP.includes(p.id))).filter(p => (!PF.types.length || PF.types.includes(p.type)) && (!PF.urgs.length || PF.urgs.includes(p.urg || 'No rush')) && (PF.status === 'all' || (PF.status === 'done' ? !!p.offered : !p.offered)) && (PF.by === 'all' || (PF.by === 'us' ? p.org === 'Hope Harbor Community Pantry' : p.org !== 'Hope Harbor Community Pantry')) && (PF.dist === 'any' || (orgOf(p.org).mi != null && orgOf(p.org).mi <= +PF.dist)) && (!PF.fav || (s.favs || []).includes(orgOf(p.org).id))).sort(PSORT).map(p => Object.assign({}, p, { urgLabel: p.urg && p.urg !== 'No rush' ? p.urg : '', urgStyle: { padding: '1px 7px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', background: p.urg === 'Urgent' ? 'var(--color-text)' : 'transparent', color: p.urg === 'Urgent' ? 'var(--color-bg)' : 'var(--color-neutral-800)', border: p.urg === 'Urgent' ? 0 : '1px solid var(--color-neutral-500)' }, isHidden: HP.includes(p.id), notHidden: !HP.includes(p.id), rowBg: HP.includes(p.id) ? 'var(--color-neutral-200)' : 'transparent', hide: () => hidePost(p.id), unhide: () => unhidePost(p.id), cardStyle: { border: '1px solid var(--color-neutral-400)', background: HP.includes(p.id) ? 'var(--color-neutral-200)' : 'var(--color-neutral-100)', boxShadow: 'var(--shadow-sm)', padding: 20, gap: 10 }, offered: !!p.offered, notOffered: !p.offered, repliesLabel: p.replies + (p.replies === 1 ? ' response' : ' responses'), offer: () => this.modal({ kind: 'offerMsg', pid: p.id, text: 'Hi! Hope Harbor Community Pantry can help with “' + p.title + '.” What’s the best way to coordinate?' }) }));
    const VF = s.volFilter, NOW = new Date('2026-11-04'), days = v => Math.round((new Date(v.iso) - NOW) / 864e5), vmi = v => { const o = this.org(v.org); return o && o.mi != null ? o.mi : 0; };
    const VS = { soonest: (a, b) => a.iso.localeCompare(b.iso), most: (a, b) => (b.need - b.have) - (a.need - a.have), closest: (a, b) => vmi(a) - vmi(b), almost: (a, b) => ((a.need - a.have) || 999) - ((b.need - b.have) || 999), newest: (a, b) => a.postedN - b.postedN };
    const volMapFn = v => {
      const o = this.org(v.org), full = v.have >= v.need, pct = Math.min(100, Math.round(v.have / v.need * 100)), q = s.volQty[v.id] || '2', left = Math.max(0, v.need - v.have);
      return Object.assign({}, v, { orgName: o ? o.name : v.org, distLabel: vmi(v) ? vmi(v) + ' mi' : '', postedLabel: v.postedN === 0 ? 'Posted today' : 'Posted ' + v.postedN + (v.postedN === 1 ? ' day ago' : ' days ago'), spotsLabel: v.have + ' of ' + v.need + ' volunteers', leftLabel: full ? 'Full' : left + ' spots left', full, isMine: !!v.mine, notMine: !v.mine, signed: !!v.signed, canSign: !v.mine && !v.signed && !full, showFull: !v.mine && !v.signed && full, signedLabel: 'You’re bringing ' + v.signed + (v.signed === 1 ? ' volunteer' : ' volunteers') + (v.leader ? ' · led by ' + v.leader : ''),
        bar: { display: 'block', height: 6, background: 'var(--color-neutral-300)', position: 'relative', overflow: 'hidden' }, fill: { display: 'block', position: 'absolute', inset: 0, width: pct + '%', background: full ? 'var(--color-neutral-600)' : 'var(--color-accent-700)' },
        qty: { v: q, on: e => this.setState({ volQty: Object.assign({}, s.volQty, { [v.id]: e.target.value }) }) }, qtyOpts: ['1', '2', '3', '4', '5', '6', '8', '10'].filter(n => +n <= left),
        sign: () => this.modal({ kind: 'volSign', vid: v.id, count: '', leader: '', lphone: '', lemail: '', group: 'Hope Harbor Community Pantry', vnote: '', agree: false }),
        undo: () => { this.setState(st => ({ vols: st.vols.map(x => x.id === v.id ? Object.assign({}, x, { have: x.have - x.signed, signed: 0 }) : x) })); this.toast('Sign-up canceled.'); },
        ask: () => { this.setState({ dashTab: 'messages' }); this.toast('Message ' + (o ? o.name : 'the organizer') + ' about “' + v.title + '”.'); },
        manage: () => this.modal({ kind: 'signups', vid: v.id }), view: () => this.modal({ kind: 'volView', vid: v.id }), eventName: v.event ? ((s.events || []).find(e => e.id === v.event) || {}).title || '' : '', viewEvent: () => { if (v.event) this.modal({ kind: 'evView', eid: v.event }); } });
    };
    const vols = (s.vols || D.VOLS).filter(v => (VF === 'bigevent' ? !!v.event : (VF === 'all' || (VF === 'mine' ? v.mine : (v.kind === VF || v.sub === VF || String(v.kind).startsWith(VF + ' ·'))))) && (s.volWhen === 'any' || days(v) <= (s.volWhen === 'week' ? 7 : 30)) && (s.volRad === 'any' || vmi(v) <= +s.volRad) && (s.volShowFull || v.signed || v.mine || v.have < v.need)).sort(VS[s.volSort] || VS.soonest).map(volMapFn);
    const EVS = (s.events || []).filter(e => VF === 'all' || VF === 'bigevent' || VF === 'Event' || (VF === 'mine' && e.mine));
    const bigEvents = EVS.map(e => {
      const ps = (s.vols || D.VOLS).filter(v => v.event === e.id).sort((x, y) => x.iso.localeCompare(y.iso));
      const need = ps.reduce((n, p) => n + p.need, 0), have = ps.reduce((n, p) => n + Math.min(p.have, p.need), 0), left = Math.max(0, need - have), pct = need ? Math.min(100, Math.round(have / need * 100)) : 0;
      const o = this.org(e.org), open = !!(s.evOpen || {})[e.id], first = ps[0], last = ps[ps.length - 1];
      const openProjects = ps.filter(p => p.have < p.need).length;
      const r = Object.assign({}, e, { orgName: o ? o.name : e.org, isMine: !!e.mine, projectsN: ps.length, projectsLabel: ps.length + (ps.length === 1 ? ' project' : ' projects'),
        openLabel: openProjects ? openProjects + ' still need help' : 'All projects are full',
        totalsLabel: have + ' of ' + need + ' volunteers', leftLabel: left ? left + ' spots left across all projects' : 'Every spot is filled',
        dateRange: first ? (first.date === last.date ? first.date : first.date + ' – ' + last.date) : '', mo: first ? (first.mo === last.mo ? first.mo : first.mo + '–' + last.mo) : '', day: first ? (first.iso === last.iso ? first.day : first.day + '–' + last.day) : '', dayStyle: { fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: first && first.iso !== last.iso ? 22 : 32, whiteSpace: 'nowrap', lineHeight: 1.1 }, dayStyleLg: { fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: first && first.iso !== last.iso ? 26 : 38, whiteSpace: 'nowrap', lineHeight: 1.1 }, totals: have + ' of ' + need + ' signed up', shortLeft: left ? left + ' still needed' : 'Full', shortToggle: open ? 'Hide projects' : 'See ' + ps.length + ' projects',
        bar: { display: 'block', height: 8, background: 'var(--color-neutral-300)', position: 'relative', overflow: 'hidden' }, fill: { display: 'block', position: 'absolute', inset: 0, width: pct + '%', background: left ? 'var(--color-accent-700)' : 'var(--color-neutral-600)' },
        open, aria: open ? 'true' : 'false', toggleLabel: open ? 'Hide projects' : 'See all ' + ps.length + ' projects',
        toggle: () => this.setState(st => ({ evOpen: Object.assign({}, st.evOpen || {}, { [e.id]: !(st.evOpen || {})[e.id] }) })),
        projects: ps.map(volMapFn) });
      r.view = () => this.modal({ kind: 'evView', eid: e.id }); r.toggleStop = x => { if (x && x.stopPropagation) x.stopPropagation(); r.toggle(); }; return r;
    });;
    const myVols = (s.vols || D.VOLS).filter(v => v.mine).sort((a, b) => a.iso.localeCompare(b.iso)).map(v => { const full = v.have >= v.need, pct = Math.min(100, Math.round(v.have / v.need * 100)), left = Math.max(0, v.need - v.have);
      return Object.assign({}, v, { leftLabel: full ? 'Full' : left + ' needed', bar: { display: 'block', height: 6, background: 'var(--color-neutral-300)', position: 'relative', overflow: 'hidden' }, fill: { display: 'block', position: 'absolute', inset: 0, width: pct + '%', background: full ? 'var(--color-neutral-600)' : 'var(--color-accent-700)' }, manage: () => this.modal({ kind: 'signups', vid: v.id }), view: () => this.modal({ kind: 'volView', vid: v.id }), eventName: v.event ? ((s.events || []).find(e => e.id === v.event) || {}).title || '' : '' }); });
    const myEvents = (s.events || []).filter(e => e.mine).map(e => { const ps = myVols.filter(v => v.event === e.id), need = ps.reduce((n, p) => n + p.need, 0), have = ps.reduce((n, p) => n + Math.min(p.have, p.need), 0), left = Math.max(0, need - have), pct = need ? Math.min(100, Math.round(have / need * 100)) : 0, open = !!(s.myEvOpen || {})[e.id], f = ps[0], l = ps[ps.length - 1];
      return { id: e.id, title: e.title, projects: ps, projectsLabel: ps.length + (ps.length === 1 ? ' project' : ' projects'), dateRange: f ? (f.date === l.date ? f.date : f.date + ' – ' + l.date) : '', mo: f ? (f.mo === l.mo ? f.mo : f.mo + '–' + l.mo) : '', day: f ? (f.iso === l.iso ? f.day : f.day + '–' + l.day) : '', dayStyle: { fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: f && f.iso !== l.iso ? 22 : 32, whiteSpace: 'nowrap', lineHeight: 1.1 }, totals: have + ' of ' + need + ' signed up', volTotal: need + ' volunteers needed in total', leftLabel: left ? left + ' still needed' : 'Full',
        bar: { display: 'block', height: 6, background: 'var(--color-neutral-300)', position: 'relative', overflow: 'hidden' }, fill: { display: 'block', position: 'absolute', inset: 0, width: pct + '%', background: left ? 'var(--color-accent-700)' : 'var(--color-neutral-600)' },
        open, aria: open ? 'true' : 'false', toggleLabel: open ? 'Hide projects' : 'See ' + ps.length + ' projects', toggle: () => this.setState(st => ({ myEvOpen: Object.assign({}, st.myEvOpen || {}, { [e.id]: !(st.myEvOpen || {})[e.id] }) })), view: () => this.modal({ kind: 'evView', eid: e.id }), toggleStop: x => { if (x && x.stopPropagation) x.stopPropagation(); this.setState(st => ({ myEvOpen: Object.assign({}, st.myEvOpen || {}, { [e.id]: !(st.myEvOpen || {})[e.id] }) })); } }; });
    const volSeg = [['all', 'All'], ['bigevent', 'Big events'], ['Event', 'Events'], ['Serve project', 'Serve projects'], ['Ongoing', 'Ongoing'], ['Skilled help', 'Skilled help'], ['Donation drive', 'Donation drives'], ['mine', 'Posted by us']].map(([k, label]) => ({ label, on: VF === k, pick: () => this.setState({ volFilter: k }) }));
    const C = D.CASE;
    const cUpd = (s.caseNew || []).concat(C.updates), myStage = s.caseStage || 'Accepted', cSel = s.caseSel || null;
    const MYST = ['Accepted', 'Coordinating', 'In progress', 'Waiting on family', 'Completed my role', 'Stepped back'];
    const CSC = { Seen: 'oklch(0.55 0.02 250)', Accepted: 'oklch(0.52 0.12 245)', Coordinating: 'oklch(0.50 0.14 295)', 'In progress': 'oklch(0.58 0.13 70)', 'Waiting on family': 'oklch(0.58 0.15 40)', 'Completed my role': 'oklch(0.52 0.12 150)', 'Stepped back': 'oklch(0.50 0.01 250)' };
    const cst = st => { const c = CSC[st] || CSC.Seen; return Object.assign({}, this.chipBase, { display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', background: 'color-mix(in oklch, ' + c + ' 14%, white)', color: 'color-mix(in oklch, ' + c + ' 75%, black)', border: '1px solid color-mix(in oklch, ' + c + ' 45%, white)' }); };
    const cdot = st => ({ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: CSC[st] || CSC.Seen });
    const selOrg = cSel && C.orgs.find(o => o.short === cSel);
    const kase = Object.assign({}, C, {
      orgs: C.orgs.slice().sort((a, b) => (b.id === 'hope') - (a.id === 'hope')).map(o => { const mine = o.id === 'hope', st = mine ? myStage : o.stage, sel = cSel === o.short;
        return Object.assign({}, o, { mine, notMine: !mine, stage: st, stageStyle: cst(st), dot: cdot(st), selStyle: (() => { const c = CSC[st] || CSC.Seen; return { minHeight: 40, fontSize: 15, width: '100%', fontWeight: 600, background: 'color-mix(in oklch, ' + c + ' 14%, white)', color: 'color-mix(in oklch, ' + c + ' 75%, black)', borderColor: 'color-mix(in oklch, ' + c + ' 45%, white)' }; })(), hasProfile: !!o.id, noProfile: !o.id, pressed: sel ? 'true' : 'false', nUpd: cUpd.filter(u => u.who === o.short).length + ' updates',
          box: { padding: 16, borderRight: '1px solid var(--color-divider)', borderBottom: '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', textAlign: 'left', background: sel ? 'var(--color-accent-100)' : 'var(--color-bg)', boxShadow: sel ? 'inset 0 -3px 0 var(--color-accent-700)' : 'none' },
          pick: () => this.setState({ caseSel: sel ? null : o.short }), key: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setState({ caseSel: sel ? null : o.short }); } },
          profile: e => { e.stopPropagation(); if (o.id) this.openOrg(o.id); } }); }),
      updates: (s.caseAll ? cUpd : cUpd.slice(0, 4)), moreN: cUpd.length > 4, allLabel: s.caseAll ? 'Show fewer' : 'See all ' + cUpd.length + ' updates', toggleAll: () => this.setState({ caseAll: !s.caseAll }),
      text: this.bind('caseText'), post: e => { e.preventDefault(); const t = (s.caseText || '').trim(); if (!t) return; this.setState(st => ({ caseText: '', caseNew: [{ t: 'Just now', who: 'Hope Harbor', text: t, mine: true }].concat(st.caseNew || []) })); this.toast('Update shared with case partners.'); },
      msgAll: () => { const others = C.orgs.filter(o => o.id !== 'hope'), id = 'tcase-' + C.code;
        this.setState(st => ({ dashTab: 'messages', selThread: id, threads: st.threads.some(t => t.id === id) ? st.threads : [{ id, subject: 'Shared case ' + C.code + ' · ' + C.who, org: others.map(o => o.short).join(', '), person: 'Group thread · ' + others.length + ' organizations', unread: 0, msgs: [{ mine: false, text: 'Group thread for shared case ' + C.code + '. Everyone on the case can see and reply. Keep names and contact details out of this thread.', t: 'Just now' }] }].concat(st.threads) }));
        try { window.scrollTo(0, 0); } catch (e) {} },
      myStage, stageOpts: MYST, stageSel: { v: myStage, on: e => { const v = e.target.value; this.setState(st => ({ caseStage: v, caseNew: [{ t: 'Just now', who: 'Hope Harbor', text: 'Changed our status to “' + v + '”.' }].concat(st.caseNew || []) })); this.toast('Your status on this case is now “' + v + '”.'); } },
      sel: !!selOrg, selName: selOrg ? selOrg.name : '', selRole: selOrg ? selOrg.role : '', selTasks: selOrg ? selOrg.tasks : [], selUpd: selOrg ? cUpd.filter(u => u.who === selOrg.short) : [], selNone: selOrg ? !cUpd.some(u => u.who === selOrg.short) : false, closeSel: () => this.setState({ caseSel: null })
    });
    const partners = ['zion', 'greenleaf', 'ridgeview', 'brendan', 'haven'].map(id => Object.assign(this.dec(this.org(id)), { message: () => this.setState({ dashTab: 'messages', selThread: id === 'brendan' ? 't1' : id === 'zion' ? 't2' : 't3' }) }));
    const meName = this.state.meName || 'Denise Carter', canEditTeam = (s.team.find(m => m.name === meName) || {}).role === 'Admin', teamEditing = canEditTeam && !!s.teamEditing;
    const team = s.team.map((m, i) => Object.assign({}, m, { isMe: m.name === meName, notMe: m.name !== meName, initials: m.name.split(' ').map(w => w[0]).join('').slice(0, 2),
      avatarStyle: (h => ({ width: 40, height: 40, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700, background: m.name === meName ? 'var(--color-accent-700)' : 'oklch(0.92 0.05 ' + h + ')', color: m.name === meName ? 'var(--color-bg)' : 'oklch(0.35 0.08 ' + h + ')' }))([250, 150, 30, 300, 200][i % 5]),
      message: () => this.modal({ kind: 'teamMsg', to: m.name, text: '' }), showChip: !teamEditing || m.name === meName, showSelect: teamEditing && m.name !== meName, selfNote: teamEditing && m.name === meName, showRemove: teamEditing && m.name !== meName,
      setRole: e => { const v = e.target.value; this.setState(st => ({ team: st.team.map(x => x.name === m.name ? Object.assign({}, x, { role: v }) : x) })); this.toast(m.name + ' is now ' + (v === 'Admin' ? 'an ' : 'a ') + v + '.'); },
      remove: () => { this.setState(st => ({ team: st.team.filter(x => x.name !== m.name) })); this.toast(m.name + ' was removed from your team.'); }, roleStyle: Object.assign({}, this.chipBase, m.role === 'Admin' ? this.STAGE.Submitted : m.role === 'Staff' ? this.STAGE.Seen : this.STAGE.Completed) }));
    const pf = s.profile;
    const profile = { hours: this.bind('profile.hours'), services: this.bind('profile.services'), capacity: this.bind('profile.capacity'), contactName: this.bind('profile.contactName'), contactRole: this.bind('profile.contactRole'), contactPhone: this.bind('profile.contactPhone'), elig: this.bind('profile.elig'), p: pf,
      save: () => { this.setState(st => ({ orgs: st.orgs.map(o => o.id === 'hope' ? Object.assign({}, o, { cap: pf.capacity, contact: [pf.contactName, pf.contactRole, o.contact[2]], phone: pf.contactPhone, updated: 'Oct 28, 2026', updN: 28 }) : o) })); this.toast('Listing updated. Changes are live.'); },
      viewPublic: () => this.setState({ pubView: true, orgId: 'hope', fromDash: false, verPop: false }), pubOpen: !!s.pubView, pubBanner: s.orgId === 'hope' ? 'Preview: this is your listing exactly as the public sees it.' : 'Organization listing', pubBtn: this.dec(this.org(s.orgId) || this.org('hope')).applyLabel, pubPreview: () => this.dec(this.org(s.orgId) || this.org('hope')).apply(), pubClose: () => this.setState({ pubView: false, verPop: false }), pubStop: e => e.stopPropagation() };
    const availSeg = ['Accepting', 'Limited', 'Waitlist', 'Full'].map(a => ({ label: a, on: hope.avail === a, pick: () => { this.setState(st => ({ orgs: st.orgs.map(o => o.id === 'hope' ? Object.assign({}, o, { avail: a }) : o) })); this.toast('Availability set to “' + this.AV[a].label + '”. Your public listing is updated.'); } }));
    const stats = [['New referrals', newN, 'Waiting for a reply', () => this.setState({ dashTab: 'referrals', qFilter: 'new', selRef: null })], ['In progress', hopeR.filter(x => ['Accepted', 'In progress'].includes(x.stage)).length, 'Accepted or underway', () => this.setState({ dashTab: 'referrals', qFilter: 'active', selRef: null })], ['Completed this month', 23 + hopeR.filter(x => x.stage === 'Completed').length, 'Neighbors served', () => this.setState({ dashTab: 'referrals', qFilter: 'closed', selRef: null })], ['Unread messages', unread, 'From partner organizations', () => this.setState({ dashTab: 'messages' })]].map(([label, value, hint, go]) => ({ label, value, hint, go }));
    const OVC = { fresh: 'oklch(0.55 0.16 250)', new: 'oklch(0.58 0.19 27)', progress: 'oklch(0.80 0.15 85)', done: 'oklch(0.60 0.14 150)', all: 'var(--color-accent-700)' };
    // Shared cases follow your organization's own status on the case.
    const CASE_GRP = { Accepted: 'progress', Coordinating: 'new', 'In progress': 'progress', 'Waiting on family': 'progress', 'Completed my role': 'progress', 'Stepped back': 'done' };
    const grp = x => (x.shared && !['Completed', 'Declined', 'Redirected'].includes(x.stage)) ? (CASE_GRP[s.caseStage || 'Accepted'] || 'progress') : x.stage === 'Submitted' ? 'fresh' : x.stage === 'Seen' ? 'new' : ['Accepted', 'In progress'].includes(x.stage) ? 'progress' : 'done';
    const HID = s.hiddenRefs || {};
    const isHid = x => { const h = HID[x.id]; if (!h) return false; if (h.kind === 'shared') return (s.caseStage || 'Accepted') === 'Completed my role'; if (h.kind === 'task') return x.log.length === h.logLen && x.stage === h.stage; return true; };
    const hideRef = (x, kind, label) => this.setState(st => ({ hideAsk: null, hiddenRefs: Object.assign({}, st.hiddenRefs || {}, { [x.id]: { kind, label, logLen: x.log.length, stage: x.stage } }) }));
    const hiddenList = hopeR.filter(x => ['fresh', 'new', 'progress'].includes(grp(x)) && isHid(x));
    const ovSets = { fresh: hopeR.filter(x => grp(x) === 'fresh' && !isHid(x)), new: hopeR.filter(x => grp(x) === 'new' && !isHid(x)), progress: hopeR.filter(x => grp(x) === 'progress' && !isHid(x)), done: hopeR.filter(x => x.stage === 'Completed'), all: hopeR };
    const ovAll = [['fresh', 'New', ovSets.fresh.length, 'Applications & referrals not opened yet', 'new'], ['new', 'Needs a response', ovSets.new.length, 'Accept, decline, or pass along', 'new'], ['progress', 'In progress', ovSets.progress.length, 'Waiting on your next step', 'active']];
    const ovDefs = ovAll.filter(d => d[2] > 0);
    const ovK = ovDefs.some(d => d[0] === s.ovTab) ? s.ovTab : (ovDefs[0] ? ovDefs[0][0] : 'new');
    const NEXT = { Submitted: 'Next: open and respond', Seen: 'Next: accept, decline, or pass', Accepted: 'Next: start helping', 'In progress': 'Next: mark completed when done' };
    const sw = k => ({ width: 8, height: 28, flex: 'none', background: OVC[k] });
    const ovCur = ovDefs.find(d => d[0] === ovK), twoRow = s.w < 560;
    const ov = {
      tabs: ovDefs.map(([k, label, value, hint], i) => { const a = k === ovK; return { label, value, hint, sel: a ? 'true' : 'false', swatch: sw(k), go: () => this.setState({ ovTab: k }),
        style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, padding: twoRow ? '10px 12px' : '12px 18px', minWidth: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--color-text)', border: 0, borderLeft: i ? '1px solid var(--color-neutral-400)' : 0, borderTop: '4px solid ' + (a ? OVC[k] : 'transparent'), borderBottom: '1px solid ' + (a ? 'transparent' : 'var(--color-neutral-400)'), background: a ? 'var(--color-bg)' : 'var(--color-neutral-100)', marginBottom: -1, position: 'relative', zIndex: a ? 1 : 0 } }; }),
      barStyle: { display: 'grid', gridTemplateColumns: 'repeat(' + Math.max(1, ovDefs.length) + ',minmax(0,1fr))', border: '1px solid var(--color-neutral-400)', borderBottom: 0 },
      title: ovK === 'fresh' ? 'New applications & referrals' : ovK === 'new' ? 'Waiting on your response' : 'Your next steps', swatch: sw(ovK), isRefs: true, isMsgs: false, isAll: true, allRefs: () => this.setState({ dashTab: 'referrals', qFilter: 'all', selRef: null }),
      items: ovSets[ovK].map(x => Object.assign(this.decRef(x), { open: () => x.shared ? this.openCasePop(x.id) : this.openPop(x.id),
        sharedDone: !!x.shared && (s.caseStage || 'Accepted') === 'Completed my role', hideShared: () => { hideRef(x, 'shared', 'Hidden until the other organizations finish'); this.toast('Hidden from your dashboard until the shared case wraps up.'); },
        canHide: true, asking: s.hideAsk === x.id, askAria: s.hideAsk === x.id ? 'true' : 'false', askLabel: 'Hide from dashboard',
        askHide: () => this.setState(st => ({ hideAsk: st.hideAsk === x.id ? null : x.id })),
        hideOpts: [['1 day', 'day'], ['3 days', 'days3'], ['1 week', 'week']].concat(grp(x) === 'progress' ? [['Until a response is needed', 'task']] : []).map(([label, k]) => ({ label, go: () => { hideRef(x, k, k === 'task' ? 'Hidden until a response is needed' : 'Hidden for ' + label); this.toast(k === 'task' ? 'Hidden until a response is needed.' : 'Hidden for ' + label + '.'); } })), swatch: sw(grp(x)), groupLabel: { fresh: 'New', new: 'Needs response', progress: 'In progress', done: 'Completed' }[grp(x)], nextLabel: x.shared ? ({ Accepted: 'Next: start on your part of the plan', Coordinating: 'Next: respond to your case partners', 'In progress': 'Next: post an update when you finish', 'Waiting on family': 'Waiting on the family', 'Completed my role': 'Waiting on other organizations' }[s.caseStage || 'Accepted'] || NEXT[x.stage]) : NEXT[x.stage] || '' })),
      threads: s.threads.filter(t => t.unread > 0).map(t => ({ org: t.org, person: t.person, last: t.msgs[t.msgs.length - 1].text, hasUnread: true, open: () => this.setState(st => ({ dashTab: 'messages', selThread: t.id, threads: st.threads.map(x => x.id === t.id ? Object.assign({}, x, { unread: 0 }) : x) })) })),
      seeAll: () => { this.setState({ dashTab: 'history', selRef: null }); try { window.scrollTo(0, 0); } catch (e) {} }
    };
    ov.empty = ov.items.length === 0; ov.none = ovDefs.length === 0; ov.has = ovDefs.length > 0;
    Object.assign(ov, { showAllClear: ov.none && !(s.allClearDismissed != null && hopeR.length <= s.allClearDismissed), dismissAllClear: () => this.setState({ allClearDismissed: hopeR.length }), hasHidden: hiddenList.length > 0, noHidden: hiddenList.length === 0, showHiddenIn: !!s.showHiddenRefs && ov.has, showHiddenOut: !!s.showHiddenRefs && ov.none, hiddenCount: hiddenList.length + (hiddenList.length === 1 ? ' case' : ' cases'), showHidden: !!s.showHiddenRefs, hiddenAria: s.showHiddenRefs ? 'true' : 'false', toggleHidden: () => this.setState(st => ({ showHiddenRefs: !st.showHiddenRefs })),
      hiddenLabel: '', hiddenBtn: (s.showHiddenRefs ? 'Close hidden cases' : 'Hidden cases') + ' (' + hiddenList.length + ')',
      hiddenItems: hiddenList.map(x => Object.assign(this.decRef(x), { open: () => x.shared ? this.openCasePop(x.id) : this.openPop(x.id), swatch: sw(grp(x)), groupLabel: { fresh: 'New', new: 'Needs response', progress: 'In progress', done: 'Completed' }[grp(x)], hiddenFor: (HID[x.id] || {}).label || 'Hidden', unhide: () => this.setState(st => { const H = Object.assign({}, st.hiddenRefs || {}); delete H[x.id]; return { hiddenRefs: H }; }) })) });
    ov.emptyText = ovK === 'fresh' ? 'No new applications or referrals right now.' : ovK === 'new' ? 'You’re all caught up — nothing is waiting on a response.' : 'Nothing in progress right now.';
    const history = hopeR.filter(x => x.stage === 'Completed').map(x => Object.assign(this.decRef(x), { dateLabel: x.date || x.when }));
    const attn = ovSets.fresh.concat(ovSets.new, ovSets.progress);
    const popOpen = !!s.ovPop && !s.casePop && !!sr && s.dashTab === 'overview';
    const ci = sr ? attn.findIndex(x => x.id === sr.id) : -1;
    const nextRef = attn.length ? (ci === -1 ? attn[0] : attn.length > 1 ? attn[(ci + 1) % attn.length] : null) : null;
    const pop = { open: popOpen, close: () => this.setState({ ovPop: false, casePop: false, selRef: null }), hasNext: !!nextRef, next: () => nextRef && (nextRef.shared ? this.openCasePop(nextRef.id) : this.openPop(nextRef.id)),
      freshN: ovSets.fresh.length, freshDot: { width: 10, height: 10, flex: 'none', background: OVC.fresh }, newN: ovSets.new.length, progN: ovSets.progress.length, newDot: { width: 10, height: 10, flex: 'none', background: OVC.new }, progDot: { width: 10, height: 10, flex: 'none', background: OVC.progress },
      swatch: { width: 6, height: 34, flex: 'none', background: sr ? OVC[grp(sr)] : OVC.all },
      groupLabel: sr ? { fresh: 'New', new: 'Needs a response', progress: 'In progress', done: 'Completed' }[grp(sr)] : '',
      posLabel: (() => { if (!sr) return ''; const g = grp(sr), list = ovSets[g] || [], i = list.findIndex(x => x.id === sr.id); return i > -1 ? 'Case ' + (i + 1) + ' of ' + list.length : (g === 'done' ? 'Finished — nice work' : 'Hidden from your dashboard'); })() };
    const hopeCatsF = ((this.org('hope') || {}).cats) || [];
    const openFP = (kind, id, ids) => this.setState(st => Object.assign({ feedPop: { kind, id, ids }, fpReply: '' }, kind === 'msgs' ? { threads: st.threads.map(x => x.id === id ? Object.assign({}, x, { unread: 0 }) : x) } : {}));
    const feed = {
      msgs: (() => { const L = s.threads.filter(t => t.unread > 0); return { n: L.length, has: L.length > 0, none: !L.length, all: () => this.setState({ dashTab: 'messages', selThread: null }),
        items: L.slice(0, 4).map(t => { const m = t.msgs[t.msgs.length - 1] || {}; return { org: t.org, subject: t.subject || t.person, last: m.text || '', when: m.t || '', open: () => openFP('msgs', t.id, L.map(x => x.id)) }; }) }; })(),
      posts: (() => { const L = (s.posts || []).filter(p => p.type !== 'Volunteers' && p.org !== 'Hope Harbor Community Pantry' && !(s.hiddenPosts || []).includes(p.id)); return { n: L.length, has: L.length > 0, none: !L.length, all: () => this.setState({ dashTab: 'community' }),
        items: L.slice(0, 3).map(p => ({ urgent: p.urg === 'Urgent', type: p.type, title: p.title, org: p.org, ago: p.ago, open: () => openFP('posts', p.id, L.map(x => x.id)) })) }; })(),
      needs: (() => { const L = (s.needs || []).filter(n => n.status === 'Unclaimed' && !n.notFit).sort((a, b) => (a.age || 0) - (b.age || 0)); return { n: L.length, has: L.length > 0, none: !L.length, all: () => this.setState({ dashTab: 'needs' }),
        items: L.slice(0, 3).map(n => ({ who: n.who, hood: n.hood, desc: n.desc, ago: n.ago, catLabel: this.cat(n.cat).label, urgent: /urgent/i.test(n.urg || ''), match: hopeCatsF.includes(n.cat), open: () => openFP('needs', n.id, L.map(x => x.id)) })) }; })()
    };
    const FP = s.feedPop, fpIds = FP ? FP.ids : [], fpI = FP ? Math.max(0, fpIds.indexOf(FP.id)) : 0;
    const fpGo = d => { const j = fpI + d; if (j < 0 || j >= fpIds.length) return; openFP(FP.kind, fpIds[j], fpIds); };
    const fp = { open: !!FP && s.dashTab === 'overview', close: () => this.setState({ feedPop: null, fpReply: '' }),
      kindLabel: FP ? { msgs: 'Unread messages', posts: 'New community posts', needs: 'New unclaimed needs' }[FP.kind] : '',
      pos: FP ? (fpI + 1) + ' of ' + fpIds.length : '', noPrev: !(fpI > 0), noNext: !(FP && fpI < fpIds.length - 1), hasPrev: fpI > 0, hasNext: FP ? fpI < fpIds.length - 1 : false, prev: () => fpGo(-1), next: () => fpGo(1),
      isMsg: !!FP && FP.kind === 'msgs', isPost: !!FP && FP.kind === 'posts', isNeed: !!FP && FP.kind === 'needs' };
    if (fp.isMsg) { const th = s.threads.find(x => x.id === FP.id) || { msgs: [] }; Object.assign(fp, { title: th.subject || th.org, sub: th.org + ' · ' + th.person, msgs: th.msgs.map(m => ({ text: m.text, t: m.t, who: m.mine ? 'You' : th.org, style: { alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '78%', padding: '10px 14px', background: m.mine ? 'var(--color-accent-700)' : 'var(--color-neutral-100)', color: m.mine ? 'var(--color-bg)' : 'var(--color-text)', border: m.mine ? 0 : '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column', gap: 4 } })),
      reply: this.bind('fpReply'), send: () => { const v = (s.fpReply || '').trim(); if (!v) return; this.toast('Message sent to ' + th.org + '.'); this.setState(st => ({ fpReply: '', threads: st.threads.map(x => x.id === th.id ? Object.assign({}, x, { msgs: x.msgs.concat({ mine: true, text: v, t: 'Just now' }) }) : x) })); },
      openFull: () => this.setState({ feedPop: null, dashTab: 'messages', selThread: th.id }) }); }
    if (fp.isPost) { const p = (s.posts || []).find(x => x.id === FP.id) || {}; Object.assign(fp, { title: p.title, sub: p.org + ' · ' + p.ago, type: p.type, urg: p.urg || 'No rush', body: p.body, replies: (p.replies || 0) + ((p.replies || 0) === 1 ? ' response' : ' responses'), offered: !!p.offered, notOffered: !p.offered,
      offer: () => this.modal({ kind: 'offerMsg', pid: p.id, text: 'Hi! Hope Harbor Community Pantry can help with “' + p.title + '.” What’s the best way to coordinate?' }),
      hidden: (s.hiddenPosts || []).includes(p.id), notHiddenP: !(s.hiddenPosts || []).includes(p.id), hide: () => { this.toast('Post hidden from your view.'); this.setState(st => ({ hiddenPosts: (st.hiddenPosts || []).concat(p.id) })); }, unhide: () => this.setState(st => ({ hiddenPosts: (st.hiddenPosts || []).filter(x => x !== p.id) })),
      openFull: () => this.setState({ feedPop: null, dashTab: 'community' }) }); }
    if (fp.isNeed) { const n = (s.needs || []).find(x => x.id === FP.id) || {}; Object.assign(fp, { title: n.who + ' · ' + n.hood, sub: (n.via || '') + ' · ' + (n.ago || ''), catLabel: n.cat ? this.cat(n.cat).label : '', urgency: n.urg, desc: n.desc, why: n.why, urgent: /urgent/i.test(n.urg || ''),
      facts: [['Need', n.cat ? this.cat(n.cat).label : ''], ['How soon', n.urg], ['Household', n.household ? n.household + (n.household === '1' ? ' person' : ' people') : ''], ['Distance', n.mi != null ? (n.mi < 10 ? n.mi.toFixed(1) : Math.round(n.mi)) + ' mi away' : ''], ['Status', n.status]].filter(r => r[1]).map(([k, v]) => ({ k, v })),
      canAct: n.status === 'Unclaimed' && !n.notFit, claimed: n.status !== 'Unclaimed',
      help: () => this.modal({ kind: 'claim', nid: n.id, mode: 'solo', partners: [], cnote: '' }), notFit: () => this.modal({ kind: 'notfit', id: n.id }),
      openFull: () => this.setState({ feedPop: null, dashTab: 'needs' }) }); }
    const infoOpen = s.pageInfo === s.dashTab;
    const HO = this.org('hope') || {};
    const HR = s.referrals.filter(x => x.to === 'hope');
    const cntSt = st => HR.filter(x => st.includes(x.stage)).length;
    const accN = cntSt(['Accepted', 'In progress', 'Completed']), decN = cntSt(['Declined']), redN = cntSt(['Redirected']);
    const doneR = HR.filter(x => x.stage === 'Completed');
    const peopleN = doneR.reduce((a, x) => a + (parseInt(x.household, 10) || 0), 0);
    const myVolsO = (s.vols || D.VOLS).filter(v => v.mine);
    const needCounts = {}; HR.forEach(x => { needCounts[x.cat] = (needCounts[x.cat] || 0) + 1; });
    const maxNeed = Math.max(1, ...Object.values(needCounts));
    const stageRows = [['Needs a response', cntSt(['Submitted', 'Seen']), 'oklch(0.58 0.19 27)'], ['In progress', cntSt(['Accepted', 'In progress']), 'oklch(0.80 0.15 85)'], ['Completed', doneR.length, 'oklch(0.60 0.14 150)'], ['Passed along', redN, 'var(--color-accent-500)'], ['Declined', decN, 'var(--color-neutral-500)']];
    const maxSt = Math.max(1, ...stageRows.map(r => r[1]));
    const DR = s.orgDraft || {}, setDr = (k, v) => this.setState(st => ({ orgDraft: Object.assign({}, st.orgDraft || {}, { [k]: v }) }));
    const hopeL = mkL(this.dec(this.org('hope')));
    const orgD = {
      name: HO.name, type: HO.type, faith: HO.faith, addr: HO.addr, phone: HO.phone, about: HO.about, verified: !!HO.verified, vDate: HO.vDate, updated: HO.updated,
      catChips: (HO.cats || []).map(k => React.createElement('span', { key: k, className: 'tag tag-neutral', style: { fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 } }, this.ic(this.cat(k).icon, 14), this.cat(k).label)),
      contactName: (HO.contact || [])[0], contactRole: (HO.contact || [])[1], contactEmail: (HO.contact || [])[2],
      hours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => ({ d, h: (HO.hours || [])[i] || '—', style: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, padding: '6px 8px', borderBottom: '1px solid var(--color-divider)', background: i === 2 ? 'var(--color-accent-100)' : 'transparent', fontWeight: i === 2 ? 600 : 400 } })),
      services: Object.keys(HO.services || {}).filter(k => (HO.services[k] || []).length).map(k => ({ label: this.cat(k).label, icon: this.ic(this.cat(k).icon, 16), items: HO.services[k] })),
      facts: [['Languages', (HO.langs || []).join(', ')], ['Cost', HO.cost], ['Eligibility', (HO.elig || []).join(', ')], ['What to bring', HO.docs]].filter(r => r[1]).map(([k, v]) => ({ k, v })),
      favPage: this.favVals(), ap: this.apVals(), editApp: () => this.modal({ kind: 'appQs', qs: JSON.parse(JSON.stringify(HO.appQs || [])) }), appQLabel: (HO.appQs || []).length ? (HO.appQs.length + ' Hope Harbor question' + (HO.appQs.length === 1 ? '' : 's') + ' on your application') : 'Standard application only',
      L: hopeL, hasPartners: (hopeL.partnerOrgs || []).length > 0,
      goSettings: () => this.setState({ dashTab: 'settings' }),
      e: ['ident', 'about', 'cats', 'hours', 'services', 'who', 'contact'].reduce((o, key) => { o[key] = { on: s.orgEdit === key, off: s.orgEdit !== key,
        start: () => this.setState({ orgEdit: key, orgDraft: JSON.parse(JSON.stringify(HO)) }), cancel: () => this.setState({ orgEdit: null }),
        save: () => { this.toast('Listing updated. Changes are live.'); this.setState(st => ({ orgEdit: null, orgs: st.orgs.map(o2 => o2.id === 'hope' ? Object.assign({}, o2, st.orgDraft, { services: Object.keys((st.orgDraft || {}).services || {}).reduce((m, k) => { m[k] = st.orgDraft.services[k].map(x => x.trim()).filter(Boolean); return m; }, {}), updated: 'Just now', updN: (o2.updN || 0) + 1 }) : o2) })); } }; return o; }, {}),
      d: ['name', 'type', 'faith', 'addr', 'phone', 'about', 'cost', 'docs', 'docsTitle'].reduce((o, k) => { o[k] = { v: DR[k] == null ? '' : DR[k], on: e => setDr(k, e.target.value) }; return o; }, {}),
      aboutCount: (DR.about || '').length + ' characters · shown on your public listing',
      catOpts: D.CATS.map(c => { const on = (DR.cats || []).includes(c.k); return { label: c.label, icon: this.ic(c.icon, 14), on: on ? 'true' : 'false', style: this.chip(on), toggle: () => setDr('cats', on ? DR.cats.filter(x => x !== c.k) : (DR.cats || []).concat(c.k)) }; }),
      langOpts: D.LANGS.map(l => { const on = (DR.langs || []).includes(l); return { label: l, on: on ? 'true' : 'false', style: this.chip(on), toggle: () => setDr('langs', on ? DR.langs.filter(x => x !== l) : (DR.langs || []).concat(l)) }; }),
      eligOpts: D.ELIG.map(l => { const on = (DR.elig || []).includes(l); return { label: l, on: on ? 'true' : 'false', style: this.chip(on), toggle: () => setDr('elig', on ? DR.elig.filter(x => x !== l) : (DR.elig || []).concat(l)) }; }),
      hourRows: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => ({ d, v: (DR.hours || [])[i] || '', on: e => { const H = (DR.hours || []).slice(); H[i] = e.target.value; setDr('hours', H); } })),
      svcRows: (DR.cats || []).map(k => ({ label: this.cat(k).label, icon: this.ic(this.cat(k).icon, 16), v: ((DR.services || {})[k] || []).join('\n'), on: e => setDr('services', Object.assign({}, DR.services || {}, { [k]: e.target.value.split('\n') })) })),
      contactRows: ['Name', 'Role', 'Email'].map((label, i) => ({ label, v: (DR.contact || [])[i] || '', on: e => { const C = (DR.contact || []).slice(); C[i] = e.target.value; setDr('contact', C); } })),
      stats: [
        [HR.length, 'Referrals received', 'Sent to Hope Harbor'],
        [cntSt(['Submitted', 'Seen']), 'Need a response', 'Waiting on your team'],
        [cntSt(['Accepted', 'In progress']), 'In progress', 'Accepted or underway'],
        [23 + doneR.length, 'Completed this month', 'Referrals closed out'],
        [(accN + decN + redN) ? Math.round(100 * accN / (accN + decN + redN)) + '%' : '—', 'Acceptance rate', 'Accepted ÷ decided'],
        [peopleN, 'People helped', 'In completed referrals'],
        [redN, 'Passed along', 'Sent to a better fit'],
        [HR.filter(x => x.shared && !['Completed', 'Declined', 'Redirected'].includes(x.stage)).length, 'Active shared cases', 'With partner organizations'],
        [(s.needs || []).filter(n => n.mine).length, 'Unclaimed needs taken', 'Claimed by your team'],
        [myVolsO.length, 'Volunteer posts', myVolsO.reduce((a, v) => a + v.have, 0) + ' people signed up'],
        [s.threads.reduce((a, th) => a + th.unread, 0), 'Unread messages', s.threads.length + ' conversations'],
        [(s.team || []).length, 'Team members', 'With dashboard access'],
        [(s.favs || []).length, 'Favorite organizations', 'Saved in Find help'],
        [HO.updN || 0, 'Listing updates', 'Since joining']
      ].map(([value, label, hint]) => ({ value, label, hint })),
      byNeed: Object.keys(needCounts).sort((a, b) => needCounts[b] - needCounts[a]).map(k => ({ label: this.cat(k).label, n: needCounts[k], bar: { display: 'block', height: '100%', width: (100 * needCounts[k] / maxNeed) + '%', background: 'var(--color-accent-700)' } })),
      byStage: stageRows.map(([label, n, c]) => ({ label, n, bar: { display: 'block', height: '100%', width: (100 * n / maxSt) + '%', background: c } }))
    };
    const dash = {
      org: orgD,
      pubTip: { show: !s.pubTipHidden, hidden: !!s.pubTipHidden, close: () => this.setState({ pubTipHidden: true }) },
      notice: s.notice ? { show: true, title: s.notice.title, text: s.notice.text, canDismiss: !!s.notice.canDismiss, dismiss: () => this.setState({ notice: null }),
        boxStyle: s.notice.tone === 'live' ? { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', marginBottom: 22, border: '1px solid #2f8f4e', borderLeft: '6px solid #2f8f4e', background: '#eef7f0', color: '#173f24' }
          : { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', marginBottom: 22, border: '1px solid #c98a10', borderLeft: '6px solid #c98a10', background: '#fdf6e7', color: '#4a3203' } } : { show: false },
      startTour: () => this.setState({ modal: { kind: 'tour', tour: 'overview', step: 0 }, dashTab: 'org', pubView: false }),
      pageTour: () => { const tk = s.dashTab; const first = (this.tourSteps(tk)[0] || {}).set || {}; this.setState(Object.assign({}, first, { modal: { kind: 'tour', tour: tk, step: 0 }, pubView: false })); },
      info: { open: infoOpen, hidden: infoOpen ? 'false' : 'true', wrap: { display: 'grid', gridTemplateRows: infoOpen ? '1fr' : '0fr', opacity: infoOpen ? 1 : 0, transform: infoOpen ? 'translateY(0)' : 'translateY(-6px)', transition: 'grid-template-rows .35s ease, opacity .3s ease, transform .35s ease' }, aria: infoOpen ? 'true' : 'false', label: infoOpen ? 'Hide page info' : 'About this page', toggle: () => this.setState(st => ({ pageInfo: st.pageInfo === st.dashTab ? null : st.dashTab })) },
      postsView: Object.assign(postsView, { has: posts.length > 0, count: posts.length + (posts.length === 1 ? ' post' : ' posts'), empty: !s.showHiddenPosts && posts.length === 0 && !pfN, filteredEmpty: posts.length === 0 && !!pfN }), feed, fp, pop, cpop: Object.assign({}, pop, { open: !!s.casePop && !!sr && s.dashTab === 'overview' }), settings: this.settingsVals(), ov, history, backToRefs: () => this.setState({ dashTab: 'referrals', selRef: null }), historyCount: history.length + ' completed referrals', backOverview: () => this.setState({ dashTab: 'overview' }), tabs: dashTabs, tab, hope, availSeg, availShow: { v: !hope.hideAvail, hidden: !!hope.hideAvail, on: () => { const nv = !hope.hideAvail; this.setState(st => ({ orgs: st.orgs.map(o => o.id === 'hope' ? Object.assign({}, o, { hideAvail: nv }) : o) })); this.toast(nv ? 'Availability is now hidden from your public listing.' : 'Availability is showing on your public listing again.'); } }, availHelp: this.AV[hope.avail].help, stats, queue, queuePreview: hopeR.filter(x => !['Completed', 'Declined', 'Redirected'].includes(x.stage)).map(x => this.decRef(x)),
      queueEmpty: queue.length === 0, caseCards, caseTitle: (KD.find(k => k[0] === ck) || KD[0])[1], caseCount: queue.length + (queue.length === 1 ? ' case' : ' cases'), qSeg: this.segOf('qFilter', [['all', 'All'], ['new', 'New'], ['active', 'In progress'], ['closed', 'Closed']]), sharedToggle: () => this.setState({ sharedF: s.sharedF === 'only' ? 'show' : 'only', qFilter: s.sharedF === 'only' ? s.qFilter : 'all' }), sharedPressed: s.sharedF === 'only' ? 'true' : 'false',
      sharedBtnLabel: s.sharedF === 'only' ? 'Showing shared cases' : 'Ongoing shared cases', sharedCount: hopeR.filter(x => x.shared && !['Completed', 'Declined', 'Redirected'].includes(x.stage)).length,
      sharedBtnStyle: { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 14px', fontSize: 15, cursor: 'pointer', border: '1px solid ' + (s.sharedF === 'only' ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), background: s.sharedF === 'only' ? 'var(--color-accent-700)' : 'var(--color-bg)', color: s.sharedF === 'only' ? 'var(--color-bg)' : 'var(--color-text)' },
      sharedCountStyle: { minWidth: 20, padding: '0 6px', fontSize: 12, fontWeight: 700, textAlign: 'center', background: s.sharedF === 'only' ? 'var(--color-bg)' : 'var(--color-accent-700)', color: s.sharedF === 'only' ? 'var(--color-accent-800)' : 'var(--color-bg)' },
      sel, hasSel: !!sel, noSel: !sel, selPrimary, selSecondary, closeSel: () => this.setState({ selRef: null }), seeAll: () => this.setState({ dashTab: 'referrals', qFilter: 'all', selRef: null }),
      note: this.bind('note'), addNote: () => { if (!s.note.trim()) return this.toast('Write a note first.'); this.setStage(sr.id, null, s.note.trim(), 'Internal note added. Only your team can see it.'); this.setState({ note: '' }); },
      layoutStyle: wide ? { display: 'grid', gridTemplateColumns: (mini ? '64px' : '236px') + ' minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr)', flex: 1, minHeight: 0, transition: 'grid-template-columns .2s ease' } : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
      toggleNav: () => this.setState({ navMini: !s.navMini }), goProfile: () => this.setState({ dashTab: 'profile', selRef: null }), navOpen: !mini, navExpanded: mini ? 'false' : 'true', navToggleLabel: mini ? 'Expand menu' : 'Collapse menu', toggleIcon: this.ic(mini ? 'arrow' : 'back', 18),
      toggleStyle: { display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : 'flex-start', gap: 10, width: '100%', minHeight: 44, padding: mini ? 0 : '0 12px', marginBottom: 8, border: 0, borderBottom: '1px solid var(--color-divider)', background: 'transparent', color: 'var(--color-neutral-800)', cursor: 'pointer', textAlign: 'left' },
      navStyle: wide ? { borderRight: '1px solid var(--color-divider)', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box' } : { display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--color-divider)', gap: 0 },
      needs, needsEmpty: needs.length === 0, needCat: this.bind('needF.cat'), needUrg: this.segOf('needF.urg', [['', 'Any'], ['Urgent — today', 'Urgent'], ['This week', 'This week'], ['Flexible', 'Flexible']]), needStatus: this.bind('needF.status'), needSort: { v: sortK, on: e => this.setState({ needSort: e.target.value }) }, needRad: [[5, 'Within 5 miles'], [10, 'Within 10 miles'], [25, 'Within 25 miles'], [50, 'Within 50 miles'], [0, 'Any distance']].map(([v, label]) => ({ v: String(v), label })), needRadV: String(s.needRad ?? 25), needRadOn: e => this.setState({ needRad: Number(e.target.value) }), radHint: (() => { const r = s.needRad ?? 25; const more = r ? s.needs.filter(n => n.mi > r && n.status === 'Unclaimed').length : 0; return more ? '+' + more + ' farther' : ''; })(), radExpand: () => { const r = s.needRad ?? 25; this.setState({ needRad: r < 10 ? 10 : r < 25 ? 25 : r < 50 ? 50 : 0 }); }, clearNeeds: () => this.setState({ needF: { cat: '', urg: '', status: '' }, needRad: 0 }),
      threads, thread, msg: this.bind('msg'), send: e => { e.preventDefault(); if (!s.msg.trim()) return; this.setState(st => ({ msg: '', threads: st.threads.map(t => t.id === th.id ? Object.assign({}, t, { msgs: t.msgs.concat({ mine: true, text: st.msg.trim(), t: 'Just now' }) }) : t) })); },
      msgGrid: Object.assign({ border: '1px solid var(--color-neutral-400)', background: 'var(--color-bg)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }, s.w >= 1100 ? { display: 'grid', gridTemplateColumns: thOpen ? 'minmax(0,1fr) minmax(0,2.2fr)' : 'minmax(0,1fr) minmax(0,0fr)', gridTemplateRows: 'minmax(0,1fr)', height: 'calc(100vh - 230px)', minHeight: 480, transition: 'grid-template-columns .4s cubic-bezier(.2,.7,.2,1)' } : { display: 'flex', flexDirection: 'column' }),
      thOpen, inboxPane: { display: s.w < 1100 && thOpen ? 'none' : 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, borderRight: thOpen ? '1px solid var(--color-neutral-400)' : '0', background: 'var(--color-neutral-100)' }, convPane: { display: s.w < 1100 && !thOpen ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', opacity: thOpen ? 1 : 0, transform: thOpen ? 'none' : 'translateX(24px)', transition: 'opacity .3s ease .1s, transform .4s cubic-bezier(.2,.7,.2,1)' }, convHidden: thOpen ? 'false' : 'true', closeThread: () => this.setState({ selThread: null }), unreadLabel: (() => { const u = s.threads.reduce((a, t) => a + (thOpen && t.id === th.id ? 0 : t.unread), 0); return u ? u + ' unread' : 'All caught up'; })(), threadCount: s.threads.length + ' conversations',
      stop: e => e.stopPropagation(), rolesOpen: !!s.rolesOpen, rolesAria: s.rolesOpen ? 'true' : 'false', rolesHidden: s.rolesOpen ? 'false' : 'true', rolesWrap: { display: 'grid', gridTemplateRows: s.rolesOpen ? '1fr' : '0fr', opacity: s.rolesOpen ? 1 : 0, marginBottom: s.rolesOpen ? 0 : -22, transition: 'grid-template-rows .35s ease, opacity .3s ease, margin-bottom .35s ease' }, rolesToggle: () => this.setState({ rolesOpen: !s.rolesOpen }),
   proj: this.projData(s), todo: this.todoData(s), myVols: myVols.slice(Math.min(s.myVolPg || 0, Math.max(0, Math.ceil(myVols.length / 5) - 1)) * 5).slice(0, 5), myVolsPager: (() => { const N = Math.ceil(myVols.length / 5), p = Math.min(s.myVolPg || 0, Math.max(0, N - 1)), a = p * 5; const btn = on => ({ width: 40, height: 40, display: 'inline-grid', placeItems: 'center', padding: 0, border: '1px solid var(--color-neutral-400)', background: 'var(--color-bg)', color: on ? 'var(--color-accent-700)' : 'var(--color-neutral-500)', cursor: on ? 'pointer' : 'not-allowed', opacity: on ? 1 : .5 }); return { show: N > 1, label: 'Showing ' + (a + 1) + '–' + Math.min(a + 5, myVols.length) + ' of ' + myVols.length, page: 'Page ' + (p + 1) + ' of ' + N, prevDis: p === 0, nextDis: p >= N - 1, prevStyle: btn(p > 0), nextStyle: btn(p < N - 1), prev: () => { if (p > 0) this.setState({ myVolPg: p - 1 }); }, next: () => { if (p < N - 1) this.setState({ myVolPg: p + 1 }); } }; })(), myVolsEmpty: !myVols.length, myEvents, myVolShowAll: (s.myVolView || 'all') === 'all', myVolShowEv: s.myVolView === 'events', myEvEmpty: !myEvents.length, myVolSeg: [['all', 'All posts'], ['events', 'Big events (' + myEvents.length + ')']].map(([k, label]) => ({ label, on: (s.myVolView || 'all') === k, pick: () => this.setState({ myVolView: k }) })), myVolSummary: myVols.length + (myVols.length === 1 ? ' post' : ' posts') + ' · ' + myVols.reduce((a, v) => a + v.have, 0) + ' of ' + myVols.reduce((a, v) => a + v.need, 0) + ' volunteers signed up', myVolAll: () => this.setState({ dashTab: 'volunteer', volFilter: 'mine', volShowFull: true }),
   posts, vols, volSeg, volsEmpty: !vols.length, newVol: () => this.modal({ kind: 'volPost', vKind: 'Event', vTitle: '', vIso: '', vTime: '', vPlace: 'Hope Harbor Community Pantry · Woodlawn', vNeed: '', vDesc: '', vSkills: [], vOther: '', vAge: 'All ages', vBg: false, vRecurring: false, vContact: 'Denise Carter · denise@hopeharbor.example' }), bigEvents, hasBigEvents: bigEvents.length > 0, volPgAll: (s.volPage || 'all') === 'all', volPgEv: s.volPage === 'events', noBigEvents: !bigEvents.length, volPages: [['all', 'All needs', vols.length], ['events', 'Big events', bigEvents.length]].map(([k, label, n]) => { const on = (s.volPage || 'all') === k; return { label, n, on: on ? 'true' : 'false', go: () => this.setState({ volPage: k }), style: { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 18px', border: 0, borderBottom: '3px solid ' + (on ? 'var(--color-accent-700)' : 'transparent'), marginBottom: -1, background: 'none', cursor: 'pointer', fontSize: 17, fontWeight: on ? 600 : 500, color: on ? 'var(--color-accent-900)' : 'var(--color-neutral-800)' }, nStyle: { minWidth: 24, height: 22, padding: '0 7px', display: 'inline-grid', placeItems: 'center', fontSize: 13, fontWeight: 600, background: on ? 'var(--color-accent-700)' : 'var(--color-neutral-200)', color: on ? 'var(--color-bg)' : 'var(--color-neutral-800)' } }; }), newEvent: () => this.modal({ kind: 'event', evTitle: '', evPlace: 'Hope Harbor Community Pantry · Woodlawn', evDesc: '', projects: [{ title: '', iso: '', time: '', need: '' }, { title: '', iso: '', time: '', need: '' }] }), volSort: this.bind('volSort'), volWhen: this.bind('volWhen'), volRad: this.bind('volRad'), volShowFull: { v: !!s.volShowFull, on: e => this.setState({ volShowFull: e.target.checked }) }, volCount: vols.length + (vols.length === 1 ? ' opportunity' : ' opportunities'), volCards: (s.volLayout || 'cards') === 'cards', volRows: s.volLayout === 'rows', volLayoutSeg: [['cards', 'Detailed', 'Full cards'], ['rows', 'Compact', 'Short rows with key info']].map(([k, label, tip]) => ({ label, tip, on: (s.volLayout || 'cards') === k, pick: () => this.setState({ volLayout: k }) })), volFiltersOpen: !!s.volFiltersOpen, volFiltersAria: s.volFiltersOpen ? 'true' : 'false', volFiltersToggle: () => this.setState({ volFiltersOpen: !s.volFiltersOpen }), volActiveN: (s.volFilter !== 'all') + (s.volWhen !== 'any') + (s.volRad !== 'any') + !!s.volShowFull, volClear: () => this.setState({ volFilter: 'all', volWhen: 'any', volRad: 'any', volShowFull: false }), newPost: () => this.modal({ kind: 'post' }), kase, partners, team, invite: () => this.modal({ kind: 'invite' }), canEditTeam, teamEditLabel: teamEditing ? 'Done editing' : 'Edit team', teamEditPressed: teamEditing ? 'true' : 'false', toggleTeamEdit: () => this.setState({ teamEditing: !teamEditing }), profile,
      logout: () => { this.toast('You have been logged out.'); this.go('home'); }
    };

    // moderation
    const mod = s.mod.map(m => Object.assign({}, m, { isOpen: m.status === 'Open', statusStyle: Object.assign({}, this.chipBase, m.status === 'Open' ? this.STAGE.Submitted : this.STAGE.Completed),
      resolve: () => { this.setState(st => ({ mod: st.mod.map(x => x.id === m.id ? Object.assign({}, x, { status: 'Resolved' }) : x) })); this.toast('Marked resolved.'); },
      dismiss: () => { this.setState(st => ({ mod: st.mod.map(x => x.id === m.id ? Object.assign({}, x, { status: 'Dismissed' }) : x) })); this.toast('Report dismissed.'); } }));
    const modOpen = s.mod.filter(m => m.status === 'Open').length + ' open reports';

    // modal
    const M = s.modal || {}, mk = M.kind;
    const passList = s.orgs.filter(o => o.id !== 'hope' && o.name.toLowerCase().includes((M.q || '').toLowerCase())).map(o => ({ name: o.name, sub: o.cats.map(k => this.cat(k).label).join(' · ') + ' · ' + this.AV[o.avail].label, on: M.pick === o.id, pick: () => this.upd('modal.pick', o.id),
      style: { display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left', padding: '10px 12px', minHeight: 44, cursor: 'pointer', border: 0, borderBottom: '1px solid var(--color-divider)', background: M.pick === o.id ? 'var(--color-accent-100)' : 'transparent', color: 'var(--color-text)' } }));
    const reasonOpts = list => list.map(l => ({ label: l, on: M.reason === l, pick: () => this.setState({ modal: Object.assign({}, M, { reason: l, err: '' }) }) }));
    const close = () => this.setState({ modal: null });
    const modal = {
      tour: mk === 'tour', tr: mk === 'tour' ? this.tourVals(M) : {}, denied: mk === 'denied', dn: mk === 'denied' ? this.deniedVals(M) : {}, folder: mk === 'folder', fd: mk === 'folder' ? this.folderModalVals(M) : {}, folderAdd: mk === 'folderAdd', fa: mk === 'folderAdd' ? this.folderAddVals(M) : {},
      open: !!mk && mk !== 'tour', teamMsg: mk === 'teamMsg', tmTo: M.to || '', tmText: { v: M.text || '', on: e => this.setState(st => ({ modal: Object.assign({}, st.modal, { text: e.target.value, err: '' }) })) }, tmSend: () => { if (!(M.text || '').trim()) return this.upd('modal.err', 'Write a message first.'); this.setState({ modal: null }); this.toast('Message sent to ' + M.to + '.'); }, applyPrev: mk === 'applyPrev', af: mk === 'applyPrev' ? this.afVals(M) : {}, report: mk === 'report', decline: mk === 'decline', pass: mk === 'pass', notfit: mk === 'notfit', ask: mk === 'ask', invite: mk === 'invite', post: mk === 'post', dlgStyle: { background: 'var(--color-bg)', width: mk === 'claim' && M.browse ? 'min(1120px, calc(100vw - 32px))' : mk === 'claim' && M.mode === 'share' ? 'min(940px, calc(100vw - 32px))' : (mk === 'volPost' || mk === 'applyPrev' || mk === 'event' || mk === 'appQs' || mk === 'volView' || mk === 'evView' || mk === 'projForm') ? 'min(820px, calc(100vw - 32px))' : (mk === 'volSign' || mk === 'signups' || mk === 'denied') ? 'min(680px, calc(100vw - 32px))' : mk === 'offerMsg' ? 'min(460px, calc(100vw - 32px))' : 'min(560px, calc(100vw - 32px))', maxWidth: 'none', maxHeight: '90vh', overflowY: mk === 'claim' && (M.browse || M.mode === 'share') && s.w >= 760 ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column', padding: 24, gap: 14, animation: 'bbin .18s ease-out', transition: 'width .3s cubic-bezier(.2,.7,.2,1)' },
      volSign: mk === 'volSign', signups: mk === 'signups', claim: mk === 'claim',
      offerMsg: mk === 'offerMsg', om: (() => { if (mk !== 'offerMsg') return {}; const p = (s.posts || []).find(x => x.id === M.pid) || {};
        return { org: p.org, title: p.title,
          send: () => { const txt = (M.text || '').trim(); if (!txt) return this.upd('modal.err', 'Write a short message first.');
            this.toast('Your offer and message were sent to ' + p.org + '.');
            this.setState(st => { const ex = st.threads.find(th => th.org === p.org); const msg = { mine: true, text: txt, t: 'Just now' };
              const threads = ex ? st.threads.map(th => th.id === ex.id ? Object.assign({}, th, { msgs: th.msgs.concat(msg) }) : th) : [{ id: 't' + Date.now(), subject: 'Re: ' + p.title, org: p.org, person: 'Community board', unread: 0, msgs: [msg] }].concat(st.threads);
              return { modal: null, threads, posts: st.posts.map(x => x.id === p.id ? Object.assign({}, x, { offered: true, replies: (x.replies || 0) + 1 }) : x) }; }); } }; })(),
      appQs: mk === 'appQs', aq: (() => { if (mk !== 'appQs') return {};
        const Q = M.qs || [], setQ = fn => this.setState(st => ({ modal: Object.assign({}, st.modal, { err: '', qs: fn(st.modal.qs.slice()) }) }));
        const field = (i, k, val) => setQ(a => { a[i] = Object.assign({}, a[i], { [k]: val }); return a; });
        return { empty: Q.length === 0,
          rows: Q.map((q, i) => { const CH = q.choices || ((q.opts || '').split(',').map(x => x.trim()).filter(Boolean)); const ch = CH.length >= 2 ? CH : CH.concat(['', ''].slice(0, 2 - CH.length));
            const setCh = arr => field(i, 'choices', arr); const mw = q.maxWords == null ? (q.type === 'long' ? 150 : 25) : q.maxWords; return { n: i + 1, first: i === 0, last: i === Q.length - 1, isChoice: q.type === 'choice', isWritten: q.type === 'text' || q.type === 'long', isNumber: q.type === 'number',
            min: { v: q.min == null ? '' : q.min, on: e => field(i, 'min', e.target.value === '' ? null : +e.target.value) }, max: { v: q.max == null ? '' : q.max, on: e => field(i, 'max', e.target.value === '' ? null : +e.target.value) },
            rangeAria: q.allowRange ? 'true' : 'false', toggleRange: () => field(i, 'allowRange', !q.allowRange),
            rangeSwitch: { position: 'relative', width: 40, height: 22, borderRadius: 11, border: 0, padding: 0, cursor: 'pointer', flex: 'none', background: q.allowRange ? 'var(--color-accent-700)' : 'var(--color-neutral-400)', transition: 'background .2s' },
            rangeKnob: { position: 'absolute', top: 3, left: q.allowRange ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .2s' },
            maxWords: { v: mw, on: e => field(i, 'maxWords', e.target.value === '' ? '' : Math.max(1, +e.target.value)) }, boxHint: (+mw || 0) > 25 ? 'Applicants get a large text box' : 'Applicants get a single-line box',
            choiceRows: ch.map((c, j) => ({ mark: { width: 14, height: 14, borderRadius: q.multi ? 3 : '50%', border: '1.5px solid var(--color-neutral-600)', flex: 'none' }, v: c, aria: 'Choice ' + (j + 1), ph: 'Choice ' + (j + 1), canRemove: ch.length > 2, on: e => { const a = ch.slice(); a[j] = e.target.value; setCh(a); }, remove: () => setCh(ch.filter((x, k) => k !== j)) })),
            addChoice: () => setCh(ch.concat('')),
            multiAria: q.multi ? 'true' : 'false', toggleMulti: () => field(i, 'multi', !q.multi),
            switchStyle: { position: 'relative', width: 40, height: 22, borderRadius: 11, border: 0, padding: 0, cursor: 'pointer', flex: 'none', background: q.multi ? 'var(--color-accent-700)' : 'var(--color-neutral-400)', transition: 'background .2s' },
            knobStyle: { position: 'absolute', top: 3, left: q.multi ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .2s' },
            q: { v: q.q, on: e => field(i, 'q', e.target.value) }, type: { v: q.type === 'long' ? 'text' : q.type, on: e => field(i, 'type', e.target.value) }, req: { v: !!q.req, on: e => field(i, 'req', e.target.checked) }, opts: { v: q.opts || '', on: e => field(i, 'opts', e.target.value) },
            up: () => setQ(a => { [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; }), down: () => setQ(a => { [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; }), remove: () => setQ(a => a.filter((x, j) => j !== i)) }; }),
          add: () => setQ(a => a.concat({ id: 'q' + Date.now(), q: '', type: 'text', maxWords: 25, req: false, opts: '' })),
          save: () => {
            const clean = Q.map(q => { const CH = (q.choices || (q.opts || '').split(',')).map(x => String(x).trim()).filter(Boolean); return Object.assign({}, q, { q: (q.q || '').trim(), choices: CH, opts: CH.join(', '), type: q.type === 'long' ? 'text' : q.type, maxWords: (q.type === 'text' || q.type === 'long') ? (+q.maxWords || (q.type === 'long' ? 150 : 25)) : undefined }); }).filter(q => q.q);
            if (clean.some(q => q.type === 'choice' && q.choices.length < 2)) return this.upd('modal.err', 'Multiple-choice questions need at least two choices.');
            this.toast('Application updated. New applicants will see ' + (clean.length ? clean.length + ' Hope Harbor question' + (clean.length === 1 ? '' : 's') : 'only the standard questions') + '.');
            this.setState(st => ({ modal: null, orgs: st.orgs.map(o => o.id === 'hope' ? Object.assign({}, o, { appQs: clean }) : o) }));
          } }; })(),
      todoNew: mk === 'todoNew', td: (() => { if (mk !== 'todoNew') return {};
        return { t: this.bind('modal.tdT'), caseSel: this.bind('modal.tdCase'), who: this.bind('modal.tdWho'), due: this.bind('modal.tdDue'), staff: (s.team || []).map(m => m.name),
          cases: (s.referrals || []).filter(x => x.to === 'hope' && !['Completed', 'Declined', 'Redirected'].includes(x.stage)).map(x => ({ id: x.id, label: x.who + ' · ' + this.cat(x.cat).label + ' · ' + x.code })),
          submit: () => { if (!(M.tdT || '').trim()) return this.upd('modal.err', 'Write what needs to get done.'); if (!M.tdCase) return this.upd('modal.err', 'Choose the case this to-do is for.');
            const t = { id: 'td' + Date.now(), t: M.tdT.trim(), caseId: M.tdCase, who: M.tdWho || '', due: M.tdDue || '', done: false };
            this.setState(st => ({ modal: null, todos: [t].concat(st.todos || []), todoF: !t.due || t.due <= Component.TODAY ? 'today' : 'later', todoAll: st.todoAll || (t.who && t.who !== 'Denise Carter') }));
            this.toast('To-do added' + (t.who && t.who !== 'Denise Carter' ? ' and assigned to ' + t.who : '') + '.'); } }; })(),
      safetyWarn: mk === 'safetyWarn', sw: { ok: () => this.setState(st => ({ modal: null, ref: Object.assign({}, st.ref, { addrMode: 'safety' }), refErr: Object.assign({}, st.refErr, { addr: '', last: '' }) })) },
      volView: mk === 'volView', vv: (() => { if (mk !== 'volView') return {}; const v = (s.vols || []).find(x => x.id === M.vid); if (!v) return {};
        const o = this.org(v.org), ev = v.event ? (s.events || []).find(e => e.id === v.event) : null, full = v.have >= v.need, left = Math.max(0, v.need - v.have), pct = Math.min(100, Math.round(v.have / v.need * 100));
        return { title: v.title, kind: v.kind, orgName: o ? o.name : v.org, isMine: !!v.mine, notMine: !v.mine, hasEvent: !!ev, eventName: ev ? ev.title : '', viewEvent: () => { if (ev) this.modal({ kind: 'evView', eid: ev.id }); },
          date: v.date, time: v.time, place: v.place, desc: v.descRaw != null && v.descRaw !== '' ? v.descRaw : v.desc, hasSkillDesc: !!v.skillDesc, skillDesc: v.skillDesc || '', skills: (v.skills || []).map(k => ({ label: k })),
          recurring: v.recurring ? 'Repeats every week' : 'One time', contact: v.contact || 'Message ' + (o ? o.name : 'the organizer') + ' through Co-mission', posted: v.postedN === 0 ? 'Posted today' : 'Posted ' + v.postedN + (v.postedN === 1 ? ' day ago' : ' days ago'),
          spots: Math.min(v.have, v.need) + ' of ' + v.need + ' volunteers signed up', leftLabel: full ? 'Full' : left + ' spots left', bar: { display: 'block', height: 8, background: 'var(--color-neutral-300)', position: 'relative', overflow: 'hidden' }, fill: { display: 'block', position: 'absolute', inset: 0, width: pct + '%', background: full ? 'var(--color-neutral-600)' : 'var(--color-accent-700)' },
          edit: () => this.editVol(v), signups: () => this.modal({ kind: 'signups', vid: v.id }), del: () => { this.setState(st => ({ modal: null, vols: st.vols.filter(x => x.id !== v.id) })); this.toast('“' + v.title + '” deleted.'); },
          canSign: !v.mine && !v.signed && !full, signed: !v.mine && !!v.signed, isFull: !v.mine && !v.signed && full, sign: () => this.modal({ kind: 'volSign', vid: v.id, count: '', leader: '', lphone: '', lemail: '', group: 'Hope Harbor Community Pantry', vnote: '', agree: false }),
          ask: () => { this.setState({ modal: null, dashTab: 'messages' }); this.toast('Message ' + (o ? o.name : 'the organizer') + ' about “' + v.title + '”.'); } }; })(),
      evView: mk === 'evView', evv: (() => { if (mk !== 'evView') return {}; const e = (s.events || []).find(x => x.id === M.eid); if (!e) return {};
        const ps = (s.vols || []).filter(v => v.event === e.id).sort((a, b) => a.iso.localeCompare(b.iso)), need = ps.reduce((n, p) => n + p.need, 0), have = ps.reduce((n, p) => n + Math.min(p.have, p.need), 0), left = Math.max(0, need - have), pct = need ? Math.round(have / need * 100) : 0, o = this.org(e.org), f = ps[0], l = ps[ps.length - 1];
        const bar = { display: 'block', height: 8, background: 'var(--color-neutral-300)', position: 'relative', overflow: 'hidden' };
        return { title: e.title, orgName: o ? o.name : e.org, isMine: !!e.mine, notMine: !e.mine, place: e.place, desc: e.desc, dateRange: f ? (f.date === l.date ? f.date : f.date + ' – ' + l.date) : '', projectsLabel: ps.length + (ps.length === 1 ? ' project' : ' projects'),
          totals: have + ' of ' + need + ' volunteers signed up', leftLabel: left ? left + ' spots left across all projects' : 'Every spot is filled', bar, fill: { display: 'block', position: 'absolute', inset: 0, width: pct + '%', background: left ? 'var(--color-accent-700)' : 'var(--color-neutral-600)' },
          projects: ps.map(v => { const vp = Math.min(100, Math.round(v.have / v.need * 100)); return { title: v.title, date: v.date, time: v.time, mo: v.mo, day: v.day, spots: Math.min(v.have, v.need) + ' of ' + v.need, leftLabel: v.have >= v.need ? 'Full' : (v.need - v.have) + ' spots left', bar: Object.assign({}, bar, { height: 6 }), fill: { display: 'block', position: 'absolute', inset: 0, width: vp + '%', background: v.have >= v.need ? 'var(--color-neutral-600)' : 'var(--color-accent-700)' }, view: () => this.modal({ kind: 'volView', vid: v.id }) }; }),
          edit: () => this.modal({ kind: 'event', editId: e.id, evTitle: e.title, evPlace: e.place || '', evDesc: e.desc || '', projects: ps.map(v => ({ vid: v.id, title: v.title, iso: v.iso, time: v.time || '', need: String(v.need) })) }),
          del: () => { this.setState(st => ({ modal: null, events: st.events.filter(x => x.id !== e.id), vols: st.vols.filter(v => v.event !== e.id) })); this.toast('“' + e.title + '” deleted.'); } }; })(),
      projForm: mk === 'projForm', pf: (() => { if (mk !== 'projForm') return {};
        const caseOpts = (s.referrals || []).filter(x => x.to === 'hope' && (x.id === M.pCase || !['Completed', 'Declined', 'Redirected'].includes(x.stage))).map(x => ({ id: x.id, label: x.who + ' · ' + this.cat(x.cat).label + ' · ' + x.code + ' (' + x.stage + ')' }));
        const selCase = (s.referrals || []).find(x => x.id === M.pCase);
        const setM = o => this.setState(st => ({ modal: Object.assign({}, st.modal, o, { err: '' }) }));
        const T = M.pTeam || [], TK = M.pTasks || [], SU = M.pSup || [], PA = M.pPartners || [], NO = M.pNotes || [];
        const staff = (s.team || []).map(m => m.name), availStaff = staff.filter(n => !T.some(m => m.name === n));
        const orgAvail = s.orgs.filter(o => o.id !== 'hope' && !PA.includes(o.id)).map(o => ({ id: o.id, name: o.name }));
        const myEv = (s.events || []).filter(e => e.mine).map(e => ({ id: e.id, label: e.title + ' (' + (s.vols || []).filter(v => v.event === e.id).length + ' projects)' }));
        const isEvAdd = false, selEv = (s.events || []).find(e => e.id === M.pEvent);
        const pfx = {
          inEv: { v: !!M.pInEv, on: e => setM(e.target.checked ? { pInEv: true, pEvPop: true } : { pInEv: false, pEvPop: false, pEvent: '' }) }, evPop: !!M.pInEv && !!M.pEvPop, hasSelEv: !!M.pInEv && !!selEv, selEvName: selEv ? selEv.title : '', needsEvPick: !!M.pInEv && !selEv && !M.pEvPop, openEvPop: () => setM({ pEvPop: true }), closeEvPop: () => setM({ pEvPop: false }), evPick: myEv.map(o => ({ label: o.label, on: M.pEvent === o.id, pick: () => setM({ pEvent: o.id, pEvPop: false }) })), isEvAdd, notEvAdd: !isEvAdd, evOpts: myEv, hasEvOpts: myEv.length > 0, noEvOpts: !myEv.length, evSel: { v: M.pEvent || '', on: e => e.target.value === '__new' ? this.modal({ kind: 'event', fromProj: true, evTitle: '', evPlace: 'Hope Harbor Community Pantry · Woodlawn', evDesc: '', projects: [{ title: '', iso: '', time: '', need: '' }, { title: '', iso: '', time: '', need: '' }] }) : setM({ pEvent: e.target.value }) }, newEvent: () => this.modal({ kind: 'event', fromProj: true, evTitle: '', evPlace: 'Hope Harbor Community Pantry · Woodlawn', evDesc: '', projects: [{ title: '', iso: '', time: '', need: '' }, { title: '', iso: '', time: '', need: '' }] }),
          team: T.map((m, i) => ({ name: m.name, role: { v: m.role || '', on: e => setM({ pTeam: T.map((x, j) => j === i ? Object.assign({}, x, { role: e.target.value }) : x) }) }, isLead: m.name === M.pLead, remove: () => setM({ pTeam: T.filter((x, j) => j !== i), pLead: M.pLead === m.name ? '' : M.pLead }) })),
          teamEmpty: !T.length, staffOpts: availStaff, hasStaffOpts: availStaff.length > 0, newMem: { v: M.pNewMem || availStaff[0] || '', on: e => setM({ pNewMem: e.target.value }) }, newRole: this.bind('modal.pNewRole'),
          addMem: () => { const n = M.pNewMem && availStaff.includes(M.pNewMem) ? M.pNewMem : availStaff[0]; if (!n) return; setM({ pTeam: T.concat({ name: n, role: (M.pNewRole || '').trim() || 'Team member' }), pNewMem: '', pNewRole: '' }); },
          tasks: TK.map((t, i) => ({ t: { v: t.t, on: e => setM({ pTasks: TK.map((x, j) => j === i ? Object.assign({}, x, { t: e.target.value }) : x) }) }, done: { v: !!t.done, on: e => setM({ pTasks: TK.map((x, j) => j === i ? Object.assign({}, x, { done: e.target.checked }) : x) }) }, who: { v: t.who || '', on: e => setM({ pTasks: TK.map((x, j) => j === i ? Object.assign({}, x, { who: e.target.value }) : x) }) }, due: { v: t.due || '', on: e => setM({ pTasks: TK.map((x, j) => j === i ? Object.assign({}, x, { due: e.target.value }) : x) }) }, remove: () => setM({ pTasks: TK.filter((x, j) => j !== i) }) })),
          tasksEmpty: !TK.length, whoOpts: T.map(m => m.name), newTask: this.bind('modal.pNewTask'),
          addTask: () => { const t = (M.pNewTask || '').trim(); if (!t) return this.upd('modal.err', 'Write the to-do first, then press Add.'); setM({ pTasks: TK.concat({ id: 't' + Date.now(), t, who: '', due: '', done: false }), pNewTask: '' }); },
          sup: SU.map((u, i) => ({ item: { v: u.item, on: e => setM({ pSup: SU.map((x, j) => j === i ? Object.assign({}, x, { item: e.target.value }) : x) }) }, need: { v: String(u.need ?? ''), on: e => setM({ pSup: SU.map((x, j) => j === i ? Object.assign({}, x, { need: +e.target.value || 0 }) : x) }) }, have: { v: String(u.have ?? 0), on: e => setM({ pSup: SU.map((x, j) => j === i ? Object.assign({}, x, { have: +e.target.value || 0 }) : x) }) }, remove: () => setM({ pSup: SU.filter((x, j) => j !== i) }) })),
          supEmpty: !SU.length, newSup: this.bind('modal.pNewSup'), newSupQty: this.bind('modal.pNewSupQty'),
          addSup: () => { const it = (M.pNewSup || '').trim(), q = +M.pNewSupQty; if (!it || !(q > 0)) return this.upd('modal.err', 'Add the supply item and how many you need.'); setM({ pSup: SU.concat({ id: 's' + Date.now(), item: it, need: q, have: 0 }), pNewSup: '', pNewSupQty: '' }); },
          partners: PA.map(id => { const o = this.org(id); return { name: o ? o.name : id, remove: () => setM({ pPartners: PA.filter(x => x !== id) }) }; }), partnersEmpty: !PA.length, orgOpts: orgAvail, hasOrgOpts: orgAvail.length > 0,
          newPartner: { v: M.pNewPartner || (orgAvail[0] || {}).id || '', on: e => setM({ pNewPartner: e.target.value }) },
          addPartner: () => { const id = M.pNewPartner && orgAvail.some(o => o.id === M.pNewPartner) ? M.pNewPartner : (orgAvail[0] || {}).id; if (!id) return; setM({ pPartners: PA.concat(id), pNewPartner: '' }); },
          planned: this.bind('modal.pPlanned'), spent: this.bind('modal.pSpent'),
          notes: NO.map((n, i) => ({ by: n.by, when: n.when, text: { v: n.text, on: e => setM({ pNotes: NO.map((x, j) => j === i ? Object.assign({}, x, { text: e.target.value }) : x) }) }, remove: () => setM({ pNotes: NO.filter((x, j) => j !== i) }) })),
          notesEmpty: !NO.length, newNote: this.bind('modal.pNewNote'),
          addNote: () => { const t = (M.pNewNote || '').trim(); if (!t) return this.upd('modal.err', 'Write the note first, then press Add note.'); setM({ pNotes: [{ id: 'n' + Date.now(), by: 'Denise Carter', when: Component.nowLabel(), text: t }].concat(NO), pNewNote: '' }); },
          tabs: [['basics', 'Basics'], ['team', 'Team (' + T.length + ')'], ['tasks', 'To-dos (' + TK.length + ')'], ['supplies', 'Supplies (' + SU.length + ')'], ['partners', 'Partners (' + PA.length + ')'], ['budget', 'Budget & notes']].map(([k, label]) => { const on = (M.pTab || 'basics') === k; return { label, on: on ? 'true' : 'false', go: () => this.setState(st => ({ modal: Object.assign({}, st.modal, { pTab: k }) })), style: { minHeight: 40, padding: '0 12px', border: 0, borderBottom: '3px solid ' + (on ? 'var(--color-accent-700)' : 'transparent'), marginBottom: -1, background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: on ? 700 : 500, color: on ? 'var(--color-accent-900)' : 'var(--color-neutral-800)', whiteSpace: 'nowrap' } }; }),
          tBasics: (M.pTab || 'basics') === 'basics', tTeam: M.pTab === 'team', tTasks: M.pTab === 'tasks', tSup: M.pTab === 'supplies', tPartners: M.pTab === 'partners', tBudget: M.pTab === 'budget'
        };
        return Object.assign(pfx, { isNew: !M.editId, types: [['Volunteer project', 'Volunteer project'], ['Case project', 'Case project']].map(([k, label]) => ({ label, on: (M.pKind || 'Volunteer project') === k, pick: () => this.upd('modal.pKind', k) })), isCase: M.pKind === 'Case project', caseOpts, caseSel: this.bind('modal.pCase'), hasCaseSel: !!selCase, caseDesc: selCase ? selCase.desc : '', heading: M.editId ? 'Edit project' : isEvAdd ? 'Add a project to a big event' : 'Start a new project', btn: M.editId ? 'Save changes' : isEvAdd ? 'Add to event' : 'Create project', title: this.bind('modal.pTitle'), iso: this.bind('modal.pIso'), end: this.bind('modal.pEnd'), time: this.bind('modal.pTime'), place: this.bind('modal.pPlace'), desc: this.bind('modal.pDesc'), need: this.bind('modal.pNeed'), lead: this.bind('modal.pLead'), status: this.bind('modal.pStatus'), pri: this.bind('modal.pPri'),
          leads: (s.team || []).map(m => m.name), statuses: ['Planning', 'Active', 'On hold', 'Completed'], pris: ['Low', 'Normal', 'High'],
          submit: () => {
            if (!(M.pTitle || '').trim()) return this.upd('modal.err', 'Give the project a name.');
            if (!M.pIso) return this.upd('modal.err', 'Pick a start date.');
            if (M.pEnd && M.pEnd < M.pIso) return this.upd('modal.err', 'The end date can’t be before the start date.');
            if (M.pKind === 'Case project' && !M.pCase) return this.upd('modal.err', 'Choose the case this project is for.');
            const linkEv = M.pInEv ? (s.events || []).find(e => e.id === M.pEvent) : null; if (M.pInEv && !linkEv) return this.upd('modal.err', 'Choose which big event this project is part of, or uncheck the box.');
            const fo = { kind: M.pKind || 'Volunteer project', caseId: M.pKind === 'Case project' ? M.pCase : '', title: M.pTitle.trim(), iso: M.pIso, endIso: M.pEnd || '', time: (M.pTime || '').trim(), place: (M.pPlace || '').trim(), desc: (M.pDesc || '').trim(), need: +M.pNeed || 0, lead: M.pLead || '', status: M.pStatus || 'Planning', priority: M.pPri || 'Normal', team: (M.pTeam || []).concat(M.pLead && !(M.pTeam || []).some(m => m.name === M.pLead) ? [{ name: M.pLead, role: 'Project lead' }] : []), tasks: (M.pTasks || []).filter(t => (t.t || '').trim()), supplies: (M.pSup || []).filter(u => (u.item || '').trim()), partners: M.pPartners || [], budget: { planned: M.pPlanned || '', spent: M.pSpent || '' }, notes: (M.pNotes || []).filter(n => (n.text || '').trim()) };
            if (M.editId) { this.setState(st => ({ modal: null, projs: st.projs.map(x => x.id === M.editId ? Object.assign({}, x, fo, { log: [{ when: Component.nowLabel(), by: 'Denise Carter', text: 'Edited project details' }].concat(x.log || []) }) : x) })); this.toast('Project updated.'); return; }
            const id = 'pr' + Date.now(), ev = linkEv ? Object.assign(Component.projVol(linkEv, fo.title, fo.iso, fo.time || 'Time to be shared', Math.max(1, fo.need || 1), 0, 'Event', ['No experience needed'], Date.now()), { postedN: 0, descRaw: fo.desc, place: fo.place || linkEv.place }) : null;
            const np = Object.assign({ id, have: 0, vid: ev ? ev.id : null, eventId: linkEv ? linkEv.id : '', log: [{ when: Component.nowLabel(), by: 'Denise Carter', text: 'Project created' }] }, fo);
            this.setState(st => ({ modal: null, projs: [np].concat(st.projs || []), vols: ev ? (st.vols || []).concat(ev) : st.vols, dashTab: 'projects', projSel: id, projDraft: {} })); this.toast('Project “' + fo.title + '” created' + (linkEv ? ' and added to ' + linkEv.title : '') + '.');
          } }); })(),
      volPost: mk === 'volPost', vp: (() => { if (mk !== 'volPost') return {};
        const SK = ['No experience needed', 'Lifting up to 25 lb', 'Spanish speaking', 'Driver with own vehicle', 'Cooking / food handler card', 'Childcare experience', 'Medical or nursing', 'Tutoring', 'Carpentry / repairs', 'Tech help', 'Event setup'];
        const sel = M.vSkills || [];
        return { heading: M.editId ? 'Edit volunteer need' : 'Post a volunteer need', btn: M.editId ? 'Save changes' : 'Post need', kinds: ['Event', 'Serve project'].map(k => ({ label: k, on: (M.vKind === 'Serve project' ? 'Serve project' : 'Event') === k, pick: () => this.upd('modal.vKind', k) })), kindLower: (M.vKind === 'Serve project' ? 'serve project' : 'event'),
          subs: ['Ongoing', 'Skilled help', 'Donation drive'].map(k => { const on = M.vSub === k; return { label: k, on: on ? 'true' : 'false', style: this.chip(on), toggle: () => this.upd('modal.vSub', on ? '' : k) }; }), isSkilled: M.vSub === 'Skilled help', skillDesc: this.bind('modal.vSkillDesc'),
          title: this.bind('modal.vTitle'), iso: this.bind('modal.vIso'), time: this.bind('modal.vTime'), need: this.bind('modal.vNeed'), place: this.bind('modal.vPlace'), desc: this.bind('modal.vDesc'), other: this.bind('modal.vOther'), age: this.bind('modal.vAge'), bg: this.bind('modal.vBg'), recurring: this.bind('modal.vRecurring'), contact: this.bind('modal.vContact'),
          skills: SK.map(k => { const on = sel.includes(k); return { label: k, on: on ? 'true' : 'false', style: this.chip(on), toggle: () => this.upd('modal.vSkills', on ? sel.filter(x => x !== k) : sel.concat(k)) }; }),
          submit: () => {
            if (!(M.vTitle || '').trim()) return this.upd('modal.err', 'Add a short title.');
            if (!M.vIso) return this.upd('modal.err', 'Pick a date.');
            if (!(+M.vNeed > 0)) return this.upd('modal.err', 'How many volunteers do you need?'); if (M.vSub === 'Skilled help' && !(M.vSkillDesc || '').trim()) return this.upd('modal.err', 'Describe the kind of skilled help you need.');
            const skills = sel.concat((M.vOther || '').split(',').map(x => x.trim()).filter(Boolean)).concat(M.vAge && M.vAge !== 'All ages' ? [M.vAge] : []).concat(M.vBg ? ['Background check required'] : []);
            const fullDesc = ((M.vDesc || '').trim() || M.vTitle.trim()) + (M.vSub === 'Skilled help' && (M.vSkillDesc || '').trim() ? ' Skilled help needed: ' + M.vSkillDesc.trim() : '');
            if (M.editId) { const dd = Component.dParts(M.vIso); const isSv = M.vKind === 'Serve project';
              this.setState(st => ({ modal: null, vols: st.vols.map(x => x.id === M.editId ? Object.assign({}, x, { title: M.vTitle.trim(), iso: M.vIso, date: dd.date, mo: dd.mo, day: dd.day, wd: dd.wd, time: M.vTime || 'Time to be shared', need: +M.vNeed, place: M.vPlace || x.place, sub: M.vSub || '', kind: x.event ? x.kind : (isSv ? 'Serve project' : 'Event') + (M.vSub ? ' · ' + M.vSub : ''), desc: fullDesc, descRaw: (M.vDesc || '').trim(), skillDesc: M.vSub === 'Skilled help' ? (M.vSkillDesc || '').trim() : '', skills: skills.length ? skills : ['No experience needed'], recurring: !!M.vRecurring, contact: M.vContact }) : x) }));
              this.toast('Changes saved to “' + M.vTitle.trim() + '”.'); return; }
            const ev = { id: 'v' + Date.now(), org: 'hope', mine: true, place: M.vPlace || 'Hope Harbor Community Pantry · Woodlawn' };
            const v = Object.assign(Component.projVol(ev, M.vTitle.trim(), M.vIso, M.vTime || 'Time to be shared', +M.vNeed, 0, (M.vKind === 'Serve project' ? 'Serve project' : 'Event'), skills.length ? skills : ['No experience needed'], 1), { id: 'v' + Date.now(), event: undefined, postedN: 0, sub: M.vSub || '', kind: (M.vKind === 'Serve project' ? 'Serve project' : 'Event') + (M.vSub ? ' · ' + M.vSub : ''), desc: ((M.vDesc || '').trim() || M.vTitle.trim()) + (M.vSub === 'Skilled help' && (M.vSkillDesc || '').trim() ? ' Skilled help needed: ' + M.vSkillDesc.trim() : ''), recurring: !!M.vRecurring, contact: M.vContact, descRaw: (M.vDesc || '').trim(), skillDesc: M.vSub === 'Skilled help' ? (M.vSkillDesc || '').trim() : '' });
            this.setState(st => ({ modal: null, vols: [v].concat(st.vols || []), projs: M.linkProj ? (st.projs || []).map(p => p.id === M.linkProj ? Object.assign({}, p, { vid: v.id, log: [{ when: Component.nowLabel(), by: 'Denise Carter', text: 'Posted as a volunteer need' }].concat(p.log || []) }) : p) : st.projs }));
            this.toast('Volunteer need posted.');
          } }; })(),
      event: mk === 'event', ev: (() => { if (mk !== 'event') return {};
        const P = M.projects || [], setP = (i, k, val) => this.setState(st => ({ modal: Object.assign({}, st.modal, { err: '', projects: st.modal.projects.map((p, j) => j === i ? Object.assign({}, p, { [k]: val }) : p) }) }));
        return { showTypes: !M.editId && !!M.fromProj, types: [['Volunteer project', () => this.projForm(null)], ['Case project', () => this.projForm(null, 'Case project')], ['Big event', () => {}]].map(([label, pick]) => ({ label, on: label === 'Big event', pick })), eyebrow: M.editId ? 'Big event' : 'New big event', heading: M.editId ? 'Edit big event' : 'Create a big event', btn: M.editId ? 'Save changes' : 'Post event', title: this.bind('modal.evTitle'), place: this.bind('modal.evPlace'), desc: this.bind('modal.evDesc'), count: P.length + (P.length === 1 ? ' project' : ' projects'),
          rows: P.map((p, i) => ({ n: i + 1, canRemove: P.length > 1, remove: () => this.setState(st => ({ modal: Object.assign({}, st.modal, { projects: st.modal.projects.filter((x, j) => j !== i) }) })),
            title: { v: p.title, on: e => setP(i, 'title', e.target.value) }, iso: { v: p.iso, on: e => setP(i, 'iso', e.target.value) }, time: { v: p.time, on: e => setP(i, 'time', e.target.value) }, need: { v: p.need, on: e => setP(i, 'need', e.target.value) } })),
          add: () => this.setState(st => ({ modal: Object.assign({}, st.modal, { projects: st.modal.projects.concat({ title: '', iso: '', time: '', need: '' }) }) })),
          submit: () => {
            if (!(M.evTitle || '').trim()) return this.upd('modal.err', 'Give the event a name.');
            const good = P.filter(p => (p.title || '').trim() && p.iso && +p.need > 0);
            if (good.length < 2) return this.upd('modal.err', 'Add at least two projects, each with a name, date, and number of volunteers.');
            if (M.editId) { const keep = good.filter(p => p.vid).map(p => p.vid);
              this.setState(st => { const old = (st.events || []).find(x => x.id === M.editId) || {}; const ev2 = Object.assign({}, old, { title: M.evTitle.trim(), place: M.evPlace || old.place, desc: (M.evDesc || '').trim() || M.evTitle.trim() });
                const vols = (st.vols || []).filter(v => v.event !== M.editId || keep.includes(v.id)).map(v => { const rw = good.find(p => p.vid === v.id); if (!rw) return v; const dd = Component.dParts(rw.iso); return Object.assign({}, v, { title: rw.title.trim(), iso: rw.iso, date: dd.date, mo: dd.mo, day: dd.day, wd: dd.wd, time: rw.time || 'Time to be shared', need: +rw.need, place: ev2.place }); });
                const add = good.filter(p => !p.vid).map((p, n) => Object.assign(Component.projVol(ev2, p.title.trim(), p.iso, p.time || 'Time to be shared', +p.need, 0, 'Event', ['No experience needed'], n + 1), { id: ev2.id + '-p' + Date.now() + n, postedN: 0 }));
                return { modal: null, events: st.events.map(x => x.id === M.editId ? ev2 : x), vols: vols.concat(add) }; });
              this.toast('Changes saved to “' + M.evTitle.trim() + '”.'); return; }
            const ev = { id: 'e' + Date.now(), org: 'hope', mine: true, kind: 'Event', title: M.evTitle.trim(), place: M.evPlace || 'Hope Harbor Community Pantry · Woodlawn', desc: (M.evDesc || '').trim() || M.evTitle.trim() };
            const pv = good.map((p, n) => Component.projVol(ev, p.title.trim(), p.iso, p.time || 'Time to be shared', +p.need, 0, 'Event', ['No experience needed'], n + 1));
            this.setState(st => Object.assign({ modal: null, events: [ev].concat(st.events || []), vols: (st.vols || []).concat(pv), evOpen: Object.assign({}, st.evOpen || {}, { [ev.id]: true }), volFilter: 'all' }, M.fromProj ? { projF: 'events', projSel: null } : {}));
            this.toast('“' + ev.title + '” posted with ' + pv.length + ' projects.');
          } }; })(),
      close, stop: e => e.stopPropagation(), err: M.err, hasErr: !!M.err, target: M.targetName || '',
      q: this.bind('modal.q'), note: this.bind('modal.note'), text: this.bind('modal.text'), title: this.bind('modal.title'), email: this.bind('modal.email'),
      passList, passEmpty: passList.length === 0,
      reportReasons: reasonOpts(['Incorrect info', 'Closed or moved', 'Inappropriate content', 'Safety concern', 'Other']), isOther: M.reason === 'Other', noteLabel: M.reason === 'Other' ? 'Tell us what’s wrong' : 'Details (optional)',
      declineReasons: reasonOpts(['We’re at capacity right now', 'Outside what we offer', 'Outside our service area', 'We couldn’t reach the person', 'Other']),
      fitReasons: reasonOpts(['Not a service we offer', 'Outside our area', 'At capacity right now', 'Other']),
      roles: ['Admin', 'Staff', 'Volunteer'].map(rl => ({ label: rl, on: (M.role || 'Staff') === rl, pick: () => this.upd('modal.role', rl) })),
      postUrg: this.segOf('modal.urg', ['Urgent', 'Within a few days', 'Within a few weeks', 'No rush']), postTypes: this.segOf('modal.type', ['Supply request', 'Event', 'Partnership']),
      submitReport: () => { if (!M.reason) return this.upd('modal.err', 'Choose a reason.'); if (M.reason === 'Other' && !(M.note || '').trim()) return this.upd('modal.err', 'Tell us what’s wrong so we can look into it.'); this.setState(st => ({ modal: null, mod: [{ id: 'm' + Date.now(), reason: M.reason, item: M.targetName, detail: M.note || '(No details given)', by: 'You', when: 'Just now', status: 'Open' }].concat(st.mod) })); this.toast('Thank you. A person will review this within 2 business days.'); },
      submitDecline: () => { if (!M.reason) return this.upd('modal.err', 'Choose a reason so the referrer knows what to do next.'); this.setStage(M.id, 'Declined', 'Declined: ' + M.reason + (M.note ? ' — ' + M.note : ''), 'Referral declined. The referrer has been notified.'); close(); },
      submitPass: () => { const o = this.org(M.pick); if (!o) return this.upd('modal.err', 'Choose an organization.'); if (M.target === 'ref') { this.setStage(M.id, 'Redirected', 'Passed to ' + o.name + (M.note ? ' — ' + M.note : ''), 'Passed to ' + o.name + '. Same reference number.'); this.setState(st => ({ referrals: st.referrals.map(r => r.id === M.id ? Object.assign({}, r, { passTo: o.id, passStage: 'Submitted' }) : r) })); } else { this.setState(st => ({ needs: st.needs.map(x => x.id === M.id ? Object.assign({}, x, { status: 'Passed along' }) : x) })); this.toast('Passed along to ' + o.name + '.'); } close(); },
      submitFit: () => { if (!M.reason) return this.upd('modal.err', 'Choose a reason.'); if (M.reason === 'Other' && !(M.note || '').trim()) return this.upd('modal.err', 'Add a short reason.'); this.setState(st => ({ modal: null, needs: st.needs.map(x => x.id === M.id ? Object.assign({}, x, { notFit: M.reason === 'Other' ? M.note.trim() : M.reason }) : x) })); this.toast('Marked not a fit. It stays open for other organizations.'); },
      submitAsk: () => { if (!(M.text || '').trim()) return this.upd('modal.err', 'Write your question.'); close(); this.toast('Question sent. You’ll get a reply in Messages.'); },
      askWho: M.who || '',
      cl: (() => { if (mk !== 'claim') return {}; const n = (s.needs || []).find(x => x.id === M.nid) || {}, cat = n.cat, mode = M.mode || 'solo', P = M.partners || [];
        const opt = (k, short, title, sub, icon) => { const on = mode === k; return { short, title, sub, icon, on, pick: () => this.upd('modal.mode', k), style: { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', background: on ? 'var(--color-accent-100)' : 'var(--color-bg)', border: '1px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'), boxShadow: on ? 'inset 3px 0 0 var(--color-accent-700)' : 'none' }, dot: { width: 20, height: 20, flex: 'none', marginTop: 2, borderRadius: '50%', border: '2px solid ' + (on ? 'var(--color-accent-700)' : 'var(--color-neutral-500)'), boxShadow: on ? 'inset 0 0 0 4px var(--color-bg)' : 'none', background: on ? 'var(--color-accent-700)' : 'transparent' } }; };
        const all = (D.ORGS || []).filter(o => o.id !== 'hope' && o.cats && o.cats.length), fit = o => o.cats.includes(cat) ? 1 : 0;
        const best = all.slice().sort((a, b) => (fit(b) - fit(a)) || ((a.mi || 99) - (b.mi || 99))), top = best.filter(o => !o.pending).slice(0, 8);
        const pool = top.concat(all.filter(o => P.includes(o.id) && !top.includes(o)));
        const bq = (M.bq || '').trim().toLowerCase(), bs = M.bs || 'match', bf = M.bf || 'all', BC = M.bcats || [], bfa = M.bfa || '', brad = +(M.brad || 0), blang = M.blang || '', bcost = M.bcost || '', bver = !!M.bver, bacc = !!M.bacc, bsel = !!M.bsel;
        const uniq = a => Array.from(new Set(a.filter(Boolean))).sort();
        const fOpts = { faith: uniq(all.map(o => o.faith)), langs: uniq([].concat(...all.map(o => o.langs || []))), cost: uniq(all.map(o => o.cost)), cats: uniq([].concat(...all.map(o => o.cats))) };
        const bActive = (bf !== 'all') + !!BC.length + !!bfa + !!brad + !!blang + !!bcost + bver + bacc + bsel + !!bq;
        const BS = { match: (a, b) => (fit(b) - fit(a)) || ((a.mi || 99) - (b.mi || 99)), near: (a, b) => (a.mi || 99) - (b.mi || 99), name: (a, b) => a.name.localeCompare(b.name), sel: (a, b) => (P.includes(b.id) - P.includes(a.id)) || a.name.localeCompare(b.name) };
        const blist = all.filter(o => (!bq || (o.name + ' ' + (o.hood || '') + ' ' + o.cats.map(c => this.cat(c).label).join(' ')).toLowerCase().includes(bq)) && (bf === 'all' || (bf === 'fit' ? fit(o) : o.type === bf)) && (!BC.length || BC.some(c => o.cats.includes(c))) && (!bfa || o.faith === bfa) && (!brad || (o.mi || 99) <= brad) && (!blang || (o.langs || []).includes(blang)) && (!bcost || o.cost === bcost) && (!bver || o.verified) && (!bacc || o.avail === 'Accepting') && (!bsel || P.includes(o.id))).sort(BS[bs] || BS.match);
        const row = o => { const on = P.includes(o.id); return { id: o.id, name: o.name, meta: (fit(o) ? 'Offers ' + this.cat(cat).label.toLowerCase() + ' · ' : '') + (o.hood || '') + (o.mi ? ' · ' + o.mi + ' mi' : ''), cats: o.cats.slice(0, 3).map(c => this.cat(c).label).join(' · '), fit: !!fit(o), pending: !!o.pending, on, toggle: () => this.setState(st => ({ modal: Object.assign({}, st.modal, { clErr: '', partners: on ? P.filter(x => x !== o.id) : P.concat(o.id) }) })) }; };
        const err = M.clErr || '';
        return { who: n.who, need: n.desc, catLabel: cat ? this.cat(cat).label : '', opts: [opt('solo', 'On our own', 'We’ll handle it on our own', 'Hope Harbor takes the full need. It moves to your referrals as Accepted.', this.ic('flag', 20)), opt('share', 'Share the case', 'Share the case with other organizations', 'Claim it and open a shared case so partners can cover parts of the need.', this.ic('users', 20))], leftCol: mode === 'share' && s.w >= 760 ? { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflow: 'hidden' } : { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
          isShare: mode === 'share', notShare: mode !== 'share', bodyGrid: mode === 'share' && s.w >= 760 ? { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr)', gap: 22, flex: '1 1 auto', minHeight: 0, alignItems: 'stretch' } : { display: 'flex', flexDirection: 'column', gap: 14 },
          partners: pool.map(row), selList: all.filter(o => P.includes(o.id)).map(row), hasSel: !!P.length, noSel: !P.length,
          askFor: { v: P.includes(M.askFor) ? M.askFor : 'all', on: e => this.upd('modal.askFor', e.target.value) },
          addAsk: () => { const t = (M.cnote || '').trim(); if (!t) return; const f = P.includes(M.askFor) ? M.askFor : 'all'; this.setState(st => ({ modal: Object.assign({}, st.modal, { cnote: '', asks: (st.modal.asks || []).concat({ k: Date.now(), id: f, text: t }) }) })); },
          askKey: e => { if (e.key === 'Enter') { e.preventDefault(); const t = (M.cnote || '').trim(); if (!t) return; const f = P.includes(M.askFor) ? M.askFor : 'all'; this.setState(st => ({ modal: Object.assign({}, st.modal, { cnote: '', asks: (st.modal.asks || []).concat({ k: Date.now(), id: f, text: t }) }) })); } },
          asks: (M.asks || []).filter(x => x.id === 'all' || P.includes(x.id)).map(x => ({ name: x.id === 'all' ? 'All partners' : (this.org(x.id) || {}).name, text: x.text, remove: () => this.setState(st => ({ modal: Object.assign({}, st.modal, { asks: (st.modal.asks || []).filter(y => y.k !== x.k) }) })) })),
          hasAsks: (M.asks || []).some(x => x.id === 'all' || P.includes(x.id)), sugList: best.filter(o => !o.pending && !P.includes(o.id)).slice(0, 8).map(row), browse: !!M.browse, notBrowse: !M.browse, openBrowse: () => this.upd('modal.browse', true), closeBrowse: () => this.upd('modal.browse', false), allN: all.length,
          bq: this.bind('modal.bq'), bs: this.bind('modal.bs'), bf: this.bind('modal.bf'), bfa: this.bind('modal.bfa'), brad: this.bind('modal.brad'), blang: this.bind('modal.blang'), bcost: this.bind('modal.bcost'),
          faithOpts: fOpts.faith, langOpts: fOpts.langs, costOpts: fOpts.cost,
          bcats: fOpts.cats.map(c => { const on = BC.includes(c); return { label: this.cat(c).label, on, toggle: () => this.upd('modal.bcats', on ? BC.filter(x => x !== c) : BC.concat(c)) }; }),
          chk: k => ({ v: !!M[k], on: e => this.upd('modal.' + k, e.target.checked) }),
          bver: { v: bver, on: e => this.upd('modal.bver', e.target.checked) }, bacc: { v: bacc, on: e => this.upd('modal.bacc', e.target.checked) }, bsel: { v: bsel, on: e => this.upd('modal.bsel', e.target.checked) },
          browseBody: s.w >= 760 ? { display: 'flex', gap: 20, flex: '1 1 auto', minHeight: 0, alignItems: 'stretch' } : { display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', flex: 'none' },
          browseList: Object.assign({ border: '1px solid var(--color-neutral-400)', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', alignItems: 'stretch' }, s.w >= 760 ? { flex: '1 1 auto', minHeight: 0 } : { flex: 'none', maxHeight: '54vh' }),
          bActiveN: bActive, bHasActive: !!bActive, bClear: () => this.setState(st => ({ modal: Object.assign({}, st.modal, { bq: '', bf: 'all', bcats: [], bfa: '', brad: '', blang: '', bcost: '', bver: false, bacc: false, bsel: false }) })), blist: blist.map(row), bCount: blist.length + (blist.length === 1 ? ' organization' : ' organizations'), bEmpty: !blist.length, doneLabel: P.length ? 'Done · ' + P.length + ' selected' : 'Done', catLow: cat ? this.cat(cat).label.toLowerCase() : '',
          pickedN: P.length ? P.length + ' selected' : '', cnote: this.bind('modal.cnote'), err, hasErr: !!err,
          submitLabel: mode === 'share' ? 'Claim and share' : 'Claim this need',
          submit: () => { if (mode === 'share' && !P.length) return this.upd('modal.clErr', 'Choose at least one organization to share with.'); const asks = (M.asks || []).filter(x => x.id === 'all' || P.includes(x.id)).map(x => (x.id === 'all' ? 'All' : (this.org(x.id) || {}).name) + ': ' + x.text); if ((M.cnote || '').trim()) asks.push('All: ' + M.cnote.trim()); this.claimNeed(n, mode, P, asks.join('; ')); } }; })(),
      su: (() => { if (mk !== 'signups') return {}; const v = (s.vols || D.VOLS).find(x => x.id === M.vid) || {}, gs = (v.groups || []).map(g => Object.assign({}, g, { nLabel: g.n + (g.n === 1 ? ' volunteer' : ' volunteers'), tel: 'tel:' + g.phone, mail: g.email ? 'mailto:' + g.email : '', hasEmail: !!g.email }));
        return { title: v.title, when: v.date + ' · ' + v.time, total: v.have + ' of ' + v.need + ' volunteers · ' + gs.length + (gs.length === 1 ? ' group' : ' groups'), groups: gs, empty: !gs.length, copy: () => this.toast('Leader contacts copied.'), msgAll: () => { this.setState({ modal: null }); this.toast('Message sent to ' + gs.length + ' group leaders.'); } }; })(),
      vs: (() => { if (mk !== 'volSign') return {}; const v = (s.vols || D.VOLS).find(x => x.id === M.vid) || {}, o = this.org(v.org), left = Math.max(1, (v.need || 0) - (v.have || 0));
        return { title: v.title, org: o ? o.name : '', when: v.date + ' · ' + v.time, place: v.place, skills: (v.skills || []).join(' · '), leftLabel: left + (left === 1 ? ' spot left' : ' spots left'), max: left,
          count: this.bind('modal.count'), leader: this.bind('modal.leader'), lphone: this.bind('modal.lphone'), lemail: this.bind('modal.lemail'), group: this.bind('modal.group'), vnote: this.bind('modal.vnote'), agree: { v: !!M.agree, on: e => this.upd('modal.agree', e.target.checked) }, e: M.verr || {},
          submit: () => { const e = {}; const cn = Math.floor(+M.count); if (!M.count || !(cn >= 1)) e.count = 'Enter how many volunteers.'; else if (cn > left) e.count = 'Only ' + left + (left === 1 ? ' spot is' : ' spots are') + ' left.'; if (!(M.leader || '').trim()) e.leader = 'Add the group leader’s name.'; if (!(M.lphone || '').trim() && !/.+@.+\..+/.test(M.lemail || '')) e.contact = 'Add a phone number or email for the leader.'; if (!M.agree) e.agree = 'Please confirm your group meets the requirements.'; if (Object.keys(e).length) return this.upd('modal.verr', e); const n = +M.count; this.setState(st => ({ modal: null, vols: (st.vols || D.VOLS).map(x => x.id === M.vid ? Object.assign({}, x, { signed: n, have: x.have + n, leader: M.leader.trim(), groups: (x.groups || []).concat({ g: (M.group || '').trim() || 'Hope Harbor team', n, leader: M.leader.trim(), phone: (M.lphone || '').trim(), email: (M.lemail || '').trim() }) }) : x) })); this.toast('Signed up ' + n + (n === 1 ? ' volunteer' : ' volunteers') + '. ' + (o ? o.name : 'The organizer') + ' will contact ' + M.leader.trim() + '.'); } }; })(),
      submitInvite: () => { if (!/.+@.+\..+/.test(M.email || '')) return this.upd('modal.err', 'Enter a valid email address.'); this.setState(st => ({ modal: null, team: st.team.concat({ name: M.email, email: M.email, role: M.role || 'Staff', status: 'Invite sent' }) })); this.toast('Invite sent to ' + M.email + '.'); },
      submitPost: () => { if (!(M.title || '').trim()) return this.upd('modal.err', 'Add a short title.'); this.setState(st => ({ modal: null, posts: [{ id: 'p' + Date.now(), type: M.type, urg: M.urg || 'No rush', org: 'Hope Harbor Community Pantry', title: M.title, body: M.text, ago: 'Just now', replies: 0 }].concat(st.posts) })); this.toast('Posted to the community board.'); }
    };

    // guide
    const G = (label, fn, on) => ({ label, go: () => { fn(); }, style: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', minHeight: 34, fontSize: 14, cursor: 'pointer', border: 0, background: on ? 'var(--color-accent-100)' : 'transparent', color: on ? 'var(--color-accent-900)' : 'var(--color-text)', fontWeight: on ? 600 : 400 } });
    const dt = k => () => this.go('dash', { dashTab: k, selRef: null });
    const guideGroups = [
      { title: 'Public site', items: [G('A · Home', nav.home, scr.home), G('B · Directory', nav.allOrgs, scr.directory), G('B · No-results state', () => this.go('directory', { filters: Object.assign(this.blankFilters(), { cats: ['legal'], faith: 'yes' }) }), false), G('C · Listing — Hope Harbor', () => this.openOrg('hope'), scr.listing && s.orgId === 'hope'), G('C · Listing — safety-sensitive', () => this.openOrg('haven'), scr.listing && s.orgId === 'haven'), G('C · Listing — pending verification', () => this.openOrg('career'), scr.listing && s.orgId === 'career'), G('D · Referral flow', () => this.startRef('hope'), scr.refer), G('J · Track a referral', () => this.go('track', { trackIn: 'CC-2611-4810', trackCode: 'CC-2611-4810', trackErr: '' }), scr.track), G('K · About', nav.about, scr.about)] },
      { title: 'Organizations', items: [G('F · Log in', nav.login, scr.login), G('F · Join the network', () => this.go('signup', { signup: Object.assign({}, s.signup, { step: 1, err: {} }) }), scr.signup), G('F · Pending verification', () => this.go('pending'), scr.pending), G('G · Dashboard', dt('overview'), scr.dash && tab.overview), G('G · Referral detail', () => { this.go('dash'); this.openRef('r1'); }, scr.dash && tab.referrals && !!sr), G('E · Unclaimed needs', dt('needs'), scr.dash && tab.needs), G('H · Messages', dt('messages'), scr.dash && tab.messages), G('H · Community board', dt('community'), scr.dash && tab.community), G('H · Shared case (from a referral)', () => { this.go('dash'); this.openCase(); }, scr.dash && tab.cases), G('I · Team & permissions', dt('org'), scr.dash && tab.overview), G('Account settings', dt('settings'), scr.dash && tab.settings), G('G · Edit listing + preview', dt('profile'), scr.dash && tab.profile)] },
      { title: 'Admin & reference', items: [G('L · Report modal', () => { if (s.screen !== 'listing') this.openOrg('clinic'); this.modal({ kind: 'report', targetName: 'Listing · ' + (s.screen === 'listing' ? lo.name : 'Christ Health Center') }); }, mk === 'report'), G('L · Moderation queue', nav.mod, scr.mod), G('Design system notes', nav.system, scr.system)] }
    ];
    const flows = [
      ['1 · Search → refer → confirm', () => { this.setState({ homeQ: 'groceries', homeCat: 'food' }); this.go('home'); this.toast('Flow 1: press “Search” to begin.'); }],
      ['2 · Login → accept a referral', () => { this.go('login'); this.toast('Flow 2: enter any password and log in.'); }],
      ['3 · Unclaimed needs → claim / suggest', dt('needs')],
      ['4 · Availability → listing preview', dt('overview')],
      ['5 · “What does verified mean?”', () => { this.openOrg('hope'); setTimeout(() => this.setState({ verPop: true }), 50); }]
    ].map(([label, go]) => ({ label, go }));

    return Object.assign(base, {
      cmcStyle: s.w >= 1100 ? { fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 46, lineHeight: '40px', height: 40, letterSpacing: '.04em', display: 'inline-block', transform: 'scaleX(.82)', transformOrigin: 'left center', marginRight: -10, paddingLeft: 12, borderLeft: '1px solid color-mix(in srgb,var(--color-bg) 45%,transparent)' } : { display: 'none' },
      scr, nav, isPublic: PUBLIC.includes(s.screen), pubLinks, menuShown: narrow && s.menuOpen, toggleMenu: () => this.setState({ menuOpen: !s.menuOpen }), menuLabel: s.menuOpen ? 'Close menu' : 'Open menu', menuExpanded: s.menuOpen ? 'true' : 'false',
      homeQ: this.bind('homeQ'), homeCat: this.bind('homeCat'), homeZip: this.bind('homeZip'), catOptions, runSearch: this.runSearch, catCar, popular, heroSearchFull: { position: 'relative', minWidth: 0, gridColumn: s.w >= 900 ? 'auto' : '1 / -1' }, heroSearchBtn: { width: '100%', margin: 0, minHeight: 56, padding: '0 28px', fontSize: 18, background: 'var(--color-accent-700)', borderColor: 'var(--color-accent-700)', color: 'var(--color-bg)', gridColumn: s.w >= 900 ? 'auto' : '1 / -1' }, heroSearchGrid: { display: 'grid', gap: 14, alignItems: 'stretch', gridTemplateColumns: s.w >= 900 ? 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto' : s.w >= 600 ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)' }, featured, featCardStyle, featRef: this.featRef, mapFrame: this.mapFrame,
      dir, listing, verPop: s.verPop, toggleVerPop: () => this.setState({ verPop: !s.verPop }), closeVerPop: () => this.setState({ verPop: false }),
      openReport: () => this.modal({ kind: 'report', targetName: 'Listing · ' + lo.name }), quickExit: () => this.go('exit'), backToResults: () => this.state.fromDash ? this.go('dash', { dashTab: this.state.fromTab || 'directory', selRef: null }) : this.go('directory'), backLabel: s.fromDash ? ({ org: 'Back to My organization', overview: 'Back to Dashboard', directory: 'Back to results', favs: 'Back to Favorites' }[s.fromTab] || 'Back') : 'Back to results',
      refer, refDone, track, about, login, signup, dash, mod, modOpen, modal,
      toast: s.toast, hasToast: !!s.toast, toastUndo: !!s.toastUndo && !!this._undoSnap, undoToast: () => this.undoToast(),
      guideShown: this.props.showGuide === true, guideOpen: s.guideOpen, guideClosed: !s.guideOpen, toggleGuide: () => this.setState({ guideOpen: !s.guideOpen }), guideGroups, flows,
      mobilePreview: { v: s.mobilePreview, on: e => this.setState({ mobilePreview: e.target.checked }) },
      exitBack: () => this.go('home')
    });
  }
}
/* ==========================================================================
   PART 3 — dash-bridge: connects the dashboard to Supabase.

   Who sees what when they open dashboard.html:
   • Not logged in ............................ sent to the log-in page.
   • Logged in with the sample email in config.js (DEMO_EMAIL)
                                                 → the Hope Harbor sample, with all its made-up
                                                   people and numbers. Nothing is saved.
   • A member of an approved organization ..... their real organization. Changes save to Supabase.
   • More than one dashboard .................. a "Which dashboard?" screen first (or the one they
                                                 chose to open automatically). Requests that are waiting
                                                 or weren't approved show there with their status.
   • Nobody's organization yet ................ site admins go to admin.html, everyone else sees
                                                 how to add or claim their organization.

   The database decides what each person may change (see the setup and update SQL files),
   so this file can't give anyone more access than the database allows.
   ========================================================================== */
(function () {
  var CC = window.CC || { ok: false };
  var cfg = window.CC_CONFIG || {};
  var DEMO_EMAIL = String(cfg.DEMO_EMAIL || '').trim().toLowerCase();
  var CONTACT_EMAIL = 'info@compassioncatalyst.org';
  var FILES = { home: 'index.html', directory: 'directory.html', about: 'about.html', orgs: 'for-organizations.html', claim: 'claim.html', login: 'login.html', signup: 'signup.html', gethelp: 'get-help.html', track: 'index.html' };
  var ROLE_LABEL = { owner: 'Admin', admin: 'Admin', staff: 'Staff', volunteer: 'Volunteer' };
  var ROLE_DB = { Admin: 'admin', Staff: 'staff', Volunteer: 'volunteer' };
  var REVIEWED = { phone: 1, email: 1, address: 1, city: 1, state: 1, zip: 1, website: 1 };

  var LIVE = false;          // true for a real organization, false for the Hope Harbor sample
  var PEND = null;           // the person's request, while it waits for approval ({ id, kind, draft })
  var NOTICE = null;         // the message at the top of the dashboard
  var ORG = null;            // the organization's row in Supabase
  var ME = null;             // { uid, email, role }
  var app = null;
  var mount = document.getElementById('app');

  // The sample's made-up claimed organizations and application links are not used.
  Component.CLAIMED = ['hope'];
  Component.APPLY_URLS = {};

  function say(html) {
    mount.innerHTML = '<div style="max-width:560px;margin:60px auto;padding:0 20px;font-size:18px;line-height:1.5">' + html + '</div>';
    var out = document.getElementById('cc-out');
    if (out) out.addEventListener('click', function () { try { sessionStorage.removeItem('cc-dash-cur'); } catch (e) {} CC.signOut().then(function () { window.location.href = 'index.html'; }); });
  }
  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  function firstName(n) { return String(n || '').trim().split(/\s+/).map(function (w, i) { return i === 0 ? w : w[0] + '.'; }).slice(0, 2).join(' '); }
  function toast(msg) { if (app) app.toast(msg); }

  // ---------- turning database rows into what the screens use ----------
  function myOrgShape(r) {
    var o = CC.toOrg(Object.assign({}, r, { is_sensitive: false, is_claimed: true }));
    o.id = 'hope'; o.dbId = r.id; o.claimed = true; o.sensitive = !!r.is_sensitive;
    o.contact = [r.contact_name || '', r.contact_title || '', r.email || ''];
    o.addr = r.address ? r.address + ', ' + (r.city || 'Birmingham') + ', ' + (r.state || 'AL') + (r.zip ? ' ' + r.zip : '') : '';
    o.hideAvail = r.show_availability === false;
    o.website = r.website || '';
    return o;
  }
  function splitAddr(s) {
    s = String(s || '').trim();
    var m = s.match(/^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/);
    if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] || null };
    m = s.match(/^(.*?),\s*([^,]+)$/);
    if (m) return { address: m[1].trim(), city: m[2].trim() };
    return { address: s || null };
  }
  function teamShape(rows, invites) {
    var t = (rows || []).map(function (m) {
      var nm = (m.full_name || '').trim() || m.email || 'Team member';
      return { name: nm, email: m.email || '', role: ROLE_LABEL[m.role] || 'Staff', status: '', uid: m.user_id, owner: m.role === 'owner' };
    });
    (invites || []).forEach(function (i) {
      t.push({ name: i.email + ' (invite sent)', email: i.email, role: ROLE_LABEL[i.role] || 'Staff', status: 'Invite sent', inviteId: i.id });
    });
    return t;
  }

  // ---------- loading ----------
  async function loadTeam() {
    var sb = CC.sb, canManage = ME.role === 'owner' || ME.role === 'admin';
    var all = await Promise.all([
      sb.rpc('org_team', { org: ORG.id }),
      canManage ? sb.from('team_invites').select('id, email, role').eq('organization_id', ORG.id).is('accepted_at', null).order('created_at') : Promise.resolve({ data: [] })
    ]);
    if (all[0].error) throw all[0].error;
    return teamShape(all[0].data, all[1].data || []);
  }
  async function loadListings() {
    try { return (await CC.loadListings()) || []; } catch (e) { if (window.console) console.warn('Could not load listings', e); return []; }
  }
  function listingOrgs(rows, skipId) {
    var out = rows.filter(function (r) { return r.id !== skipId; }).map(CC.toOrg);
    CC.setPlaces(out);
    return out;
  }

  // ---------- which dashboards this account can open ----------
  // Every organization they're on the team of, every request still waiting or not approved,
  // and the Admin page for the site's team. The picker shows when there's more than one.
  var DASHES = [];     // the list the picker shows (the design's myDash)
  var CUR = null;      // the dashboard that's open
  var PREFS = {};      // this person's saved choices (profiles.prefs): autoDash = the dashboard that opens by itself
  var STASH_FILE = null;
  var TOUR_WAIT = null;
  var CUR_KEY = 'cc-dash-cur';
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  function savePrefs(patch) {
    Object.assign(PREFS, patch);
    try { localStorage.setItem('cc-prefs-' + ME.uid, JSON.stringify(PREFS)); } catch (e) {}
    CC.sb.from('profiles').update({ prefs: PREFS }).eq('id', ME.uid).then(function () {});
  }
  function statusOf(o) { return o.status === 'paused' ? 'Paused' : 'Live'; }

  // A request that was saved on this device (when the email had to be confirmed first) is sent now.
  async function sendStash(email) {
    var st = CC.stashed && CC.stashed(); if (!st || !st.data) return true;
    var d = st.data, owner = String(d.email || '').trim().toLowerCase();
    if (owner && owner !== email) return true; // started with a different account; leave it for that account
    if (d.method === 'doc' && !STASH_FILE) { askForFile(st); return false; }
    if (st.kind === 'new_listing') await CC.submitNewListing(d, STASH_FILE); else await CC.submitClaim(d, STASH_FILE);
    CC.clearStash(); STASH_FILE = null;
    sset(CUR_KEY, null);
    setTimeout(function () { toast('Your request was sent. We’ll email you after we review it.'); }, 600);
    return true;
  }
  function askForFile(st) {
    var d = st.data || {}, isNew = st.kind === 'new_listing';
    say('<h1 style="font-size:30px;margin:0 0 10px">Finish sending your request</h1>' +
      '<p>' + (isNew ? 'Your new listing for <strong>' + CC.esc(d.name) + '</strong>' : 'Your claim for <strong>' + CC.esc(d.orgName) + '</strong>') + ' is almost ready. Because you chose to send a document, please choose it again so we can attach it.</p>' +
      '<form id="cc-stash" style="display:flex;flex-direction:column;gap:14px;margin-top:16px"><label for="cc-sf" style="font-weight:600">Your document' + (st.fileName ? ' (' + CC.esc(st.fileName) + ')' : '') + '</label>' +
      '<input id="cc-sf" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" class="input" style="min-height:48px;font-size:16px">' +
      '<span id="cc-sf-err" role="alert" style="color:#b4443a"></span>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" type="submit" style="min-height:48px;padding:0 22px;font-size:17px;background:var(--color-accent-700);border-color:var(--color-accent-700);color:#fff">Send for review</button>' +
      '<button class="btn btn-secondary" type="button" id="cc-sf-drop" style="min-height:48px;font-size:16px">Discard this request</button></div></form>');
    document.getElementById('cc-stash').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = document.getElementById('cc-sf').files[0];
      if (!f) { document.getElementById('cc-sf-err').textContent = 'Please choose your document first.'; return; }
      STASH_FILE = f; say('<p>Sending…</p>'); start().catch(fail);
    });
    document.getElementById('cc-sf-drop').addEventListener('click', function () {
      if (!confirm('Discard this request? You’d need to fill it out again.')) return;
      CC.clearStash(); say('<p>Loading…</p>'); start().catch(fail);
    });
  }

  async function loadDashes(sb, uid, isAdmin) {
    var mem = await sb.from('organization_members').select('organization_id, role').eq('user_id', uid);
    if (mem.error) throw mem.error;
    var roles = {}; (mem.data || []).forEach(function (m) { roles[m.organization_id] = m.role; });
    var ids = Object.keys(roles), rows = [];
    if (ids.length) rows = (await sb.from('organizations').select('*').in('id', ids).in('status', ['approved', 'paused']).order('name')).data || [];
    var have = {}; rows.forEach(function (o) { have[o.id] = 1; });
    var list = rows.map(function (o) {
      return { id: 'o-' + o.id, kind: 'org', name: o.name, role: ROLE_LABEL[roles[o.id]] || 'Staff', status: statusOf(o), org: myOrgShape(o), _row: o, _role: roles[o.id] };
    });
    // Requests still waiting, and ones that weren't approved
    var rq = (await sb.from('claim_requests').select('id, organization_id, kind, status, draft, created_at, reviewer_note').eq('user_id', uid).in('status', ['pending', 'rejected']).order('created_at', { ascending: false })).data || [];
    rq = rq.filter(function (q) { if (have[q.organization_id]) return false; have[q.organization_id] = 1; return true; });
    if (rq.length) {
      var newIds = rq.filter(function (q) { return q.kind === 'new_listing'; }).map(function (q) { return q.organization_id; });
      var clIds = rq.filter(function (q) { return q.kind !== 'new_listing'; }).map(function (q) { return q.organization_id; });
      var base = {};
      if (newIds.length) ((await sb.from('organizations').select('*').in('id', newIds)).data || []).forEach(function (o) { base[o.id] = o; });
      if (clIds.length) ((await sb.from('directory_listings').select('*').in('id', clIds)).data || []).forEach(function (o) { base[o.id] = o; });
      rq.forEach(function (q) {
        var b = base[q.organization_id]; if (!b) return;
        var row = Object.assign({ apply_mode: 'steps', show_availability: true, show_contact: true, hide_address: false }, b, q.kind === 'claim' ? (q.draft || {}) : {});
        var no = q.status === 'rejected';
        list.push({ id: 'r-' + q.id, kind: 'org', name: row.name, role: 'Admin', status: no ? 'Not approved' : 'Waiting for approval', org: myOrgShape(row),
          note: no ? (q.reviewer_note || 'If you have questions, reply to the email we sent you or write to ' + CONTACT_EMAIL + '.') : '',
          _row: row, _role: 'owner', _req: { id: q.id, kind: q.kind, draft: q.draft || {}, rejected: no } });
      });
    }
    if (isAdmin) {
      var n = 0, rp = 0;
      try { n = (await sb.from('claim_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')).count || 0; } catch (e) {}
      try { rp = (await sb.from('listing_reports').select('id', { count: 'exact', head: true }).eq('status', 'open')).count || 0; } catch (e) {}
      list.push({ id: 'admin', kind: 'admin', name: 'Compassion Catalyst Admin', role: 'Site admin', status: '',
        info: (n === 1 ? '1 request' : n + ' requests') + ' waiting for review' + (rp ? ' · ' + rp + (rp === 1 ? ' open report' : ' open reports') : '') });
    }
    return list;
  }

  async function start() {
    if (!CC.ok) return say('<h1 style="font-size:28px">We can’t reach the server</h1><p>Please check your internet connection and try again in a few minutes.</p>');
    var session = await CC.whenReady;
    if (!session) { window.location.replace('login.html'); return; }
    var sb = CC.sb, uid = session.user.id, email = String(session.user.email || '').toLowerCase();
    ME = { uid: uid, email: email, role: 'owner' };

    // The Hope Harbor sample
    if (DEMO_EMAIL && email === DEMO_EMAIL) {
      var rows0 = await loadListings();
      var hope = new Component({}).state.orgs.find(function (o) { return o.id === 'hope'; });
      window.CC_DASH_INIT = rows0.length ? { orgs: [hope].concat(listingOrgs(rows0)) } : {};
      boot(false);
      toast('This is the Hope Harbor sample. Nothing you change here is saved.');
      startTourOnce('demo');
      return;
    }

    // A request saved on this device is sent first
    if (!(await sendStash(email))) return;

    try { await sb.rpc('accept_my_invites'); } catch (e) { /* no invites */ }
    var prof = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    var P = prof.data || {};
    PREFS = (P.prefs && typeof P.prefs === 'object') ? P.prefs : {};
    if (!P.prefs) { try { PREFS = JSON.parse(localStorage.getItem('cc-prefs-' + uid) || '{}') || {}; } catch (e) {} }
    var q = location.search, orgOnly = /[?&]org=1\b/.test(q), askAgain = /[?&]pick=1\b/.test(q);
    DASHES = await loadDashes(sb, uid, !!P.is_admin && !orgOnly);
    var orgDashes = DASHES.filter(function (d) { return d.kind !== 'admin'; });

    if (!DASHES.length) {
      var other = CC.stashed && CC.stashed();
      return say('<h1 style="font-size:30px;margin:0 0 10px">You don’t have a dashboard yet</h1>' +
        (other && other.data ? '<p>A request on this device was started with a different email (' + CC.esc(other.data.email || '') + '). Log out and log in with that email to send it.</p>' : '') +
        '<p>To get one, add your organization to the directory or claim its listing. Our team reviews every request, and your dashboard opens as soon as you send it.</p>' +
        '<p style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px"><a class="btn btn-primary" href="signup.html" style="min-height:48px;padding:0 20px;font-size:17px;background:var(--color-accent-700);border-color:var(--color-accent-700);color:#fff">Add your organization</a>' +
        '<a class="btn btn-secondary" href="claim.html" style="min-height:48px;padding:0 20px;font-size:17px">Claim a listing</a>' +
        '<button class="btn btn-ghost" type="button" id="cc-out" style="min-height:48px;font-size:17px">Log out</button></p>');
    }
    if (!orgDashes.length) { window.location.replace('admin.html'); return; } // only the Admin page

    // Which one opens: one picked earlier in this visit, then the one set to open by itself, then ask
    var pickedNow = sget(CUR_KEY), auto = PREFS.autoDash || '';
    var byId = function (id) { return DASHES.find(function (d) { return d.id === id; }); };
    var pickOpen = false;
    if (askAgain) { CUR = orgDashes[0]; pickOpen = DASHES.length > 1; }
    else if (pickedNow && byId(pickedNow) && byId(pickedNow).kind !== 'admin') CUR = byId(pickedNow);
    else if (auto && byId(auto)) {
      if (auto === 'admin') { window.location.replace('admin.html'); return; }
      CUR = byId(auto);
    } else { CUR = orgDashes[0]; pickOpen = DASHES.length > 1; }
    if (!pickOpen) sset(CUR_KEY, CUR.id);

    ORG = CUR._row; ME.role = CUR._role;
    PEND = CUR._req || null;
    var waiting = PEND && !PEND.rejected;
    if (PEND && PEND.rejected) {
      NOTICE = { tone: 'wait', canDismiss: false, title: 'This request wasn’t approved',
        text: 'We weren’t able to approve ' + ORG.name + '. Nothing about it is public. You can delete this dashboard, or reply to our email if you have questions.' };
    } else if (waiting) {
      ORG.status = 'pending';
      NOTICE = { tone: 'wait', canDismiss: false,
        title: PEND.kind === 'claim' ? 'Your claim is waiting for approval' : 'Your new listing is waiting for approval',
        text: 'Go ahead and set up your listing now. Your changes are saved, but they won’t show on Find help until our team approves ' +
          (PEND.kind === 'claim' ? 'your claim' : 'your listing') + ' (usually within 2–5 business days). We’ll email you when it’s live.' };
    }

    var res = await Promise.all([
      PEND ? Promise.resolve([]) : loadTeam(),
      PEND ? Promise.resolve({ data: [] }) : sb.from('org_favorites').select('favorite_id').eq('organization_id', ORG.id),
      loadListings(),
      PEND ? Promise.resolve({ data: [] }) : sb.from('claim_requests').select('id, reviewed_at').eq('user_id', uid).eq('organization_id', ORG.id).eq('status', 'approved').order('reviewed_at', { ascending: false }).limit(1),
      PEND ? Promise.resolve({ data: null }) : sb.from('org_settings').select('fav_folders').eq('organization_id', ORG.id).maybeSingle()
    ]);
    // Just approved? Say so once.
    var ok = res[3] && res[3].data && res[3].data[0];
    if (ok && ok.reviewed_at && Date.now() - new Date(ok.reviewed_at) < 60 * 864e5) {
      var seen = null; try { seen = localStorage.getItem('cc-live-seen-' + ok.id); } catch (e) {}
      if (!seen) NOTICE = { tone: 'live', canDismiss: true, key: 'cc-live-seen-' + ok.id, title: 'Your listing is live!',
        text: 'Our team approved it, so people can now find ' + ORG.name + ' on Find help. Keep it up to date from here any time.' };
    }
    var team = res[0], favIds = (res[1].data || []).map(function (f) { return f.favorite_id; }), rows = res[2];
    var others = listingOrgs(rows, ORG.id);
    var meName = (P.full_name || '').trim() || email;
    if (!team.some(function (m) { return m.uid === uid; })) team.unshift({ name: meName, email: email, role: ROLE_LABEL[ME.role] || 'Staff', uid: uid });
    team.forEach(function (m) { if (m.uid === uid) m.name = meName; });

    // Favorites folders are saved by each listing's database id
    var FF = (res[4] && res[4].data && res[4].data.fav_folders) || {}, ofDb = FF.of || {}, ofApp = {}, showDb = FF.show || {}, showApp = {};
    others.forEach(function (o) { if (ofDb[o.dbId]) ofApp[o.id] = ofDb[o.dbId]; if (Array.isArray(showDb[o.dbId])) showApp[o.id] = showDb[o.dbId]; });
    var density = 'compact'; try { density = localStorage.getItem('cc-fav-density-' + uid) || 'compact'; } catch (e) {}

    var S0 = new Component({}).state; // the design's starting state, for shapes we keep as they are
    window.CC_DASH_INIT = {
      LIVE: true, tourPending: !!waiting, meName: meName, meRole: ROLE_LABEL[ME.role] || 'Staff', isSiteAdmin: !!P.is_admin, myOrgCount: orgDashes.length,
      orgs: [Object.assign(myOrgShape(ORG), PEND ? { claimed: false, verified: PEND.kind === 'claim' ? !!ORG.verified : false } : {})].concat(others),
      favs: others.filter(function (x) { return favIds.indexOf(x.dbId) >= 0; }).map(function (x) { return x.id; }),
      favFolders: Array.isArray(FF.folders) ? FF.folders : [], favFolderOf: ofApp, favShow: showApp, favExpanded: {}, favRowOpen: null, favDensity: density === 'detailed' ? 'detailed' : 'compact',
      myDash: DASHES.map(function (d) { return { id: d.id, kind: d.kind, name: d.name, role: d.role, status: d.status, org: d.org, note: d.note, info: d.info }; }),
      curDash: CUR.id, pickOpen: pickOpen, pickRemember: false, autoOpen: auto && byId(auto) ? auto : '',
      modal: PEND && PEND.rejected ? { kind: 'denied', did: CUR.id, step: 'ask' } : null,
      team: team,
      apply: { mode: ORG.apply_mode === 'web' ? 'web' : 'steps', url: ORG.apply_url || '' },
      settings: Object.assign({}, S0.settings, { name: P.full_name || '', email: email, phone: P.phone || '', twoStep: false,
        p: Object.assign({}, S0.settings.p, { showContact: ORG.show_contact !== false, hideAddr: !!ORG.hide_address }) }),
      profile: { hours: '', services: '', capacity: '', contactName: ORG.contact_name || '', contactRole: ORG.contact_title || '', contactPhone: ORG.phone || '', elig: '' }
      // Referrals, messages, needs and projects aren't part of the live dashboard yet. Those screens are
      // switched off (only My organization, Find help, Favorites and Settings open), so nothing from them shows.
    };
    LIVE = true;
    boot(true);
    if (!(PEND && PEND.rejected)) startTourOnce(uid);
    if (ORG.status === 'paused') toast('Your listing is paused, so it isn’t showing on Find help right now. Email ' + CONTACT_EMAIL + ' with questions.');
  }

  // Open another dashboard (this reloads the page with that organization's real data)
  function openDash(d, remember) {
    if (remember) savePrefs({ autoDash: d.id });
    if (d.kind === 'admin') { window.location.href = 'admin.html'; return; }
    if (CUR && d.id === CUR.id) { sset(CUR_KEY, d.id); if (app) app.setState({ pickOpen: false }); return; }
    sset(CUR_KEY, d.id);
    window.location.href = 'dashboard.html';
  }

  function boot(live) {
    mount.textContent = '';
    app = window.app = window.startApp(Component, mount, { brandName: 'Compassion Catalyst', startScreen: 'dash', showGuide: false }, window.DASH_SCREENS);
    app._lastSaved = live ? JSON.parse(JSON.stringify({ hope: app.org('hope'), favs: app.state.favs, apply: app.state.apply, p: app.state.settings.p })) : null;
  }

  // Some hidden sample screens look organizations up by their sample id. If one isn't in the live list,
  // fall back to the saved copy in data.js so nothing breaks (those screens aren't shown on the live site).
  var baseOrg = Component.prototype.org;
  Component.prototype.org = function (id) {
    var o = baseOrg ? baseOrg.call(this, id) : null;
    if (o) return o;
    return ((window.BBData && window.BBData.ORGS) || []).find(function (x) { return x.id === id && x.id !== 'hope'; });
  };

  // ---------- leaving the dashboard for a public page ----------
  var baseGo = Component.prototype.go;
  Component.prototype.go = function (screen, extra) {
    if (FILES[screen]) { window.location.href = FILES[screen]; return; }
    return baseGo.call(this, screen, extra);
  };

  // ---------- the buttons that need the real server ----------
  var baseRV = Component.prototype.renderVals;
  Component.prototype.renderVals = function () {
    var v = baseRV.apply(this, arguments);
    if (v && CC.placeVals) CC.placeVals(this, v);
    if (!v || !v.dash) return v;
    var self = this, s = this.state, hope = this.org('hope') || {};
    var meName = s.meName || 'Denise Carter', role = s.meRole || 'Admin';
    v.dash.myOrgName = hope.name || 'Your organization';
    v.dash.meRole = role;
    v.dash.meLine = firstName(meName) + ' · ' + role;
    v.dash.demoOnly = !LIVE;
    v.dash.devicesNote = LIVE ? 'Signs you out on every other phone and computer.' : 'This laptop (Chrome) · iPhone · Office desktop';
    v.dash.deactivateNote = LIVE ? 'Email us and we’ll close your account or take your listing down.' : 'Removes your listing from the directory. Open referrals are returned to Unclaimed needs.';
    v.dash.notice = NOTICE ? { show: true, title: NOTICE.title, text: NOTICE.text, canDismiss: !!NOTICE.canDismiss,
      boxStyle: NOTICE.tone === 'live'
        ? { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', marginBottom: 22, border: '1px solid #2f8f4e', borderLeft: '6px solid #2f8f4e', background: '#eef7f0', color: '#173f24' }
        : { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', marginBottom: 22, border: '1px solid #c98a10', borderLeft: '6px solid #c98a10', background: '#fdf6e7', color: '#4a3203' },
      dismiss: function () { try { if (NOTICE.key) localStorage.setItem(NOTICE.key, '1'); } catch (e) {} NOTICE = null; self.setState({}); } } : { show: false };
    var tipKey = 'cc-hide-pubtip-' + (ME ? ME.uid : 'demo'), tipHidden = false;
    try { tipHidden = localStorage.getItem(tipKey) === '1'; } catch (e) {}
    v.dash.pubTip = { show: !tipHidden, hidden: tipHidden, close: function () { try { localStorage.setItem(tipKey, '1'); } catch (e) {} self.setState({}); } };
    v.dash.logout = function () { sset(CUR_KEY, null); CC.signOut().then(function () { window.location.href = 'index.html'; }, function () { window.location.href = 'index.html'; }); };
    if (!LIVE) return v;

    // Which dashboard: real switching, "open this one automatically", and deleting one that wasn't approved
    if (v.pk && v.pk.list) {
      var D = s.myDash || [];
      var GREY = { background: 'var(--color-neutral-200)', color: 'var(--color-neutral-800)', border: '1px solid var(--color-neutral-500)' };
      v.pk.list.forEach(function (it, k) {
        var d = D[k]; if (!d) return;
        it.open = function () { openDash(d, !!(self.state.pickOpen && self.state.pickRemember)); };
        if (d.status === 'Paused') { it.chip = 'Paused'; Object.assign(it.chipStyle, GREY); Object.assign(it.chipStyleSm, GREY); it.chipDot = Object.assign({}, it.chipDot, { background: 'var(--color-neutral-600)' }); }
      });
      var autoIds = [''].concat(D.map(function (d) { return d.id; }));
      (v.pk.autoOpts || []).forEach(function (a, k) {
        var basePick = a.pick;
        a.pick = function () { basePick(); savePrefs({ autoDash: autoIds[k] || '' }); };
      });
    }
    if (v.modal && v.modal.dn && s.modal && s.modal.kind === 'denied') {
      var dd = (s.myDash || []).find(function (x) { return x.id === s.modal.did; }) || {};
      v.modal.dn.note = dd.note || v.modal.dn.note;
      v.modal.dn.doDelete = function () {
        var reqId = String(dd.id || '').replace(/^r-/, '');
        CC.sb.rpc('delete_my_request', { request_id: reqId }).then(function (r) {
          if (r.error) return toast(CC.msg(r.error));
          sset(CUR_KEY, null);
          var rest = (self.state.myDash || []).filter(function (x) { return x.id !== dd.id; });
          if (PREFS.autoDash === dd.id) savePrefs({ autoDash: '' });
          self.setState({ modal: null });
          toast(dd.name + ' was deleted from your account.');
          setTimeout(function () { window.location.href = rest.length ? 'dashboard.html' : 'index.html'; }, 1200);
        });
      };
    }

    // Settings → Account
    var st = v.dash.settings, S = s.settings;
    st.save = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var name = (S.name || '').trim(), phone = (S.phone || '').trim(), em = (S.email || '').trim().toLowerCase();
      if (!name) return toast('Please add your full name.');
      if (!/.+@.+\..+/.test(em)) return toast('Please enter a valid email address.');
      CC.sb.from('profiles').update({ full_name: name, phone: phone || null }).eq('id', ME.uid).then(function (r) {
        if (r.error) return toast(CC.msg(r.error));
        self.setState(function (x) { return { meName: name, team: x.team.map(function (m) { return m.uid === ME.uid ? Object.assign({}, m, { name: name }) : m; }) }; });
        if (em !== ME.email) {
          CC.sb.auth.updateUser({ email: em }, { emailRedirectTo: CC.SITE + 'dashboard.html' }).then(function (u) {
            toast(u.error ? CC.msg(u.error) : 'Saved. To change your email, click the links we sent to both your old and new addresses.');
          });
        } else toast('Account details saved.');
      });
    };
    st.changePw = function () {
      CC.forgot(ME.email).then(function (r) { toast(r.error ? CC.msg(r.error) : 'We emailed a link to ' + ME.email + ' to set a new password.'); });
    };
    st.signOutAll = function () {
      CC.sb.auth.signOut({ scope: 'others' }).then(function (r) { toast(r.error ? CC.msg(r.error) : 'Signed out of all your other devices.'); });
    };
    st.deactivate = function () {
      window.location.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('Close my account: ' + (hope.name || '')) +
        '&body=' + encodeURIComponent('Please close my account (' + ME.email + ') for ' + (hope.name || 'our organization') + '.\n\nAlso take our listing off the directory: yes / no\n');
    };

    // Team → Invite teammate. Invites are saved in Supabase; your own email app sends the message.
    if (PEND) { v.dash.invite = function () { toast('You can invite your team once your listing is approved.'); }; }
    if (v.modal && s.modal && s.modal.kind === 'invite') {
      v.modal.inviteNote = 'When you send this, your email app opens with a message and a link for them. They join your team when they log in with this email.';
      v.modal.submitInvite = function () {
        var M = self.state.modal || {}, em = String(M.email || '').trim().toLowerCase(), r = M.role || 'Staff';
        if (!/.+@.+\..+/.test(em)) return self.upd('modal.err', 'Enter a valid email address.');
        if (self.state.team.some(function (m) { return (m.email || '').toLowerCase() === em; })) return self.upd('modal.err', 'That person is already on your team or invited.');
        CC.sb.from('team_invites').insert({ organization_id: ORG.id, email: em, role: ROLE_DB[r] || 'staff' }).select('id').single().then(function (res) {
          if (res.error) return self.upd('modal.err', /row-level security|permission/i.test(res.error.message) ? 'Only Admins can invite teammates.' : CC.msg(res.error));
          self.setState(function (x) { return { modal: null, team: x.team.concat({ name: em + ' (invite sent)', email: em, role: r, status: 'Invite sent', inviteId: res.data.id }) }; });
          toast('Invite saved for ' + em + '. Send the email that just opened.');
          var link = CC.SITE + 'join.html?email=' + encodeURIComponent(em);
          window.location.href = 'mailto:' + em + '?subject=' + encodeURIComponent('Join ' + (hope.name || 'our team') + ' on Compassion Catalyst') +
            '&body=' + encodeURIComponent('Hi,\n\nI added you to ' + (hope.name || 'our organization') + '’s team on Compassion Catalyst, where we keep our listing up to date.\n\nTo join, open this link and create an account with this email address (' + em + '):\n' + link + '\n\nThanks,\n' + (self.state.meName || ''));
        });
      };
    }
    return v;
  };

  // ---------- saving changes ----------
  // After every change on screen, compare with what was there before and save the difference.
  var pendingOrg = {}, orgTimer = null;
  function queueOrg(patch) {
    Object.assign(pendingOrg, patch);
    clearTimeout(orgTimer);
    orgTimer = setTimeout(flushOrg, 700);
  }
  async function flushOrg() {
    var patch = pendingOrg; pendingOrg = {};
    if (!Object.keys(patch).length) return;
    if (PEND && PEND.rejected) { if (!flushOrg._said) { flushOrg._said = 1; toast('This request wasn’t approved, so changes here aren’t saved.'); } return; }
    if (PEND && PEND.kind === 'claim') {
      // Not approved yet: keep the changes with the claim. They're published when it's approved.
      var draft = Object.assign({}, PEND.draft, patch);
      var d = await CC.sb.from('claim_requests').update({ draft: draft }).eq('id', PEND.id).select('id');
      if (d.error || !d.data || !d.data.length) { toast(d.error ? CC.msg(d.error) : 'We couldn’t save that change. Please refresh and try again.'); return; }
      PEND.draft = draft; Object.assign(ORG, patch);
      return;
    }
    var r = await CC.sb.from('organizations').update(patch).eq('id', ORG.id).select('*');
    if (r.error) { toast(CC.msg(r.error)); return resync(); }
    if (!r.data || !r.data.length) { toast('Only Admins on your team can change the listing.'); return resync(); }
    var row = r.data[0], held = PEND ? [] : Object.keys(patch).filter(function (k) { return REVIEWED[k] && String(patch[k] == null ? '' : patch[k]) !== String(row[k] == null ? '' : row[k]); });
    ORG = row;
    if (held.length) {
      toast('Saved. Phone, email and address changes are checked by our team before they show on your listing.');
      resync();
    }
  }
  function resync() {
    if (!app) return;
    CC.sb.from('organizations').select('*').eq('id', ORG.id).single().then(function (r) {
      if (r.error || !r.data) return;
      ORG = r.data;
      var fresh = myOrgShape(ORG);
      app._skipSave = true;
      app.setState(function (x) {
        return { orgs: x.orgs.map(function (o) { return o.id === 'hope' ? Object.assign({}, o, fresh, { updated: o.updated }) : o; }),
          apply: { mode: ORG.apply_mode === 'web' ? 'web' : 'steps', url: ORG.apply_url || '' },
          settings: Object.assign({}, x.settings, { p: Object.assign({}, x.settings.p, { showContact: ORG.show_contact !== false, hideAddr: !!ORG.hide_address }) }) };
      });
    });
  }
  async function reloadTeam() {
    try { var t = await loadTeam(); t.forEach(function (m) { if (m.uid === ME.uid) m.name = app.state.meName; }); app.setState({ team: t }); } catch (e) {}
  }

  function orgPatch(a, b) {
    var p = {};
    function f(key, col, val) { if (!same(a[key], b[key])) p[col] = val; }
    f('name', 'name', (b.name || '').trim() || a.name);
    f('type', 'org_type', b.type || null);
    f('faith', 'faith', b.faith || null);
    f('phone', 'phone', (b.phone || '').trim() || null);
    f('about', 'about', b.about || null);
    f('cats', 'categories', b.cats || []);
    f('services', 'services', b.services || {});
    f('hours', 'hours', b.hours || []);
    f('langs', 'languages', b.langs || []);
    f('elig', 'eligibility', b.elig || []);
    f('cost', 'cost', b.cost || null);
    f('docs', 'what_to_bring', b.docs || null);
    f('docsTitle', 'docs_title', String(b.docsTitle || '').trim() || null);
    f('avail', 'availability', b.avail);
    f('hideAvail', 'show_availability', !b.hideAvail);
    if (!same(a.addr, b.addr)) Object.assign(p, splitAddr(b.addr));
    var ca = a.contact || [], cb = b.contact || [];
    if (ca[0] !== cb[0]) p.contact_name = (cb[0] || '').trim() || null;
    if (ca[1] !== cb[1]) p.contact_title = (cb[1] || '').trim() || null;
    if (ca[2] !== cb[2]) p.email = (cb[2] || '').trim() || null;
    return p;
  }

  var baseDU = Component.prototype.componentDidUpdate;
  Component.prototype.componentDidUpdate = function (pp, ps) {
    if (baseDU) baseDU.apply(this, arguments);
    // The welcome tour waits until a dashboard is picked
    if (TOUR_WAIT && ps && ps.pickOpen && !this.state.pickOpen) { var tw = TOUR_WAIT; TOUR_WAIT = null; startTourOnce(tw); }
    if (!LIVE || !ps) return;
    var s = this.state, self = this;
    if (this._skipSave) { this._skipSave = false; return; }

    // The listing
    if (ps.orgs !== s.orgs) {
      var a = (ps.orgs || []).find(function (o) { return o.id === 'hope'; }) || {}, b = this.org('hope') || {};
      if (a !== b) { var p = orgPatch(a, b); if (Object.keys(p).length) queueOrg(p); }
    }
    // How people apply
    if (ps.apply !== s.apply && !same(ps.apply, s.apply)) {
      var A = s.apply || {}, url = (A.url || '').trim(), okUrl = /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url);
      var ap = { apply_mode: A.mode === 'web' && okUrl ? 'web' : 'steps' };
      if (!url || okUrl) ap.apply_url = url || null;
      queueOrg(ap);
    }
    // Privacy choices (Settings)
    var pa = (ps.settings || {}).p || {}, pb = (s.settings || {}).p || {};
    if (pa !== pb) {
      var pp2 = {};
      if (pa.showContact !== pb.showContact) pp2.show_contact = !!pb.showContact;
      if (pa.hideAddr !== pb.hideAddr) pp2.hide_address = !!pb.hideAddr;
      if (Object.keys(pp2).length) queueOrg(pp2);
    }
    // Favorites (saved once the listing is approved)
    // Favorites folders (shared by the team) and the Compact / Detailed choice (just for this person)
    if (!PEND && (ps.favFolders !== s.favFolders || ps.favFolderOf !== s.favFolderOf || ps.favShow !== s.favShow)) queueFolders(this);
    if (ps.favDensity !== s.favDensity) { try { localStorage.setItem('cc-fav-density-' + ME.uid, s.favDensity || 'compact'); } catch (e) {} }
    if (ps.favs !== s.favs && PEND) { if (!this._favNote) { this._favNote = 1; toast('Favorites are kept on this screen for now. They’ll save once your listing is approved.'); } }
    else if (ps.favs !== s.favs) {
      var add = (s.favs || []).filter(function (id) { return (ps.favs || []).indexOf(id) < 0; });
      var del = (ps.favs || []).filter(function (id) { return (s.favs || []).indexOf(id) < 0; });
      add.forEach(function (id) {
        var o = self.org(id); if (!o || !o.dbId) return;
        CC.sb.from('org_favorites').insert({ organization_id: ORG.id, favorite_id: o.dbId }).then(function (r) { if (r.error && !/duplicate/i.test(r.error.message)) toast(CC.msg(r.error)); });
      });
      del.forEach(function (id) {
        var o = self.org(id); if (!o || !o.dbId) return;
        CC.sb.from('org_favorites').delete().eq('organization_id', ORG.id).eq('favorite_id', o.dbId).then(function (r) { if (r.error) toast(CC.msg(r.error)); });
      });
    }
    // Team: role changes and removals (new invites are saved when they're sent)
    if (ps.team !== s.team && !PEND) {
      var now = {}; (s.team || []).forEach(function (m) { now[(m.email || m.name).toLowerCase()] = m; });
      (ps.team || []).forEach(function (m) {
        var k = (m.email || m.name).toLowerCase(), n = now[k], q = null;
        if (!m.uid && !m.inviteId) return;
        if (!n) {
          q = m.inviteId ? CC.sb.from('team_invites').delete().eq('id', m.inviteId).select('id')
                         : CC.sb.from('organization_members').delete().eq('organization_id', ORG.id).eq('user_id', m.uid).select('user_id');
        } else if (n.role !== m.role) {
          q = m.inviteId ? CC.sb.from('team_invites').update({ role: ROLE_DB[n.role] || 'staff' }).eq('id', m.inviteId).select('id')
                         : CC.sb.from('organization_members').update({ role: ROLE_DB[n.role] || 'staff' }).eq('organization_id', ORG.id).eq('user_id', m.uid).select('user_id');
        }
        if (q) q.then(function (r) {
          if (r.error || !r.data || !r.data.length) {
            toast(m.owner ? 'The person who manages this listing can’t be changed or removed here. Email ' + CONTACT_EMAIL + ' for help.' : r.error ? CC.msg(r.error) : 'Only Admins can change the team.');
            reloadTeam();
          }
        });
      });
    }
  };

  var folderTimer = null;
  function queueFolders(c) {
    clearTimeout(folderTimer);
    folderTimer = setTimeout(function () {
      var s = c.state, of = {};
      Object.keys(s.favFolderOf || {}).forEach(function (id) { var o = c.org(id), f = s.favFolderOf[id]; if (o && o.dbId && f) of[o.dbId] = f; });
      var show = {}; Object.keys(s.favShow || {}).forEach(function (id) { var o = c.org(id); if (o && o.dbId && Array.isArray(s.favShow[id])) show[o.dbId] = s.favShow[id]; });
      var val = { folders: (s.favFolders || []).map(function (f) { return { id: f.id, name: f.name, desc: f.desc || '', icon: f.icon || 'folder' }; }), of: of, show: show };
      CC.sb.from('org_settings').upsert({ organization_id: ORG.id, fav_folders: val, updated_at: new Date().toISOString() }).then(function (r) {
        if (r.error) toast(/relation|does not exist|schema cache/i.test(r.error.message) ? 'Folders can’t be saved yet. Ask your site admin to run the latest database update.' : CC.msg(r.error));
      });
    }, 700);
  }

  // ---------- the welcome tour (part of the dashboard design; shows once per person, Settings → Take the tour shows it again) ----------
  function startTourOnce(who) {
    var k = 'cc-tour-' + who, done = null;
    try { done = localStorage.getItem(k); localStorage.setItem(k, '1'); } catch (e) { return; }
    if (done) return;
    if (app && app.state.pickOpen) { TOUR_WAIT = who; try { localStorage.removeItem(k); } catch (e) {} return; }
    setTimeout(function () { if (app) app.setState({ modal: { kind: 'tour', tour: 'overview', step: 0 } }); }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start().catch(fail); }); else start().catch(fail);
  function fail(e) { if (window.console) console.error(e); say('<h1 style="font-size:28px">Something went wrong</h1><p>' + CC.esc(CC.msg(e)) + '</p><p><a href="login.html">Back to log in</a></p>'); }
})();
