/* Moteur d'affichage des maquettes Entreprise AR (sans dépendance).
   Lit l'arbre du gabarit (window.AR_TPL), évalue les {{trous}}, <sc-for>, <sc-if>,
   et met à jour la page en place à chaque changement d'état. */
(function () {
  'use strict';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = { svg: 1, path: 1, circle: 1, rect: 1, polygon: 1, polyline: 1, line: 1, g: 1, ellipse: 1, text: 1, defs: 1 };
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(scope, path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$/.test(path) || /^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(str, scope) {
    var m = WHOLE.exec(str);
    if (m) return lookup(scope, m[1]);
    return str.replace(HOLE, function (_, p) { var v = lookup(scope, p); return v === null || v === undefined ? '' : String(v); });
  }

  // ---- gabarit -> nœuds virtuels ----
  function build(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (typeof n === 'string') { var t = n.indexOf('{{') >= 0 ? interp(n, scope) : n; out.push(String(t === undefined || t === null ? '' : t)); continue; }
      var tag = n[0], attrs = n[1], kids = n[2];
      if (tag === 'sc-for') {
        var list = lookup(scope, (WHOLE.exec(attrs.list) || [0, ''])[1]) || [];
        var as = attrs.as || 'item';
        for (var k = 0; k < list.length; k++) {
          var sub = Object.create(scope); sub[as] = list[k]; sub.$index = k;
          build(kids, sub, out);
        }
        continue;
      }
      if (tag === 'sc-if') {
        var cond = attrs.value && WHOLE.test(attrs.value) ? lookup(scope, WHOLE.exec(attrs.value)[1]) : attrs.value;
        if (cond) build(kids, scope, out);
        continue;
      }
      var props = {};
      for (var a in attrs) {
        if (a.indexOf('hint-') === 0) continue;
        props[a] = attrs[a].indexOf('{{') >= 0 ? interp(attrs[a], scope) : attrs[a];
      }
      var children = [];
      build(kids, scope, children);
      out.push({ tag: tag, props: props, children: children });
    }
    return out;
  }

  // ---- DOM ----
  var pendingFocus = [];
  function eventType(name, el) {
    var t = name.slice(2);
    if (t === 'change') {
      var tg = el.tagName.toLowerCase(), ty = (el.getAttribute('type') || '').toLowerCase();
      if ((tg === 'input' && ty !== 'checkbox' && ty !== 'radio' && ty !== 'date' && ty !== 'time') || tg === 'textarea') return 'input';
      return 'change';
    }
    if (t === 'doubleclick') return 'dblclick';
    return t;
  }
  function setProp(el, name, val, old) {
    if (name.indexOf('on') === 0 && name.length > 2) {
      var type = eventType(name, el);
      el.__h = el.__h || {};
      if (!el.__h[type]) el.addEventListener(type, function (e) { var f = el.__h[type]; if (typeof f === 'function') f(e); });
      el.__h[type] = val;
      return;
    }
    if (val === old && name !== 'value' && name !== 'checked') return;
    if (name === 'value') { if (el.value !== String(val === undefined || val === null ? '' : val)) el.value = val === undefined || val === null ? '' : val; return; }
    if (name === 'checked') { el.checked = !!val; return; }
    if (name === 'disabled') { el.disabled = !!val; return; }
    if (name === 'autofocus') { if (val && !el.__focused) { el.__focused = true; pendingFocus.push(el); } return; }
    if (val === undefined || val === null || val === false && name.indexOf('aria-') !== 0 && name.indexOf('data-') !== 0) { el.removeAttribute(name); return; }
    el.setAttribute(name, String(val));
  }
  function create(v, svg) {
    if (typeof v === 'string') return document.createTextNode(v);
    var isSvg = svg || v.tag === 'svg' || SVG_TAGS[v.tag] && svg;
    var el = isSvg ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
    var late = {};
    for (var p in v.props) { if (p === 'value' || p === 'checked') { late[p] = v.props[p]; continue; } setProp(el, p, v.props[p], undefined); }
    for (var i = 0; i < v.children.length; i++) el.appendChild(create(v.children[i], isSvg && v.tag !== 'foreignObject'));
    for (var q in late) setProp(el, q, late[q], undefined);
    el.__v = v;
    return el;
  }
  function patchChildren(parent, oldKids, newKids, svg) {
    var nodes = parent.childNodes;
    for (var i = 0; i < newKids.length; i++) {
      var nv = newKids[i], ov = oldKids[i], el = nodes[i];
      if (!el) { parent.appendChild(create(nv, svg)); continue; }
      if (typeof nv === 'string') {
        if (el.nodeType === 3) { if (el.nodeValue !== nv) el.nodeValue = nv; }
        else parent.replaceChild(document.createTextNode(nv), el);
        continue;
      }
      if (typeof ov === 'string' || !ov || el.nodeType !== 1 || ov.tag !== nv.tag) { parent.replaceChild(create(nv, svg), el); continue; }
      var isSvg = svg || nv.tag === 'svg';
      var op = ov.props, np = nv.props, k;
      for (k in op) if (!(k in np)) { if (k.indexOf('on') === 0) { if (el.__h) el.__h[eventType(k, el)] = null; } else if (k === 'value') el.value = ''; else el.removeAttribute(k); }
      for (k in np) if (k !== 'value' && k !== 'checked') setProp(el, k, np[k], op[k]);
      patchChildren(el, ov.children, nv.children, isSvg);
      if ('value' in np) setProp(el, 'value', np.value, op.value);
      if ('checked' in np) setProp(el, 'checked', np.checked, op.checked);
      el.__v = nv;
    }
    while (parent.childNodes.length > newKids.length) parent.removeChild(parent.lastChild);
  }

  // ---- logique ----
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (p) {
    var v = typeof p === 'function' ? p(this.state) : p;
    this.state = Object.assign({}, this.state, v);
    if (this.__schedule) this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__schedule) this.__schedule(); };
  window.DCLogic = DCLogic;

  window.ARMount = function (Comp) {
    var root = document.getElementById('app');
    var logic = new Comp({});
    var prev = [], queued = false;
    function render() {
      queued = false;
      var vals = logic.renderVals();
      var next = build(window.AR_TPL, vals, []);
      patchChildren(root, prev, next, false);
      prev = next;
      while (pendingFocus.length) { var el = pendingFocus.shift(); try { el.focus(); } catch (e) {} }
    }
    logic.__schedule = function () { if (!queued) { queued = true; Promise.resolve().then(render); } };
    render();
    if (logic.componentDidMount) logic.componentDidMount();
    window.addEventListener('beforeunload', function () { if (logic.componentWillUnmount) logic.componentWillUnmount(); });
  };
})();
