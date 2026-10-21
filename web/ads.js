// ---------- ads-monitor: Meta en Google (Windsor.ai) + Shopify + ProfitMetrics ----------
dash.calc('ads_weeks', {
  inputs: ['ads_daily', 'ads_campaigns', 'shop_sessions_daily', 'shop_sessions_recent', 'pm_daily'],
  title: 'Ads-uitgaven per week',
  description: 'Meta- en Google-uitgaven per week (zondag t/m zaterdag), opgeteld uit de dagcijfers.',
  fn: (ads_daily) => {
    const wk = new Map();
    for (const r of ads_daily) {
      const t = new Date(r.d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - t.getUTCDay());
      const w = t.toISOString().slice(0, 10);
      const o = wk.get(w) || { week: w, meta: 0, google: 0 };
      o[r.p === 'm' ? 'meta' : 'google'] += Number(r.s) || 0;
      wk.set(w, o);
    }
    return [...wk.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
  },
});
(function () {
  const nl = 'nl-NL';
  const eur0 = new Intl.NumberFormat(nl, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur2 = new Intl.NumberFormat(nl, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = new Intl.NumberFormat(nl, { maximumFractionDigits: 0 });
  const dec1 = new Intl.NumberFormat(nl, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dec2 = new Intl.NumberFormat(nl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct0 = new Intl.NumberFormat(nl, { style: 'percent', maximumFractionDigits: 0 });
  const pct1 = new Intl.NumberFormat(nl, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct2 = new Intl.NumberFormat(nl, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kE = (v) => (Math.abs(v) >= 1e6 ? '€ ' + new Intl.NumberFormat(nl, { maximumFractionDigits: 2 }).format(v / 1e6) + ' mln' : Math.abs(v) >= 1000 ? '€ ' + new Intl.NumberFormat(nl, { maximumFractionDigits: Math.abs(v) >= 100000 ? 0 : 1 }).format(v / 1000) + 'k' : eur0.format(v));
  const DAY = 864e5;
  const P0 = (s) => new Date(s + 'T00:00:00Z');
  const iso = (d) => d.toISOString().slice(0, 10);
  const addD = (s, n) => iso(new Date(P0(s).getTime() + n * DAY));
  const days = (a, b) => Math.round((P0(b) - P0(a)) / DAY) + 1;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
  const dShort = (s) => P0(s).toLocaleDateString(nl, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const mName = (s) => P0(s.slice(0, 7) + '-01').toLocaleDateString(nl, { month: 'long', timeZone: 'UTC' });
  const mShort = (y, mo) => new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(nl, { month: 'short', timeZone: 'UTC' }).replace('.', '');
  const cap = (t) => t.replace(/^./, (c) => c.toUpperCase());
  const mEndOf = (s) => { const d = P0(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const C = { meta: '#1f4b47', google: '#84bd3f', ly: '#9aa7a4', plan: '#f0b429', warn: '#e09a00', bad: '#c0392b', good: '#3d8b2f', soft: '#c8d3cf' };
  const getRows = (n) => { try { const d = dash.data(n); const r = d && (Array.isArray(d) ? d : d.data); return Array.isArray(r) ? r : null; } catch (e) { return null; } };
  const numP = (k, def) => { const v = dash.params()[k]; const n = Number(String(v ?? '').replace(',', '.')); return v === undefined || v === null || v === '' || Number.isNaN(n) ? def : n / 100; };
  const LOCAL = /lokaal|local|store|straal|omgeving|km\b|kilometer|showroom|winkel/i;

  // ---------- data ----------
  function load() {
    const ad = getRows('ads_daily'), camp = getRows('ads_campaigns') || [];
    const ses = (getRows('shop_sessions_daily') || []).concat(getRows('shop_sessions_recent') || []);
    const sd = getRows('shop_sales_daily'), sr = getRows('shop_sales_recent') || [], pm = getRows('pm_daily') || [];
    if (!ad || !sd) return null;
    const A = new Map(); for (const r of ad) { const o = A.get(r.d) || {}; o[r.p] = r; A.set(r.d, o); }
    const S = new Map(); for (const r of sd) S.set(r.day, r); for (const r of sr) S.set(r.day, r);
    const V = new Map(); for (const r of ses) V.set(r.day, r);
    const PM = new Map(); for (const r of pm) PM.set(r.d, r);
    const last = (it, k) => it.reduce((m, r) => (r[k] > m ? r[k] : m), '');
    return { A, S, V, PM, camp, lastAd: last(ad, 'd'), lastSes: last(ses, 'day'), lastPm: last(pm, 'd') };
  }
  function tot(D, from, to) {
    const o = { ms: 0, gs: 0, mi: 0, gi: 0, mc: 0, gc: 0, mcv: 0, gcv: 0, mv: 0, gv: 0, omzet: 0, orders: 0, ses: 0, cmp: 0, sesDays: 0, bw: 0, np: 0, matc: 0, pmOmzet: 0, pmDays: 0, n: 0 };
    for (let d = from; d <= to; d = addD(d, 1)) {
      const a = D.A.get(d) || {}, m = a.m || {}, g = a.g || {};
      o.ms += +m.s || 0; o.gs += +g.s || 0; o.mi += +m.i || 0; o.gi += +g.i || 0; o.mc += +m.c || 0; o.gc += +g.c || 0;
      o.mcv += +m.cv || 0; o.matc += +m.atc || 0; o.gcv += +g.cv || 0; o.mv += +m.v || 0; o.gv += +g.v || 0;
      const s = D.S.get(d); if (s) { o.omzet += +s.omzet || 0; o.orders += +s.orders || 0; }
      const v = D.V.get(d); if (v) { o.ses += +v.sessions || 0; o.cmp += +v.sessions_that_completed_checkout || 0; o.sesDays++; }
      const p = D.PM.get(d); if (p) { o.bw += +p.bw || 0; o.np += +p.np || 0; o.pmOmzet += +p.omzet || 0; o.pmDays++; }
      o.n++;
    }
    o.spend = o.ms + o.gs;
    o.adpct = o.omzet ? o.spend / o.omzet : null;
    o.pmOk = o.pmDays === o.n && o.n > 0;
    o.poas = o.pmOk && o.spend ? o.bw / o.spend : null;
    o.marge = o.pmOk && o.pmOmzet ? o.bw / o.pmOmzet : null;
    o.bwNa = o.pmOk ? o.bw - o.spend : null;
    o.sesOk = o.sesDays === o.n && o.n > 0;
    if (!o.sesOk) o.ses = null;
    o.cr = o.ses ? o.orders / o.ses : null;
    o.cpv = o.ses ? o.spend / o.ses : null;
    o.aov = o.orders ? o.omzet / o.orders : null;
    return o;
  }

  // ---------- budget model ----------
  let E = null;
  const lyCache = new Map(), kCache = new Map();
  function lyRatio(D, s) {
    const ck = s.slice(0, 7); if (lyCache.has(ck)) return lyCache.get(ck);
    const d = P0(ck + '-01'), y = d.getUTCFullYear() - 1, mo = d.getUTCMonth();
    const o = tot(D, iso(new Date(Date.UTC(y, mo, 1))), iso(new Date(Date.UTC(y, mo + 1, 0))));
    const v = o.omzet > 0 && o.spend > 0 ? Math.min(0.3, Math.max(0.03, o.spend / o.omzet)) : 0.1;
    lyCache.set(ck, v); return v;
  }
  const marge = () => numP('ad_marge', 0.48);
  const mKey = (s) => 'ad_pct_' + s.slice(0, 4) + '_' + s.slice(5, 7);
  const isOwn = (s) => { const v = dash.params()[mKey(s)]; return !(v === undefined || v === null || v === ''); };
  const TARGET = 0.083;
  // target ads-% of a month = the ads-% of the same month last year (season pattern; autumn/winter higher, peak lower)
  // norm per calendar month = the ads-% of that month in base year 2026 (a good year); months of 2026 not yet complete use 2025
  const BASE_Y = 2026, normCache = new Map();
  function pctFor(D, s) {
    const mo = Number(s.slice(5, 7)); if (normCache.has(mo)) return normCache.get(mo);
    const first = `${BASE_Y}-${String(mo).padStart(2, '0')}-01`, y = mEndOf(first) <= (D.lastAd || today()) ? BASE_Y : BASE_Y - 1;
    const f = `${y}-${String(mo).padStart(2, '0')}-01`, o = tot(D, f, mEndOf(f));
    const v = o.omzet > 0 && o.spend > 0 ? Math.min(0.3, Math.max(0.03, o.spend / o.omzet)) : TARGET;
    normCache.set(mo, v); return v;
  }
  const shareCache = new Map();
  // Meta share of the ads budget per calendar month, as in 2026; months not yet reached in 2026 use the 2026 year-to-date share
  function shareFor(D, s) {
    const mo = Number(s.slice(5, 7)); if (shareCache.has(mo)) return shareCache.get(mo);
    const f = `${BASE_Y}-${String(mo).padStart(2, '0')}-01`, last = D.lastAd || today();
    const o = f <= last ? tot(D, f, mEndOf(f) < last ? mEndOf(f) : last) : tot(D, `${BASE_Y}-01-01`, last);
    const v = o.spend > 0 ? o.ms / o.spend : 0.5; shareCache.set(mo, v); return v;
  }
  const tgt = (D, from, to) => { let w = 0, t = 0; for (let d = from; d <= to; d = addD(d, 1)) { const b = E.dayBudget(d) || 0; w += b; t += b * pctFor(D, d); } return w ? t / w : pctFor(D, from); };
  const omzetPlan = (from, to) => E.bud(from, to);
  const adPlan = (D, from, to) => { let t = 0; for (let d = from; d <= to; d = addD(d, 1)) t += E.dayBudget(d) * pctFor(D, d); return t; };
  const poasDoel = (D, s) => marge() / pctFor(D, s);


  // ---------- season: where is demand heading the next 3 weeks compared with the last 4? ----------
  // three sources, median: Google search volume per month (Zoekwoordplanner), the budget plan (begroting), and revenue in the same weeks last year
  let seasonCache = null;
  function seasonTrend(D, t) {
    if (seasonCache && seasonCache.t === t) return seasonCache.v;
    const nF = t, nT = addD(t, 20), pF = addD(t, -28), pT = addD(t, -1), src = [];
    const K = getRows('markt_kp') || [], VM = new Map();
    for (const r of K) if (r.groep !== 'ketens') VM.set(r.maand, (VM.get(r.maand) || 0) + (+r.volume || 0));
    if (VM.size >= 12) {
      const mv = (m) => VM.get(m) ?? VM.get(`${+m.slice(0, 4) - 1}${m.slice(4)}`) ?? VM.get(`${+m.slice(0, 4) + 1}${m.slice(4)}`) ?? null;
      const day = (d) => { const m = d.slice(0, 7), v = mv(m); return v == null ? null : v / Number(mEndOf(d).slice(8, 10)); };
      const av = (a, b) => { let s = 0, n = 0; for (let d = a; d <= b; d = addD(d, 1)) { const v = day(d); if (v != null) { s += v; n++; } } return n ? s / n : null; };
      const a = av(nF, nT), b = av(pF, pT); if (a && b) src.push(['zoekvolume', a / b]);
    }
    try { const a = omzetPlan(nF, nT) / 21, b = omzetPlan(pF, pT) / 28; if (a && b) src.push(['begroting', a / b]); } catch (e) { /* no plan */ }
    const ly = (a, b) => { let s = 0, n = 0; for (let d = addD(a, -364); d <= addD(b, -364); d = addD(d, 1)) { const r = D.S.get(d); if (r) { s += +r.omzet || 0; n++; } } return n ? s / n : null; };
    const la = ly(nF, nT), lb = ly(pF, pT); if (la && lb) src.push(['vorig jaar', la / lb]);
    const vals = src.map((x) => x[1]).sort((x, z) => x - z), f = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;
    const v = { f, src, dir: f == null ? 'flat' : f < 0.85 ? 'down' : f < 0.95 ? 'soft' : f >= 1.15 ? 'up' : 'flat' };
    seasonCache = { t, v }; return v;
  }
  const seasonTxt = (S) => (S.f == null ? '' : `vraag komende 3 weken naar verwachting ${S.f >= 1 ? '+' : '−'}${pct0.format(Math.abs(S.f - 1))} t.o.v. de afgelopen 4 weken (${S.src.map(([n, v]) => `${n} ${v >= 1 ? '+' : '−'}${pct0.format(Math.abs(v - 1))}`).join(', ')})`);

  // ---------- opschaalplan: budget leads the omzet plan by two weeks ----------
  const LEAD = 7;
  // ads-% of a week = the ads-% of the same month last year (2026 was a good year: use its pattern as is)
  const pctW = (D, w) => pctFor(D, w);
  // budget for week w: avg of the planned ads for this week and the next two (budget runs ~1 week ahead of demand)
  const rawPlan = (D, w) => { let t = 0; for (let k = 0; k <= 2; k++) { const f = addD(w, 7 * k); t += pctW(D, f) * omzetPlan(f, addD(f, 6)); } return t / 3; };
  function opschaal(D, P) {
    const end = P.end, sun = addD(P.t, -P0(P.t).getUTCDay());
    const rows = [];
    for (let i = -10; i <= 40; i++) {
      const w = addD(sun, i * 7), e = addD(w, 6), fut = i > 0, part = i === 0;
      const l = tot(D, addD(w, -364), addD(e, -364));
      const share = shareFor(D, addD(w, 3)); // Meta/Google split as in the same month of 2026
      const c = fut ? null : tot(D, w, part ? end : e);
      rows.push({ w, e, fut, part, raw: rawPlan(D, w), od: omzetPlan(addD(w, LEAD), addD(w, LEAD + 6)), pct: pctW(D, addD(w, LEAD)), share, l, c });
    }
    // step budget: keep the level until the plan moves 20% or more away from it, so the budget is changed a few times, not every week
    let lvl = null;
    rows.forEach((r) => { if (lvl === null || Math.abs(r.raw / lvl - 1) >= 0.2) lvl = r.raw; r.plan = lvl; });
    // never more than +20% per week: a bigger jump starts earlier and is spread over several weeks
    for (let i = rows.length - 2; i >= 0; i--) if (rows[i].part || rows[i].fut) rows[i].plan = Math.max(rows[i].plan, rows[i + 1].plan / 1.2);
    rows.forEach((r, i) => { const pv = rows[i - 1]; r.chg = pv && pv.plan && Math.abs(r.plan / pv.plan - 1) >= 0.01 ? r.plan / pv.plan - 1 : 0; });
    const now = rows.find((r) => r.part);
    // advice
    const s7 = tot(D, addD(end, -6), end);
    const lp = D.lastPm || end, p7 = tot(D, addD(lp, -6), lp), p28 = tot(D, addD(lp, -27), lp);
    const doel = poasDoel(D, P.t);
    let kind, title, why, rec;
    const pace = now.plan ? s7.spend / now.plan : null;
    const r7 = p7.poas != null ? p7.poas / doel : null, r28 = p28.poas != null ? p28.poas / doel : null;
    const fmtP = `POAS ${p7.poas == null ? '–' : dec1.format(p7.poas)} (7 dagen) en ${p28.poas == null ? '–' : dec1.format(p28.poas)} (28 dagen), doel deze maand ${dec1.format(doel)}`;
    // step size follows how far POAS is from this month's target; the 28-day POAS must agree so one good or bad week does not trigger it
    let step = 0;
    const SZ = seasonTrend(D, P.t), stx = seasonTxt(SZ);
    if (SZ.dir === 'up') {
      // demand rising (spring): scale a bit earlier, and need more proof before cutting (ads lag the demand, attribution comes later)
      if (r7 != null && r28 != null && r28 >= 0.9) step = r7 >= 1.25 && r28 >= 1 ? 0.2 : r7 >= 1 ? 0.1 : 0;
      else if (r28 != null && r28 < 0.7) step = r28 < 0.55 ? -0.2 : (r7 != null && r7 < 0.7 ? -0.1 : 0);
    } else {
      if (r7 != null && r28 != null && r28 >= 1) step = r7 >= 1.25 ? 0.2 : r7 >= 1.1 ? 0.1 : 0;
      else if (r28 != null && r28 < 0.85) step = r28 < 0.7 ? -0.2 : (r7 != null && r7 < 0.85 ? -0.1 : 0);
    }
    // demand falling (after summer, end of year): a good POAS now does not mean extra budget pays off next weeks
    let blocked = 0;
    if (step > 0 && SZ.dir === 'down') { blocked = step; step = 0; }
    else if (step > 0 && SZ.dir === 'soft') { if (step > 0.1 || r7 < 1.25) blocked = step - (r7 >= 1.25 ? 0.1 : 0); step = r7 >= 1.25 ? 0.1 : 0; }
    const base = step > 0 ? Math.max(now.plan, s7.spend) : step < 0 ? Math.min(now.plan, s7.spend) : now.plan;
    rec = base * (1 + step);
    if (step > 0) { kind = 'good'; title = `Opschalen +${pct0.format(step)}`; why = `${fmtP}: ruim erboven, extra budget levert nog genoeg brutowinst op. Eerst bij campagnes die door budget vertoningen missen en bij best verkopende producten met voorraad.`; }
    else if (step < 0) { kind = 'bad'; title = `Afschalen ${pct0.format(step)}`; why = `${fmtP}: eronder, ads kosten meer dan ze opleveren. Zwakste campagnes eerst terugschroeven.`; }
    else if (blocked) { kind = 'ok'; title = 'Houden: seizoen zakt'; why = `${fmtP}: ruim boven doel, maar het seizoen zakt: ${stx}. Extra budget levert de komende weken minder op dan de POAS van nu doet denken; budget volgt het plan omlaag.`; }
    else { kind = 'ok'; title = 'Volg het plan'; why = `${fmtP}: ` + (r7 == null || r28 == null ? 'nog te weinig winstcijfers.' : r28 >= 1 && r7 < 1 ? 'over 28 dagen boven doel, de laatste week eronder; aanhouden en volgende week opnieuw kijken.' : r28 < 1 && r7 >= 1 ? 'laatste week boven doel, over 28 dagen nog niet; aanhouden.' : 'rond doel.'); }
    if (stx && !blocked) why += SZ.dir === 'up' ? ` Seizoen trekt aan: ${stx}; daarom eerder opschalen en pas terugschroeven als de POAS duidelijk tegenvalt.` : SZ.dir === 'soft' ? ` Seizoen zwakt af: ${stx}; daarom hooguit +10%.` : SZ.dir === 'down' && step < 0 ? ` Ook het seizoen zakt: ${stx}.` : '';
    if (pace != null && kind !== 'bad') { if (pace < 0.85) why += ` Uitgaven laatste 7 dagen ${eur0.format(s7.spend)}, ${pct0.format(1 - pace)} onder plan: dagbudgetten verhogen.`; else if (pace > 1.25 && kind !== 'good') why += ` Uitgaven laatste 7 dagen ${eur0.format(s7.spend)}, ${pct0.format(pace - 1)} boven plan.`; }
    const next = rows.find((r) => r.fut && r.chg > 0);
    const vd = document.getElementById('ad-advies'); vd.replaceChildren();
    vd.style.borderColor = kind === 'good' ? '#84bd3f' : kind === 'bad' ? '#c0392b' : '#1f4b47';
    vd.append(el('b', '', `Deze week: ${title} · zet ads op ${eur0.format(rec / 7)} per dag (Meta ${eur0.format(rec / 7 * now.share)}, Google ${eur0.format(rec / 7 * (1 - now.share))})`), el('span', '', why));
    if (next) vd.append(el('span', '', `Volgende opschaalstap: week van ${dShort(next.w)}, plan ${eur0.format(next.plan / 7)} per dag (+${pct0.format(next.chg)}). Campagnes en creatives een week ervoor klaar hebben. Verhoog per campagne niet meer dan 20% per keer en wacht 3–4 dagen tussen verhogingen (leerfase Meta en Google).`));
    // tiles
    const host = document.getElementById('ad-adv-tiles'); host.replaceChildren();
    const peak = rows.filter((r) => r.fut).reduce((m, r) => (r.plan > m.plan ? r : m), { plan: 0 });
    [['Plan deze week', eur0.format(now.plan), `${eur0.format(now.plan / 7)} per dag · voor omzetdoel ${eur0.format(now.od)} volgende week`],
     ['Uitgegeven laatste 7 dagen', eur0.format(s7.spend), `${eur0.format(s7.spend / 7)} per dag (Meta ${eur0.format(s7.ms / 7)}, Google ${eur0.format(s7.gs / 7)})` + (pace == null ? '' : ` · ${pct0.format(pace)} van plan`), pace == null ? '' : pace < 0.85 || pace > 1.25 ? 'bad' : 'good'],
     ['POAS laatste 7 dagen', p7.poas == null ? '–' : dec2.format(p7.poas), `doel ${dec1.format(doel)} · 28 dagen ${p28.poas == null ? '–' : dec1.format(p28.poas)}`, p7.poas == null ? '' : p7.poas >= doel ? 'good' : 'bad'],
     ['Piek in het plan', peak.w ? eur0.format(peak.plan) : '–', peak.w ? `week van ${dShort(peak.w)} · ${eur0.format(peak.plan / 7)} per dag` : ''],
    ].forEach(([l, v, sub, st]) => { const t = el('div', 'ad-kpi ad-kpi-main' + (st ? ' ad-kpi-' + st : '')); t.append(el('div', 'ad-kpi-l', l), el('div', 'ad-kpi-v', v), el('div', 'ad-kpi-s', sub)); host.append(t); });
    const pS = p28.poas == null ? null : `POAS ${dec1.format(p28.poas)} (doel ${dec1.format(doel)})`, sS = SZ.f == null ? '' : `vraag komende 3 weken ${SZ.f >= 1 ? '+' : '−'}${pct0.format(Math.abs(SZ.f - 1))}`;
    const short = !pS ? 'Nog te weinig winstcijfers.' : kind === 'good' ? `${pS} ruim boven doel${SZ.dir === 'up' ? ` en ${sS}` : ''}: extra budget levert nog genoeg op.` : kind === 'bad' ? `${pS} onder doel: ads kosten meer dan ze opleveren.` : blocked ? `${pS} ruim boven doel, maar ${sS}: extra budget levert straks minder op.` : `${pS}${sS && SZ.dir !== 'flat' ? `, ${sS}` : ''}: niets aan veranderen.`;
    lastPlan = rows; lastAdv = { kind, title, rec, now, why, short, next, dag: s7.spend / 7 };
    saveOpschaal(rows, { title, rec, why, short, share: now.share, next });
  }
  let lastPlan = null, lastAdv = null;
  function opschaalChart() {
    if (!lastPlan) return;
    const box = document.getElementById('ad-ch-plan');
    const W = lastPlan.map((r) => ({ ...r }));
    const g = chartBase(box, W, Math.max(...W.map((r) => Math.max(r.plan, r.c ? r.c.spend : 0, r.l.spend))), kE, 260);
    W.forEach((r) => {
      const bx = g.x(r.w), bw = g.x.bandwidth();
      if (r.c) { g.svg.append('rect').attr('x', bx).attr('width', bw).attr('y', g.y(r.c.gs)).attr('height', g.y(0) - g.y(r.c.gs)).attr('fill', C.google).attr('opacity', r.part ? 0.6 : 1); g.svg.append('rect').attr('x', bx).attr('width', bw).attr('y', g.y(r.c.spend)).attr('height', g.y(r.c.gs) - g.y(r.c.spend)).attr('fill', C.meta).attr('opacity', r.part ? 0.6 : 1); }
      else g.svg.append('rect').attr('x', bx + 0.5).attr('width', bw - 1).attr('y', g.y(r.plan)).attr('height', g.y(0) - g.y(r.plan)).attr('fill', 'rgba(132,189,63,.18)').attr('stroke', C.google).attr('stroke-dasharray', '3 2');
      g.svg.append('line').attr('x1', bx - 2).attr('x2', bx + bw + 2).attr('y1', g.y(r.plan)).attr('y2', g.y(r.plan)).attr('stroke', C.plan).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
      if (r.fut && r.chg > 0) g.svg.append('text').attr('x', bx + bw / 2).attr('y', g.y(r.plan) - 5).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 700).attr('fill', '#3d8b2f').text('▲');
    });
    g.svg.append('path').datum(W).attr('d', pathOf(g, (r) => r.l.spend)).attr('fill', 'none').attr('stroke', C.ly).attr('stroke-width', 1.6).attr('stroke-dasharray', '4 3');
    hover(box, g, W, (r) => [[C.plan, 'Plan', `${eur0.format(r.plan)} (${eur0.format(r.plan / 7)}/dag)`], [null, 'Ads-% plan', pct1.format(r.pct)], [null, 'Omzetdoel volgende week', eur0.format(r.od)], ...(r.c ? [[C.meta, 'Meta', eur0.format(r.c.ms)], [C.google, 'Google', eur0.format(r.c.gs)], [null, 'POAS', r.c.poas == null ? '–' : dec2.format(r.c.poas)]] : []), [C.ly, 'Vorig jaar', eur0.format(r.l.spend)]]);
    legend('ad-leg-plan', [[C.meta, 'Meta'], [C.google, 'Google'], [C.plan, 'Plan', 'tick'], [C.google, 'Plan komende weken', 'dash'], [C.ly, 'Vorig jaar', 'line']]);
  }
  // the plan is also saved to the artifact db so the Monday message can quote it
  let opDb, opSaved = '', opT;
  function saveOpschaal(rows, adv) {
    clearTimeout(opT);
    opT = setTimeout(async () => {
      try {
        if (opDb === undefined) opDb = window.claude && window.claude.use ? await window.claude.use('db') : null;
        if (!opDb) return;
        const weken = rows.filter((r) => r.part || r.fut).slice(0, 30).map((r) => ({ week: r.w, plan_week: Math.round(r.plan), per_dag: Math.round(r.plan / 7), meta_dag: Math.round(r.plan / 7 * r.share), google_dag: Math.round(r.plan / 7 * (1 - r.share)), omzetdoel_volgende_week: Math.round(r.od), actie: r.chg > 0 ? 'verhogen' : r.chg < 0 ? 'verlagen' : '' }));
        const body = { weken, advies: { titel: adv.title, per_dag: Math.round(adv.rec / 7), meta_dag: Math.round(adv.rec / 7 * adv.share), google_dag: Math.round(adv.rec / 7 * (1 - adv.share)), toelichting: adv.short || adv.why }, doel_pct: pctFor(D, P.t), lead_dagen: LEAD };
        const js = JSON.stringify(body); if (js === opSaved) return;
        await opDb.doc('ads/opschaalplan').set({ ...body, at: new Date().toISOString() }); opSaved = js;
      } catch (e) { /* best effort */ }
    }, 1500);
  }

  // ---------- this month: pilot + verdict ----------
  function pilot(D, P) {
    const host = document.getElementById('ad-pilot'); host.replaceChildren();
    const t = P.t, y = P.end, mFrom = t.slice(0, 8) + '01', mEnd = mEndOf(t);
    const hasDays = y >= mFrom;
    const cur = hasDays ? tot(D, mFrom, y) : tot(D, mFrom, mFrom);
    const oDoel = omzetPlan(mFrom, mEnd), oTD = hasDays ? omzetPlan(mFrom, y) : 0;
    const aBud = adPlan(D, mFrom, mEnd), aTD = hasDays ? adPlan(D, mFrom, y) : 0;
    const left = days(addD(y, 1), mEnd);
    const oRatio = oTD ? cur.omzet / oTD : 1;
    const oProj = cur.omzet + omzetPlan(addD(y, 1), mEnd) * Math.max(0.5, Math.min(1.5, oRatio));
    const pace7 = tot(D, addD(y, -6), y).spend / 7;
    const aProj = cur.spend + pace7 * left;
    const pct = pctFor(D, t), pd = poasDoel(D, t);
    const poas7 = tot(D, addD(y, -6), y).poas, poas28 = tot(D, addD(y, -27), y).poas;
    const yF = y.slice(0, 4) + '-01-01', poasY = tot(D, yF, y).poas, pdY = marge() / tgt(D, yF, y);
    document.getElementById('ad-month-t').textContent = `${cap(mName(t))}: stand t/m ${dShort(y)}`;
    const card = (title, big, sub, rows, ratio, okIfHigh) => {
      const c = el('div', 'lw-card ad-pcard');
      c.append(el('div', 'ad-ptitle', title), el('div', 'ad-pbig', big));
      if (sub) c.append(el('div', 'ad-psub', sub));
      if (ratio != null) {
        const bar = el('div', 'bg-track bg-track-big'); const f = el('i', (okIfHigh ? ratio >= 0.97 : ratio <= 1.1) ? 'bg-ok' : 'bg-low');
        f.style.width = Math.min(100, Math.max(0, ratio * 100)) + '%'; bar.append(f); c.append(bar);
      }
      const kv = el('div', 'ad-kv'); rows.forEach(([a, b, cls]) => { kv.append(el('span', '', a)); kv.append(el('b', cls || '', b)); }); c.append(kv);
      host.append(c);
    };
    card('Omzet', eur0.format(cur.omzet), `van maanddoel ${eur0.format(oDoel)}`, [
      [`Volgens plan t/m ${dShort(y)}`, `${eur0.format(oTD)} · ${oTD ? pct0.format(oRatio) : '–'}`, oRatio >= 0.97 ? 'lw-good' : 'lw-bad'],
      ['Prognose eind maand', `${eur0.format(oProj)} (${pct0.format(oDoel ? oProj / oDoel : 0)} van doel)`, oProj >= oDoel * 0.97 ? 'lw-good' : 'lw-bad'],
      [`Nog nodig (${left} dagen)`, `${eur0.format(Math.max(0, oDoel - cur.omzet))} · ${eur0.format(left ? Math.max(0, oDoel - cur.omzet) / left : 0)}/dag`],
    ], oDoel ? cur.omzet / oDoel : null, true);
    const oProjPct = oProj ? aProj / oProj : null;
    card('Ads-uitgaven', eur0.format(cur.spend), `Meta ${eur0.format(cur.ms)} · Google ${eur0.format(cur.gs)}`, [
      ['Tempo laatste 7 dagen', `${eur0.format(pace7)}/dag`],
      ['Prognose eind maand bij dit tempo', eur0.format(aProj)],
      ['Ads % van omzet eind maand (prognose)', oProjPct == null ? '–' : pct1.format(oProjPct), oProjPct == null ? '' : oProjPct <= pct * 1.1 ? 'lw-good' : 'lw-bad'],
    ], null);
    card('Rendement (POAS)', cur.poas == null ? '–' : eur2.format(cur.poas), cur.poas == null ? 'nog geen ProfitMetrics-cijfers' : `brutowinst per € 1 ads · doel ${eur2.format(pd)}`, [
      ['Ads % van omzet deze maand', cur.adpct == null ? '–' : `${pct1.format(cur.adpct)} · doel ${pct1.format(pct)}`, cur.adpct == null ? '' : cur.adpct <= pct * 1.1 ? 'lw-good' : 'lw-bad'],
      ['Laatste 7 dagen (per € 1 ads)', poas7 == null ? '–' : eur2.format(poas7), poas7 == null ? '' : poas7 >= pd ? 'lw-good' : 'lw-bad'],
      ['Laatste 28 dagen (per € 1 ads)', poas28 == null ? '–' : eur2.format(poas28), poas28 == null ? '' : poas28 >= pd ? 'lw-good' : 'lw-bad'],
      [`Dit jaar t/m ${dShort(y)} (per € 1 ads)`, poasY == null ? '–' : eur2.format(poasY), poasY == null ? '' : poasY >= pdY ? 'lw-good' : 'lw-bad'],
      ['Doel POAS dit jaar (gewogen naar omzet)', eur2.format(pdY)],
      ['Brutowinst na ads', cur.bwNa == null ? '–' : eur0.format(cur.bwNa) + (cur.marge ? ` (marge ${pct1.format(cur.marge)})` : '')],
      ...(cur.pmOk ? [['Nettowinst t/m ' + dShort(y) + ' (ProfitMetrics)', eur0.format(cur.np), cur.np >= 0 ? 'lw-good' : 'lw-bad']] : []),
    ], null);
    // verdict
    const v = document.getElementById('ad-verdict'); v.replaceChildren();
    const poasNow = poas28 ?? cur.poas;
    // seasonal tolerance: in months where last year's ads-% was higher than 8% (autumn/winter) that level is acceptable
    const lyP = lyRatio(D, t), sp = Math.max(pct, lyP), spd = marge() / sp;
    let lvl, head, why;
    const behind = oRatio < 0.95, ahead = oRatio > 1.05, adHigh = cur.adpct != null && cur.adpct > sp * 1.1, poasOk = poasNow != null && poasNow >= spd, poasStrong = poasNow != null && poasNow >= pd * 1.2;
    if (behind && poasOk) { lvl = 'up'; head = 'Opschalen'; why = `Omzet loopt achter (${pct0.format(oRatio)} van plan), terwijl ads rendabel zijn (POAS ${dec1.format(poasNow)} ≥ doel ${dec1.format(pd)}). Verhoog het budget in de best renderende campagnes, begin bij campagnes die vertoningen verliezen door budget.`; }
    else if (behind && !poasOk) { lvl = 'fix'; head = 'Bijsturen'; why = `Omzet loopt achter (${pct0.format(oRatio)} van plan) en ads renderen onder doel (POAS ${poasNow == null ? '–' : dec1.format(poasNow)} < ${dec1.format(pd)}). Meer budget lost dit niet op: kijk naar aanbod en prijzen, creatives, zoektermen en de campagnes zonder rendement.`; }
    else if (adHigh && !poasOk) { lvl = 'down'; head = 'Afschalen'; why = `Ads ${pct1.format(cur.adpct)} van omzet (doel ${pct1.format(pct)}, ${mName(t)} vorig jaar ${pct1.format(lyP)}) bij POAS ${poasNow == null ? '–' : dec1.format(poasNow)}. Verlaag het budget van de zwakste campagnes tot het weer in de pas loopt.`; }
    else if (poasStrong && !adHigh) { lvl = 'up'; head = 'Ruimte om op te schalen'; why = `Omzet ${ahead ? 'loopt voor' : 'op koers'} (${pct0.format(oRatio)} van plan) en POAS ${dec1.format(poasNow)} ligt ruim boven doel ${dec1.format(pd)}. Extra budget levert waarschijnlijk winstgevende omzet op.`; }
    else { lvl = 'hold'; head = 'Op koers: vasthouden'; why = `Omzet ${pct0.format(oRatio)} van plan, ads ${cur.adpct == null ? '–' : pct1.format(cur.adpct)} van omzet (doel ${pct1.format(pct)}; ${mName(t)} vorig jaar ${pct1.format(lyP)}, in dit seizoen normaal hoger), POAS ${poasNow == null ? '–' : dec1.format(poasNow)} (doel ${dec1.format(pd)}).`; }
    v.className = 'ad-verdict ad-v-' + lvl;
    v.append(el('b', '', head), el('span', '', why));
    return { cur, oDoel, oTD, oProj, aBud, aTD, aProj, pace7, pct, pd, poas7, poas28, oRatio, left, mFrom };
  }


  // ---------- another month: targets (future) or result (past) ----------
  function monthView(D, P, m) {
    const host = document.getElementById('ad-pilot'); host.replaceChildren();
    const from = m + '-01', end = mEndOf(from), fut = from > P.end, yr = from.slice(0, 4);
    const label = cap(mName(from)) + ' ' + yr;
    const oDoel = omzetPlan(from, end), pct = pctFor(D, from), pd = marge() / pct, aDoel = oDoel * pct, nd = days(from, end);
    const lyF = `${Number(yr) - 1}-${from.slice(5)}`, ly = tot(D, lyF, mEndOf(lyF));
    let plan = 0; if (lastPlan) for (const r of lastPlan) for (let k = 0; k < 7; k++) { const d = addD(r.w, k); if (d >= from && d <= end) plan += r.plan / 7; }
    const card = (title, big, sub, rows) => {
      const c = el('div', 'lw-card ad-pcard'); c.append(el('div', 'ad-ptitle', title), el('div', 'ad-pbig', big)); if (sub) c.append(el('div', 'ad-psub', sub));
      const kv = el('div', 'ad-kv'); rows.forEach(([a, b, cls]) => { kv.append(el('span', '', a)); kv.append(el('b', cls || '', b)); }); c.append(kv); host.append(c);
    };
    const v = document.getElementById('ad-verdict'); v.replaceChildren();
    if (fut) {
      document.getElementById('ad-month-t').textContent = `${label}: doelen`;
      card('Omzetdoel', eur0.format(oDoel), 'begroting uit het weekrapport', [
        [`${cap(mName(from))} ${Number(yr) - 1}`, ly.omzet ? eur0.format(ly.omzet) : '–'],
        ['Groei', ly.omzet ? (oDoel / ly.omzet - 1 >= 0 ? '+' : '') + pct0.format(oDoel / ly.omzet - 1) : '–'],
        ['Gemiddeld per dag', eur0.format(oDoel / nd)],
      ]);
      card('Ads-budget', eur0.format(aDoel), `${pct1.format(pct)} van de omzet (norm voor ${mName(from)})`, [
        ['Gemiddeld per dag', `${eur0.format(aDoel / nd)} (Meta ${eur0.format(aDoel / nd * shareFor(D, from))}, Google ${eur0.format(aDoel / nd * (1 - shareFor(D, from)))})`],
        ['Volgens opschaalplan (week vooruit)', plan ? `${eur0.format(plan)} · ${eur0.format(plan / nd)}/dag` : 'nog buiten het plan'],
        [`Uitgegeven ${mName(from)} ${Number(yr) - 1}`, ly.spend ? `${eur0.format(ly.spend)} (${ly.adpct == null ? '–' : pct1.format(ly.adpct)})` : '–'],
      ]);
      card('Rendement (POAS-doel)', dec1.format(pd), `minimale brutowinst per euro ads (${pct0.format(marge())} marge ÷ ${pct1.format(pct)})`, [
        ['Verwachte brutowinst', eur0.format(oDoel * marge())],
        ['Brutowinst na ads', eur0.format(oDoel * marge() - aDoel)],
        [`POAS ${mName(from)} ${Number(yr) - 1}`, ly.poas == null ? '–' : dec1.format(ly.poas)],
      ]);
      v.className = 'ad-verdict ad-v-hold';
      v.append(el('b', '', `Doelen ${label}`), el('span', '', `Omzet ${eur0.format(oDoel)}, ads rond ${eur0.format(aDoel)} (${pct1.format(pct)}, gemiddeld ${eur0.format(aDoel / nd)} per dag), POAS minimaal ${dec1.format(pd)}. Ligt de POAS die maand ruim hoger, dan zegt het opschaalplan wekelijks hoeveel er bij kan.`));
    } else {
      const o = tot(D, from, end < P.end ? end : P.end);
      document.getElementById('ad-month-t').textContent = `${label}: resultaat`;
      card('Omzet', eur0.format(o.omzet), `van maanddoel ${eur0.format(oDoel)}`, [
        ['Behaald', oDoel ? pct0.format(o.omzet / oDoel) : '–', o.omzet >= oDoel ? 'lw-good' : 'lw-bad'],
        [`${cap(mName(from))} ${Number(yr) - 1}`, ly.omzet ? `${eur0.format(ly.omzet)} (${(o.omzet / ly.omzet - 1 >= 0 ? '+' : '') + pct0.format(o.omzet / ly.omzet - 1)})` : '–'],
      ]);
      card('Ads-uitgaven', eur0.format(o.spend), `Meta ${eur0.format(o.ms)} · Google ${eur0.format(o.gs)}`, [
        ['Gemiddeld per dag', eur0.format(o.spend / nd)],
        ['Ads % van omzet', o.adpct == null ? '–' : `${pct1.format(o.adpct)} · doel ${pct1.format(pct)}`, o.adpct == null ? '' : o.adpct <= pct * 1.1 ? 'lw-good' : 'lw-bad'],
      ]);
      card('Rendement (POAS)', o.poas == null ? '–' : dec1.format(o.poas), `doel ${dec1.format(pd)}`, [
        ['Brutowinst na ads', o.bwNa == null ? '–' : eur0.format(o.bwNa) + (o.marge ? ` (marge ${pct1.format(o.marge)})` : '')],
        [`POAS ${mName(from)} ${Number(yr) - 1}`, ly.poas == null ? '–' : dec1.format(ly.poas)],
      ]);
      const ok = o.omzet >= oDoel, eff = o.poas == null || o.poas >= pd;
      v.className = 'ad-verdict ad-v-' + (ok && eff ? 'up' : ok || eff ? 'hold' : 'down');
      v.append(el('b', '', `${label}: ${ok ? 'omzetdoel gehaald' : 'omzetdoel niet gehaald'}`), el('span', '', `Omzet ${eur0.format(o.omzet)} (${oDoel ? pct0.format(o.omzet / oDoel) : '–'} van doel), ads ${o.adpct == null ? '–' : pct1.format(o.adpct)} van omzet (doel ${pct1.format(pct)}), POAS ${o.poas == null ? '–' : dec1.format(o.poas)} (doel ${dec1.format(pd)}).`));
    }
  }

  // ---------- year table ----------
  function yearTable(D, P) {
    const ty = Number(P.t.slice(0, 4)), tmo = Number(P.t.slice(5, 7));
    const yr = Number(dash.params().ad_jaar) || ty;
    document.getElementById('ad-year').textContent = yr;
    const tb = document.getElementById('ad-ytable'); tb.replaceChildren();
    const cols = ['Maand', 'Omzetdoel', 'Omzet', 'Behaald', 'Ads', 'Ads % omzet', 'Doel ads %', 'POAS', 'Doel POAS', 'Brutowinst na ads', `Ads % ${yr - 1}`, `POAS ${yr - 1}`];
    const hr = el('tr'); cols.forEach((c, i) => hr.append(el('th', i ? 'lw-num' : '', c)));
    const th = el('thead'); th.append(hr); tb.append(th);
    const bd = el('tbody');
    const T = { od: 0, om: 0, sp: 0, bw: 0, bwOk: true, odTD: 0, any: false, tg: 0 };
    for (let mo = 1; mo <= 12; mo++) {
      const from = `${yr}-${String(mo).padStart(2, '0')}-01`, end = mEndOf(from);
      const isCur = yr === ty && mo === tmo, isFut = yr > ty || (yr === ty && mo > tmo);
      const stop = isCur ? P.end : end;
      const od = omzetPlan(from, end);
      const o = !isFut && stop >= from ? tot(D, from, stop) : null;
      const lyF = `${yr - 1}-${from.slice(5)}`, ly = tot(D, lyF, mEndOf(lyF));
      const tr = el('tr', isCur ? 'bg-cur' : isFut ? 'bg-fut' : '');
      tr.append(el('td', '', cap(mShort(yr, mo)) + (isCur ? ' (lopend)' : '')), el('td', 'lw-num', eur0.format(od)), el('td', 'lw-num', o ? eur0.format(o.omzet) : '—'));
      const beh = el('td', 'lw-num', o && od ? pct0.format(o.omzet / od) : '—'); if (o && !isCur) beh.classList.add(o.omzet >= od ? 'lw-good' : 'lw-bad'); tr.append(beh);
      tr.append(el('td', 'lw-num', o ? eur0.format(o.spend) : '—'));
      const ap = el('td', 'lw-num', o && o.adpct != null ? pct1.format(o.adpct) : '—'); const mt = pctFor(D, from); if (o && o.adpct != null) { ap.classList.add(o.adpct <= mt * 1.1 ? 'lw-good' : o.adpct <= mt * 1.3 ? 'ad-under' : 'lw-bad'); ap.title = `doel ${pct1.format(mt)} (norm per maand, zie uitleg)`; }
      tr.append(ap, el('td', 'lw-num bg-muted', pct1.format(mt)));
      const po = el('td', 'lw-num', o && o.poas != null ? dec1.format(o.poas) : '—'); if (o && o.poas != null) po.classList.add(o.poas >= marge() / mt ? 'lw-good' : 'lw-bad'); tr.append(po, el('td', 'lw-num bg-muted', dec1.format(marge() / mt)));
      tr.append(el('td', 'lw-num', o && o.bwNa != null ? eur0.format(o.bwNa) : '—'), el('td', 'lw-num bg-muted', ly.adpct == null ? '—' : pct1.format(ly.adpct)), el('td', 'lw-num bg-muted', ly.poas == null ? '—' : dec1.format(ly.poas)));
      bd.append(tr);
      T.od += od;
      if (o) { T.any = true; T.om += o.omzet; T.sp += o.spend; T.tg += pctFor(D, from) * o.omzet; T.odTD += isCur ? omzetPlan(from, stop) : od; if (o.bwNa == null) T.bwOk = false; else T.bw += o.bwNa; }
    }
    tb.append(bd);
    const tf = el('tfoot'), tr = el('tr');
    const yp = T.any && T.om ? T.sp / T.om : null;
    const tdp = el('td', 'lw-num', yp == null ? '—' : pct1.format(yp)); const yt = T.om ? T.tg / T.om : TARGET; if (yp != null) { tdp.classList.add(yp <= yt * 1.05 ? 'lw-good' : 'lw-bad'); tdp.title = `doel ${pct1.format(yt)}`; }
    tr.append(el('td', '', 'Jaar t/m nu'), el('td', 'lw-num', eur0.format(T.odTD)), el('td', 'lw-num', T.any ? eur0.format(T.om) : '—'), el('td', 'lw-num', T.any && T.odTD ? pct0.format(T.om / T.odTD) : '—'), el('td', 'lw-num', T.any ? eur0.format(T.sp) : '—'), tdp, el('td', 'lw-num bg-muted', T.any ? pct1.format(yt) : '—'), el('td', 'lw-num', T.any && T.sp && T.bwOk ? dec1.format((T.bw + T.sp) / T.sp) : '—'), el('td', 'lw-num bg-muted', T.any ? dec1.format(marge() / yt) : '—'), el('td', 'lw-num', T.any && T.bwOk ? eur0.format(T.bw) : '—'), el('td'), el('td'));
    tf.append(tr); tb.append(tf);
    return yr;
  }

  // ---------- weekly charts ----------
  function chartBase(box, W, maxV, fmtY, H = 230) {
    box.querySelectorAll('svg,.ad-tip').forEach((n) => n.remove());
    const Wd = Math.max(300, box.clientWidth), top = 10, bot = H - 24;
    const y = d3.scaleLinear([0, maxV * 1.08 || 1], [bot, top]).nice();
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${Wd} ${H}`).attr('height', H);
    const probe = svg.append('text').attr('font-size', 11).text(fmtY(y.domain()[1])); const left = Math.ceil(probe.node().getComputedTextLength()) + 12; probe.remove();
    const x = d3.scaleBand(W.map((w) => w.w), [left, Wd - 30]).padding(0.22);
    const ticks = y.ticks(4);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', left).attr('x2', Wd - 30).attr('y1', y).attr('y2', y).attr('stroke', 'var(--cds-chart-grid)');
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', left - 6).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(fmtY);
    const nowW = W.find((w) => w.part);
    if (nowW) { const xx = x(nowW.w) + x.bandwidth() + (x.step() - x.bandwidth()) / 2; svg.append('line').attr('x1', xx).attr('x2', xx).attr('y1', top - 4).attr('y2', bot).attr('stroke', '#1f4b47').attr('stroke-dasharray', '2 3').attr('stroke-opacity', 0.5); svg.append('text').attr('x', xx + 4).attr('y', top + 6).attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text('vooruit →'); }
    const every = Math.ceil(W.length / Math.max(1, Math.floor((Wd - left) / 46)));
    svg.append('g').selectAll('text').data(W.filter((_, i) => i % every === 0)).join('text').attr('x', (w) => x(w.w) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle').attr('font-size', 10.5).attr('fill', 'var(--color-fg-muted)').text((w) => dShort(w.w));
    const tip = el('div', 'lw-tip ad-tip'); tip.style.display = 'none'; box.append(tip);
    return { svg, x, y, H, tip, Wd, bot, cx: (w) => x(w.w) + x.bandwidth() / 2 };
  }
  function hover(box, g, W, rowsFn) {
    g.svg.append('g').selectAll('rect').data(W).join('rect').attr('x', (w) => g.x(w.w) - (g.x.step() - g.x.bandwidth()) / 2).attr('width', g.x.step()).attr('y', 0).attr('height', g.H).attr('fill', 'transparent')
      .on('mousemove', (ev, w) => {
        const [px, py] = d3.pointer(ev, box);
        g.tip.replaceChildren(el('div', 'lw-tip-h', `Week ${dShort(w.w)} – ${dShort(w.e)}${w.part ? ' (t/m gisteren)' : w.fut ? ' (begroot)' : ''}`));
        rowsFn(w).forEach(([c, a, b]) => { const r = el('div'); if (c) { const s = el('span', 'lw-sw'); s.style.background = c; r.append(s); } r.append(document.createTextNode(a + ': '), el('b', '', b)); g.tip.append(r); });
        g.tip.style.display = 'block';
        const tw = g.tip.offsetWidth || 190; g.tip.style.left = Math.min(Math.max(0, px + 12), box.clientWidth - tw) + 'px'; g.tip.style.top = Math.max(0, py - 60) + 'px';
      })
      .on('mouseleave', () => { g.tip.style.display = 'none'; });
  }
  function legend(id, items) { const L = document.getElementById(id); L.replaceChildren(); for (const [c, l, kind] of items) { const s = el('span'); const sw = el('span', 'lw-sw'); sw.style.background = c; if (kind === 'line') { sw.style.height = '2px'; sw.style.width = '14px'; sw.style.verticalAlign = 'middle'; } if (kind === 'tick') { sw.style.height = '3px'; sw.style.width = '12px'; sw.style.verticalAlign = 'middle'; } if (kind === 'dash') { sw.style.background = 'transparent'; sw.style.border = '1.5px dashed ' + c; sw.style.boxSizing = 'border-box'; } s.append(sw, document.createTextNode(l)); L.append(s); } }
  const pathOf = (g, f, yS) => d3.line().defined((w) => f(w) != null).x(g.cx).y((w) => (yS || g.y)(f(w)));

  // ---------- season plan + playbook ----------

  // ---------- signals ----------
  function campAgg(D, from, to) {
    const out = new Map();
    for (const r of D.camp) {
      if (r.d < from || r.d > to) continue;
      const k = r.p + ':' + r.id;
      const o = out.get(k) || { p: r.p, id: r.id, n: r.n, t: r.t, st: r.st, b: null, bd: '', s: 0, i: 0, c: 0, cv: 0, v: 0, fW: 0, lbW: 0, isN: 0 };
      o.s += +r.s || 0; o.i += +r.i || 0; o.c += +r.c || 0; o.cv += +r.cv || 0; o.v += +r.v || 0;
      if (r.d >= o.bd) { o.bd = r.d; o.b = r.b; o.st = r.st; o.n = r.n; }
      if (r.f) o.fW = Math.max(o.fW, +r.f);
      if (r.is != null && r.i) { o.lbW += (r.lb || 0) * r.i; o.isN += +r.i; }
      out.set(k, o);
    }
    for (const o of out.values()) { o.roas = o.s ? o.v / o.s : null; o.cpc = o.c ? o.s / o.c : null; o.lb = o.isN ? o.lbW / o.isN : null; }
    return out;
  }
  function signals(D, P, M, camps, X) {
    const out = [];
    const y = P.end;
    // month pacing
    if (M.oRatio < 0.95) out.push([0, `Omzet ${mName(P.t)} loopt achter: ${eur0.format(M.cur.omzet)} tegen ${eur0.format(M.oTD)} volgens plan (${pct0.format(M.oRatio)}); prognose eind maand ${eur0.format(M.oProj)} van ${eur0.format(M.oDoel)}.`]);
    if (M.cur.adpct != null && M.cur.adpct > pctFor(D, P.t) * 1.3) out.push([1, `Ads deze maand ${pct1.format(M.cur.adpct)} van de omzet (doel ${pct1.format(pctFor(D, P.t))}, norm voor deze maand).`]);
    // POAS
    if (M.poas28 != null && M.poas28 < M.pd * 0.85) out.push([0, `POAS laatste 28 dagen ${dec1.format(M.poas28)}, doel ${dec1.format(M.pd)}: elke euro ads levert te weinig brutowinst. Zwakke campagnes afschalen of verbeteren.`]);
    else if (M.poas7 != null && M.poas28 != null && M.poas7 < M.poas28 * 0.75) out.push([1, `POAS zakt: ${dec1.format(M.poas7)} laatste 7 dagen tegen ${dec1.format(M.poas28)} over 28 dagen.`]);
    // visitors vs LY vs growth target
    const a = tot(D, addD(y, -6), y), b = tot(D, addD(y, -370), addD(y, -364));
    if (a.ses != null && b.ses) {
      const g = a.ses / b.ses - 1, target = E.growth(Number(y.slice(0, 4)), Number(y.slice(5, 7)));
      if (g < target - 0.1) out.push([g < 0 ? 0 : 1, `Bezoekers laatste 7 dagen ${g >= 0 ? '+' : '−'}${pct0.format(Math.abs(g))} t.o.v. vorig jaar, begroting vraagt +${pct0.format(target)}. Meer bereik nodig.`]);
    }
    const c28 = tot(D, addD(y, -34), addD(y, -7));
    if (a.cr != null && c28.cr && a.cr / c28.cr < 0.8) out.push([1, `Conversieratio ${pct2.format(a.cr)} laatste 7 dagen tegen ${pct2.format(c28.cr)} in de 4 weken ervoor. Check levertijden, prijzen, voorraad van toppers en de site.`]);
    // campaigns
    for (const r of camps) {
      const loc = LOCAL.test(r.n);

    }
    if (X && X.rend && X.rend.lastUp && X.rend.lastUp.kind === 'down') out.push([0, `Laatste budgetverhoging (${dShort(X.rend.lastUp.d)}) rendeerde niet: elke extra € ads bracht ±${eur2.format(X.rend.lastUp.marg)} brutowinst. Niet verder opschalen tot dit beter is.`]);
    out.sort((x, z) => x[0] - z[0]);
    return out;
  }

  // ---------- period tiles ----------
  function period(D) {
    const per = dash.params().ad_per || 'd28';
    const t = today(), y = addD(t, -1);
    const end = D.lastAd && D.lastAd < y ? D.lastAd : y;
    const td = P0(t), sun = addD(t, -td.getUTCDay());
    const shiftM = (s, n) => { const d = P0(s); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), last)))); };
    let from, to, label, pf, pt, cal = false;
    if (per === 'wtd') { from = sun; to = end; if (to < from) { from = addD(sun, -7); to = addD(sun, -1); } label = 'Deze week'; pf = addD(from, -7); pt = addD(to, -7); }
    else if (per === 'd28') { to = end; from = addD(to, -27); label = 'Laatste 28 dagen'; pf = addD(from, -28); pt = addD(from, -1); }
    else if (per === 'mtd') { from = t.slice(0, 8) + '01'; to = end; if (to < from) from = addD(from, -1).slice(0, 8) + '01'; label = 'Deze maand'; pf = shiftM(from, -1); pt = shiftM(to, -1); cal = true; }
    else if (per === 'month') { to = addD(t.slice(0, 8) + '01', -1); from = to.slice(0, 8) + '01'; label = 'Vorige maand'; pf = shiftM(from, -1); pt = mEndOf(pf); cal = true; }
    else if (per === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(dash.params().ad_from || '') && /^\d{4}-\d{2}-\d{2}$/.test(dash.params().ad_to || '')) {
      const pa = dash.params(); from = pa.ad_from < pa.ad_to ? pa.ad_from : pa.ad_to; to = pa.ad_from < pa.ad_to ? pa.ad_to : pa.ad_from; if (to > end) to = end; if (from > to) from = to;
      const n = Math.round((P0(to) - P0(from)) / 864e5) + 1; label = 'Eigen periode'; pt = addD(from, -1); pf = addD(pt, -(n - 1));
    }
    else if (per === 'ytd') { from = t.slice(0, 4) + '-01-01'; to = end; label = 'Dit jaar'; pf = shiftM(from, -12); pt = shiftM(to, -12); cal = true; }
    else { from = addD(sun, -7); to = addD(sun, -1); label = 'Vorige week'; pf = addD(from, -7); pt = addD(to, -7); }
    const lf = cal ? shiftM(from, -12) : addD(from, -364), lt = cal ? shiftM(to, -12) : addD(to, -364);
    return { per, from, to, pf, pt, lf, lt, label, t, end };
  }
  const delta = (a, b) => (a == null || b == null || !b ? null : a / b - 1);
  function dspan(d, dir, pp) {
    const s = el('span', '', d === null || !isFinite(d) ? '–' : pp ? (d > 0 ? '+' : d < 0 ? '−' : '±') + dec1.format(Math.abs(d) * 100) + ' pp' : (d > 0 ? '+' : d < 0 ? '−' : '±') + dec1.format(Math.abs(d) * 100) + '%');
    if (d && isFinite(d) && dir) s.classList.add(d * dir > 0 ? 'lw-good' : 'lw-bad');
    return s;
  }
  function tiles(D, P) {
    const cur = tot(D, P.from, P.to), prev = tot(D, P.pf, P.pt), ly = tot(D, P.lf, P.lt);
    const ob = omzetPlan(P.from, P.to), tg = tgt(D, P.from, P.to);
    const host = document.getElementById('ad-tiles'); host.replaceChildren();
    const defs = [
      ['Omzet (Shopify, ex btw)', eur0.format(cur.omzet), [[delta(cur.omzet, ob), 1, false, 'vs plan'], [delta(cur.omzet, ly.omzet), 1, false, 'vs vorig jaar']], `plan ${eur0.format(ob)}`],
      ['Ads-uitgaven', eur0.format(cur.spend), [[delta(cur.spend, prev.spend), 0, false, 'vs vorige periode'], [delta(cur.spend, ly.spend), 0, false, 'vs vorig jaar']], `Meta ${eur0.format(cur.ms)} · Google ${eur0.format(cur.gs)}`],
      ['Ads % van omzet', cur.adpct == null ? '–' : pct1.format(cur.adpct), [[cur.adpct != null ? cur.adpct - tg : null, -1, true, `vs doel ${pct1.format(tg)}`], [cur.adpct != null && ly.adpct != null ? cur.adpct - ly.adpct : null, -1, true, 'vs vorig jaar']], `vorig jaar ${ly.adpct == null ? '–' : pct1.format(ly.adpct)}`],
      ['POAS (brutowinst ÷ ads)', cur.poas == null ? '–' : dec2.format(cur.poas), [[delta(cur.poas, prev.poas), 1, false, 'vs vorige periode'], [delta(cur.poas, ly.poas), 1, false, 'vs vorig jaar']], `doel ${dec1.format(marge() / tg)} (bij ${pct0.format(marge())} marge en ${pct1.format(tg)} ads)`],
      ['Brutowinst na ads', cur.bwNa == null ? '–' : eur0.format(cur.bwNa), [[delta(cur.bwNa, prev.bwNa), 1, false, 'vs vorige periode'], [delta(cur.bwNa, ly.bwNa), 1, false, 'vs vorig jaar']], cur.marge ? `brutomarge ${pct1.format(cur.marge)}` : ''],
      ['Bezoekers', cur.ses == null ? '–' : int.format(cur.ses), [[delta(cur.ses, prev.ses), 1, false, 'vs vorige periode'], [delta(cur.ses, ly.ses), 1, false, 'vs vorig jaar']], cur.cpv == null ? '' : `ads per bezoeker ${eur2.format(cur.cpv)}`],
      ['Conversie (alle orders ÷ sessies)', cur.cr == null ? '–' : pct2.format(cur.cr), [[delta(cur.cr, prev.cr), 1, false, 'vs vorige periode'], [delta(cur.cr, ly.cr), 1, false, 'vs vorig jaar']], `${int.format(cur.orders)} orders (webshop + showroom) · alleen online ${cur.ses ? pct2.format(cur.cmp / cur.ses) : '–'}`],
      ['Gem. orderwaarde', cur.aov == null ? '–' : eur0.format(cur.aov), [[delta(cur.aov, prev.aov), 1, false, 'vs vorige periode'], [delta(cur.aov, ly.aov), 1, false, 'vs vorig jaar']], ''],
    ];
    defs.forEach(([label, val, ds, sub], i) => {
      const t = el('div', 'ad-kpi' + (i < 4 ? ' ad-kpi-main' : ''));
      const first = ds[0] && ds[0][0] != null && isFinite(ds[0][0]) && ds[0][1] ? ds[0][0] * ds[0][1] : null;
      if (first != null) t.classList.add(first >= 0 ? 'ad-kpi-good' : 'ad-kpi-bad');
      t.append(el('div', 'ad-kpi-l', label), el('div', 'ad-kpi-v', val));
      const chips = el('div', 'ad-chips');
      ds.forEach(([v, dir, pp, l]) => {
        const c = el('span', 'ad-chip');
        if (v == null || !isFinite(v)) { c.classList.add('ad-chip-n'); c.textContent = '– ' + l; }
        else {
          const up = v > 0, txt = (pp ? dec1.format(Math.abs(v) * 100) + ' pp' : dec1.format(Math.abs(v) * 100) + '%');
          c.textContent = (up ? '▲ ' : v < 0 ? '▼ ' : '') + txt + ' ' + l;
          c.classList.add(!dir || v === 0 ? 'ad-chip-n' : v * dir > 0 ? 'ad-chip-g' : 'ad-chip-b');
        }
        chips.append(c);
      });
      t.append(chips);
      if (sub) t.append(el('div', 'ad-kpi-s', sub));
      host.append(t);
    });
    return { cur, prev };
  }

  // ---------- platform + campaigns ----------
  function platformTable(cur, prev) {
    const tb = document.getElementById('ad-platform'); tb.replaceChildren();
    const hr = el('tr'); ['Platform', 'Uitgaven', 'Aandeel', 'Impressies', 'Klikken', 'CTR', 'CPC', 'Conversies (platform)', 'Waarde (platform)', 'ROAS (platform)', 'ROAS vorige periode'].forEach((x, i) => hr.append(el('th', i ? 'lw-num' : '', x)));
    const th = el('thead'); th.append(hr); tb.append(th);
    const bd = el('tbody');
    const line = (name, col, s, i, c, cv, v, ps, pv) => {
      const tr = el('tr'); const td = el('td'); const dot = el('span', 'lw-sw'); dot.style.background = col; td.append(dot, document.createTextNode(name));
      tr.append(td, el('td', 'lw-num', eur0.format(s)), el('td', 'lw-num', cur.spend ? pct0.format(s / cur.spend) : '–'), el('td', 'lw-num', int.format(i)), el('td', 'lw-num', int.format(c)), el('td', 'lw-num', i ? pct2.format(c / i) : '–'), el('td', 'lw-num', c ? eur2.format(s / c) : '–'), el('td', 'lw-num', dec1.format(cv)), el('td', 'lw-num', eur0.format(v)), el('td', 'lw-num', s ? dec2.format(v / s) : '–'), el('td', 'lw-num bg-muted', ps ? dec2.format(pv / ps) : '–'));
      bd.append(tr);
    };
    line('Meta', C.meta, cur.ms, cur.mi, cur.mc, cur.mcv, cur.mv, prev.ms, prev.mv);
    line('Google', C.google, cur.gs, cur.gi, cur.gc, cur.gcv, cur.gv, prev.gs, prev.gv);
    tb.append(bd);
  }
  let sortKey = 's', sortDir = -1;
  function campRows(D, y) {
    const c7 = campAgg(D, addD(y, -6), y), p7 = campAgg(D, addD(y, -13), addD(y, -7)), c28 = campAgg(D, addD(y, -41), y);
    return [...c28.values()].filter((o) => o.s > 0).map((o) => {
      const k = o.p + ':' + o.id, a = c7.get(k) || { s: 0, c: 0, cv: 0, v: 0, roas: null, cpc: null, lb: null, fW: 0 }, b = p7.get(k) || { s: 0 };
      return { p: o.p, n: o.n, t: o.t, b: o.b, s: a.s, ds: b.s ? a.s / b.s - 1 : null, c: a.c, cpc: a.cpc, cv: a.cv, v: a.v, roas: a.roas, lb: a.lb != null ? a.lb : o.lb, f: a.fW || o.fW, s28: o.s, cv28: o.cv, v28: o.v, roas28: o.roas };
    });
  }
  function campTable(D, y, rows) {
    rows.sort((x, z) => { const a = x[sortKey], b = z[sortKey]; if (typeof a === 'string') return sortDir * a.localeCompare(b); return sortDir * ((a ?? -1e9) - (b ?? -1e9)); });
    const tb = document.getElementById('ad-camps'); tb.replaceChildren();
    const cols = [['p', 'Platform'], ['n', 'Campagne'], ['b', 'Budget/dag'], ['s', 'Uitgaven 7d'], ['ds', 'vs vorige 7d'], ['c', 'Klikken'], ['cpc', 'CPC'], ['cv', 'Conv.'], ['roas', 'ROAS 7d'], ['lb', 'Verloren door budget'], ['f', 'Frequentie'], ['s28', 'Uitgaven 6 wk'], ['roas28', 'ROAS 6 wk']];
    const hr = el('tr');
    cols.forEach(([k, l], i) => { const th = el('th', i > 1 ? 'lw-num ad-sort' : 'ad-sort', l + (sortKey === k ? (sortDir < 0 ? ' ↓' : ' ↑') : '')); th.addEventListener('click', () => { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'n' || k === 'p' ? 1 : -1; } campTable(D, y, rows); }); hr.append(th); });
    const th = el('thead'); th.append(hr); tb.append(th);
    const bd = el('tbody');
    const typeNl = { SEARCH: 'Zoeken', PERFORMANCE_MAX: 'PMax', SHOPPING: 'Shopping', DISPLAY: 'Display', VIDEO: 'Video', DEMAND_GEN: 'Demand Gen' };
    for (const r of rows) {
      const tr = el('tr');
      const pl = el('td'); const dot = el('span', 'lw-sw'); dot.style.background = r.p === 'm' ? C.meta : C.google; pl.append(dot, document.createTextNode(r.p === 'm' ? 'Meta' : 'Google'));
      const nm = el('td', 'ad-cname'); nm.append(document.createTextNode(r.n)); if (typeNl[r.t]) nm.append(el('small', '', ' ' + typeNl[r.t])); if (LOCAL.test(r.n)) nm.append(el('span', 'ad-tag', 'lokaal/showroom'));
      const tdLb = el('td', 'lw-num', r.lb == null ? '–' : pct0.format(r.lb)); if (r.lb != null && r.lb >= 0.2) tdLb.classList.add('ad-flag');
      const tdF = el('td', 'lw-num', r.p === 'm' && r.f ? dec1.format(r.f) : '–'); if (r.p === 'm' && r.f >= 3) tdF.classList.add('ad-flag');
      const tdCv = el('td', 'lw-num', dec1.format(r.cv)); if (r.s >= 75 && !r.cv && !LOCAL.test(r.n)) tdCv.classList.add('ad-flag');
      tr.append(pl, nm, el('td', 'lw-num', r.b ? eur0.format(r.b) : '–'), el('td', 'lw-num', eur0.format(r.s)), el('td', 'lw-num', r.ds == null ? '–' : (r.ds >= 0 ? '+' : '−') + pct0.format(Math.abs(r.ds))), el('td', 'lw-num', int.format(r.c)), el('td', 'lw-num', r.cpc == null ? '–' : eur2.format(r.cpc)), tdCv, el('td', 'lw-num', r.roas == null ? '–' : dec2.format(r.roas)), tdLb, tdF, el('td', 'lw-num', eur0.format(r.s28)), el('td', 'lw-num', r.roas28 == null ? '–' : dec2.format(r.roas28)));
      bd.append(tr);
    }
    tb.append(bd);
  }


  // ---------- campaign advice: where to put (or take) budget ----------
  function campAdvice(rows, ORD, FD) {
    const host = document.getElementById('ad-cadv'); host.replaceChildren();
    const BE = 1.21 / marge(), ST = 2 * BE; // platform ROAS (value incl. btw): break-even and 'strong'
    const typeNl = { SEARCH: 'Zoeken', PERFORMANCE_MAX: 'PMax', SHOPPING: 'Shopping', DEMAND_GEN: 'Demand Gen' };
    const L = rows.filter((r) => r.s28 >= 50).map((r) => {
      const loc = LOCAL.test(r.n) || /store/i.test(r.n), sp = r.s / 7, bud = r.b ? +r.b : null, cur = bud ? (sp ? Math.min(bud, sp) : bud) : sp, R7 = r.roas, R28 = r.roas28 || 0;
      const unused = bud && sp < 0.8 * bud; // the budget is not what limits this campaign (bid strategy, bids or search volume)
      const fc = r.p === 'm' ? (FD && FD.byC.get(r.n)) || null : null;
      let act = 'hold', why, score = 0, note = '';
      if (R28 >= ST && r.cv28 >= 3) { act = 'up'; score = R28 * (1 + (r.lb || 0)); why = `ROAS ${dec1.format(R28)} over 6 weken (${int.format(r.cv28)} conversies${R7 != null ? `, laatste 7 dagen ${dec1.format(R7)}` : ''})` + (r.p === 'g' && r.lb >= 0.1 ? ` en mist ${pct0.format(r.lb)} van de vertoningen doordat het budget op is: extra budget wordt hier direct omgezet.` : '.') + (R7 != null && R7 < BE ? ' Laatste week zwakker, maar één week zegt weinig.' : ''); }
      else if (/brand|loungesetland/i.test(r.n)) why = `Merkcampagne (mensen die op Loungesetland zoeken): goedkoop en altijd aan laten, ROAS ${dec1.format(R28)}.`;
      else if (loc) why = `Lokaal/showroom: online ROAS ${dec1.format(R28)} zegt weinig, beoordeel op showroombezoek en totale omzet. Budget houden.`;
      else if (r.cv28 < 0.5) { if (r.s28 >= 2 * ORD / BE) { act = 'down'; why = `${eur0.format(r.s28)} in 6 weken zonder conversie: meer dan 2 orders aan kosten. Verlagen of zoektermen/doelgroep nalopen.`; } else why = `Nog geen conversie in 6 weken, maar één order (gem. ${eur0.format(ORD)}) maakt hem al rendabel. Te vroeg om te oordelen: houden.`; }
      else if (R28 < BE && (r.v28 + ORD) / r.s28 < BE) { act = 'down'; why = `ROAS ${dec1.format(R28)} over 6 weken, en zelfs met één order extra nog onder break-even (${dec1.format(BE)}).`; }
      else if (R28 < BE) why = `ROAS ${dec1.format(R28)} over 6 weken, onder break-even, maar één order extra (gem. ${eur0.format(ORD)}) brengt hem erboven. Bij weinig, grote orders is dat toeval: houden en over een paar weken opnieuw kijken.`;
      else why = `ROAS ${dec1.format(R28)}: rendabel, geen uitschieter. Houden.`;
      // Meta: creative fatigue overrules a budget increase (more budget on a tired ad only raises the frequency)
      if (fc) {
        const moe = fc.ads.filter((z) => z.kind === 'down'), lo = fc.ads.filter((z) => z.kind === 'hold'), nm = (z) => `"${z.a.n}"`;
        if (moe.length && (fc.moeShare >= 0.4 || fc.ads.length === 1)) {
          if (act === 'up') { act = 'fresh'; score = R28; why = `ROAS ${dec1.format(R28)} is sterk, maar ${moe.map(nm).join(', ')} is moe (${dec1.format(moe[0].w7.f)}× per week gezien, klikratio ${pct0.format(moe[0].drop)}). Eerst een nieuwe creative, daarna verhogen; meer budget op een moeie advertentie verhoogt alleen de frequentie.`; }
          else if (act === 'hold' && !loc) { act = 'fresh'; why += ` Daarbij is ${moe.map(nm).join(', ')} moe: vervang de creative.`; }
          else note = ` ${moe.map(nm).join(', ')} is moe: vervang de creative.`;
        } else if (moe.length) note = ` Pauzeer of vervang ${moe.map(nm).join(', ')} (moe); de rest van de campagne is fris genoeg.`;
        else if (lo.length) note = ` ${lo.map(nm).join(', ')}: ${lo[0].tip}.`;
      }
      if (act === 'up' && unused) { act = 'hold'; score = 0; why = `ROAS ${dec1.format(R28)} is sterk, maar het dagbudget van ${eur0.format(bud)} wordt maar voor ${pct0.format(sp / bud)} gebruikt (${eur0.format(sp)}/dag): het budget is hier niet de rem. Meer uitgeven kan alleen met een hoger bod${r.p === 'g' && r.t === 'SEARCH' ? ' of meer zoekwoorden' : ''}${r.p === 'g' && r.lr >= 0.2 ? ` (mist ${pct0.format(r.lr)} van de vertoningen door rangschikking)` : ''}; budget verhogen doet niets.`; }
      return { ...r, loc, cur, sp, bud, unused, act, why: why + note, score, to: cur, fc };
    });
    // budget moves only within a platform (the Meta/Google split stays as in 2026): freed money of a platform goes to its own strongest campaigns
    const A = lastAdv, sh = A ? A.now.share : 0.5, extra = A && A.kind === 'good' ? Math.max(0, A.rec / 7 - A.dag) : 0;
    const plat = {};
    for (const pl of ['m', 'g']) {
      const own = L.filter((x) => x.p === pl), downs = own.filter((x) => x.act === 'down');
      downs.forEach((x) => { x.to = x.cur * 0.8; });
      const fr = downs.reduce((t, x) => t + x.cur - x.to, 0), ex = extra * (pl === 'm' ? sh : 1 - sh);
      const ups = own.filter((x) => x.act === 'up').sort((a, b) => b.score - a.score);
      let pot = fr + ex;
      for (const x of ups) { const add = Math.min(x.cur * 0.2, pot); x.to = x.cur + add; pot -= add; }
      // money left: next best profitable campaigns (not local/brand, creatives fresh enough) also get max +20%
      if (pot >= 1) own.filter((x) => x.act === 'hold' && !x.unused && !x.loc && !/brand|loungesetland/i.test(x.n) && x.roas28 >= BE).sort((a, b) => b.roas28 - a.roas28).forEach((x) => {
        if (pot < 1) return; const add = Math.min(x.cur * 0.2, pot); x.to = x.cur + add; pot -= add; x.act = 'up'; x.score = x.roas28 / 10;
        x.why = `Rendabel (ROAS ${dec1.format(x.roas28)} over 6 weken, break-even ${dec1.format(BE)}) en er is ${pl === 'm' ? 'Meta' : 'Google'}-budget over na de sterkste campagnes: voorzichtig mee opschalen.` + x.why.replace(/^ROAS [^.]*\. Houden\./, '').replace(/^ROAS [^:]*: rendabel, geen uitschieter\. Houden\./, '');
      });
      plat[pl] = { fr, ex, left: pot, fresh: own.filter((x) => x.act === 'fresh').length };
    }
    host.append(el('p', 'lw-note', (extra ? `Opschalen met ongeveer ${eur0.format(extra)} per dag, per campagne nooit meer dan +20%. ` : '') + 'Meta en Google apart (hun ROAS is niet te vergelijken); budget schuift alleen binnen een platform.'));
    const order = { up: 0, fresh: 1, down: 2, hold: 3 }, lab = { up: '▲ Verhogen', fresh: '◆ Nieuwe creative', down: '▼ Verlagen', hold: '■ Houden' };
    for (const pl of ['m', 'g']) {
      const own = L.filter((x) => x.p === pl); if (!own.length) continue;
      const P = plat[pl], gh = el('div', 'ad-cgrp');
      gh.append(el('h4', '', pl === 'm' ? 'Meta' : 'Google'));
      const bits = [];
      if (P.ex >= 1) bits.push(`${eur0.format(P.ex)} per dag erbij`);
      if (P.fr >= 1) bits.push(`${eur0.format(P.fr)} per dag vrij uit zwakke campagnes`);
      if (P.left >= 1) bits.push(`${eur0.format(P.left)} per dag nog niet in te zetten${pl === 'm' && P.fresh ? ': eerst nieuwe creatives' : `: geen andere rendabele ${pl === 'm' ? 'Meta' : 'Google'}-campagne om het in te steken, dus niet forceren`}`);
      if (pl === 'm' && FD && FD.acc7) bits.push(`publiek ziet de advertenties ${dec1.format(FD.acc7.f)}× per week${FD.acc28 ? ` (${dec1.format(FD.acc28.f)}× per 28 dagen)` : ''}`);
      gh.append(el('span', 'lw-note', bits.join(' · ')));
      host.append(gh);
      const holds = own.filter((x) => x.act === 'hold'), hd = el('details', 'ad-hold');
      hd.append(el('summary', '', `${holds.length} campagne${holds.length === 1 ? '' : 's'} houden: budget laten staan ▸`));
      own.sort((a, b) => order[a.act] - order[b.act] || b.score - a.score || b.s28 - a.s28).forEach((x) => {
        const d = el('div', 'ad-ca');
        d.append(el('span', 'ad-cb ' + x.act, lab[x.act]));
        const nm = el('span', ''); nm.append(el('b', '', x.n), document.createTextNode(typeNl[x.t] ? ` · ${typeNl[x.t]}` : ''));
        if (x.fc) { const w = x.fc.ads.some((z) => z.kind === 'down') ? 'down' : x.fc.letop ? 'hold' : 'up'; nm.append(el('span', 'ad-fat ' + w, w === 'down' ? 'creative moe' : w === 'hold' ? 'creative: let op' : 'creatives fris')); }
        d.append(nm);
        const amt = el('b', 'amt', Math.abs(x.to - x.cur) >= 1 ? `${x.bud ? 'budget ' : ''}${eur0.format(x.bud || x.cur)} → ${eur0.format(x.to)}/dag` : x.bud ? `budget ${eur0.format(x.bud)}/dag` : `${eur0.format(x.sp)}/dag`);
        if (x.bud && Math.abs(x.sp - x.bud) >= 1) amt.append(el('small', 'ad-spent', `uitgegeven ${eur0.format(x.sp)}/dag`));
        d.append(amt);
        d.append(el('small', '', x.why + (x.act === 'up' && x.to - x.cur < 1 ? ' Volgende in de rij als er budget bij komt.' : '') + ' ▸ Klik voor uitleg'));
        const det = campDetail(x, BE, ST, ORD); det.hidden = true;
        d.addEventListener('click', () => { det.hidden = !det.hidden; d.classList.toggle('open', !det.hidden); });
        (x.act === 'hold' ? hd : host).append(d, det);
      });
      if (holds.length) host.append(hd);
    }
    return { plat, L };
  }


  function campDetail(x, BE, ST, ORD) {
    const box = el('div', 'ad-cdet'), G = x.p === 'g', pl = G ? 'Google' : 'Meta', f = (v, k) => (v == null ? '–' : k === 'e' ? eur0.format(v) : k === 'p' ? pct0.format(v) : dec1.format(v));
    const step = x.to - x.cur;
    const todo = x.act === 'up' ? (step >= 1 ? `Zet in ${pl} het dagbudget van ${eur0.format(x.bud || x.cur)} op ${eur0.format(x.to)} (+${pct0.format(step / x.cur)}). Na 3–4 dagen kijken: ROAS nog boven ${dec1.format(BE)}? Dan mag de volgende stap van max. 20%.` : `Eerste kandidaat zodra er budget bij komt (advies opschalen of geld dat in ${pl} vrijkomt).`)
      : x.act === 'down' ? `Zet in ${pl} het dagbudget ${x.bud ? `van ${eur0.format(x.bud)} ` : ''}op ${eur0.format(x.to)}${x.unused ? ` (er gaat nu maar ${eur0.format(x.sp)} per dag uit, dus een lager budget is nodig om echt minder uit te geven)` : ''}. ${G ? (x.t === 'SEARCH' ? 'Loop de zoektermen na en sluit termen zonder verkoop uit.' : 'Haal producten zonder voorraad of marge uit de campagne.') : 'Vervang de zwakste advertenties of verklein de doelgroep.'} Na 2 weken opnieuw beoordelen; nog steeds onder break-even, dan pauzeren.`
      : x.act === 'fresh' ? `Budget laten staan op ${eur0.format(x.bud || x.sp)} per dag. Zet een nieuwe advertentie (nieuwe hook, eerste beeld of video) in deze campagne en pauzeer de moeie zodra de nieuwe loopt. Na ±1 week: frequentie en klikratio weer goed en ROAS boven ${dec1.format(BE)}? Dan mag +20%.`
      : 'Budget laten staan en over een week of twee opnieuw beoordelen.';
    const act = el('div', 'ad-cact ' + (x.act === 'fresh' ? 'hold' : x.act)); act.append(el('b', '', 'Wat te doen'), el('span', '', todo));
    const t = el('table', 'ad-cdt'), hr = el('tr'); ['', '7 dagen', '6 weken'].forEach((h) => hr.append(el('th', '', h))); t.append(hr);
    [['Uitgaven', f(x.s, 'e'), f(x.s28, 'e')], ['Conversies', f(x.cv), f(x.cv28)], ['ROAS', f(x.roas), f(x.roas28)]].forEach((r) => { const tr = el('tr'); r.forEach((c, i) => tr.append(el(i ? 'td' : 'th', '', c))); t.append(tr); });
    const mini = el('div', 'ad-cdm');
    [['Dagbudget', x.b ? eur0.format(x.b) : '–'], ['Uitgegeven per dag', f(x.sp, 'e')], ['vs week ervoor', x.ds == null ? '–' : (x.ds >= 0 ? '+' : '') + pct0.format(x.ds)], ['CPC', x.cpc == null ? '–' : eur2.format(x.cpc)], G ? ['Mist door budget', f(x.lb, 'p')] : ['Frequentie 7 d', x.fc && x.fc.f != null ? dec1.format(x.fc.f) + '×' : '–']]
      .forEach(([a, b]) => { const c = el('span'); c.append(el('small', '', a), el('b', '', b)); mini.append(c); });
    const L = el('div'); L.append(el('div', 'ad-cdh', 'Cijfers'), t, mini);
    const ck = el('ul', 'ad-cdc'), chk = (ok, t1, t2) => { const li = el('li', ok ? 'ok' : 'no'); li.append(el('i', '', ok ? '✓' : '✗'), el('b', '', t1), el('small', '', t2)); ck.append(li); };
    chk(x.roas28 >= BE, `ROAS boven break-even (${dec1.format(BE)})`, `6 weken: ${f(x.roas28)}. Daaronder kost elke euro ads meer dan hij aan brutowinst oplevert (1,21 ÷ ${pct0.format(marge())} marge).`);
    chk(x.roas28 >= ST, `Sterk genoeg om op te schalen (≥ ${dec1.format(ST)})`, '2× break-even.');
    chk(x.cv28 >= 3, 'Genoeg conversies (≥ 3)', `${f(x.cv28)} in 6 weken; minder is toeval.`);
    chk(x.s28 && (x.v28 + ORD) / x.s28 >= BE, 'Eén order extra = boven break-even', `Gemiddelde order ${eur0.format(ORD)}. Zo ja, dan is een slechte periode geen reden om te verlagen.`);
    if (G) chk(x.lb >= 0.1, 'Mist vertoningen door budget', `${f(x.lb, 'p')} (vanaf 10% levert extra budget direct extra vertoningen op).`);
    else if (x.fc) chk(!x.fc.ads.some((z) => z.kind === 'down'), 'Advertenties niet moe', `Moe = ≥ 3× per week of ≥ 4× per 28 dagen gezien én klikratio 20% of meer onder het 28-dagengemiddelde.`);
    if (x.roas != null) chk(x.roas >= BE, 'Laatste week boven break-even', `${f(x.roas)}; alleen een waarschuwing, één week zegt weinig.`);
    const Rt = el('div'); Rt.append(el('div', 'ad-cdh', 'Toetsing'), ck);
    if (x.loc) Rt.append(el('p', 'ad-cdn', 'ⓘ Lokale/showroomcampagne: doel is winkelbezoek, dat online nauwelijks als omzet wordt gemeten.'));
    const g = el('div', 'ad-cdg'); g.append(L, Rt);
    box.append(act, g);
    if (x.fc && x.fc.ads.length) {
      const t2 = el('table', 'ad-cdt ad-cads'), h2 = el('tr'); ['Advertentie', 'Uitgaven 7 d', 'Frequentie 7 d / 28 d', 'Klikratio 7 d vs 28 d', 'Per winkelwagen 28 d', 'Status'].forEach((h) => h2.append(el('th', '', h))); t2.append(h2);
      for (const z of x.fc.ads) { const tr = el('tr'); tr.append(el('td', '', z.a.n + (z.age != null ? ` (${int.format(z.age)} d live)` : '')), el('td', '', eur0.format(z.w7.s)), el('td', '', `${dec1.format(z.w7.f)}× / ${dec1.format(z.w28.f)}×`), el('td', '', z.c7 == null ? '–' : `${pct2.format(z.c7)} vs ${pct2.format(z.c28)}${z.drop == null ? '' : ` (${z.drop >= 0 ? '+' : '−'}${pct0.format(Math.abs(z.drop))})`}`), el('td', '', z.cpa == null ? '–' : eur0.format(z.cpa)), el('td', 'ad-sv ' + z.kind, z.label)); t2.append(tr); }
      const wrap = el('div'); wrap.append(el('div', 'ad-cdh', 'Advertenties in deze campagne'), t2); box.append(wrap);
    }
    box.append( el('p', 'ad-cdn', `ROAS = omzet die ${pl} zelf aan de campagne toeschrijft ÷ uitgaven. ${G ? 'Google ziet de showroomverkoop niet, dus de echte opbrengst ligt hoger.' : 'Meta telt ook kijkers en showroomkopers mee, dus de echte opbrengst ligt lager.'} Daarom alleen vergelijken binnen hetzelfde platform.`));
    return box;
  }

  // ---------- extra budget: do budget steps still pay off? ----------
  const spDay = (D, d) => { const a = D.A.get(d) || {}; return (+(a.m || {}).s || 0) + (+(a.g || {}).s || 0); };
  function budgetSteps(D, y) {
    const avg = (a, b) => { let s = 0, n = 0; for (let d = a; d <= b; d = addD(d, 1)) { s += spDay(D, d); n++; } return n ? s / n : 0; };
    const ch = (d) => { const pre = avg(addD(d, -7), addD(d, -1)), post = avg(d, addD(d, 6) < y ? addD(d, 6) : y); return pre ? post / pre - 1 : 0; };
    const found = [];
    for (let d = addD(y, -200); d <= addD(y, -3); d = addD(d, 1)) {
      if (Math.abs(ch(d)) < 0.15) continue;
      // the change starts somewhere in the next days: take the day with the sharpest jump
      let best = d; for (let k = 1; k <= 6 && addD(d, k) <= addD(y, -3); k++) if (Math.abs(ch(addD(d, k))) > Math.abs(ch(best))) best = addD(d, k);
      const s14 = avg(addD(best, -14), addD(best, -1)), a14 = avg(best, addD(best, 13) < y ? addD(best, 13) : y);
      if (s14 && Math.abs(a14 / s14 - 1) >= 0.1 && (!found.length || days(found[found.length - 1], best) > 14)) found.push(best);
      d = addD(best, 7);
    }
    return found.map((d) => {
      const e = addD(d, 13) < y ? addD(d, 13) : y, b = tot(D, addD(d, -14), addD(d, -1)), a = tot(D, d, e), nb = b.n, na = a.n;
      const s0 = b.spend / nb, s1 = a.spend / na, ok = b.pmOk && a.pmOk, bw0 = ok ? b.bw / nb : null, bw1 = ok ? a.bw / na : null;
      const marg = ok && s1 !== s0 ? (bw1 - bw0) / (s1 - s0) : null, doel = poasDoel(D, d);
      const cpm = (o) => ((o.mi + o.gi) ? (o.spend / (o.mi + o.gi)) * 1000 : null), cpa = (o) => (o.matc ? o.ms / o.matc : null);
      const up = s1 > s0;
      // how much does daily gross profit jump around by itself? (big orders): standard error of the difference
      const sd = (f, t) => { const v = []; for (let x = f; x <= t; x = addD(x, 1)) { const p = D.PM.get(x); if (p) v.push(+p.bw || 0); } const m = v.reduce((q, z) => q + z, 0) / (v.length || 1); return { v: v.reduce((q, z) => q + (z - m) ** 2, 0) / Math.max(1, v.length - 1), n: v.length }; };
      const q0 = sd(addD(d, -14), addD(d, -1)), q1 = sd(d, e), se = Math.sqrt(q0.v / Math.max(1, q0.n) + q1.v / Math.max(1, q1.n));
      const zeker = ok && Math.abs(bw1 - bw0) >= 2 * se;
      let kind, label;
      if (na < 7) { kind = 'hold'; label = 'Nog te vroeg'; }
      else if (marg == null) { kind = 'hold'; label = 'Geen winstcijfers'; }
      else if (up) { if (marg >= 1.5 && a.poas >= doel * 0.9) { kind = 'up'; label = 'Rendeert'; } else if (marg < 1 || a.poas < doel * 0.7) { kind = 'down'; label = 'Rendeert niet'; } else { kind = 'hold'; label = 'Twijfel'; } }
      else { if (marg < 1) { kind = 'up'; label = 'Goed besluit'; } else if (marg >= 2) { kind = 'down'; label = 'Kostte winst'; } else { kind = 'hold'; label = 'Neutraal'; } }
      const mo = d.slice(5, 7), seas = na >= 7 && marg != null && ((up && ['02', '03', '04', '05'].includes(mo)) || (!up && ['07', '08', '09'].includes(mo)));
      const base = kind, cert = na < 7 ? '' : marg == null ? '' : !zeker ? 'onzeker' : seas ? 'seizoen' : 'zeker';
      if (cert === 'onzeker' || cert === 'seizoen') kind = 'hold';
      return { d, e, na, up, zeker, base, cert, s0, s1, bw0, bw1, poas0: b.poas, poas1: a.poas, marg, doel, cpm0: cpm(b), cpm1: cpm(a), cpa0: cpa(b), cpa1: cpa(a), kind, label, spring: seas };
    }).reverse();
  }
  function headroom(D, y) {
    // Google search: share of impressions missed because the budget ran out vs because of rank (last 14 days, impression-weighted)
    let iw = 0, lb = 0, lr = 0, gs = 0; const from = addD(y, -13);
    for (const r of D.camp) if (r.p === 'g' && r.d >= from && r.d <= y && r.is != null && +r.i) { iw += +r.i; lb += (+r.lb || 0) * r.i; lr += (+r.lr || 0) * r.i; gs += +r.s || 0; }
    const G = iw ? { lb: lb / iw, lr: lr / iw, s: gs } : null;
    // Meta: frequency and CPM of the whole account (7 days vs the 7 before and 28 days)
    const MA = getRows('meta_ads') || [], acc = (w) => MA.find((r) => r.lvl === 'acct' && r.w === w);
    const a7 = acc('7d'), av = acc('v7d'), a28 = acc('28d');
    const cpm = (o) => (o && o.i ? (o.s / o.i) * 1000 : null);
    const M = a7 ? { f7: a7.f, f28: a28 ? a28.f : null, cpm7: cpm(a7), cpmv: cpm(av), cpm28: cpm(a28), s7: a7.s, sv: av ? av.s : null, peil: a7.peil } : null;
    if (M) { const dS = M.sv ? M.s7 / M.sv - 1 : 0, dC = M.cpmv ? M.cpm7 / M.cpmv - 1 : 0; M.dS = dS; M.dC = dC; M.sat = M.f7 >= 3 || (M.f7 >= 2.5 && dC > 0.15) || (dS > 0.1 && dC > dS * 0.6); }
    return { G, M };
  }
  function rendView(D, P) {
    const host = document.getElementById('ad-rend'); if (!host) return null; host.replaceChildren();
    const y = P.end, S = budgetSteps(D, y), H = headroom(D, y), last = S.find((s) => s.na >= 7) || S[0];
    const lastUp = S.find((s) => s.up && s.na >= 7 && days(s.d, y) <= 75);
    // verdict
    const v = el('div', 'ad-verdict'); let vk = 'hold', head, txt = [];
    const gRoom = H.G && H.G.lb >= 0.1, mSat = H.M && H.M.sat;
    if (lastUp && lastUp.kind === 'down') { vk = 'down'; head = 'Laatste verhoging rendeerde niet: niet verder opschalen'; }
    else if (lastUp && lastUp.kind === 'up' && (gRoom || !mSat)) { vk = 'up'; head = 'Extra budget rendeert nog'; }
    else if (mSat && !gRoom) { vk = 'hold'; head = 'Weinig ruimte: Meta-publiek verzadigd, Google mist weinig door budget'; }
    else head = gRoom ? 'Ruimte bij Google, verder voorzichtig' : 'Geen duidelijk signaal: stap voor stap';
    const SZ = seasonTrend(D, P.t);
    if (SZ.dir === 'down' && vk !== 'down') { vk = 'hold'; head = 'Seizoen zakt: nu geen extra budget, ook al is er ruimte'; }
    if (SZ.f != null) txt.push(`Seizoen: ${seasonTxt(SZ)}.${SZ.dir === 'down' ? ' Ruimte bij Google of Meta is er dan wel, maar extra vraag om die ruimte te vullen niet.' : SZ.dir === 'up' ? ' Ruimte die er nu is wordt de komende weken vanzelf benut: tijd om op te schalen.' : ''}`);
    if (!lastUp) txt.push('Geen budgetverhoging in de afgelopen 2½ maand om te beoordelen.');
    if (lastUp) txt.push(`Laatste verhoging ${dShort(lastUp.d)}: ${eur0.format(lastUp.s0)} → ${eur0.format(lastUp.s1)} per dag, brutowinst ${lastUp.bw0 == null ? '–' : eur0.format(lastUp.bw0)} → ${lastUp.bw1 == null ? '–' : eur0.format(lastUp.bw1)} per dag${lastUp.marg == null ? '' : `: elke extra € ads bracht ±${eur2.format(lastUp.marg)} brutowinst`}${lastUp.zeker ? '' : ', maar onzeker: grote orders maken de winst per dag grillig'}${lastUp.spring ? ' (voorjaar: de vraag steeg ook vanzelf, dus te rooskleurig)' : ''}.`);
    if (H.G) txt.push(gRoom ? `Google Zoeken mist ${pct0.format(H.G.lb)} van de vertoningen door budget: extra budget koopt daar dezelfde zoekopdrachten tegen ongeveer dezelfde prijs.` : `Google Zoeken mist maar ${pct0.format(H.G.lb)} door budget${H.G.lr >= 0.3 ? ` en ${pct0.format(H.G.lr)} door rangschikking (bod/kwaliteit)` : ''}: meer budget gaat daar vooral naar duurdere klikken.`);
    if (H.M) txt.push(mSat ? `Meta raakt verzadigd: mensen zien de advertenties ${dec1.format(H.M.f7)}× per week${H.M.dC > 0.05 ? `, CPM ${H.M.dC >= 0 ? '+' : '−'}${pct0.format(Math.abs(H.M.dC))} t.o.v. de week ervoor` : ''}. Eerst nieuwe creatives of een groter gebied, dan pas meer budget.` : `Meta heeft nog bereik: ${dec1.format(H.M.f7)}× per week per persoon, CPM ${H.M.dC >= 0 ? '+' : '−'}${pct0.format(Math.abs(H.M.dC))} t.o.v. de week ervoor.`);
    const why = el('ul', 'ad-why'); txt.forEach((t) => why.append(el('li', '', t)));
    // indicator tiles
    const tl = el('div', 'ad-kpis');
    const tile = (l, val, sub, st) => { const t = el('div', 'ad-kpi ad-kpi-main' + (st ? ' ad-kpi-' + st : '')); t.append(el('div', 'ad-kpi-l', l), el('div', 'ad-kpi-v', val), el('div', 'ad-kpi-s', sub)); tl.append(t); };
    tile(last && !last.up ? 'Laatste stap (verlaging): brutowinst kwijt per bespaarde €' : 'Laatste stap: extra brutowinst per extra € ads', last && last.marg != null ? (last.up || last.marg > 0 ? eur2.format(last.marg) : '€ 0 (winst steeg)') : '–', last ? `${last.up ? 'verhoging' : 'verlaging'} ${dShort(last.d)} · ${last.na} dagen erna · POAS ${last.poas0 == null ? '–' : dec1.format(last.poas0)} → ${last.poas1 == null ? '–' : dec1.format(last.poas1)}${last.zeker ? '' : ' · onzeker'}` : 'geen budgetstap gevonden', last && last.marg != null ? (last.kind === 'up' ? 'good' : last.kind === 'down' ? 'bad' : '') : '');
    tile('Google Zoeken: gemist door budget', H.G ? pct0.format(H.G.lb) : '–', H.G ? `laatste 14 dagen · gemist door rangschikking ${pct0.format(H.G.lr)}` : 'geen zoekcampagnes', H.G ? (gRoom ? 'good' : '') : '');
    tile('Meta: frequentie per week', H.M ? dec1.format(H.M.f7) + '×' : '–', H.M ? `28 dagen ${H.M.f28 == null ? '–' : dec1.format(H.M.f28) + '×'} · CPM ${eur2.format(H.M.cpm7)} (week ervoor ${H.M.cpmv == null ? '–' : eur2.format(H.M.cpmv)})` : 'nog geen Meta-bereikcijfers', H.M ? (mSat ? 'bad' : 'good') : '');
    host.append(tl, why);
    // budget steps as readable rows: what changed, what profit did, conclusion, how sure
    const card = el('div', 'lw-card'); card.style.marginTop = 'var(--cds-gap-md)';
    card.append(el('h3', '', 'Budgetstappen van de afgelopen maanden'), el('p', 'lw-note', 'Per keer dat het dagbudget minstens 15% omhoog of omlaag ging: de 14 dagen ervoor tegen de 14 dagen erna. Klik op een stap voor de details.'));
    const sgn = (v) => (v >= 0 ? '+' : '−') + eur0.format(Math.abs(v));
    S.slice(0, 8).forEach((s) => {
      const r = el('div', 'ad-st'), dS = s.s1 - s.s0, dB = s.bw1 != null ? s.bw1 - s.bw0 : null, pc = s.s0 ? dS / s.s0 : 0;
      const c1 = el('div', 'ad-st-d'); c1.append(el('b', '', dShort(s.d) + ' ' + s.d.slice(2, 4)), el('span', 'ad-st-dir ' + (s.up ? 'up' : 'down'), `${s.up ? '▲ Verhoogd' : '▼ Verlaagd'} ${pct0.format(Math.abs(pc))}`));
      const c2 = el('div', 'ad-st-n');
      c2.append(el('div', '', `Ads ${eur0.format(s.s0)} → ${eur0.format(s.s1)} per dag (${sgn(dS)})`), el('div', '', dB == null ? 'Brutowinst: nog geen cijfers' : `Brutowinst ${eur0.format(s.bw0)} → ${eur0.format(s.bw1)} per dag (${sgn(dB)})`));
      let concl;
      if (s.na < 7) concl = `Pas ${s.na} dagen na de stap: over een week te beoordelen.`;
      else if (s.marg == null) concl = 'Geen winstcijfers voor deze periode.';
      else if (s.up) concl = `Elke extra € ads leverde ${eur2.format(s.marg)} brutowinst op: ${s.marg >= 1.5 ? 'verdient zich ruim terug' : s.marg >= 1 ? 'verdient zich net terug (bezorg- en vaste kosten niet gedekt)' : 'verdient zich niet terug'}.`;
      else concl = s.marg <= 0 ? `${eur0.format(-dS)} per dag bespaard en de brutowinst ging zelfs omhoog.` : `${eur0.format(-dS)} per dag bespaard, ${eur0.format(-dB)} per dag brutowinst kwijt (${eur2.format(s.marg)} per bespaarde €): ${s.marg < 1 ? 'de besparing is groter dan het verlies' : 'het verlies is groter dan de besparing'}.`;
      const c3 = el('div', 'ad-st-c', concl);
      const c4 = el('div', 'ad-st-v'), vtxt = s.na < 7 ? 'Te vroeg' : s.label.replace(/ \(.*\)$/, '');
      c4.append(el('span', 'ad-chip ' + (s.na < 7 ? 'hold' : s.base), vtxt));
      const ct = { zeker: ['ok', 'betrouwbaar'], onzeker: ['warn', 'onzeker'], seizoen: ['warn', 'seizoen speelt mee'] }[s.cert];
      if (ct) c4.append(el('span', 'ad-chip ' + ct[0], ct[1]));
      if (s.na >= 7 && s.na < 14) c4.append(el('span', 'ad-chip warn', `${s.na} van 14 dagen`));
      r.append(c1, c2, c3, c4);
      const det = el('div', 'ad-st-det'); det.hidden = true;
      det.append(el('span', '', `POAS ${s.poas0 == null ? '–' : dec1.format(s.poas0)} → ${s.poas1 == null ? '–' : dec1.format(s.poas1)}`), el('span', '', `CPM ${s.cpm0 == null ? '–' : eur2.format(s.cpm0)} → ${s.cpm1 == null ? '–' : eur2.format(s.cpm1)}`), el('span', '', `Meta per winkelwagen ${s.cpa0 == null ? '–' : eur0.format(s.cpa0)} → ${s.cpa1 == null ? '–' : eur0.format(s.cpa1)}`),
        el('span', '', s.cert === 'onzeker' ? 'Onzeker: het verschil in brutowinst is kleiner dan de normale schommeling door grote orders.' : s.cert === 'seizoen' ? (s.up ? 'Seizoen: in februari–mei stijgt de vraag ook zonder extra budget, dus de opbrengst lijkt beter dan hij is.' : 'Seizoen: in juli–september daalt de vraag ook zonder minder budget, dus het verlies komt grotendeels door het seizoen.') : s.cert === 'zeker' ? 'Betrouwbaar: het verschil is groter dan de normale schommeling.' : ''));
      r.addEventListener('click', () => { det.hidden = !det.hidden; r.classList.toggle('open', !det.hidden); });
      card.append(r, det);
    });
    if (!S.length) card.append(el('p', 'lw-note', 'Geen budgetstappen van 15% of meer in het afgelopen halfjaar.'));
    host.append(card);
    return { lastUp, gRoom, mSat };
  }

  // ---------- Meta ad fatigue ----------
  function fatigueData() {
    const MA = getRows('meta_ads') || [], ads = new Map();
    for (const r of MA) if (r.lvl === 'ad') { const o = ads.get(r.id) || { id: r.id, n: r.n, c: r.c, ct: r.ct }; o[r.w] = r; ads.set(r.id, o); }
    const peil = (MA[0] || {}).peil;
    const ctr = (o) => (o && o.i ? o.k / o.i : null);
    const rows = [...ads.values()].filter((a) => a['7d'] && a['7d'].s > 0).map((a) => {
      const w7 = a['7d'], w28 = a['28d'] || w7, c7 = ctr(w7), c28 = ctr(w28), drop = c7 != null && c28 ? c7 / c28 - 1 : null;
      const age = a.ct && peil ? days(a.ct, peil) : null, hi = w7.f >= 3 || (w28.f || 0) >= 4;
      let kind, label, tip;
      if (hi && drop != null && drop <= -0.2) { kind = 'down'; label = 'Moe'; tip = 'vervangen: vaak gezien en er wordt minder geklikt'; }
      else if (hi) { kind = 'hold'; label = 'Let op'; tip = 'hoge frequentie, klikken houden nog stand: nieuwe variant klaarzetten'; }
      else if (drop != null && drop <= -0.25 && w7.f >= 2) { kind = 'hold'; label = 'Let op'; tip = 'klikratio zakt: hook of eerste beeld vernieuwen'; }
      else { kind = 'up'; label = 'Fris'; tip = ''; }
      return { a, w7, w28, c7, c28, drop, age, kind, label, tip, cpa: w28.atc ? w28.s / w28.atc : null };
    });
    const byC = new Map(); for (const r of rows) { const o = byC.get(r.a.c) || { ads: [], s: 0, moeS: 0, fW: 0 }; o.ads.push(r); o.s += r.w7.s; o.fW += r.w7.f * r.w7.s; if (r.kind === 'down') o.moeS += r.w7.s; byC.set(r.a.c, o); }
    for (const o of byC.values()) { o.f = o.s ? o.fW / o.s : null; o.moeShare = o.s ? o.moeS / o.s : 0; o.letop = o.ads.some((r) => r.kind === 'hold'); o.ads.sort((x, z) => z.w7.s - x.w7.s); }
    return { rows, byC, acc7: MA.find((r) => r.lvl === 'acct' && r.w === '7d'), acc28: MA.find((r) => r.lvl === 'acct' && r.w === '28d'), peil };
  }

  // ---------- today: one numbered to-do list from the advice, the campaigns and the signals ----------
  function todoView(P, PLr, sig) {
    const host = document.getElementById('ad-todo'); if (!host) return; host.replaceChildren();
    const items = [], A = lastAdv, it = (tag, kind, txt, sub, href) => items.push({ tag, kind, txt, sub, href });
    if (A) {
      const d = A.rec / 7, sh = A.now.share, split = `Meta ${eur0.format(d * sh)}, Google ${eur0.format(d * (1 - sh))}`;
      if (A.kind === 'good') it('Budget', 'up', `Dagbudget van ${eur0.format(A.dag)} naar ${eur0.format(d)}`, split, '#ad-s-camp');
      else if (A.kind === 'bad') it('Budget', 'down', `Dagbudget van ${eur0.format(A.dag)} naar ${eur0.format(d)}`, `${split}; zwakste campagnes eerst`, '#ad-s-camp');
      else if (Math.abs(A.dag / d - 1) > 0.1) it('Budget', A.dag > d ? 'down' : 'up', `Dagbudget van ${eur0.format(A.dag)} naar ${eur0.format(d)}`, split, '#ad-s-advies');

    }
    const L = (PLr && PLr.L) || [], plN = (x) => (x.p === 'm' ? 'Meta' : 'Google');
    const acts = L.filter((x) => x.act === 'fresh' || (x.act === 'down' && x.cur - x.to >= 1) || (x.act === 'up' && x.to - x.cur >= 1)).sort((a, b) => ({ down: 0, fresh: 1, up: 2 }[a.act] - { down: 0, fresh: 1, up: 2 }[b.act]) || Math.abs(b.to - b.cur) - Math.abs(a.to - a.cur));
    for (const x of acts.slice(0, 5)) {
      if (x.act === 'fresh') { const moe = x.fc ? x.fc.ads.filter((z) => z.kind === 'down').map((z) => `"${z.a.n}"`).join(', ') : ''; it(plN(x), 'hold', `${x.n}: nieuwe creative maken`, moe ? `${moe} is moe` : '', '#ad-s-camp'); }
      else it(plN(x), x.act, `${x.n}: ${x.bud ? 'dagbudget ' : ''}${eur0.format(x.bud || x.cur)} → ${eur0.format(x.to)}`, x.act === 'down' ? 'verliest geld, ook met één order extra' : '', '#ad-s-camp');
    }
    if (acts.length > 5) it('Campagnes', 'info', `Nog ${acts.length - 5} campagne-aanpassing${acts.length - 5 > 1 ? 'en' : ''}`, 'zie het campagne-advies', '#ad-s-camp');
    for (const [lv, t] of sig) if (lv === 0) it('Let op', 'down', t, '', '');
    const nx = lastPlan && lastPlan.find((r) => r.fut && r.chg > 0);
    if (nx && days(P.t, nx.w) <= 14) it('Voorbereiden', 'info', `Volgende opschaalstap week van ${dShort(nx.w)}: ${eur0.format(nx.plan / 7)}/dag (+${pct0.format(nx.chg)})`, 'campagnes en creatives een week ervoor klaarzetten', '#ad-opschaal');
    const W = window.mkWeerAdvice ? window.mkWeerAdvice() : null;
    if (W && W.lvl !== 'hold' && W.season) it('Weer', W.lvl === 'up' ? 'up' : 'hold', W.head, W.short || '', '#mk-weer-sec');
    if (!items.length) { host.append(el('h3', '', 'Vandaag doen'), el('p', 'lw-note', 'Niets: alles staat goed.')); return; }
    host.append(el('h3', '', 'Vandaag doen'));
    const ol = el('ol');
    for (const x of items) { const li = el('li'), c = el('div'); c.append(el('span', 'ad-tag ' + x.kind, x.tag), document.createTextNode(x.txt)); if (x.sub) c.append(el('small', '', x.sub)); li.append(c); if (x.href) { const a = el('a', '', '›'); a.title = 'Bekijk'; a.href = x.href; li.append(a); } else li.append(el('span')); ol.append(li); }
    host.append(ol);
    const rest = sig.filter(([lv]) => lv > 0);
    if (rest.length) { const lo = el('div', 'ad-lo'), ul = el('ul'); rest.slice(0, 5).forEach(([, t]) => ul.append(el('li', '', t))); lo.append(el('b', '', 'Om in de gaten te houden'), ul); host.append(lo); }
  }

  // ---------- render ----------
  function render() {
    const D = load();
    if (!D || !window.bgEngine) return;
    const m = new Map(); for (const [d, r] of D.S) m.set(d, +r.omzet || 0);
    E = window.bgEngine(m, dash.params(), today()); lyCache.clear(); kCache.clear(); normCache.clear(); shareCache.clear(); seasonCache = null;
    const P = period(D);
    const M = pilot(D, P);
    yearTable(D, P);
    const rows = campRows(D, P.end);
    const FD = fatigueData(), X = { rend: rendView(D, P), moe: FD.rows.filter((r) => r.kind !== 'up') };
    const SIG = signals(D, P, M, rows, X);
    document.querySelectorAll('#ad-periode [data-per]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.per === P.per)));
    for (const [id, v] of [['ad-from', P.from], ['ad-to', P.to]]) { const n = document.getElementById(id); if (document.activeElement !== n) n.value = v; n.max = P.end; }
    document.querySelector('#ad-periode .ad-custom').classList.toggle('on', P.per === 'custom');
    document.getElementById('ad-range').textContent = `${dShort(P.from)} – ${dShort(P.to)} · vergeleken met ${dShort(P.pf)} – ${dShort(P.pt)} en vorig jaar ${dShort(P.lf)} – ${dShort(P.lt)} · ads t/m ${D.lastAd ? dShort(D.lastAd) : '–'}, winst t/m ${D.lastPm ? dShort(D.lastPm) : '–'}`;
    const T = tiles(D, P);
    platformTable(T.cur, T.prev);
    opschaal(D, P);
    const PL = campAdvice(rows, (tot(D, addD(P.end, -89), P.end).aov || 1230) * 1.21, FD);
    const selM = dash.params().ad_maand, curM = P.t.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(selM || '') && selM !== curM) monthView(D, P, selM);
    else if (lastAdv) {
      // one advice for the whole page: the month verdict takes the weekly advice of the opschaalplan
      const v = document.getElementById('ad-verdict'), A = lastAdv, d = A.rec / 7;
      v.className = 'ad-verdict ad-v-' + (A.kind === 'good' ? 'up' : A.kind === 'bad' ? 'down' : 'hold');
      v.replaceChildren(el('b', '', A.title + ` · ${eur0.format(d)} per dag`), el('span', '', A.short + (Math.abs(A.dag / d - 1) > 0.1 ? ` Nu gaat er ${eur0.format(A.dag)} per dag uit.` : '')));
    }
    const PLp = PL ? PL.plat : null, lft = PLp ? (PLp.m.left || 0) + (PLp.g.left || 0) : 0;
    if (lastAdv && lastAdv.kind === 'good' && !(/^\d{4}-\d{2}$/.test(selM || '') && selM !== curM) && lft >= 5) document.getElementById('ad-verdict').append(el('span', 'ad-warn', `Waarvan ±${eur0.format(lft)} per dag nu nergens goed heen kan: ${[PLp.m.left >= 1 ? (PLp.m.fresh ? 'bij Meta eerst nieuwe creatives' : 'bij Meta geen campagne met ruimte') : '', PLp.g.left >= 1 ? 'bij Google geen rendabele campagne met ruimte' : ''].filter(Boolean).join(', ')}.`));
    if (lastAdv && lastAdv.kind === 'good' && !(/^\d{4}-\d{2}$/.test(selM || '') && selM !== curM) && X.rend && (X.rend.lastUp && X.rend.lastUp.kind === 'down' || X.rend.mSat && !X.rend.gRoom)) {
      document.getElementById('ad-verdict').append(el('span', 'ad-warn', X.rend.lastUp && X.rend.lastUp.kind === 'down' ? `Let op: de laatste verhoging (${dShort(X.rend.lastUp.d)}) rendeerde niet. Verhoog alleen bij Google-campagnes die vertoningen missen door budget, niet over de hele linie.` : 'Let op: het Meta-publiek is verzadigd en Google mist weinig door budget. Extra budget eerst in nieuwe creatives of een groter gebied steken.'));
    }
    todoView(P, PL, SIG);
    document.getElementById('ad-mnow').hidden = !selM || selM === curM;
    if (!document.getElementById('pg-ads').hidden) opschaalChart();
  }
  document.querySelectorAll('#ad-periode [data-per]').forEach((b) => b.addEventListener('click', () => dash.setParams({ ad_per: b.dataset.per })));
  const mShift = (n) => { const cur = dash.params().ad_maand || today().slice(0, 7); const d = new Date(Date.UTC(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)) - 1 + n, 1)); dash.setParams({ ad_maand: d.toISOString().slice(0, 7) }); };
  document.getElementById('ad-mprev').addEventListener('click', () => mShift(-1));
  document.getElementById('ad-mnext').addEventListener('click', () => mShift(1));
  document.getElementById('ad-mnow').addEventListener('click', () => dash.setParams({ ad_maand: null }));
  const onCustom = () => { const f = document.getElementById('ad-from').value, t = document.getElementById('ad-to').value; if (f && t) dash.setParams({ ad_per: 'custom', ad_from: f, ad_to: t }); };
  ['ad-from', 'ad-to'].forEach((id) => document.getElementById(id).addEventListener('change', onCustom));
  let tj; const setLater = (k, v) => { clearTimeout(tj); tj = setTimeout(() => dash.setParams({ [k]: v }), 450); };
  const curYear = () => Number(document.getElementById('ad-year').textContent) || Number(today().slice(0, 4));
  document.getElementById('ad-yprev').addEventListener('click', () => dash.setParams({ ad_jaar: String(curYear() - 1) }));
  document.getElementById('ad-ynext').addEventListener('click', () => dash.setParams({ ad_jaar: String(curYear() + 1) }));
  dash.onData(render);
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
})();
