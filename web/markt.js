// ---------- markt: weer, vraag naar de showroom (Google-profiel) en concurrenten ----------
(function () {
  const nl = 'nl-NL';
  const eur0 = new Intl.NumberFormat(nl, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const int = new Intl.NumberFormat(nl, { maximumFractionDigits: 0 });
  const dec1 = new Intl.NumberFormat(nl, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct0 = new Intl.NumberFormat(nl, { style: 'percent', maximumFractionDigits: 0 });
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const P0 = (s) => new Date(s + 'T00:00:00Z'), iso = (d) => d.toISOString().slice(0, 10);
  const addD = (s, n) => { const d = P0(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const days = (a, b) => Math.round((P0(b) - P0(a)) / 864e5) + 1;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
  const dag = (s) => P0(s).toLocaleDateString(nl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
  const rows = (id) => { const d = dash.data(id); return d && d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const signed = (v) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '±') + pct0.format(Math.abs(v)));

  // ---------- weer ----------
  const ICON = [[/thunder/, '⛈'], [/heavyrain|rain/, '🌧'], [/sleet|snow/, '🌨'], [/fog/, '🌫'], [/partlycloudy/, '⛅'], [/fair/, '🌤'], [/clearsky/, '☀️'], [/cloudy/, '☁️']];
  const icon = (s) => { for (const [r, i] of ICON) if (r.test(s || '')) return i; return '·'; };
  function weer() {
    const host = document.getElementById('mk-weer'), adv = document.getElementById('mk-weer-adv');
    const W = rows('weer'); host.replaceChildren(); adv.replaceChildren();
    if (!W) { host.append(el('p', 'lw-note', '—')); return; }
    const t = today(), F = W.filter((w) => w.d >= t && w.tmax != null).slice(0, 10);
    for (const w of F) {
      const c = el('div', 'mk-day' + ([0, 6].includes(P0(w.d).getUTCDay()) ? ' wk' : '') + (w.tmax >= 18 && (w.regen || 0) < 2 ? ' warm' : ''));
      c.append(el('small', '', dag(w.d)), el('span', 'mk-ic', icon(w.symbool)), el('b', '', `${Math.round(w.tmax)}°`), el('small', '', `${Math.round(w.tmin)}° · ${dec1.format(w.regen || 0)} mm`));
      host.append(c);
    }
    const A = weerAdvice(W);
    if (!A.season) {
      // outside the season: one line, forecast on request
      host.hidden = true; adv.className = 'mk-weer-off';
      const tx = F.length ? Math.round(Math.max(...F.map((w) => w.tmax))) : null, rn = F.reduce((q, w) => q + (w.regen || 0), 0);
      const bt = el('button', '', 'toon verwachting'); bt.type = 'button'; bt.addEventListener('click', () => { host.hidden = !host.hidden; bt.textContent = host.hidden ? 'toon verwachting' : 'verberg verwachting'; });
      adv.append(el('span', '', `Buiten het seizoen (augustus–januari): het weer heeft weinig invloed op de verkoop.${tx != null ? ` Komende ${F.length} dagen tot ${tx}°, samen ${dec1.format(rn)} mm regen.` : ''}`), bt);
    } else { host.hidden = false; adv.className = 'ad-verdict ad-v-' + A.lvl; adv.append(el('b', '', A.head), el('span', '', A.why)); }
    const p = W[0] && W[0].peil; document.getElementById('mk-weer-src').textContent = p ? `Verwachting van ${dag(p)} (MET Norway, Ridderkerk).` : '';
  }
  function weerAdvice(W) {
    W = W || rows('weer') || []; const t = today(), F = W.filter((w) => w.d >= t && w.tmax != null).slice(0, 10);
    // advice for the next weekend in the forecast
    const mo = Number(t.slice(5, 7)), season = mo >= 2 && mo <= 7;
    const wk = F.filter((w) => [0, 6].includes(P0(w.d).getUTCDay())).slice(0, 2);
    let head, why, lvl = 'hold';
    if (!season) { head = 'Buiten het seizoen'; why = 'Van augustus tot en met januari heeft het weer weinig invloed op de verkoop van tuinmeubelen. Geen actie nodig.'; }
    else if (!wk.length) { head = 'Nog geen weekend in de verwachting'; why = 'Kijk later deze week opnieuw.'; }
    else {
      const tx = Math.max(...wk.map((w) => w.tmax)), rn = wk.reduce((a, w) => a + (w.regen || 0), 0), warmTh = mo <= 3 ? 14 : 18;
      if (tx >= warmTh && rn < 3) { lvl = 'up'; head = `Mooi weekend op komst (tot ${Math.round(tx)}°, droog)`; why = `Mooi weer in het voorjaar trekt mensen naar de tuin en de showroom. Zet donderdag of vrijdag het dagbudget +20% hoger (het maximum per keer), met de sterkste campagnes eerst, en zorg voor bezetting in de showroom. Maandag weer terug als de POAS daalt.`; }
      else if (rn >= 8) { lvl = 'down'; head = `Nat weekend (${dec1.format(rn)} mm)`; why = 'Bij regen blijven mensen binnen en oriënteren ze online; niet opschalen. Gebruik het voor online acties of nieuwsbrieven.'; }
      else { head = `Wisselvallig weekend (tot ${Math.round(tx)}°)`; why = 'Geen reden om het budget voor het weekend aan te passen; volg het weekadvies.'; }
      if (mo <= 4 && tx >= 15 && !W.some((w) => w.d < t && w.tmax >= 15)) why += ' Eerste echt warme dagen van het jaar: dan schiet de vraag meestal omhoog.';
    }
    return { lvl, head, why, season, short: lvl === 'up' ? 'donderdag of vrijdag dagbudget +20%, maandag terug als de POAS daalt' : lvl === 'down' ? 'niet opschalen voor het weekend' : '' };
  }
  window.mkWeerAdvice = () => { try { return weerAdvice(); } catch (e) { return null; } };

  // ---------- vraag: Google-bedrijfsprofiel ----------
  function vraag() {
    const host = document.getElementById('mk-vraag'), G = rows('gbp_daily'); host.replaceChildren();
    if (!G || !G.length) { host.append(el('p', 'lw-note', '—')); return; }
    const M = new Map(G.map((r) => [r.d, r])), last = G.filter((r) => r.imp > 0).reduce((m, r) => (r.d > m ? r.d : m), '');
    const ses = new Map(); for (const id of ['shop_sessions_daily', 'shop_sessions_recent']) for (const r of rows(id) || []) ses.set(r.day, +r.sessions || 0);
    host.append(meter(M, last));
    // only full weeks (Sunday–Saturday) up to the last Saturday with profile data
    const endW = addD(last, -((P0(last).getUTCDay() + 1) % 7)), first = G.find((r) => r.imp > 0).d;
    // a day without search views but with profile views is not complete yet (Google fills it in later)
    const g = (k) => (d) => { const r = M.get(d); return r && r.imp > 0 && (k === 'maps' || r.zoek > 0) ? +r[k] || 0 : null; };
    const IND = [
      ['Routeaanvragen', 'naar de showroom (Google-profiel)', g('route')],
      ['Websiteklikken', 'vanuit het Google-profiel', g('web')],
      ['Gebeld', 'via het Google-profiel', g('bel')],
      ['Gevonden in Google Zoeken', 'weergaven van het profiel', g('zoek')],
      ['Gevonden in Google Maps', 'weergaven van het profiel', g('maps')],
      ['Bezoekers webshop', 'alle bronnen (Shopify)', (d) => (ses.has(d) ? ses.get(d) : null)],
    ];
    const sum = (f, a, b) => { let s = 0, n = 0; const t = days(a, b); for (let d = a; d <= b; d = addD(d, 1)) { const v = f(d); if (v != null) { s += v; n++; } } return n && n >= t * 0.85 ? Math.round((s * t) / n) : null; };
    // period: buttons or one clicked week
    const zc = dash.params().mk_zoom || '13', wk = { '1': 1, '4': 4, '13': 13, '26': 26, '52': 52 }[zc], nAll = Math.floor((P0(endW) - P0(first)) / 6048e5) + 1;
    const nP = Math.min(wk || nAll, nAll), selW = /^\d{4}-\d{2}-\d{2}$/.test(dash.params().mk_vweek || '') && dash.params().mk_vweek <= endW ? dash.params().mk_vweek : null;
    const pF = selW || addD(endW, -7 * nP + 1), pT = selW ? addD(selW, 6) : endW, pN = days(pF, pT) / 7;
    const nC = zc === 'all' ? nAll : Math.min(nAll, Math.max(13, nP)), W = [];
    for (let i = nC - 1; i >= 0; i--) { const e = addD(endW, -7 * i), w = addD(e, -6), f = (d) => { const a = g('route')(d), b = g('web')(d); return a == null ? null : a + (b || 0); }; W.push({ w, e, c: sum(f, w, e), l: sum(f, addD(w, -364), addD(e, -364)), on: w >= pF && e <= pT }); }
    // controls
    const zb = el('div', 'mk-zoom');
    [['1', 'Laatste week'], ['4', '4 weken'], ['13', '13 weken'], ['26', '26 weken'], ['52', '1 jaar'], ['all', 'Alles']].forEach(([k, l]) => { const bt = el('button', '', l); bt.type = 'button'; bt.setAttribute('aria-pressed', String(!selW && k === zc)); bt.addEventListener('click', () => dash.setParams({ mk_zoom: k, mk_vweek: null })); zb.append(bt); });
    const per = selW ? `week ${dag(pF)} t/m ${dag(pT)}` : `${nP === 1 ? 'week' : `${nP} weken`} ${dag(pF)} t/m ${dag(pT)}`;
    const hd = el('div', 'mk-chead'), lab = el('div', 'mk-per'); lab.append(el('b', '', 'Periode: '), document.createTextNode(per));
    if (selW) { const x = el('button', 'mk-clr', '× terug naar ' + ({ '1': 'laatste week', '4': '4 weken', '13': '13 weken', '26': '26 weken', '52': '1 jaar', all: 'alles' }[zc] || '13 weken')); x.type = 'button'; x.addEventListener('click', () => dash.setParams({ mk_vweek: null })); lab.append(x); }
    hd.append(lab, zb); host.append(hd);
    // indicator cards synced with the period: what people do, and how visible the profile is
    const prevF = addD(pF, -7 * pN), prevT = addD(pF, -1), lyF = addD(pF, -364), lyT = addD(pT, -364);
    const pill = (lab, c, o, small) => {
      const sp = el('span', 'mk-pill');
      if (c == null || o == null) { sp.classList.add('na'); sp.textContent = `${lab}: geen data`; return sp; }
      const r = o ? c / o - 1 : null;
      if (small || r == null || r > 5) { sp.classList.add('na'); sp.textContent = `${lab}: ${int.format(o)}${r != null && r > 5 && !small ? ' (onvolledig)' : ''}`; return sp; }
      sp.classList.add(r >= 0.1 ? 'up' : r <= -0.1 ? 'down' : 'flat'); sp.textContent = `${r >= 0.1 ? '▲' : r <= -0.1 ? '▼' : '■'} ${pct0.format(Math.abs(r))} ${lab}`; return sp;
    };
    const lp = pN === 1 ? 'vs week ervoor' : `vs ${pN} weken ervoor`;
    const grid = el('div', 'mk-kgrid');
    [['Wat mensen doen', [0, 1, 2, 5]], ['Hoe vaak het profiel gezien wordt', [3, 4]]].forEach(([title, idx]) => {
      const grp = el('div', 'mk-kgrp'); grp.append(el('div', 'mk-kgt', title));
      const row = el('div', 'mk-krow');
      for (const i of idx) {
        const [n, sub, f] = IND[i], c = sum(f, pF, pT), p = sum(f, prevF, prevT), l = sum(f, lyF, lyT), small = Math.max(c || 0, p || 0, l || 0) < 20;
        const k = el('div', 'mk-k'); k.append(el('div', 'mk-kl', n), el('div', 'mk-kv', c == null ? '–' : int.format(c)), el('div', 'mk-ks', pN > 1 && c != null ? `${sub} · gem. ${int.format(c / pN)} per week` : sub));
        const ps = el('div', 'mk-kp'); ps.append(pill(small ? 'vorige periode' : lp, c, p, small), pill(small ? 'vorig jaar' : 'vs vorig jaar', c, l, small)); k.append(ps); row.append(k);
      }
      grp.append(row); grid.append(grp);
    });
    host.append(grid);
    // chart
    const box = el('div', 'lw-chart mk-chart');
    host.append(el('div', 'lw-legend mk-leg', `Routeaanvragen + websiteklikken per week (donker = gekozen periode, klik op een week om die te kiezen) · stippellijn = zelfde week vorig jaar`), box);
    const Wd = Math.max(300, host.clientWidth || 600), H = 200, top = 10, bot = H - 22, left = 34;
    const mx = Math.max(1, ...W.map((r) => Math.max(r.c || 0, r.l || 0)));
    const x = d3.scaleBand(W.map((r) => r.w), [left, Wd - 8]).padding(0.25), y = d3.scaleLinear([0, mx * 1.1], [bot, top]).nice();
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${Wd} ${H}`).attr('height', H);
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', left).attr('x2', Wd - 8).attr('y1', y).attr('y2', y).attr('stroke', 'var(--cds-chart-grid, #e4dfd6)');
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', left - 5).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text((v) => int.format(v));
    const bars = svg.append('g').selectAll('g').data(W).join('g').style('cursor', 'pointer').on('click', (ev, r) => dash.setParams({ mk_vweek: r.w }));
    bars.append('rect').attr('x', (r) => x(r.w)).attr('width', x.bandwidth()).attr('y', top).attr('height', bot - top).attr('fill', 'transparent');
    bars.append('rect').attr('x', (r) => x(r.w)).attr('width', x.bandwidth()).attr('y', (r) => y(r.c || 0)).attr('height', (r) => bot - y(r.c || 0)).attr('rx', 2).attr('fill', (r) => (r.on ? '#1f4b47' : '#c8d3cf'));
    bars.append('title').text((r) => `Week ${dag(r.w)} t/m ${dag(r.e)}: ${r.c == null ? '–' : int.format(r.c)} (vorig jaar ${r.l == null ? '–' : int.format(r.l)})`);
    svg.append('path').datum(W).attr('d', d3.line().defined((r) => r.l != null).x((r) => x(r.w) + x.bandwidth() / 2).y((r) => y(r.l))).attr('fill', 'none').attr('stroke', '#7d8b88').attr('stroke-width', 1.6).attr('stroke-dasharray', '4 3').attr('pointer-events', 'none');
    const ev = Math.ceil(W.length / Math.max(1, Math.floor((Wd - left) / 50)));
    svg.append('g').selectAll('text').data(W.filter((_, i) => (W.length - 1 - i) % ev === 0)).join('text').attr('x', (r) => x(r.w) + x.bandwidth() / 2).attr('y', H - 5).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text((r) => dag(r.w).replace(/^\S+ /, ''));
    document.getElementById('mk-vraag-src').textContent = `Hoe vaak mensen jullie op Google vinden, een route naar de showroom vragen of doorklikken: de beste graadmeter voor showroombezoek en een vroeg signaal dat het seizoen begint. Hele weken (zondag t/m zaterdag) t/m ${dag(endW)}; een ontbrekende laatste dag wordt naar rato aangevuld. Google-profiel vanaf april 2025 (eerste maanden onvolledig: daar staat bij vorig jaar alleen het aantal), bezoekers uit Shopify.`;
  }


  // ---------- vraagmeter: is the demand picking up? ----------
  function meter(M, lastG) {
    const box = el('div', 'mk-meter');
    const ses = new Map(); for (const id of ['shop_sessions_daily', 'shop_sessions_recent']) for (const r of rows(id) || []) ses.set(r.day, +r.sessions || 0);
    const wk = (get, e) => { let s = 0, n = 0; for (let d = addD(e, -6); d <= e; d = addD(d, 1)) { const v = get(d); if (v != null) { s += v; n++; } } return n >= 6 ? s : null; };
    const gA = (d) => { const r = M.get(d); return r && r.imp > 0 ? (+r.route || 0) + (+r.web || 0) : null; }, gB = (d) => (ses.has(d) ? ses.get(d) : null);
    const lastS = [...ses.keys()].sort().pop() || lastG;
    const ind = [['Routeaanvragen + websiteklikken (Google-profiel)', gA, lastG], ['Bezoekers webshop (Shopify)', gB, lastS]].map(([n, g, e0]) => {
      const e = addD(e0, -((P0(e0).getUTCDay() + 1) % 7)); // last full week, Sunday-Saturday
      const c = wk(g, e), b = [1, 2, 3].map((k) => wk(g, addD(e, -7 * k))).filter((v) => v != null), base = b.length ? b.reduce((a, v) => a + v, 0) / b.length : null, ly = wk(g, addD(e, -364));
      return { n, e, c, r: c != null && base ? c / base - 1 : null, ly: c != null && ly ? c / ly - 1 : null };
    });
    const [A, B] = ind, mo = Number(today().slice(5, 7)), watch = [11, 12, 1, 2, 3, 4, 5].includes(mo);
    const up = A.r != null && (A.r >= 0.35 || (A.r >= 0.2 && B.r != null && B.r >= 0.2)), early = A.ly != null && A.ly >= 0.3 && [12, 1, 2, 3].includes(mo);
    let lvl = 'hold', head, why;
    if (up && watch) { lvl = 'up'; head = 'Vraag trekt aan'; why = `Afgelopen week ${signed(A.r)} routeaanvragen en websiteklikken${B.r != null ? ` en ${signed(B.r)} webshopbezoekers` : ''} t.o.v. de 3 weken ervoor. Zet de volgende opschaalstap nu (max +20%), niet pas als het in het plan staat.`; }
    else if (up) { head = 'Vraag hoger dan de weken ervoor'; why = `Routeaanvragen en websiteklikken ${signed(A.r)} t.o.v. de 3 weken ervoor. Buiten de opbouwperiode (november–mei) meestal een incident; in de gaten houden.`; }
    else { head = 'Vraag stabiel'; why = `Routeaanvragen en websiteklikken ${signed(A.r)} t.o.v. de 3 weken ervoor${B.r != null ? `, webshopbezoekers ${signed(B.r)}` : ''}. Geen signaal om eerder op te schalen.`; }
    if (early) { lvl = 'up'; why += ` Ten opzichte van dezelfde week vorig jaar ${signed(A.ly)}: het seizoen komt eerder op gang dan vorig jaar.`; }
    const v = el('div', 'ad-verdict ad-v-' + lvl); v.append(el('b', '', head), el('span', '', why));
    const t = el('table', 'lw-table mk-mt'), hr = el('tr'); ['Graadmeter (laatste volle week)', 'Aantal', 'vs 3 weken ervoor', 'vs vorig jaar'].forEach((h, i) => hr.append(el('th', i ? 'lw-num' : '', h))); t.append(hr);
    ind.forEach((x) => { const tr = el('tr'), c1 = el('td', 'lw-num', signed(x.r)), c2 = el('td', 'lw-num', signed(x.ly)); if (x.r != null) c1.classList.add(x.r >= 0.2 ? 'lw-good' : x.r <= -0.2 ? 'lw-bad' : 'x'); tr.append(el('td', '', `${x.n} · week t/m ${dag(x.e)}`), el('td', 'lw-num', x.c == null ? '–' : int.format(x.c)), c1, c2); t.append(tr); });
    v.firstChild.textContent = 'Signaal laatste volle week: ' + v.firstChild.textContent.replace(/^./, (c) => c.toLowerCase());
    box.append(v);
    return box;
  }

  // ---------- concurrenten ----------
  // ---------- marktpotentieel: zoekvolume tegen wat wij er nu van binnenhalen ----------
  function potentieel() {
    const host = document.getElementById('mk-pot'), K = rows('markt_kp'), S = rows('shop_search_month'); host.replaceChildren();
    if (!K || !K.length || !S) { host.append(el('p', 'lw-note', '—')); return; }
    const pf = (d) => new Intl.NumberFormat(nl, { style: 'percent', maximumFractionDigits: d });
    const REL = { lounge: 1, tuinset: 1, merken: 1 };
    // real monthly search volume per month (Google Keyword Planner), relevant groups only
    const VOL = new Map(), KW = new Map(); for (const r of K) { if (REL[r.groep]) VOL.set(r.maand, (VOL.get(r.maand) || 0) + r.volume); }
    const kpM = [...VOL.keys()].sort(), kp12 = kpM.slice(-12);
    const G = {}; for (const r of K) if (kp12.includes(r.maand)) { G[r.groep] = (G[r.groep] || 0) + r.volume / kp12.length; const k = KW.get(r.zoekwoord) || { z: r.zoekwoord, g: r.groep, v: 0 }; k.v += r.volume / kp12.length; KW.set(r.zoekwoord, k); }
    const rel = (G.lounge || 0) + (G.tuinset || 0) + (G.merken || 0);
    const TM = new Map(S.filter((r) => r.tm).map((r) => [r.maand, r.tm]));
    const shiftY = (m, n) => `${+m.slice(0, 4) + n}${m.slice(4)}`;
    // a month without planner data (too old, or still running) uses the same month one year later/earlier: marked as estimate
    const zoekInfo = (m) => {
      let v = VOL.get(m), est = null; if (v == null && VOL.has(shiftY(m, 1))) { v = VOL.get(shiftY(m, 1)); est = shiftY(m, 1); } else if (v == null && VOL.has(shiftY(m, -1))) { v = VOL.get(shiftY(m, -1)); est = shiftY(m, -1); }
      if (v == null) return null; const tm = TM.get(m); if (tm) { const dim = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); v = v * Number(tm.slice(8, 10)) / dim; }
      return { v, est };
    };
    const zoek = (m) => (zoekInfo(m) || { v: 0 }).v;
    const SM = new Map(S.map((r) => [r.maand, r.sessies])), months = S.map((r) => r.maand).filter((m) => zoekInfo(m)).sort(), last12 = months.filter((m) => !TM.has(m)).slice(-12);
    const sel = dash.params().mk_pper && months.includes(dash.params().mk_pper) ? dash.params().mk_pper : '12m';
    // orders and revenue per webshop session (all orders incl. showroom) for the chosen period
    const sd = [...(rows('shop_sales_daily') || []), ...(rows('shop_sales_recent') || [])], ss = [...(rows('shop_sessions_daily') || []), ...(rows('shop_sessions_recent') || [])];
    const inP = (d) => (sel === '12m' ? last12.includes(d.slice(0, 7)) : d.slice(0, 7) === sel);
    const om = new Map(), se = new Map(); for (const r of sd) if (inP(r.day)) om.set(r.day, r); for (const r of ss) if (inP(r.day)) se.set(r.day, +r.sessions || 0);
    let O = 0, E = 0, N = 0; for (const r of om.values()) { O += +r.orders || 0; E += +r.omzet || 0; } for (const v of se.values()) N += v;
    const conv = N ? O / N : null, aov = O ? E / O : null;
    const Q = sel === '12m' ? last12.reduce((a, m) => a + zoek(m), 0) : zoek(sel), V = sel === '12m' ? last12.reduce((a, m) => a + SM.get(m), 0) : SM.get(sel);
    const nEst = sel === '12m' ? last12.filter((m) => zoekInfo(m).est).length : 0, selInfo = sel === '12m' ? null : zoekInfo(sel);
    const share = Q ? V / Q : null, per1 = Q * 0.01, eur1 = conv && aov ? per1 * conv * aov : null;
    const mShort = (m) => P0(m + '-01').toLocaleDateString(nl, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const mName = (m) => mShort(m) + (TM.has(m) ? ` (t/m ${dag(TM.get(m))})` : '');
    // period choice
    const ctl = el('div', 'mk-chead'), zb = el('div', 'mk-zoom'), b12 = el('button', '', 'Laatste 12 maanden'); b12.type = 'button'; b12.setAttribute('aria-pressed', String(sel === '12m')); b12.addEventListener('click', () => dash.setParams({ mk_pper: null })); zb.append(b12);
    const sl = el('select', 'mk-sel'); sl.append(new Option('Kies een maand…', ''));
    [...months].reverse().forEach((m) => sl.append(new Option(mName(m), m))); sl.value = sel === '12m' ? '' : sel; sl.addEventListener('change', () => dash.setParams({ mk_pper: sl.value || null })); zb.append(sl);
    ctl.append(el('div', 'lw-label', sel === '12m' ? `Periode: ${mName(last12[0])} t/m ${mName(last12[last12.length - 1])}` : `Periode: ${mName(sel)}`), zb); host.append(ctl);
    const tiles = el('div', 'lw-tiles');
    const qSub = sel === '12m' ? (nEst ? `${nEst} van de 12 maanden geschat (zelfde maand ander jaar)` : 'echt gemeten zoekvolume (Google Zoekwoordplanner)') : selInfo.est ? `schatting: ${mShort(selInfo.est)} (Zoekwoordplanner ${selInfo.est > sel ? 'geeft alleen de laatste 12 maanden' : 'heeft deze maand nog niet'})` + (TM.has(sel) ? ', naar rato van de dagen' : '') : 'echt gemeten zoekvolume (Google Zoekwoordplanner)';
    [['Zoekopdrachten', int.format(Q), qSub],
     ['Jullie bezoekers via Google', int.format(V || 0), 'betaald + gratis (Shopify), incl. zoeken op jullie naam'],
     ['Aandeel van de zoekers', share == null ? '–' : pf(1).format(share), 'bezoekers via Google ÷ zoekopdrachten'],
     ['Per 1% extra van de zoekers', eur1 == null ? '–' : `± ${eur0.format(eur1)}`, conv ? `${int.format(per1)} bezoekers × ${pf(2).format(conv)} orders per bezoeker × ${eur0.format(aov)}` : ''],
    ].forEach(([l, v, sub]) => { const t = el('div', 'lw-tile'); t.append(el('div', 'lw-label', l), el('div', 'lw-value', v), el('div', 'lw-delta', sub)); tiles.append(t); });
    host.append(tiles);
    // share per month; estimated months lighter with a dashed outline
    const D = months.map((m) => { const z = zoekInfo(m); return { m, s: SM.get(m) / z.v, est: z.est, q: z.v }; }), ch = el('div', 'lw-chart'), Wd = Math.max(300, host.clientWidth || 600), H = 170, left = 40, bot = H - 20;
    const x = d3.scaleBand(D.map((r) => r.m), [left, Wd - 8]).padding(0.25), y = d3.scaleLinear([0, Math.max(0.01, ...D.map((r) => r.s)) * 1.1], [bot, 8]).nice();
    const svg = d3.select(ch).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${Wd} ${H}`).attr('height', H);
    svg.append('g').selectAll('text').data(y.ticks(3)).join('text').attr('x', left - 5).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text((v) => pf(1).format(v));
    const g = svg.append('g').selectAll('g').data(D).join('g').style('cursor', 'pointer').on('click', (ev, r) => dash.setParams({ mk_pper: r.m }));
    const on = (r) => sel === r.m || (sel === '12m' && last12.includes(r.m));
    g.append('rect').attr('x', (r) => x(r.m)).attr('width', x.bandwidth()).attr('y', (r) => y(r.s)).attr('height', (r) => bot - y(r.s)).attr('rx', 2)
      .attr('fill', (r) => (on(r) ? '#1f4b47' : '#c8d3cf')).attr('fill-opacity', (r) => (r.est ? 0.5 : 1)).attr('stroke', (r) => (r.est ? (on(r) ? '#1f4b47' : '#8fa39d') : 'none')).attr('stroke-dasharray', '3 2');
    g.append('title').text((r) => `${mName(r.m)}: ${pf(1).format(r.s)} (${int.format(SM.get(r.m))} bezoekers op ${r.est ? '±' : ''}${int.format(r.q)} zoekopdrachten${r.est ? `; zoekvolume geschat uit ${mShort(r.est)}` : ''})`);
    g.append('text').attr('x', (r) => x(r.m) + x.bandwidth() / 2).attr('y', H - 5).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text((r) => P0(r.m + '-01').toLocaleDateString(nl, { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', ''));
    host.append(el('div', 'lw-legend mk-leg', `Aandeel van de zoekers per maand (klik op een maand om die te kiezen). Lichte balken met stippellijn: zoekvolume geschat; Zoekwoordplanner heeft echte maandcijfers vanaf ${mShort(kpM[0])}.`), ch);
    const inf = el('details', 'ad-info'); inf.append(el('summary', '', 'ⓘ Hoe werkt dit?')); host.append(inf); inf.append(el('p', 'lw-note', `Zoekvolume: Google Zoekwoordplanner via jullie Google Ads-account, echte aantallen per maand (Nederland, Nederlands), elke maand automatisch ververst. Telt alle zoektermen met loungeset, loungebank, lounge of tuinset en merken (±${int.format(rel)} per maand gemiddeld, ${KW.size} zoektermen; varianten die Google samen telt één keer). Niet meegeteld: goedkope ketens (Jysk, IKEA, Karwei e.d.: ±${int.format(G.ketens || 0)}/maand), hoezen/kussens, binnen en tweedehands. Let op: jullie bezoekers via Google zijn alle zoekmachinebezoeken, ook mensen die op "Loungesetland" zoeken; daardoor ligt het aandeel wat te hoog, vooral in rustige maanden. Hoe groot is de markt in euro's? De Nederlandse markt voor tuinmeubelen wordt geschat op € 450–500 mln per jaar (SourceReady, 2026; schatting zonder onderbouwing).`));
    const t = el('table', 'lw-table'), hr = el('tr'); ['Grootste zoektermen', 'Zoekopdrachten per maand (gem.)', 'Groep'].forEach((h, i) => hr.append(el('th', i === 1 ? 'lw-num' : i === 2 ? 'mk-grp' : '', h))); t.append(hr);
    const GN = { lounge: 'loungeset/-bank', tuinset: 'tuinset', merken: 'merk', ketens: 'goedkope keten' };
    [...KW.values()].filter((r) => GN[r.g]).sort((a, b) => b.v - a.v).slice(0, 15).forEach((r) => { const tr = el('tr'); tr.append(el('td', '', r.z), el('td', 'lw-num', int.format(r.v)), el('td', 'mk-grp', GN[r.g])); t.append(tr); });
    const box = el('div', 'lw-tablebox mk-kwbox'); box.append(t); const dt = el('details', 'ad-hold'); dt.append(el('summary', '', `Grootste zoektermen (top 15) ▸`), box); host.append(dt);
  }
  dash.onData(() => {
    if (document.getElementById('pg-ads').hidden) return;
    weer(); vraag(); potentieel();
  });
  window.addEventListener('resize', () => { if (!document.getElementById('pg-ads').hidden) { weer(); vraag(); potentieel(); } });
})();
