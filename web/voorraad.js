// ---------- Voorraad en inkoop: bestellen, per leverancier, containervoorstel, inkomend ----------
(function () {
  const nl = 'nl-NL';
  const eur0 = new Intl.NumberFormat(nl, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const int = new Intl.NumberFormat(nl, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(nl, { maximumFractionDigits: 1 });
  const n2 = new Intl.NumberFormat(nl, { maximumFractionDigits: 2 });
  const pct0 = new Intl.NumberFormat(nl, { style: 'percent', maximumFractionDigits: 0 });
  const DAY = 864e5;
  const P0 = (s) => new Date(s + 'T00:00:00Z');
  const iso = (d) => d.toISOString().slice(0, 10);
  const addD = (s, n) => iso(new Date(P0(s).getTime() + n * DAY));
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
  const dNl = (s) => (s ? P0(s).toLocaleDateString(nl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const mNl = (m) => P0(m + '-01').toLocaleDateString(nl, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const rows = (id) => { const d = dash.data(id); return d && d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const num = (v, d) => { const n = Number(String(v ?? '').replace(',', '.')); return v === undefined || v === null || v === '' || Number.isNaN(n) ? d : n; };
  const short = (s) => String(s || '').split('|').slice(0, 2).map((x) => x.trim()).join(' · ');
  const pon = (x) => String(x || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  let OPEN_PO = new Set();
  const isAdmin = () => !!(dash.user && dash.user.r === 'beheerder');

  // ---------- CBM per product (gedeeld document voorraad/cbm) ----------
  let CBM = {}, HERK = {}, cbmLoaded = false, db = null;
  const LOCNAAM = { I: 'China', J: 'China', C: 'China', E: 'China', A: 'Indonesië', B: 'Indonesië' };
  (async () => {
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
    try { if (db) { const s = await db.doc('voorraad/cbm').get(); CBM = s.exists ? (s.data().waarden || {}) : {}; } } catch (e) { CBM = {}; }
    try { if (db) { const h = await db.doc('voorraad/herkomst').get(); HERK = h.exists ? (h.data().waarden || {}) : {}; } } catch (e) { HERK = {}; }
    cbmLoaded = true; render();
  })();
  async function saveCbm(sku, v) {
    if (!db) return;
    const s = await db.doc('voorraad/cbm').get();
    const w = Object.assign({}, s.exists ? s.data().waarden || {} : {});
    if (v == null) delete w[sku]; else w[sku] = v;
    await db.doc('voorraad/cbm').set({ waarden: w, at: new Date().toISOString() });
    CBM = w; render();
  }
  const cbmOf = (sku) => { const v = Number(CBM[sku]); return v > 0 ? v : null; };

  // ---------- levertijd per leverancier ----------
  // standaard: mediaan van (verwachte aankomst − besteldatum) van de eigen inkooporders, anders 13 weken (China) of 2 weken
  function leadDefaults(pos) {
    const by = new Map();
    for (const p of pos) {
      if (!p.besteld || !p.eta || p.eta < p.besteld) continue;
      const w = (P0(p.eta) - P0(p.besteld)) / DAY / 7;
      if (w < 0.5 || w > 52) continue;
      (by.get(p.leverancier_id) || by.set(p.leverancier_id, []).get(p.leverancier_id)).push(w);
    }
    const out = new Map();
    for (const [k, a] of by) { a.sort((x, y) => x - y); out.set(k, Math.round(a[Math.floor(a.length / 2)])); }
    return out;
  }
  const guess = (name) => (/mod|foshan|ningbo|cathrine|container|tierra|republic/i.test(name || '') ? 13 : 2);

  // ---------- advies per product ----------
  function advies(r, P, L) {
    const D = Math.max(1, num(P.vr_dek, 16)), B = Math.max(0, num(P.vr_buf, 2));
    const v = r.vraag || [], H = v.length;
    const t0 = r._week0;
    const arr = new Array(H).fill(0);
    for (const x of r.leveringen || []) { const dt = (r._cpEta && r._cpEta.get(pon(x.po))) || x.datum; const i = Math.max(0, Math.floor((P0(dt < today() ? today() : dt) - P0(t0)) / DAY / 7)); if (i < H) arr[i] += Number(x.stuks) || 0; }
    // voorraad doorrekenen zonder nieuwe bestelling
    let s = Number(r.voorraad) || 0, opIdx = null; const proj = [];
    for (let i = 0; i < H; i++) { s += arr[i]; s -= v[i]; proj.push(s); if (opIdx === null && s < 0) opIdx = i; }
    // bestelmoment: eerste week vanaf de levertijd (eerder kan een nieuwe bestelling niet binnen zijn) waarin de voorraad
    // onder de veiligheidsvoorraad zakt; bestellen uiterlijk = die week − levertijd
    const bufAt = (i) => v.slice(i + 1, i + 1 + B).reduce((a, b) => a + b, 0);
    const a = Math.min(L, H - 1);
    let rp = null;
    for (let i = a; i < H; i++) if (proj[i] < bufAt(i)) { rp = i; break; }
    const orderBy = rp === null ? null : rp - L;
    // hoeveelheid als je nu bestelt: verkoop vanaf aankomst t/m dekking + veiligheidsvoorraad − wat er dan ligt − wat er in die periode binnenkomt
    const atArr = a > 0 ? proj[a - 1] : Number(r.voorraad) || 0;
    const need = v.slice(a, a + D + B).reduce((x, y) => x + y, 0);
    const inWin = arr.slice(a, a + D).reduce((x, y) => x + y, 0);
    const qty = Math.max(0, Math.ceil(need - Math.max(0, atArr) - inWin));
    const kortVoor = opIdx !== null && opIdx < a; // tekort vóór een nieuwe bestelling binnen kan zijn
    let status, rank;
    if (rp === null) { status = 'Voldoende'; rank = 5; }
    else if (kortVoor && rp <= a) { status = 'Te laat'; rank = 0; }
    else if (orderBy <= 0) { status = 'Nu bestellen'; rank = 1; }
    else if (orderBy <= 4) { status = 'Binnen 4 weken'; rank = 2; }
    else { status = 'Later'; rank = 3; }
    if (status === 'Te laat' && L <= 2) { status = 'Nu bestellen'; rank = 1; } // korte levertijd: gewoon nu bijbestellen
    if (rank <= 2 && qty === 0) { status = kortVoor ? 'Tekort tot levering' : 'Voldoende'; rank = kortVoor ? 3 : 5; } // wat al besteld is dekt het
    const wkTo = (i) => addD(t0, i * 7);
    const perWk = v.slice(a, a + D).reduce((x, y) => x + y, 0) / D;
    return { kortVoor, L, opDatum: opIdx === null ? null : wkTo(opIdx), bestelDatum: orderBy === null ? null : wkTo(Math.max(0, orderBy)), orderBy, qty: rank <= 2 || P.vr_alles ? qty : 0, qtyNu: qty, status, rank, atArr, perWk, aankomst: wkTo(a) };
  }

  // ---------- containers ----------
  function containers(T, P) {
    const c20 = num(P.vr_c20, 28), c40 = num(P.vr_c40, 58), chq = num(P.vr_chq, 67);
    if (!(T > 0)) return { txt: '—', cap: 0, list: [] };
    const list = [];
    let rest = T;
    while (rest > chq) { list.push(['40HQ', chq]); rest -= chq; }
    if (rest > 0) list.push(rest <= c20 ? ['20ft', c20] : rest <= c40 ? ['40ft', c40] : ['40HQ', chq]);
    const cap = list.reduce((a, x) => a + x[1], 0);
    const cnt = {}; for (const [k] of list) cnt[k] = (cnt[k] || 0) + 1;
    const txt = Object.entries(cnt).map(([k, n]) => `${n}× ${k}`).join(' + ') + ` · ${pct0.format(T / cap)} vol`;
    return { txt, cap, list };
  }

  let LAST = null;
  function render() {
    const root = document.getElementById('pg-vr');
    if (!root) return;
    const dk = rows('st_dekking'), pos = rows('vr_pos'), lev = rows('vr_leveranciers'), sz = rows('st_seizoen');
    const P = dash.params();
    if (!dk || !pos || !lev || !rows('cp_open') || !rows('fx')) { clearTimeout(render._t); render._t = setTimeout(render, 700); return; }
    const stand = sz && sz[0] ? sz[0].stand : null;
    document.getElementById('vr-stand').textContent = stand ? dNl(stand.slice(0, 10)) + ' ' + stand.slice(11, 16) : '—';
    const week0 = sz && sz[0] ? sz[0].week : today();
    const hist = leadDefaults(pos);
    // inkomend: containerplanning (ETA, bedragen) gekoppeld aan Sumtracker (inhoud) op PO-nummer
    const cp = rows('cp_open') || [], fx = rows('fx'), rate = fx && fx[0] ? Number(fx[0].usd_eur) || 0 : 0;
    const CPETA = new Map(cp.filter((c) => c.eta).map((c) => [pon(c.po), c.eta]));
    const stByPo = new Map(pos.map((p) => [pon(p.po), p]));
    const levByName = (n) => { const k = String(n || '').toLowerCase().replace(/[^a-z]/g, ''); const hit = lev.find((l) => { const m = String(l.leverancier || '').toLowerCase().replace(/[^a-z]/g, ''); return m && k && (m.includes(k) || k.includes(m.split('outdoor')[0])); }); return hit ? hit.leverancier_id : null; };
    const IN = cp.filter((c) => c.binnen !== 'Ja' && (c.eta || (Number(c.aanbetaling_eur) || 0) > 0)).map((c) => {
      const st = stByPo.get(pon(c.po));
      const aanb = (Number(c.aanbetaling_eur) || 0) + (Number(c.betaling2_eur) || 0);
      const open = c.container_betaald ? 0 : (Number(c.open_usd) || 0) * rate, vracht = c.binnen === 'Ja' ? 0 : (Number(c.vracht_usd) || 0) * rate;
      return { po: st ? st.po : String(c.po).replace(/\s+/g, ''), eta: c.eta, leverancier: st ? st.leverancier : c.leverancier, leverancier_id: st ? st.leverancier_id : levByName(c.leverancier),
        inhoud: c.inhoud, stuks: st ? st.open_stuks : null, regels: st ? st.regels : null, inSt: !!st, aanb, open, vracht, totaal: aanb + open + vracht, betaald: !!c.container_betaald };
    }).filter((x) => !x.eta || x.eta >= addD(today(), -14) || (x.inSt && stByPo.get(pon(x.po)).open)).sort((a, b) => ((a.eta || '9999') < (b.eta || '9999') ? -1 : 1));
    const leadOf = (id, name) => num(P['lt_' + id], hist.get(id) ?? guess(name));

    // instellingen
    document.querySelectorAll('#vr-set [data-vrp]').forEach((i) => { const d = { vr_dek: 16, vr_buf: 2, vr_c20: 28, vr_c40: 58, vr_chq: 67 }[i.dataset.vrp]; if (document.activeElement !== i) i.value = num(P[i.dataset.vrp], d); });
    const ltb = document.querySelector('#vr-lt tbody');
    if (!ltb.contains(document.activeElement)) {
      const levs = lev.filter((l) => l.leverancier_id != null && (l.skus || l.open_pos || l.inkoop_12m));
      ltb.replaceChildren(...levs.map((l) => {
        const tr = el('tr'); tr.append(el('td', '', l.leverancier), el('td', 'lw-num', hist.has(l.leverancier_id) ? hist.get(l.leverancier_id) + ' wk' : '—'));
        const td = el('td', 'lw-num'); const inp = el('input'); inp.type = 'number'; inp.min = 0; inp.max = 52; inp.step = 1;
        inp.value = P['lt_' + l.leverancier_id] ?? ''; inp.placeholder = String(hist.get(l.leverancier_id) ?? guess(l.leverancier));
        inp.addEventListener('change', () => dash.setParams({ ['lt_' + l.leverancier_id]: inp.value === '' ? null : Number(inp.value) }));
        td.append(inp); tr.append(td); return tr;
      }));
    }

    // advies per product
    const actief = (r) => (Number(r.voorraad) || 0) > 0 || (Number(r.onderweg) || 0) > 0 || (Number(r.verkocht_13w) || 0) > 0;
    const nonActief = dk.filter((r) => !actief(r) || (HERK[r.sku] && HERK[r.sku].uitlopend)).length;
    const uitlopend = (r) => !!(HERK[r.sku] && HERK[r.sku].uitlopend);
    const all = dk.filter((r) => actief(r) && !uitlopend(r)).map((r) => { r._week0 = week0; r._cpEta = CPETA; const L = leadOf(r.leverancier_id, r.leverancier); const a = advies(r, P, L); const c = cbmOf(r.sku); return { r, a, cbm: c }; });
    LAST = all;
    const urgent = (x) => x.a.rank <= 2;
    const fLev = P.vr_lev != null && P.vr_lev !== '' ? String(P.vr_lev) : '';
    const fSt = P.vr_st || '';
    const inLev = (x) => !fLev || String(x.r.leverancier_id) === fLev;

    // tegels
    const T = el('div'); const tiles = document.getElementById('vr-tiles');
    const cnt = (rk) => all.filter((x) => inLev(x) && x.a.rank === rk);
    const val = (a) => a.reduce((t, x) => t + x.a.qty * (x.r.kostprijs || 0), 0);
    const openPos = IN.filter((p) => !fLev || String(p.leverancier_id) === fLev);
    const nxt = openPos.find((p) => p.eta && p.eta >= today());
    const tileDefs = [
      ['laat', 'Te laat', cnt(0), (a) => `op vóór een bestelling van nu binnen kan zijn · advies ${eur0.format(val(a))}`],
      ['nu', 'Nu bestellen', cnt(1), (a) => `bestelmoment is nu · advies ${eur0.format(val(a))}`],
      ['4w', 'Binnen 4 weken bestellen', cnt(2), (a) => `advies ${eur0.format(val(a))}`],
    ];
    tiles.replaceChildren(...tileDefs.map(([k, l, a, sub]) => {
      const t = el('div', 'lw-tile lw-click'); t.setAttribute('role', 'button'); t.tabIndex = 0; t.setAttribute('aria-pressed', String(fSt === k));
      const v = el('div', 'lw-value', `${a.length} producten`); if (k === 'laat' && a.length) v.classList.add('lw-bad');
      t.append(el('div', 'lw-label', l), v, el('div', 'lw-delta', sub(a)));
      const go = () => dash.setParams({ vr_st: fSt === k ? null : k });
      t.addEventListener('click', go); t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      return t;
    }), (() => {
      const t = el('div', 'lw-tile');
      t.append(el('div', 'lw-label', 'Onderweg (containerplanning)'), el('div', 'lw-value', eur0.format(openPos.reduce((a, p) => a + p.totaal, 0))),
        el('div', 'lw-delta', `${openPos.length} containers · ${eur0.format(openPos.reduce((a, p) => a + p.aanb, 0))} al betaald, ${eur0.format(openPos.reduce((a, p) => a + p.open + p.vracht, 0))} nog te betalen${nxt ? ` · eerstvolgende ${dNl(nxt.eta)} (${nxt.po})` : ''}`));
      return t;
    })());

    // leverancier-filter
    const levIds = [...new Set(all.map((x) => String(x.r.leverancier_id)))];
    const levName = new Map(all.map((x) => [String(x.r.leverancier_id), x.r.leverancier]));
    for (const l of lev) levName.set(String(l.leverancier_id), l.leverancier);
    const bar = document.getElementById('vr-levf');
    const mk = (id, label) => { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(fLev === (id == null ? '' : id))); b.addEventListener('click', () => dash.setParams({ vr_lev: id })); return b; };
    bar.replaceChildren(mk(null, 'Alle leveranciers'), ...levIds.sort((a, b) => String(levName.get(a)).localeCompare(String(levName.get(b)))).map((id) => mk(id, levName.get(id) || 'Onbekend')));

    // bestellijst
    let list = all.filter(inLev);
    if (fSt === 'laat') list = list.filter((x) => x.a.rank === 0); else if (fSt === 'nu') list = list.filter((x) => x.a.rank === 1); else if (fSt === '4w') list = list.filter((x) => x.a.rank === 2); else list = list.filter((x) => x.a.rank <= 3);
    list.sort((a, b) => a.a.rank - b.a.rank || (a.a.bestelDatum || '9999').localeCompare(b.a.bestelDatum || '9999') || b.r.waarde_52w - a.r.waarde_52w);
    document.getElementById('vr-best-t').textContent = `Bestellijst${fLev ? ' · ' + (levName.get(fLev) || '') : ''} (${list.length})`;
    document.getElementById('vr-inact').textContent = nonActief ? `${nonActief} producten staan niet in de lijst: uitlopend (niet meer na te bestellen), of zonder voorraad, inkooporder en verkoop in de laatste 13 weken.` : '';
    const tb = document.querySelector('#vr-tbl tbody');
    const stCls = (s) => (s === 'Te laat' ? ' lw-bad' : s === 'Nu bestellen' || s === 'Binnen 4 weken' || s === 'Tekort tot levering' ? ' lw-warn' : ' lw-ok');
    tb.replaceChildren(...list.slice(0, 400).map((x) => {
      const tr = el('tr'); const r = x.r, a = x.a;
      const nm = el('td', 'lw-wrap', short(r.naam)); nm.title = `${r.sku} · ${int.format(r.verkocht_52w)} verkocht in 52 weken · verwacht ${n1.format(a.perWk)}/week na aankomst`;
      const ond = el('td', 'lw-num', r.onderweg ? int.format(r.onderweg) : '—'); if (r.leveringen && r.leveringen.length) ond.title = r.leveringen.map((l) => `${l.po}: ${int.format(l.stuks)} op ${dNl(l.datum)}`).join('\n');
      tr.append(nm, el('td', '', r.leverancier), el('td', 'lw-num', int.format(r.voorraad)), ond,
        el('td', a.kortVoor ? 'lw-bad' : '', a.opDatum ? dNl(a.opDatum) + (a.kortVoor && r.onderweg ? ' (tot levering)' : '') : 'na 60 wk'), el('td', 'lw-num', a.L + ' wk'),
        el('td', a.rank <= 1 ? 'lw-bad' : '', a.bestelDatum ? (a.orderBy <= 0 ? 'nu' : dNl(a.bestelDatum)) : '—'),
        el('td', 'lw-num', a.qty ? int.format(a.qty) : '—'), el('td', 'lw-num', x.cbm && a.qty ? n1.format(a.qty * x.cbm) : x.cbm ? '' : '?'),
        el('td', 'lw-num', a.qty ? eur0.format(a.qty * (r.kostprijs || 0)) : '—'));
      const st = el('td'); st.append(el('span', 'lw-pill' + stCls(a.status), a.status)); tr.append(st);
      return tr;
    }));
    const sq = list.reduce((t, x) => t + x.a.qty, 0), sc = list.reduce((t, x) => t + (x.cbm ? x.a.qty * x.cbm : 0), 0), se = list.reduce((t, x) => t + x.a.qty * (x.r.kostprijs || 0), 0);
    document.getElementById('vr-ft-q').textContent = int.format(sq);
    document.getElementById('vr-ft-c').textContent = n1.format(sc);
    document.getElementById('vr-ft-e').textContent = eur0.format(se);

    // per leverancier
    const lb = document.querySelector('#vr-lev tbody');
    lb.replaceChildren(...lev.filter((l) => l.inkoop_12m || l.open_pos || l.skus).map((l) => {
      const mine = all.filter((x) => x.r.leverancier_id === l.leverancier_id && urgent(x));
      const cb = mine.reduce((t, x) => t + (x.cbm ? x.a.qty * x.cbm : 0), 0);
      const eur = mine.reduce((t, x) => t + x.a.qty * (x.r.kostprijs || 0), 0);
      const tr = el('tr'); tr.setAttribute('aria-pressed', String(fLev === String(l.leverancier_id)));
      tr.append(el('td', '', l.leverancier), el('td', 'lw-num', eur0.format(l.inkoop_jaar)), el('td', 'lw-num', eur0.format(l.inkoop_12m)), el('td', 'lw-num', int.format(IN.filter((p) => p.leverancier_id === l.leverancier_id).length)),
        ...(() => { const m = IN.filter((p) => p.leverancier_id === l.leverancier_id); const q = m.reduce((a, p) => a + (p.stuks || 0), 0), e = m.reduce((a, p) => a + p.totaal, 0); const nx = m.find((p) => p.eta && p.eta >= today());
          return [el('td', 'lw-num', q ? int.format(q) : '—'), el('td', 'lw-num', e ? eur0.format(e) : '—'), el('td', '', nx ? dNl(nx.eta) : '—')]; })(),
        el('td', 'lw-num', mine.length ? `${mine.length} · ${eur0.format(eur)}` : '—'), el('td', 'lw-num', cb ? n1.format(cb) + ' cbm' : '—'), el('td', '', cb ? containers(cb, P).txt : '—'));
      tr.addEventListener('click', () => dash.setParams({ vr_lev: fLev === String(l.leverancier_id) ? null : String(l.leverancier_id) }));
      return tr;
    }));

    // containervoorstel
    renderCont(all, P, fLev, levName);

    // inkomend
    const inp = IN.filter((p) => !fLev || String(p.leverancier_id) === fLev);
    const ib = document.querySelector('#vr-in tbody');
    const open = new Set(String(P.vr_po || '').split(',').filter(Boolean));
    const out = [];
    for (const p of inp) {
      const tr = el('tr', 'vr-po'); tr.setAttribute('aria-expanded', String(open.has(p.po))); tr.title = 'Klik om de inhoud te zien';
      const late = p.eta && p.eta < today();
      tr.append(el('td', late ? 'lw-bad' : '', (open.has(p.po) ? '▾ ' : '▸ ') + (p.eta ? dNl(p.eta) : 'geen ETA')), el('td', '', p.po), el('td', '', p.leverancier || ''), el('td', 'lw-wrap', p.inhoud || ''),
        el('td', 'lw-num', p.stuks == null ? '—' : int.format(p.stuks)), el('td', 'lw-num', eur0.format(p.aanb)), el('td', 'lw-num', p.open ? eur0.format(p.open) : p.betaald ? 'betaald' : '—'),
        el('td', 'lw-num', p.vracht ? eur0.format(p.vracht) : '—'), el('td', 'lw-num', eur0.format(p.totaal)));
      tr.addEventListener('click', () => { const n = new Set(open); if (n.has(p.po)) n.delete(p.po); else n.add(p.po); dash.setParams({ vr_po: [...n].join(',') || null }); });
      out.push(tr);
      if (open.has(p.po)) {
        const dr = el('tr', 'vr-detail'); const td = el('td'); td.colSpan = 9;
        if (!p.regels) td.append(el('p', 'lw-note', p.inSt ? 'Geen regels gevonden in Sumtracker.' : `${p.po} staat niet (open) in Sumtracker, dus de inhoud is niet bekend.`));
        else {
          const t = el('table', 'lw-table vr-sub'); const h = el('tr'); ['SKU', 'Product', 'Besteld', 'Geleverd', 'Nog te komen'].forEach((x, i) => h.append(el('th', i >= 2 ? 'lw-num' : '', x))); const th = el('thead'); th.append(h); t.append(th);
          const tb = el('tbody');
          for (const g of p.regels.slice().sort((a, b) => b.open - a.open)) { const r = el('tr'); r.append(el('td', '', g.sku || ''), el('td', 'lw-wrap', g.naam || ''), el('td', 'lw-num', int.format(g.besteld)), el('td', 'lw-num', g.geleverd ? int.format(g.geleverd) : '—'), el('td', 'lw-num', int.format(g.open))); tb.append(r); }
          t.append(tb); td.append(t);
        }
        dr.append(td); out.push(dr);
      }
    }
    ib.replaceChildren(...out);
    document.getElementById('vr-in-n').textContent = `${inp.length} containers`;
    document.getElementById('vr-in-q').textContent = int.format(inp.reduce((a, p) => a + (p.stuks || 0), 0));
    document.getElementById('vr-in-a').textContent = eur0.format(inp.reduce((a, p) => a + p.aanb, 0));
    document.getElementById('vr-in-o').textContent = eur0.format(inp.reduce((a, p) => a + p.open, 0));
    document.getElementById('vr-in-v').textContent = eur0.format(inp.reduce((a, p) => a + p.vracht, 0));
    document.getElementById('vr-in-e').textContent = eur0.format(inp.reduce((a, p) => a + p.totaal, 0));
    document.getElementById('vr-in-k').textContent = rate ? `1 USD = ${new Intl.NumberFormat(nl, { maximumFractionDigits: 4 }).format(rate)} EUR (ECB, ${dNl(fx[0].date)})` : '—';
    const byM = new Map(); for (const p of inp) { if (!p.eta) continue; const m = p.eta.slice(0, 7); const o = byM.get(m) || { a: 0, o: 0, n: 0 }; o.a += p.aanb; o.o += p.open + p.vracht; o.n += 1; byM.set(m, o); }
    const mx = Math.max(1, ...[...byM.values()].map((v) => v.a + v.o));
    const host = document.getElementById('vr-in-m');
    host.replaceChildren(...[...byM.entries()].sort().map(([m, v]) => { const row = el('div', 'lw-funnel-row'); const b = el('div', 'lw-funnel-bar lw-stack'); const f1 = el('div', 'lw-funnel-fill'); f1.style.width = (v.a / mx) * 100 + '%'; f1.style.background = '#1f4b47'; const f2 = el('div', 'lw-funnel-fill'); f2.style.width = (v.o / mx) * 100 + '%'; f2.style.background = '#84bd3f'; b.append(f1, f2); row.title = `${v.n} containers · betaald ${eur0.format(v.a)} · nog te betalen ${eur0.format(v.o)}`; row.append(el('div', '', mNl(m)), b, el('div', 'lw-num', eur0.format(v.a + v.o))); return row; }));
  }

  function renderCont(all, P, fLev, levName) {
    const host = document.getElementById('vr-cont');
    const tt = document.getElementById('vr-cont-t');
    if (!fLev) {
      tt.textContent = 'Containervoorstel';
      host.replaceChildren(el('p', 'lw-note', 'Kies hierboven een leverancier (knop of rij in ‘Per leverancier’) om een containervoorstel te maken: alle producten van die leverancier die nu of binnen 4 weken besteld moeten worden, met de hoeveelheid uit het advies, omgerekend naar CBM en containers.'));
      return;
    }
    const id = fLev;
    tt.textContent = 'Containervoorstel · ' + (levName.get(id) || '');
    const fill = !!P.vr_fill;
    const lnm = String(levName.get(id) || '').toLowerCase();
    const ofLev = (x) => String(x.r.leverancier_id) === fLev || (HERK[x.r.sku] && HERK[x.r.sku].leverancier && lnm.includes(String(HERK[x.r.sku].leverancier).toLowerCase()) && /container/.test(lnm));
    const items = all.filter((x) => ofLev(x) && (x.a.rank <= 2 || (fill && x.cbm && x.a.qtyNu >= 0 && x.r.verkocht_52w > 0))).map((x) => ({ ...x, q: x.a.rank <= 2 ? x.a.qty : 0 }));
    const tg = el('div', 'lw-mini');
    const b1 = el('button', '', 'Alleen het advies'); b1.type = 'button'; b1.setAttribute('aria-pressed', String(!fill)); b1.addEventListener('click', () => dash.setParams({ vr_fill: null }));
    const b2 = el('button', '', 'Container vol maken'); b2.type = 'button'; b2.setAttribute('aria-pressed', String(fill)); b2.addEventListener('click', () => dash.setParams({ vr_fill: 1 }));
    const b3 = el('button', 'vr-btn', 'Download als CSV'); b3.type = 'button'; b3.addEventListener('click', () => csv(items.filter((x) => x.q > 0), levName.get(id)));
    tg.append(b1, b2, b3);
    const parts = [tg];
    // per productielocatie een eigen container (fabrieken laden niet samen)
    const locOf = (x) => (HERK[x.r.sku] && HERK[x.r.sku].locatie) || '';
    const locs = [...new Set(items.map(locOf))].sort();
    for (const loc of locs) {
      const g = items.filter((x) => locOf(x) === loc);
      if (!g.some((x) => x.q > 0) && !fill) continue;
      if (locs.length > 1 || loc) parts.push(el('h3', 'vr-loc', loc ? `Productielocatie ${loc}${LOCNAAM[loc] ? ' · ' + LOCNAAM[loc] : ''}` : 'Locatie onbekend'));
      parts.push(...group(g));
    }
    parts.push(el('p', 'lw-note', `Containermaten: 20ft ${num(P.vr_c20, 28)} cbm, 40ft ${num(P.vr_c40, 58)} cbm, 40ft HQ ${num(P.vr_chq, 67)} cbm netto laadruimte (aan te passen bij Instellingen). ‘Container vol maken’ vult de laatste container aan met de producten die na aankomst het kortst toe kunnen. Aankomst bij bestellen nu: ${dNl(items[0] ? items[0].a.aankomst : null)}.`));
    host.replaceChildren(...parts);
  }

  function group(items) {
    const P = dash.params(); const fill = !!P.vr_fill;
    const T0 = items.reduce((t, x) => t + (x.cbm ? x.q * x.cbm : 0), 0);
    let C = containers(T0, P);
    // container vol maken: steeds 1 stuk erbij van het product dat na aankomst het kortst dekt, tot de laatste container vol is
    let added = 0;
    if (fill && C.cap > 0) {
      let free = C.cap - T0; const cand = items.filter((x) => x.cbm && x.a.perWk > 0);
      for (let n = 0; n < 5000 && cand.length; n++) {
        let best = null, bw = Infinity;
        for (const x of cand) { if (x.cbm > free) continue; const w = (Math.max(0, x.a.atArr) + x.q) / x.a.perWk; if (w < bw) { bw = w; best = x; } }
        if (!best) break; best.q += 1; free -= best.cbm; added += best.cbm;
      }
    }
    const T = T0 + added; C = containers(T, P);
    const noCbm = items.filter((x) => !x.cbm && x.q > 0);
    const eur = items.reduce((t, x) => t + x.q * (x.r.kostprijs || 0), 0);
    const box = el('div', 'vr-cbox');
    box.append(el('div', 'lw-value', `${n1.format(T)} cbm`), el('div', '', C.txt), el('div', 'lw-delta', `${int.format(items.reduce((t, x) => t + x.q, 0))} stuks · ${eur0.format(eur)} inkoopwaarde (huidige kostprijs)`));
    const bar = el('div', 'vr-fill');
    let restT = T; for (const [k, cap] of C.list) { const d = el('div'); const f = Math.min(cap, restT); restT -= f; d.style.width = (cap / Math.max(C.cap, 1)) * 100 + '%'; d.style.background = `linear-gradient(90deg, #84bd3f ${(f / cap) * 100}%, transparent ${(f / cap) * 100}%)`; d.title = `${k}: ${n1.format(f)} van ${cap} cbm`; bar.append(d); }
    const parts = [box, bar];
    if (noCbm.length) parts.push(el('p', 'lw-note lw-bad', `${noCbm.length} producten hebben nog geen CBM en tellen niet mee in de containers. Vul de CBM per stuk hieronder in${isAdmin() ? '' : ' (alleen een beheerder kan dat opslaan)'}.`));
    const tbl = el('table', 'lw-table lw-stocktable'); const th = el('thead'); const hr = el('tr');
    ['Product', 'SKU · art.nr leverancier', 'Status', 'Bestellen', 'CBM/stuk', 'CBM', 'Inkoop', 'Dekt na aankomst'].forEach((h, i) => hr.append(el('th', i >= 3 && i !== 7 ? 'lw-num' : '', h))); th.append(hr); tbl.append(th);
    const tb = el('tbody');
    for (const x of items.filter((x) => x.q > 0 || !x.cbm).sort((a, b) => a.a.rank - b.a.rank || b.q - a.q)) {
      const tr = el('tr');
      const cbTd = el('td', 'lw-num');
      if (isAdmin()) { const i = el('input'); i.type = 'number'; i.step = '0.01'; i.min = 0; i.value = x.cbm ?? ''; i.placeholder = '?'; i.addEventListener('change', () => saveCbm(x.r.sku, i.value === '' ? null : Number(i.value))); cbTd.append(i); }
      else cbTd.textContent = x.cbm ? n2.format(x.cbm) : '?';
      const wk = x.a.perWk > 0 ? (Math.max(0, x.a.atArr) + x.q) / x.a.perWk : null;
      tr.append(el('td', 'lw-wrap', short(x.r.naam)), el('td', '', x.r.sku + (HERK[x.r.sku] ? ' · ' + HERK[x.r.sku].artikel : '')), el('td', '', x.a.status), el('td', 'lw-num', int.format(x.q)), cbTd,
        el('td', 'lw-num', x.cbm ? n1.format(x.q * x.cbm) : '—'), el('td', 'lw-num', eur0.format(x.q * (x.r.kostprijs || 0))), el('td', '', wk == null ? '—' : n1.format(wk) + ' wk'));
      tb.append(tr);
    }
    tbl.append(tb); const tbx = el('div', 'lw-tablebox lw-tablebox-20'); tbx.append(tbl); parts.push(tbx);
    return parts;
  }

  function csv(items, lev) {
    const rowsC = [['SKU', 'Artikelnr leverancier', 'Locatie', 'Product', 'Aantal', 'CBM per stuk', 'CBM totaal', 'Kostprijs', 'Inkoopwaarde']].concat(items.map((x) => [x.r.sku, (HERK[x.r.sku] || {}).artikel || '', (HERK[x.r.sku] || {}).locatie || '', x.r.naam, x.q, x.cbm ?? '', x.cbm ? (x.q * x.cbm).toFixed(2) : '', (x.r.kostprijs || 0).toFixed(2), (x.q * (x.r.kostprijs || 0)).toFixed(2)]));
    const txt = '﻿' + rowsC.map((r) => r.map((v) => { const s = String(v).replace('.', ','); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    a.download = `bestelvoorstel ${lev || ''} ${today()}.csv`; document.body.append(a); a.click(); a.remove();
  }

  // instellingen-velden
  document.querySelectorAll('#vr-set [data-vrp]').forEach((i) => i.addEventListener('change', () => dash.setParams({ [i.dataset.vrp]: i.value === '' ? null : Number(i.value) })));
  dash.onData(() => { try { render(); } catch (e) { console.error('[voorraad]', e); } });
})();
