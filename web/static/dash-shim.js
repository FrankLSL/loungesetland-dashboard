/* Loungesetland dashboard — runtime voor de pagina.
 * Biedt dezelfde `dash`-functies als de oorspronkelijke dashboardomgeving, zodat index.html, ads.js en markt.js
 * ongewijzigd werken:
 *   dash.data(id)          → {status, data, columns, meta, refreshing, message}
 *   dash.onData(fn)        → fn draait nu en bij elke wijziging van data, filters of breedte
 *   dash.calc(id, {inputs, fn})   afgeleide data
 *   dash.loader(id, {fn})  zet het antwoord van een live query om in rijen
 *   dash.params(), dash.setParams({..}), dash.resetParams(), dash.setLink(name), dash.refresh(id), dash.colors
 *   window.claude.use('db') → {doc(path).get() / .set(obj) / .update(obj)} voor gedeelde instellingen
 */
(function () {
  'use strict';
  const BOOT = window.__DASH_BOOT__ || {};
  const META = BOOT.datasets || {};           // id -> {title, source:{kind, args?}, updated, ...}
  const store = {};                            // id -> {status, data, columns, meta, message, refreshing, key}
  const calcs = {}, loaders = {}, listeners = [];
  const calcCache = {};
  let params = {};

  // ---------- params: defaults (dash/params) < gedeelde waarden < URL ----------
  const HKEY = 'p';
  function readHash() {
    try { const h = new URLSearchParams(location.hash.slice(1)).get(HKEY); return h ? JSON.parse(decodeURIComponent(h)) : {}; } catch (e) { return {}; }
  }
  function writeHash() {
    try {
      const keep = {}; for (const k in params) if (params[k] !== (BOOT.paramDefaults || {})[k]) keep[k] = params[k];
      const s = Object.keys(keep).length ? '#' + HKEY + '=' + encodeURIComponent(JSON.stringify(keep)) : ' ';
      history.replaceState(null, '', location.pathname + location.search + (s.trim() ? s : ''));
    } catch (e) { /* ignore */ }
  }
  params = Object.assign({}, BOOT.paramDefaults || {}, readHash());

  // ---------- scheduling of redraws ----------
  let pending = false;
  function changed() {
    if (pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; for (const k in calcCache) delete calcCache[k]; stampStates(); for (const fn of listeners.slice()) { try { fn(); } catch (e) { console.error('[dash] onData', e); } } });
  }
  let rw = 0; window.addEventListener('resize', () => { const w = window.innerWidth; if (Math.abs(w - rw) > 4) { rw = w; changed(); } });

  // ---------- loading ----------
  function tmpl(v) {
    if (typeof v === 'string') return v.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k) => (params[k] == null ? '' : String(params[k])));
    if (Array.isArray(v)) return v.map(tmpl);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = tmpl(v[k]); return o; }
    return v;
  }
  function asRows(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') for (const k of ['rows', 'data', 'results']) if (Array.isArray(x[k])) return x[k];
    return x;
  }
  function colsOf(rows) { const c = []; if (Array.isArray(rows)) for (const r of rows.slice(0, 50)) if (r && typeof r === 'object') for (const k of Object.keys(r)) if (!c.includes(k)) c.push(k); return c; }

  function load(id, force) {
    const m = META[id];
    if (!m) { store[id] = { status: 'missing', data: [], columns: [], meta: [], message: 'Onbekende bron' }; return; }
    const src = m.source || {};
    const isQuery = src.kind === 'query';
    const args = isQuery ? tmpl(src.args || {}) : null;
    const key = isQuery ? JSON.stringify(args) : 'file';
    const cur = store[id];
    if (cur && cur.key === key && !force && cur.status !== 'error') return;
    const prev = cur && cur.status === 'ok' ? cur : null;
    store[id] = prev ? Object.assign({}, prev, { refreshing: true, key }) : { status: 'loading', data: [], columns: [], meta: [], key };
    const req = isQuery
      ? fetch('/api/query/' + encodeURIComponent(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) })
      : fetch('/api/data/' + encodeURIComponent(id) + (m.updated_at ? '?v=' + encodeURIComponent(m.updated_at) : ''));
    req.then(async (r) => {
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error((body && (body.detail || body.error)) || ('HTTP ' + r.status));
      return body;
    }).then((body) => {
      if (store[id].key !== key) return; // a newer request replaced this one
      let data, meta = [];
      if (isQuery) {
        const L = loaders[id];
        if (L) {
          const out = L.fn({ answer: body.answer, args, call: null });
          if (out && !Array.isArray(out) && Array.isArray(out.rows)) { data = out.rows; meta = out.meta || []; } else data = out;
        } else data = asRows(body.answer);
      } else data = asRows(body.rows);
      store[id] = { status: 'ok', data: data == null ? [] : data, columns: colsOf(data), meta, key, updated: body.updated_at || null };
      changed();
    }).catch((e) => {
      if (store[id].key !== key) return;
      store[id] = prev ? Object.assign({}, prev, { refreshing: false, message: String(e.message || e) }) : { status: 'error', data: [], columns: [], meta: [], message: String(e.message || e), key };
      console.warn('[dash] ' + id + ': ' + (e.message || e));
      changed();
    });
  }

  function view(s) {
    const v = { status: s.status, data: s.data, columns: s.columns || [], meta: s.meta || [], message: s.message, refreshing: !!s.refreshing };
    v.rows = Array.isArray(s.data) ? s.data : []; v.value = s.data;
    return v;
  }

  function calcData(id) {
    if (calcCache[id]) return calcCache[id];
    const c = calcs[id];
    calcCache[id] = { status: 'loading', data: [], columns: [], meta: [] }; // guards cycles
    const inputs = c.inputs.map((i) => dash.data(i));
    let res;
    if (inputs.some((x) => x.status === 'error')) res = { status: 'error', data: [], message: 'Een bron laadde niet' };
    else if (inputs.some((x) => x.status !== 'ok')) res = { status: 'loading', data: [] };
    else {
      try { const out = c.fn(...inputs.map((x) => (Array.isArray(x.data) ? x.data : x.data))); res = { status: 'ok', data: out == null ? [] : out }; }
      catch (e) { console.error('[dash] calc ' + id, e); res = { status: 'error', data: [], message: String(e.message || e) }; }
    }
    res.columns = colsOf(res.data); res.meta = [];
    calcCache[id] = res; return res;
  }

  // ---------- states on marks ----------
  function stampStates() {
    const root = document.getElementById('dash-root'); if (!root) return;
    root.querySelectorAll('[data-source]').forEach((el) => {
      const ids = el.getAttribute('data-source').split(/\s+/).filter(Boolean);
      let st = '';
      for (const id of ids) {
        const s = calcs[id] ? calcCache[id] : store[id];
        if (!s) continue;
        if (s.status === 'loading') st = 'loading'; else if (s.status === 'error' && st !== 'loading') st = 'error'; else if (s.refreshing && !st) st = 'refreshing';
      }
      if (st) el.setAttribute('data-dash-source-state', st); else el.removeAttribute('data-dash-source-state');
    });
  }

  const dash = window.dash = {
    data(id) {
      if (calcs[id]) return view(calcData(id));
      if (!META[id]) return view({ status: 'missing', data: [], message: 'Onbekende bron: ' + id });
      load(id, false);
      return view(store[id]);
    },
    onData(fn) { listeners.push(fn); try { fn(); } catch (e) { console.error('[dash] onData', e); } },
    calc(id, def) { calcs[id] = { inputs: def.inputs || [], fn: def.fn, title: def.title }; },
    loader(id, def) { loaders[id] = { fn: def.fn }; },
    params() { return Object.assign({}, params); },
    setParams(obj) {
      let ch = false;
      for (const k in obj) { const v = obj[k]; if (v === null || v === undefined) { if (k in params) { delete params[k]; ch = true; } } else if (params[k] !== v) { params[k] = v; ch = true; } }
      if (!ch) return;
      writeHash();
      // query datasets whose arguments depend on params reload when used
      changed();
    },
    resetParams() { params = Object.assign({}, BOOT.paramDefaults || {}); writeHash(); changed(); },
    setLink() { /* links zijn de URL zelf */ },
    refresh(id) { if (META[id]) { load(id, true); changed(); } },
    colors: ['#1f4b47', '#84bd3f', '#e09a00', '#7a9e9a', '#c0392b', '#5b7fa6', '#b07cc6', '#9a958c'],
    user: BOOT.user || null,
  };

  // ---------- gedeelde documenten (vervangt window.claude.use('db')) ----------
  function docApi(path) {
    const url = '/api/doc/' + path.split('/').map(encodeURIComponent).join('/');
    return {
      async get() {
        const r = await fetch(url); if (r.status === 404) return { exists: false, data: () => undefined };
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json(); return { exists: true, data: () => j.data };
      },
      async set(obj) { const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }); if (!r.ok) throw new Error(r.status === 403 ? 'Alleen een beheerder kan dit opslaan' : 'HTTP ' + r.status); },
      async update(obj) { const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }); if (!r.ok) throw new Error('HTTP ' + r.status); },
    };
  }
  window.claude = window.claude || {};
  window.claude.use = async (what) => (what === 'db' ? { doc: docApi } : null);

  document.addEventListener('DOMContentLoaded', () => { rw = window.innerWidth; changed(); });
})();
