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
  const vol = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean).join(' · ');
  const naamCel = (td, r, caret) => { if (caret) td.append(caret); td.append(document.createTextNode(vol(r.naam)), el('div', 'dk-sku', r.sku)); return td; };
  // opnieuw tekenen zonder te verspringen: houd de opengeklapte regel (of anders de scrollpositie) op dezelfde plek in beeld
  function keepPos(fn) {
    const root = document.getElementById('pg-vr');
    const anc = root && root.querySelector('tr.dk-row[aria-expanded="true"]');
    const tid = anc && anc.closest('table') ? anc.closest('table').id : null, key = anc ? anc.dataset.key : null, top = anc ? anc.getBoundingClientRect().top : null;
    const boxes = root ? [...root.querySelectorAll('.lw-tablebox')].map((b) => [b, b.scrollTop]) : [];
    const y = window.scrollY;
    fn();
    for (const [b, t] of boxes) if (b.isConnected) b.scrollTop = t;
    window.scrollTo(0, y);
    if (key && tid) { const n = document.querySelector(`#${tid} tr.dk-row[data-key="${CSS.escape(key)}"]`); if (n) window.scrollBy(0, n.getBoundingClientRect().top - top); }
  }
  const short = (s) => String(s || '').split('|').slice(0, 2).map((x) => x.trim()).join(' · ');
  const pon = (x) => String(x || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  let OPEN_PO = new Set();
  // hoofdleveranciers; Apple Bee (containers) en Apple Bee Magazijn zijn één bedrijf
  const GROEPEN = [['mod', 'MOD Outdoor', /\bmod\b/i], ['ab', 'Apple Bee', /apple ?bee/i], ['tierra', 'Tierra Outdoor', /tierra/i], ['republic', 'Republic', /republic/i]];
  const GNAAM = Object.fromEntries(GROEPEN.map(([k, n]) => [k, n]).concat([['overig', 'Overige leveranciers']]));
  const grpNaam = (n) => { for (const [k, , re] of GROEPEN) if (re.test(String(n || ''))) return k; return 'overig'; };
  // 'Leverancier 20734' was een verzamelaccount (bestaat niet meer): dan op merk/containersheet indelen
  // producten zonder leverancier in Sumtracker (nooit op een inkooporder, of het oude verzamelaccount 20734):
  // leverancier afleiden van de andere producten uit dezelfde collectie en hetzelfde materiaal (bv. Daan teak → Republic, Daan alu → Ningbo)
  // leverancier per product: handmatig gekozen (gedeeld document voorraad/leverancier) > uit Sumtracker-inkooporders > afgeleid van de collectie
  // Apple Bee Containers en Apple Bee Magazijn tonen we als één leverancier: Apple Bee
  const PREP = new WeakMap(); let LEVVER = 0, LEVO = {};
  const onbekendeLev = (r) => !r.leverancier || r.leverancier === 'Onbekend' || /^Leverancier \d+$/.test(r.leverancier);
  function prepDk(dk) {
    if (!dk || PREP.get(dk) === LEVVER) return; PREP.set(dk, LEVVER);
    for (const r of dk) {
      if (!('_l0' in r)) { r._l0 = r.leverancier; r._i0 = r.leverancier_id; }
      r.leverancier = r._l0; r.leverancier_id = r._i0; delete r.lev_afgeleid; delete r.lev_handmatig; delete r.lev_origineel;
      const o = LEVO[r.sku]; if (o && o.naam) { r.leverancier = o.naam; r.leverancier_id = o.id ?? null; r.lev_handmatig = true; }
    }
    const mat = (r) => (/teak/i.test(r.naam || '') && !/alumin/i.test(r.naam || '') ? 'teak' : /alumin/i.test(r.naam || '') ? 'alu' : /rope|wicker/i.test(r.naam || '') ? 'rope' : '');
    const tel = new Map();
    const add = (k, r) => { const m = tel.get(k) || new Map(); const id = r.leverancier_id; const o = m.get(id) || { n: 0, naam: r.leverancier }; o.n += 1 + (Number(r.verkocht_52w) || 0); m.set(id, o); tel.set(k, m); };
    const merkK = (r) => 'merk:' + (collectie(r).merk || r.merk || '').toLowerCase();
    for (const r of dk) if (!onbekendeLev(r) && r.leverancier_id != null) { const c = collectie(r).model; add(c + '|' + mat(r), r); add(c, r); add(merkK(r), r); }
    for (const r of dk) {
      if (r.lev_handmatig || !onbekendeLev(r)) continue;
      if (HERK[r.sku] && HERK[r.sku].leverancier) { r.lev_origineel = r.leverancier; r.leverancier = HERK[r.sku].leverancier; r.lev_afgeleid = true; continue; } // Apple Bee containersheet
      if (/dienblad/i.test(r.naam || '')) continue; // losse accessoires: blijven bij Overige
      const c = collectie(r).model; let m = tel.get(c + '|' + mat(r)) || tel.get(c);
      if (!m) { // anders op merk, als één leverancier het merk duidelijk levert
        const mm = tel.get(merkK(r)); if (!mm) continue;
        const tot = [...mm.values()].reduce((t, o) => t + o.n, 0), best = [...mm.values()].sort((p, q) => q.n - p.n)[0];
        if (best.n < tot * 0.8) continue; m = mm;
      }
      const [id, o] = [...m.entries()].sort((p, q) => q[1].n - p[1].n)[0];
      r.lev_origineel = r.leverancier; r.leverancier = o.naam; r.leverancier_id = id; r.lev_afgeleid = true;
    }
    for (const r of dk) if (/apple ?bee/i.test(r.leverancier || '')) r.leverancier = 'Apple Bee';
  }
  async function saveLev(sku, v) {
    LEVO = Object.assign({}, LEVO); if (v == null) delete LEVO[sku]; else LEVO[sku] = v; LEVVER++;
    try { if (db) { const g = await db.doc('voorraad/leverancier').get(); const w = Object.assign({}, g.exists ? g.data().waarden || {} : {}); if (v == null) delete w[sku]; else w[sku] = v; await db.doc('voorraad/leverancier').set({ waarden: w, at: new Date().toISOString() }); } } catch (e) { /* lokaal */ }
    keepPos(() => { render(); dkDecorate(); });
  }
  const grpProd = (r) => { const g = grpNaam(r.leverancier); if (g !== 'overig') return g; if (HERK[r.sku] && HERK[r.sku].leverancier) return grpNaam(HERK[r.sku].leverancier); return r.merk === 'Apple Bee' ? 'ab' : 'overig'; };
  const isAdmin = () => !!(dash.user && dash.user.r === 'beheerder');

  // ---------- CBM per product (gedeeld document voorraad/cbm) ----------
  let CBM = {}, HERK = {}, GROEI = {}, STAT = {}, cbmLoaded = false, db = null;
  // bestelstatus per product: {type:'stop'} = niet meer bestellen, {type:'wacht', tot} = even aankijken tot datum
  const holdOf = (sku) => { const h = STAT[sku]; if (!h) return null; if (h.type === 'wacht' && h.tot && h.tot < today()) return null; return h; };
  async function saveStat(sku, v) {
    STAT = Object.assign({}, STAT); if (v == null) delete STAT[sku]; else STAT[sku] = v;
    try { if (db) { const g = await db.doc('voorraad/bestelstatus').get(); const w = Object.assign({}, g.exists ? g.data().waarden || {} : {}); if (v == null) delete w[sku]; else w[sku] = v; await db.doc('voorraad/bestelstatus').set({ waarden: w, at: new Date().toISOString() }); } } catch (e) { /* lokaal */ }
    keepPos(() => { render(); dkDecorate(); });
  }
  const holdTxt = (h) => (h.type === 'weg' ? 'Verborgen' : h.type === 'stop' ? 'Niet meer bestellen' : `Aankijken t/m ${dNl(h.tot)}`);
  const verborgen = (sku) => !!(STAT[sku] && STAT[sku].type === 'weg'); // verkopen we niet meer: uit alle lijsten (telt wel mee bij Opslag)
  function holdKnoppen(sku) {
    const h = holdOf(sku); const bar = el('div', 'lw-mini'); bar.append(el('span', 'dk-lbl', 'Bestellen:'));
    const opts = [[null, 'Normaal meenemen'], ['wacht', 'Even aankijken (4 weken)'], ['stop', 'Niet meer bestellen'], ['weg', 'Verbergen (verkopen we niet meer)']];
    for (const [t, l] of opts) { const b = el('button', '', l); b.type = 'button'; b.setAttribute('aria-pressed', String((h ? h.type : null) === t)); b.addEventListener('click', (e) => { e.stopPropagation(); saveStat(sku, t ? { type: t, tot: t === 'wacht' ? addD(today(), 28) : null, at: today() } : null); }); bar.append(b); }
    return bar;
  }
  // ---------- verwachte verkoop per product, met gekozen groei ----------
  // basis = eigen verkoop in dezelfde maand van het laatste volle jaar (als het product ≥ 52 weken loopt), anders winkelpatroon;
  // groei: getal in % of 'b' = begroting (per maand uit 'Omzet tegen begroting')
  const SEIZ = () => rows('st_seizoen') || [];
  const keuze = (sku) => (GROEI[sku] == null ? 'b' : GROEI[sku]);
  function vraagMet(r, g) {
    const base = r.vraag_eigen || r.vraag0;
    if (!base) return r.vraag || [];
    const sz = SEIZ();
    return base.map((x, i) => x * (1 + (g === 'b' ? bgWeek(sz[i] ? sz[i].week : null, sz[i]) : Number(g) || 0) / 100));
  }
  // begrote groei (procent) per maand: zelfde bron als de begroting in het weekrapport (gedeelde waarden bg_<jaar>_<mm>), dus live
  const bgPct = (y, mo) => { const v = dash.params()['bg_' + y + '_' + String(mo).padStart(2, '0')]; const n = Number(String(v ?? '').replace(',', '.')); if (v !== undefined && v !== null && v !== '' && !Number.isNaN(n)) return n; const p = (window.BG_PLAN || {})[y]; return p ? p[mo - 1] : 25; };
  const bgDefault = (y, mo) => { const v = dash.params()['bg_' + y + '_' + String(mo).padStart(2, '0')]; return v === undefined || v === null || v === ''; };
  // week telt mee in de maand van zijn donderdag (zoals de server)
  const bgWeek = (wk, srow) => { if (!wk) return srow ? Number(srow.groei) || 0 : 0; const d = addD(wk, 3); return bgPct(+d.slice(0, 4), +d.slice(5, 7)); };
  window.vrVraag = (r) => vraagMet(r, keuze(r.sku));
  async function saveGroei(sku, v) {
    GROEI = Object.assign({}, GROEI); if (v == null) delete GROEI[sku]; else GROEI[sku] = v;
    try { if (db) { const g = await db.doc('voorraad/groei').get(); const w = Object.assign({}, g.exists ? g.data().waarden || {} : {}); if (v == null) delete w[sku]; else w[sku] = v; await db.doc('voorraad/groei').set({ waarden: w, at: new Date().toISOString() }); } } catch (e) { /* alleen lokaal */ }
    keepPos(() => { render(); dkDecorate(); });
  }
  const LOCNAAM = { I: 'China', J: 'China', C: 'China', E: 'China', A: 'Indonesië', B: 'Indonesië' };
  (async () => {
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
    try { if (db) { const s = await db.doc('voorraad/cbm').get(); CBM = s.exists ? (s.data().waarden || {}) : {}; } } catch (e) { CBM = {}; }
    try { if (db) { const h = await db.doc('voorraad/herkomst').get(); HERK = h.exists ? (h.data().waarden || {}) : {}; } } catch (e) { HERK = {}; }
    try { if (db) { const g = await db.doc('voorraad/groei').get(); GROEI = g.exists ? (g.data().waarden || {}) : {}; } } catch (e) { GROEI = {}; }
    try { if (db) { const g = await db.doc('voorraad/bestelstatus').get(); STAT = g.exists ? (g.data().waarden || {}) : {}; } } catch (e) { STAT = {}; }
    try { if (db) { const g = await db.doc('voorraad/leverancier').get(); LEVO = g.exists ? (g.data().waarden || {}) : {}; } } catch (e) { LEVO = {}; }
    LEVVER++;
    cbmLoaded = true; COLCACHE.clear(); render(); try { dkDecorate(); } catch (e) { /* */ }
  })();
  async function saveCbm(sku, v) {
    if (!db) return;
    const s = await db.doc('voorraad/cbm').get();
    const w = Object.assign({}, s.exists ? s.data().waarden || {} : {});
    if (v == null) delete w[sku]; else w[sku] = v;
    await db.doc('voorraad/cbm').set({ waarden: w, at: new Date().toISOString() });
    CBM = w; render();
  }
  // Apple Bee-portaal (dataset ab_portaal): magazijnvoorraad Dongen, prijs en volume per artikel; een SKU kan uit meerdere artikelen bestaan (a+b)
  let ABC = { rows: null, map: new Map() };
  function abInfo(sku) {
    const rs = rows('ab_portaal'); if (!rs) return null;
    if (ABC.rows !== rs || ABC.herk !== HERK) { ABC = { rows: rs, herk: HERK, map: new Map(rs.map((r) => [String(r.artikel), r])) }; ABC.sku = new Map(); }
    if (ABC.sku.has(sku)) return ABC.sku.get(sku);
    const h = HERK[sku]; let out = null;
    if (h && h.artikel) {
      const parts = String(h.artikel).split('+').map((a) => ABC.map.get(a.trim())).filter(Boolean);
      if (parts.length) out = { cbm: parts.reduce((t, p) => t + (Number(p.cbm) || 0), 0), mag: Math.min(...parts.map((p) => Number(p.magazijn) || 0)), prijs: parts.reduce((t, p) => t + (Number(p.prijs_magazijn) || 0), 0), fob: parts.reduce((t, p) => t + (Number(p.prijs_fob_usd) || 0), 0), moq: Math.max(...parts.map((p) => Number(p.moq_magazijn) || 1)), later: parts[0].magazijn_later || [], fabriek: parts[0].fabriek, artikel: h.artikel };
    }
    ABC.sku.set(sku, out); return out;
  }
  // cel 'Dongen': voorraad Apple Bee-magazijn, prijs, en wanneer er weer iets komt; rood als het niet genoeg is om het gat tot de container te dichten
  function dongenCel(r, nodig) {
    const td = el('td', 'ab-dongen'); const ai = abInfo(r.sku);
    if (!ai) { td.textContent = HERK[r.sku] || /^AB-/.test(r.sku) ? '—' : ''; td.title = HERK[r.sku] ? 'Nog geen gegevens uit het Apple Bee-portaal' : ''; return td; }
    if (!(ai.prijs > 0)) { td.append(el('b', '', '—'), el('small', '', 'niet via magazijn')); td.title = `Artikel ${ai.artikel} is niet via het Apple Bee-magazijn te bestellen, alleen per container (FOB $ ${int.format(ai.fob)}).`; return td; }
    if (nodig && ai.mag < nodig) td.classList.add('ab-kort');
    td.append(el('b', '', ai.mag > 0 ? `${int.format(ai.mag)} st` : 'op'));
    const later = (ai.later || []).find((l) => l && l.available > 0);
    if (later) td.append(el('small', '', `+${int.format(later.available)} op ${dNl(later.eta)}`));
    td.title = `Apple Bee-magazijn Dongen, artikel ${ai.artikel}. Magazijnprijs ${eur0.format(ai.prijs)}, FOB $ ${int.format(ai.fob)}${ai.moq > 1 ? ', min. ' + ai.moq + ' st' : ''}${nodig ? `. Nodig tot de container: ${int.format(nodig)} st` : ''}.`;
    return td;
  }
  const cbmOf = (sku) => { const v = Number(CBM[sku]); if (v > 0) return v; const a = abInfo(sku); return a && a.cbm > 0 ? Math.round(a.cbm * 1000) / 1000 : null; };

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
    out.n = new Map([...by].map(([k, a]) => [k, a.length]));
    return out;
  }
  const guess = (name) => (/mod|foshan|ningbo|cathrine|container|tierra|republic/i.test(name || '') ? 13 : 2);

  // ---------- Chinees Nieuwjaar ----------
  // Chinese fabrieken werken tot ± half januari, starten weer eind februari; eerste verschepingen pas weer begin/half maart.
  // Levertijd L = productie (± de helft) + verschepen/varen (de rest). Valt de productie in de stop, dan schuift die op;
  // is de container klaar in de stop, dan vertrekt hij pas begin maart.
  const CNY = (y) => ({ stop: `${y}-01-15`, start: `${y}-02-28`, varen: `${y}-03-10`, boekVoor: `${y - 1}-12-01` });
  // Na Nieuwjaar wil iedereen tegelijk verschepen: wie pas na ± 1 december bestelt, mist de eerste schepen (± 3 weken later weg).
  const DRUKTE = 21;
  // Indonesië (Republic, Apple Bee locatie A en B): Lebaran (Idul Fitri), fabrieken ± 2 weken dicht rond de feestdag
  const LEBARAN = { 2026: '2026-03-20', 2027: '2027-03-10', 2028: '2028-02-27', 2029: '2029-02-15', 2030: '2030-02-05' };
  function aankomstNa(besteld, L, land) {
    const prod = Math.round(L / 2), vaar = L - prod;
    let klaar = addD(besteld, prod * 7), cny = false, leb = false;
    if (land === 'china') {
      for (const y of [Number(besteld.slice(0, 4)), Number(besteld.slice(0, 4)) + 1]) {
        const c = CNY(y);
        if (besteld < c.start && klaar > c.stop) { // productie loopt door de stop heen: stilstand erbij
          const stil = Math.round((P0(c.start) - P0(besteld > c.stop ? besteld : c.stop)) / DAY);
          klaar = addD(klaar, stil); cny = true;
        }
        if (klaar >= c.stop && klaar < c.varen) { klaar = besteld < c.boekVoor ? c.varen : addD(c.varen, DRUKTE); cny = true; } // klaar in de stop: vertrek na Nieuwjaar
      }
    } else if (land === 'indo') {
      for (const y of [Number(besteld.slice(0, 4)), Number(besteld.slice(0, 4)) + 1]) {
        const e = LEBARAN[y]; if (!e) continue;
        const van = addD(e, -7), tot = addD(e, 7);
        if (besteld < tot && klaar > van) { klaar = addD(klaar, 14); leb = true; }
      }
    }
    return { datum: addD(klaar, vaar * 7), cny, leb };
  }

  // ---------- advies per product ----------
  function advies(r, P, L, vOverride, land) {
    const D = Math.max(1, num(P.vr_dek, 16)), B = Math.max(0, num(P.vr_buf, 2));
    const v = vOverride || window.vrVraag(r), H = v.length;
    const t0 = r._week0;
    const arr = new Array(H).fill(0);
    for (const x of r.leveringen || []) { const dt = (r._cpEta && r._cpEta.get(pon(x.po))) || x.datum; const i = Math.max(0, Math.floor((P0(dt < today() ? today() : dt) - P0(t0)) / DAY / 7)); if (i < H) arr[i] += Number(x.stuks) || 0; }
    // voorraad doorrekenen zonder nieuwe bestelling
    let s = Number(r.voorraad) || 0, opIdx = null; const proj = [];
    for (let i = 0; i < H; i++) { s += arr[i]; s -= v[i]; proj.push(s); if (opIdx === null && s < 0) opIdx = i; }
    // bestelmoment: eerste week vanaf de levertijd (eerder kan een nieuwe bestelling niet binnen zijn) waarin de voorraad
    // onder de veiligheidsvoorraad zakt; bestellen uiterlijk = die week − levertijd
    const bufAt = (i) => v.slice(i + 1, i + 1 + B).reduce((a, b) => a + b, 0);
    // aankomst (weekindex) als je in week o bestelt, met Chinees Nieuwjaar voor Chinese leveranciers
    const arrOf = (o) => { const x = aankomstNa(addD(t0 < today() ? today() : t0, o * 7), L, land); return { i: Math.min(H - 1, Math.max(0, Math.ceil((P0(x.datum) - P0(t0)) / DAY / 7))), cny: x.cny, leb: x.leb }; };
    const nu = arrOf(0);
    const a = nu.i;
    let rp = null;
    for (let i = a; i < H; i++) if (proj[i] < bufAt(i)) { rp = i; break; }
    // laatste bestelweek waarvan de levering nog vóór het bestelpunt binnen is
    let orderBy = null;
    if (rp !== null) { orderBy = -1; for (let o = 0; o <= rp; o++) { if (arrOf(o).i <= rp) orderBy = o; } if (orderBy < 0) orderBy = 0; }
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
    const tekortVoor = Math.max(0, -Math.min(0, ...proj.slice(0, Math.max(1, a))));
    return { cny: nu.cny, leb: nu.leb, land, tekortVoor, kortVoor, L, opDatum: opIdx === null ? null : wkTo(opIdx), bestelDatum: orderBy === null ? null : wkTo(Math.max(0, orderBy)), orderBy, qty: rank <= 2 || P.vr_alles ? qty : 0, qtyNu: qty, status, rank, atArr, perWk, aankomst: wkTo(a), D, B, need, inWin, bp: rp === null ? null : wkTo(rp), bufNu: rp === null ? 0 : bufAt(rp) };
  }

  // ---------- containers ----------
  // 20ft alleen waar jullie dat doen: Apple Bee locatie A (Indonesië, dure sets) en I (China, dure tafels); de rest altijd 40ft
  const mag20 = (g, loc) => g === 'ab' && (loc === 'A' || loc === 'I');
  function containers(T, P, met20 = true) {
    const c20 = num(P.vr_c20, 28), c40 = num(P.vr_c40, 58), chq = num(P.vr_chq, 67);
    if (!(T > 0)) return { txt: '—', cap: 0, list: [] };
    const list = [];
    let rest = T;
    while (rest > chq) { list.push(['40HQ', chq]); rest -= chq; }
    if (rest > 0) list.push(met20 && rest <= c20 ? ['20ft', c20] : rest <= c40 ? ['40ft', c40] : ['40HQ', chq]);
    const cap = list.reduce((a, x) => a + x[1], 0);
    const cnt = {}; for (const [k] of list) cnt[k] = (cnt[k] || 0) + 1;
    const txt = Object.entries(cnt).map(([k, n]) => `${n}× ${k}`).join(' + ') + ` · ${pct0.format(T / cap)} vol`;
    return { txt, cap, list };
  }

  // ---------- begroting per maand (bewerkbaar, synchroon met het weekrapport) ----------
  const BGT = {};
  function renderBg() {
    const host = document.getElementById('vr-bg'); if (!host) return;
    const sz = SEIZ(); if (!sz.length) return;
    const dk = rows('st_dekking') || [];
    const focus = host.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    // verwachte verkoop per maand (inkoopwaarde, alle actieve producten), op dagbasis
    const per = new Map();
    for (const r of dk) {
      const k = Number(r.kostprijs) || 0; if (!k) continue;
      const v = window.vrVraag(r);
      for (let i = 0; i < v.length && i < sz.length; i++) { if (!v[i]) continue; for (let j = 0; j < 7; j++) { const m = addD(sz[i].week, j).slice(0, 7); per.set(m, (per.get(m) || 0) + v[i] / 7 * k); } }
    }
    const t = today(), first = t.slice(0, 7), endH = addD(sz[sz.length - 1].week, 6), last = addD(endH, 1).slice(0, 7) > endH.slice(0, 7) ? endH.slice(0, 7) : addD(endH.slice(0, 7) + '-01', -1).slice(0, 7); // alleen volledige maanden binnen de horizon
    const years = []; for (let y = +first.slice(0, 4); y <= +last.slice(0, 4); y++) years.push(y);
    const mn = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    const tbl = el('table', 'lw-table vr-bgt'); const hr = el('tr'); hr.append(el('th', '', ''));
    mn.forEach((m) => hr.append(el('th', 'lw-num', m))); hr.append(el('th', 'lw-num', 'Totaal'));
    const th = el('thead'); th.append(hr); tbl.append(th); const tb = el('tbody');
    for (const y of years) {
      const g = el('tr', 'vr-bgt-g'); g.append(el('td', '', `Groei ${y}`));
      const w = el('tr', 'vr-bgt-w'); w.append(el('td', '', `Verwachte verkoop ${y} (inkoopwaarde)`));
      let tot = 0;
      for (let mo = 1; mo <= 12; mo++) {
        const key = `bg_${y}_${String(mo).padStart(2, '0')}`, ym = `${y}-${String(mo).padStart(2, '0')}`;
        const inRange = ym >= first && ym <= last;
        const td = el('td', 'lw-num');
        if (inRange) {
          const inp = el('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.dataset.key = key;
          inp.value = n1.format(bgPct(y, mo)); if (!bgDefault(y, mo)) inp.classList.add('bg-chg');
          inp.title = `Begrote groei ${mn[mo - 1]} ${y} t.o.v. ${mn[mo - 1]} ${y - 1}`;
          inp.addEventListener('input', () => { clearTimeout(BGT[key]); BGT[key] = setTimeout(() => dash.setParams({ [key]: inp.value.replace(/\./g, '').replace(',', '.').replace('%', '').trim() || null }), 500); });
          td.append(inp, el('span', 'vr-bgt-p', '%'));
        } else td.textContent = '';
        g.append(td);
        const val = inRange ? per.get(ym) || 0 : null; if (val) tot += val;
        w.append(el('td', 'lw-num', val == null ? '' : eur0.format(val) + (ym === first ? '*' : '')));
      }
      g.append(el('td', '')); w.append(el('td', 'lw-num', tot ? eur0.format(tot) : ''));
      tb.append(g, w);
    }
    tbl.append(tb);
    const box = el('div', 'lw-tablebox'); box.append(tbl);
    const reset = el('button', 'vr-link', 'standaardpercentages terugzetten'); reset.type = 'button';
    reset.addEventListener('click', () => { const z = {}; for (const y of years) for (let mo = 1; mo <= 12; mo++) z[`bg_${y}_${String(mo).padStart(2, '0')}`] = null; dash.setParams(z); });
    host.replaceChildren(box, el('p', 'lw-note', '* rest van deze maand. Dit is dezelfde begroting als in het weekrapport: wat je hier aanpast, staat daar ook (en andersom) en is voor iedereen opgeslagen. Bestellijst, containervoorstel en voorraad per product rekenen direct mee, behalve producten waar je een eigen groei hebt gekozen. Geel = aangepast. '), reset);
    if (focus) { const f = host.querySelector(`input[data-key="${focus}"]`); if (f) { f.focus(); const L = f.value.length; f.setSelectionRange(L, L); } }
  }

  let LAST = null, MKX = null; const OPENB = new Set();
  function render() {
    const root = document.getElementById('pg-vr');
    if (!root) return;
    const dk = rows('st_dekking'), pos = rows('vr_pos'), lev = rows('vr_leveranciers'), sz = rows('st_seizoen');
    prepDk(dk);
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
    MKX = (r, vOverride) => { r._week0 = week0; r._cpEta = CPETA; const g = grpProd(r);
      // Apple Bee: altijd uit origine (meer marge) met de containerlevertijd; het magazijn alleen om het gat tot de container te overbruggen
      // (alleen producten die in de containersheet staan; de rest komt alleen uit het magazijn)
      const origine = g === 'ab' && !!HERK[r.sku];
      const L = origine ? leadOf(20084, 'Apple Bee Containers') : g === 'ab' ? leadOf(21362, 'Apple Bee Magazijn') : leadOf(r.leverancier_id, r.leverancier);
      const herLoc = HERK[r.sku] && HERK[r.sku].locatie;
      const land = origine ? (['A', 'B'].includes(herLoc) ? 'indo' : 'china') : g === 'republic' ? 'indo' : g === 'mod' || g === 'tierra' || /foshan|ningbo|cathrine|mod outdoor|tierra/i.test(r.leverancier || '') ? 'china' : null;
      const a = advies(r, P, L, vOverride, land); const c = cbmOf(r.sku);
      const lid = origine ? 20084 : g === 'ab' ? 21362 : r.leverancier_id;
      a.ltBron = P['lt_' + lid] != null && P['lt_' + lid] !== '' ? 'handmatig ingesteld bij Instellingen' : hist.has(lid) ? `mediaan van ${hist.n.get(lid)} eigen inkooporders (besteld → aankomst)` : 'schatting (nog geen inkooporders met datum)';
      a.ltLev = origine ? 'Apple Bee uit origine (container)' : g === 'ab' ? 'Apple Bee-magazijn' : r.leverancier;
      if (origine && a.rank === 0) { a.rank = 1; a.status = 'Nu bestellen'; } // tekort tot de container vangt het magazijn op
      return { r, a, cbm: c, g, origine, mag: origine && a.tekortVoor > 0 ? Math.ceil(a.tekortVoor) : 0 }; };
    const allIncl = dk.filter((r) => actief(r) && !uitlopend(r) && !verborgen(r.sku)).map((r) => MKX(r));
    const uit = allIncl.filter((x) => holdOf(x.r.sku));
    const all = allIncl.filter((x) => !holdOf(x.r.sku));
    LAST = all;
    const urgent = (x) => x.a.rank <= 2;
    const fLev = P.vr_lev != null && P.vr_lev !== '' ? String(P.vr_lev) : '';
    const fSt = P.vr_st || '';
    const inLev = (x) => !fLev || x.g === fLev;
    for (const p of IN) p.g = grpNaam(p.leverancier);

    // tegels
    const T = el('div'); const tiles = document.getElementById('vr-tiles');
    const cnt = (rk) => all.filter((x) => inLev(x) && x.a.rank === rk);
    const val = (a) => a.reduce((t, x) => t + x.a.qty * (x.r.kostprijs || 0), 0);
    const openPos = IN.filter((p) => !fLev || p.g === fLev);
    const nxt = openPos.find((p) => p.eta && p.eta >= today());
    const tileDefs = [
      ['laat', 'Te laat', cnt(0), (a) => { const m = a.filter((x) => x.mag); return `op vóór een bestelling van nu binnen kan zijn · advies ${eur0.format(val(a))}` + (m.length ? ` · ${m.length} Apple Bee-producten overbruggen via het magazijn` : ''); }],
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
    const levName = new Map(Object.entries(GNAAM));
    const bar = document.getElementById('vr-levf');
    const mk = (id, label) => { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(fLev === (id == null ? '' : id))); b.addEventListener('click', () => dash.setParams({ vr_lev: id })); return b; };
    bar.replaceChildren(mk(null, 'Alle leveranciers'), ...Object.entries(GNAAM).map(([k, n]) => mk(k, k === 'overig' ? 'Overige' : n)));

    // bestellijst
    let list = (P.vr_uit ? uit : all).filter(inLev);
    if (fSt === 'laat') list = list.filter((x) => x.a.rank === 0); else if (fSt === 'nu') list = list.filter((x) => x.a.rank === 1); else if (fSt === '4w') list = list.filter((x) => x.a.rank === 2); else list = list.filter((x) => x.a.rank <= 3);
    // belangrijkheid = omzet 12 mnd van de hele collectie (bv. alle Lotte-delen samen), daarna van het product zelf
    const colOmz = new Map(); for (const r of dk) { const m = collectie(r).model; colOmz.set(m, (colOmz.get(m) || 0) + (Number(r.omzet_52w) || 0)); }
    const imp = (x) => colOmz.get(collectie(x.r).model) || 0;
    list.sort((a, b) => a.a.rank - b.a.rank || imp(b) - imp(a) || (b.r.omzet_52w || 0) - (a.r.omzet_52w || 0)); // per status: belangrijkste collectie eerst
    document.getElementById('vr-best-t').textContent = `Bestellijst${fLev ? ' · ' + (levName.get(fLev) || '') : ''} (${list.length})`;
    const inact = document.getElementById('vr-inact');
    inact.replaceChildren();
    if (uit.length) { const b = el('button', 'vr-link', P.vr_uit ? 'terug naar de bestellijst' : `${uit.length} producten uitgezet (niet meer bestellen of aankijken) — bekijk`); b.type = 'button'; b.addEventListener('click', () => dash.setParams({ vr_uit: P.vr_uit ? null : 1 })); inact.append(b, document.createTextNode(' ')); }
    if (nonActief) inact.append(document.createTextNode(`${nonActief} producten staan niet in de lijst: uitlopend, of zonder voorraad, inkooporder en verkoop in de laatste 13 weken.`));
    const tb = document.querySelector('#vr-tbl tbody');
    const metDongen = false; // Dongen alleen bij Voorraad per product document.querySelectorAll('#vr-tbl .vr-dongen').forEach((e) => { e.hidden = !metDongen; });
    const stCls = (s) => (s === 'Te laat' ? ' lw-bad' : s === 'Nu bestellen' || s === 'Binnen 4 weken' || s === 'Tekort tot levering' ? ' lw-warn' : ' lw-ok');
    if (!tb._vrClick) { tb._vrClick = true; tb.addEventListener('click', (e) => { if (e.target.closest('.dk-detail, button, input, select')) return; const tr = e.target.closest('tr.dk-row'); if (!tr) return; const k = tr.dataset.key; const was = OPENB.has(k); const top = tr.getBoundingClientRect().top; OPENB.clear(); if (!was) OPENB.add(k); render(); const n = tb.querySelector(`tr.dk-row[data-key="${CSS.escape(k)}"]`); if (n) window.scrollBy(0, n.getBoundingClientRect().top - top); }); }
    if (tb.closest('.lw-tablebox')) tb.closest('.lw-tablebox').classList.toggle('dk-open', OPENB.size > 0);
    tb.replaceChildren(...list.slice(0, 400).flatMap((x) => {
      const r = x.r, a = x.a; const tr = el('tr', 'dk-row'); tr.dataset.key = r.sku; tr.setAttribute('aria-expanded', String(OPENB.has(r.sku)));
      const nm = naamCel(el('td', 'lw-wrap'), r, el('span', 'dk-caret', OPENB.has(r.sku) ? '▾ ' : '▸ ')); nm.title = `${r.sku} · ${int.format(r.verkocht_52w)} verkocht in 52 weken · verwacht ${n1.format(a.perWk)}/week na aankomst`;
      const ond = el('td', 'lw-num', r.onderweg ? int.format(r.onderweg) : '—'); if (r.leveringen && r.leveringen.length) ond.title = r.leveringen.map((l) => { const e = CPETA.get(pon(l.po)) || l.datum; return `${l.po}: ${int.format(l.stuks)} op ${dNl(e)}`; }).join('\n');
      const levTd = el('td', '', r.leverancier + (r.lev_afgeleid ? ' *' : '')); if (r.lev_afgeleid) levTd.title = `In Sumtracker zonder leverancier (${r.lev_origineel || 'onbekend'}); afgeleid van de andere producten uit deze collectie. Zet de leverancier in Sumtracker om dit vast te leggen.`;
      tr.append(nm, levTd, el('td', 'lw-num', int.format(r.voorraad)), ond,
        el('td', a.kortVoor ? 'lw-bad' : '', a.opDatum ? dNl(a.opDatum) + (a.kortVoor && r.onderweg ? ' (tijdelijk op tot levering)' : '') : 'na 60 wk'), ...(metDongen ? [dongenCel(r, x.mag)] : []), el('td', 'lw-num', a.L + ' wk'),
        el('td', a.rank <= 1 ? 'lw-bad' : '', a.bestelDatum ? (a.orderBy <= 0 ? 'nu' : dNl(a.bestelDatum)) : '—'),
        el('td', 'lw-num', a.qty ? int.format(a.qty) : '—'), el('td', 'lw-num', x.cbm && a.qty ? n1.format(a.qty * x.cbm) : x.cbm ? '' : '?'),
        el('td', 'lw-num', a.qty ? eur0.format(a.qty * (r.kostprijs || 0)) : '—'));
      const st = el('td'); const h = holdOf(r.sku);
      if (h) st.append(el('span', 'lw-pill dk-hold', holdTxt(h))); else st.append(el('span', 'lw-pill' + stCls(a.status), a.status));
      if (x.mag && !h) { const m = el('div', 'vr-mag', `magazijn: ${int.format(x.mag)} st tot de container er is`); st.append(m); }
      if (false) { const ai = abInfo(r.sku); if (ai) { const d = el('div', 'vr-mag' + (x.mag && ai.mag < x.mag ? ' lw-bad' : ''), `Dongen: ${ai.mag > 0 ? int.format(ai.mag) + ' st' : 'niet op voorraad'} · ${eur0.format(ai.prijs)}`); d.title = `Apple Bee-magazijn Dongen (portaal), artikel ${ai.artikel}. Magazijnprijs ${eur0.format(ai.prijs)}, FOB $ ${int.format(ai.fob)}${ai.moq > 1 ? ', min. ' + ai.moq + ' st' : ''}.`; st.append(d); } }
      const lnk = el('div', 'vr-acts');
      const mkl = (t, l) => { const b = el('button', 'vr-link', l); b.type = 'button'; b.addEventListener('click', () => saveStat(r.sku, t ? { type: t, tot: t === 'wacht' ? addD(today(), 28) : null, at: today() } : null)); return b; };
      if (h) lnk.append(mkl(null, 'weer meenemen')); else lnk.append(mkl('wacht', 'aankijken'), mkl('stop', 'niet meer bestellen'));
      st.append(lnk); tr.append(st);
      if (!OPENB.has(r.sku)) return [tr];
      const d = el('tr', 'dk-detail'); const td = el('td'); td.colSpan = metDongen ? 12 : 11; td.append(detail(r, x, true)); d.append(td);
      return [tr, d];
    }));
    const sq = list.reduce((t, x) => t + x.a.qty, 0), sc = list.reduce((t, x) => t + (x.cbm ? x.a.qty * x.cbm : 0), 0), se = list.reduce((t, x) => t + x.a.qty * (x.r.kostprijs || 0), 0);
    document.getElementById('vr-ft-q').textContent = int.format(sq);
    document.getElementById('vr-ft-c').textContent = n1.format(sc);
    document.getElementById('vr-ft-e').textContent = eur0.format(se);

    // per leverancier
    const lb = document.querySelector('#vr-lev tbody');
    const agg = Object.keys(GNAAM).map((k) => {
      const ls = lev.filter((l) => grpNaam(l.leverancier) === k);
      return { k, naam: GNAAM[k], inkoop_jaar: ls.reduce((t, l) => t + l.inkoop_jaar, 0), inkoop_12m: ls.reduce((t, l) => t + l.inkoop_12m, 0) };
    });
    lb.replaceChildren(...agg.map((l) => {
      const mine = all.filter((x) => x.g === l.k && urgent(x));
      const cb = mine.reduce((t, x) => t + (x.cbm ? x.a.qty * x.cbm : 0), 0);
      const eur = mine.reduce((t, x) => t + x.a.qty * (x.r.kostprijs || 0), 0);
      const m = IN.filter((p) => p.g === l.k); const q = m.reduce((a, p) => a + (p.stuks || 0), 0), e = m.reduce((a, p) => a + p.totaal, 0); const nx = m.find((p) => p.eta && p.eta >= today());
      const tr = el('tr', l.k === 'overig' ? 'vr-overig' : ''); tr.setAttribute('aria-pressed', String(fLev === l.k));
      tr.append(el('td', '', l.naam), el('td', 'lw-num', eur0.format(l.inkoop_jaar)), el('td', 'lw-num', eur0.format(l.inkoop_12m)), el('td', 'lw-num', int.format(m.length)),
        el('td', 'lw-num', q ? int.format(q) : '—'), el('td', 'lw-num', e ? eur0.format(e) : '—'), el('td', '', nx ? dNl(nx.eta) : '—'),
        el('td', 'lw-num', mine.length ? `${mine.length} · ${eur0.format(eur)}` : '—'), el('td', 'lw-num', cb && l.k !== 'overig' ? n1.format(cb) + ' cbm' : '—'), el('td', '', cb && l.k !== 'overig' ? (l.k === 'ab' ? 'per productielocatie, zie voorstel' : containers(cb, P, false).txt) : '—'));
      tr.addEventListener('click', () => dash.setParams({ vr_lev: fLev === l.k ? null : l.k }));
      return tr;
    }));

    // containervoorstel
    renderCont(all, P, fLev, levName);

    // inkomend
    const inp = IN.filter((p) => !fLev || p.g === fLev);
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

  // voorraadverloop met een extra bestelling van q stuks die binnenkomt op de aankomstdatum van een bestelling van nu
  function dekInfo(x) {
    if (x._dek) return x._dek;
    const v = window.vrVraag(x.r), p = projectie(x.r, v, x.origine), t0 = p.t0;
    const ai = Math.max(0, Math.round((P0(x.a.aankomst) - P0(t0)) / DAY / 7));
    return (x._dek = { p, ai, wk: p.wk });
  }
  // dekt tot: eerste week waarin de voorraad (incl. wat al onderweg is + deze bestelling) opraakt
  function dektTot(x, q) {
    const { p, ai } = dekInfo(x);
    for (let i = ai; i < p.proj.length; i++) if (p.proj[i] + q < 0) return p.wk(i);
    return null;
  }
  // hoeveel stuks nodig om tot datum `tot` voorraad te hebben (rekening houdend met wat er ligt en onderweg is)
  function nodigTot(x, tot) {
    const { p, ai } = dekInfo(x); let min = 0;
    for (let i = ai; i < p.proj.length && p.wk(i) <= tot; i++) min = Math.min(min, p.proj[i]);
    return Math.max(0, Math.ceil(-min));
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
    if (fLev === 'overig') { host.replaceChildren(el('p', 'lw-note', 'Geen containervoorstel voor de overige leveranciers; kies MOD Outdoor, Apple Bee, Tierra Outdoor of Republic.')); return; }
    const ofLev = (x) => x.g === fLev && (fLev !== 'ab' || x.origine);
    // tijdelijk uit het voorstel gehaalde producten (alleen voor jou, in de link); de vrije ruimte wordt aangevuld
    const excl = new Set(String(P.vr_cx || '').split(',').filter(Boolean));
    // basis: het advies (bestelpunt), of 'dekken tot' een gekozen datum
    const tot = /^\d{4}-\d{2}-\d{2}$/.test(P.vr_tot || '') ? P.vr_tot : null;
    const QOc = qoMap();
    const items = all.filter((x) => ofLev(x) && (x.a.rank <= 2 || QOc.has(x.r.sku) || (x.cbm && x.r.verkocht_52w > 0 && x.a.perWk > 0) || (tot && x.a.perWk > 0))).map((x) => { const q0 = tot ? nodigTot(x, tot) : x.a.rank <= 2 ? x.a.qty : 0, uit = excl.has(x.r.sku); return { ...x, q0, uit, q: uit ? 0 : q0 }; }).filter((x) => !(x.uit && x.q0 === 0 && QOc.has(x.r.sku)));
    const tg = el('div', 'lw-mini');
    const maxC = Number(P.vr_max) || 0;
    const b1 = el('button', '', 'Alleen het advies'); b1.type = 'button'; b1.setAttribute('aria-pressed', String(!fill && !maxC && !tot)); b1.addEventListener('click', () => dash.setParams({ vr_fill: null, vr_max: null, vr_tot: null }));
    const b2 = el('button', '', 'Container vol maken'); b2.type = 'button'; b2.setAttribute('aria-pressed', String(fill && !maxC)); b2.addEventListener('click', () => dash.setParams({ vr_fill: 1, vr_max: null }));
    const bm = (n) => { const b = el('button', '', `Max ${n} × 40ft`); b.type = 'button'; b.title = `Wat gaat er mee als je maar ${n} container${n > 1 ? 's' : ''} (40ft HQ) bestelt: eerst wat het snelst op is, tot de container vol is`; b.setAttribute('aria-pressed', String(maxC === n)); b.addEventListener('click', () => dash.setParams({ vr_max: maxC === n ? null : n, vr_fill: null })); return b; };
    const b3 = el('button', 'vr-btn', 'Download als CSV'); b3.type = 'button'; b3.addEventListener('click', () => csv(items.filter((x) => x.q > 0), levName.get(id)));
    const tw = el('span', 'vr-tot');
    const tcb = el('button', '', 'Dekken tot'); tcb.type = 'button'; tcb.setAttribute('aria-pressed', String(!!tot));
    const ti = el('input'); ti.type = 'date'; ti.value = tot || (() => { const y = +today().slice(0, 4) + (today().slice(5, 7) > '05' ? 1 : 0); return `${y}-05-31`; })();
    tcb.title = 'Bestel zoveel dat je voorraad (met wat er al onderweg is) meegaat tot deze datum, volgens de verwachte verkoop';
    tcb.addEventListener('click', () => dash.setParams({ vr_tot: tot ? null : ti.value }));
    ti.addEventListener('change', () => dash.setParams({ vr_tot: ti.value || null }));
    tw.append(tcb, ti);
    tg.append(b1, b2, bm(1), bm(2), tw, b3);
    const parts = [tg];
    // per productielocatie een eigen container (fabrieken laden niet samen)
    const locOf = (x) => (HERK[x.r.sku] && HERK[x.r.sku].locatie) || '';
    const locs = [...new Set(items.map(locOf))].sort();
    for (const loc of locs) {
      const g = items.filter((x) => locOf(x) === loc);
      if (!g.some((x) => x.q > 0 || (x.uit && x.q0 > 0)) && !fill) continue;
      if (locs.length > 1 || loc) parts.push(el('h3', 'vr-loc', loc ? `Productielocatie ${loc}${LOCNAAM[loc] ? ' · ' + LOCNAAM[loc] : ''}` : 'Locatie onbekend'));
      parts.push(...group(g, all.filter((x) => ofLev(x) && locOf(x) === loc)));
    }
    parts.push(el('p', 'lw-note', `Containermaten: 20ft ${num(P.vr_c20, 28)} cbm, 40ft ${num(P.vr_c40, 58)} cbm, 40ft HQ ${num(P.vr_chq, 67)} cbm netto laadruimte (aan te passen bij Instellingen). ‘Container vol maken’ vult de laatste container aan met de producten die na aankomst het kortst toe kunnen. Aankomst bij bestellen nu: ${dNl(items[0] ? items[0].a.aankomst : null)}.`));
    host.replaceChildren(...parts);
  }

  // wanneer moet deze container verscheept worden (ETD): op tijd binnen voor het eerste product dat onder de veiligheidsvoorraad zakt
  function verscheping(items) {
    if (!items.length) return null;
    const a0 = items[0].a, L = a0.L, land = a0.land, vaar = L - Math.round(L / 2);
    const krit = items.filter((x) => x.a.bp || x.a.opDatum).sort((p, q) => ((p.a.bp || p.a.opDatum) < (q.a.bp || q.a.opDatum) ? -1 : 1))[0];
    const nodig = krit ? (krit.a.bp || krit.a.opDatum) : null;
    const nu = aankomstNa(today(), L, land), vroegETD = addD(nu.datum, -vaar * 7);
    const box = el('div', 'vr-etd');
    const regel = (l, v, sub) => { const d = el('div', 'vr-etd-r'); d.append(el('span', 'vr-etd-l', l), el('b', '', v)); if (sub) d.append(el('span', 'vr-etd-s', ' ' + sub)); box.append(d); };
    if (!nodig) { regel('Verscheping (ETD):', 'zo snel als het kan', `klaar ± ${dNl(vroegETD)}, binnen ± ${dNl(nu.datum)}`); return box; }
    const etd = addD(nodig, -vaar * 7);
    const naam = vol(krit.r.naam).split(' · ').slice(0, 2).join(' · ');
    const cnyIn = (d) => { const y = +d.slice(0, 4); return d >= `${y}-01-15` && d < `${y}-03-10`; };
    if (etd < vroegETD) {
      regel('Vraag verscheping (ETD):', 'zo snel mogelijk, ± ' + dNl(vroegETD), `binnen ± ${dNl(nu.datum)}, nodig vóór ${dNl(nodig)} (${naam}): ± ${Math.round((P0(nu.datum) - P0(nodig)) / DAY / 7)} weken te laat${a0.cny ? ' door Chinees Nieuwjaar' : a0.leb ? ' door Lebaran' : ''}`);
    } else {
      regel('Vraag verscheping (ETD) uiterlijk:', dNl(etd), `dan binnen ± ${dNl(nodig)}, op tijd voor ${naam} (zakt dan onder de veiligheidsvoorraad); eerder kan vanaf ± ${dNl(vroegETD)}`);
      if (land === 'china' && cnyIn(etd)) regel('Let op:', 'valt in Chinees Nieuwjaar', `fabrieken dicht ± 15 jan – eind feb, eerste schepen ± 10 maart: vraag verscheping vóór ± 10 januari`);
      if (land === 'indo' && LEBARAN[+etd.slice(0, 4)] && Math.abs(P0(etd) - P0(LEBARAN[+etd.slice(0, 4)])) / DAY <= 10) regel('Let op:', 'valt rond Lebaran', `fabrieken ± 2 weken dicht rond ${dNl(LEBARAN[+etd.slice(0, 4)])}: vraag verscheping een paar weken eerder`);
    }
    regel('Vaartijd en transport:', `± ${vaar} weken`, `helft van de levertijd (${L} wk); productie ± ${L - vaar} weken`);
    return box;
  }

  const excl0 = () => new Set(String(dash.params().vr_cx || '').split(',').filter(Boolean));
  // zelf aangepaste aantallen: param vr_qo = 'SKU:aantal|SKU:aantal'
  const qoMap = () => new Map(String(dash.params().vr_qo || '').split('|').filter(Boolean).map((p) => { const i = p.lastIndexOf(':'); return [p.slice(0, i), Math.max(0, parseInt(p.slice(i + 1), 10) || 0)]; }));
  const qoSet = (m) => dash.setParams({ vr_qo: [...m.entries()].map(([k, v]) => `${k}:${v}`).join('|') || null });
  function qtyCel(x) {
    const td = el('td', 'lw-num');
    if (x.uit) { td.textContent = `(${int.format(x.q0)})`; return td; }
    const i = el('input', 'vr-qty'); i.type = 'number'; i.min = 0; i.step = 1; i.value = x.q; i.title = 'Aantal zelf aanpassen';
    i.addEventListener('change', () => { const o = qoMap(); const v = Math.max(0, parseInt(i.value, 10) || 0); o.set(x.r.sku, v); qoSet(o); });
    td.append(i);
    const ref = x.qv != null ? x.qv : x.q0;
    if (x.qv != null) td.append(el('div', 'vr-qty-s', `voorstel ${int.format(x.qv)}`));
    else if (x.q !== x.q0) td.append(el('div', 'vr-qty-s', x.q > x.q0 ? `+${x.q - x.q0} t.o.v. advies` : `advies ${x.q0}`));
    return td;
  }
  // product van deze leverancier zelf toevoegen aan het voorstel (zoeken op titel of SKU)
  function toevoegen(items, kandidaten) {
    const inV = new Set(items.filter((x) => x.q > 0 || qoMap().has(x.r.sku)).map((x) => x.r.sku));
    const opties = kandidaten.filter((x) => !inV.has(x.r.sku)).sort((a, b) => (b.r.omzet_52w || 0) - (a.r.omzet_52w || 0));
    const wrap = el('div', 'vr-add');
    if (!opties.length) return wrap;
    const b = el('button', 'vr-add-btn', `+ Product toevoegen (${opties.length} producten van deze leverancier)`); b.type = 'button';
    b.addEventListener('click', () => addPopup(opties));
    wrap.append(b);
    return wrap;
  }
  const stdQ = (x) => Math.max(1, x.a.qtyNu || Math.round((x.a.perWk || 0) * 8) || 1);
  // groot venster om producten van de leverancier te zoeken en toe te voegen aan het containervoorstel
  function addPopup(opties) {
    document.querySelectorAll('.vr-modal-bg').forEach((n) => n.remove());
    const bg = el('div', 'vr-modal-bg lw'); const m = el('div', 'vr-modal'); bg.append(m);
    const kop = el('div', 'vr-modal-kop');
    kop.append(el('h3', '', 'Product toevoegen aan containervoorstel'));
    const x0 = el('button', 'vr-modal-x', '×'); x0.type = 'button'; x0.title = 'Sluiten (Esc)'; kop.append(x0);
    const q = el('input', 'vr-modal-q'); q.type = 'search'; q.placeholder = 'Zoek op titel of SKU, bijvoorbeeld “80 cm” of “daan tafel”';
    const tel = el('div', 'vr-modal-tel');
    const lijst = el('div', 'vr-modal-lijst');
    const t = el('table', 'lw-table vr-modal-t'); const th = el('thead'); const hr = el('tr');
    for (const [h, c] of [['Product', ''], ['Voorraad', 'lw-num'], ['Onderweg', 'lw-num'], ['Verkoop/wk', 'lw-num'], ['Voorraad tot', ''], ['CBM/stuk', 'lw-num'], ['Aantal', 'lw-num'], ['', '']]) hr.append(el('th', c, h));
    th.append(hr); const tb = el('tbody'); t.append(th, tb); lijst.append(t);
    const voet = el('div', 'vr-modal-voet');
    const klaar = el('button', 'vr-btn', 'Klaar'); klaar.type = 'button';
    const vInfo = el('span', 'vr-po-s', 'Toegevoegde producten komen in de tabel met dit aantal; daar kun je het nog aanpassen.');
    voet.append(vInfo, klaar);
    m.append(kop, q, tel, lijst, voet);
    const toegevoegd = new Set();
    const fmtWk = (v) => (v >= 10 ? int.format(Math.round(v)) : (Math.round(v * 10) / 10).toLocaleString('nl-NL'));
    const teken = () => {
      const w = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hits = opties.filter((x) => { const s = (vol(x.r.naam) + ' ' + x.r.sku).toLowerCase(); return w.every((z) => s.includes(z)); });
      tel.textContent = w.length ? `${hits.length} van ${opties.length} producten` : `${opties.length} producten, best verkopend bovenaan`;
      tb.replaceChildren();
      if (!hits.length) { const tr = el('tr'); const td = el('td', 'vr-modal-leeg', 'Niets gevonden. Probeer een ander woord of een deel van de SKU.'); td.colSpan = 8; tr.append(td); tb.append(tr); return; }
      for (const x of hits) {
        const r = x.r, a = x.a, tr = el('tr'); const al = toegevoegd.has(r.sku); if (al) tr.className = 'vr-modal-ok';
        const nm = el('td'); nm.append(el('div', 'vr-modal-nm', vol(r.naam)), el('div', 'dk-sku', r.sku));
        const c = cbmOf(r.sku);
        const inp = el('input', 'vr-qty'); inp.type = 'number'; inp.min = '1'; inp.value = String(al ? qoMap().get(r.sku) || stdQ(x) : stdQ(x));
        const qtd = el('td', 'lw-num'); qtd.append(inp);
        const knop = el('button', al ? 'vr-add-ja' : 'vr-btn vr-add-go', al ? '✓ toegevoegd · weghalen' : 'Toevoegen'); knop.type = 'button';
        const doe = () => {
          const o = qoMap();
          if (toegevoegd.has(r.sku)) { o.delete(r.sku); toegevoegd.delete(r.sku); }
          else { o.set(r.sku, Math.max(1, Math.round(Number(inp.value) || stdQ(x)))); toegevoegd.add(r.sku); }
          const e = excl0(); e.delete(r.sku);
          dash.setParams({ vr_qo: [...o.entries()].map(([k, v]) => `${k}:${v}`).join('|') || null, vr_cx: [...e].join(',') || null }); teken(); vInfo.textContent = toegevoegd.size ? `${toegevoegd.size} product(en) toegevoegd. Het voorstel achter dit venster is bijgewerkt.` : 'Toegevoegde producten komen in de tabel met dit aantal; daar kun je het nog aanpassen.';
        };
        knop.addEventListener('click', doe);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doe(); } });
        inp.addEventListener('change', () => { if (toegevoegd.has(r.sku)) { const o = qoMap(); o.set(r.sku, Math.max(1, Math.round(Number(inp.value) || 1))); qoSet(o); } });
        const kt = el('td', 'vr-modal-act'); kt.append(knop);
        tr.append(nm, el('td', 'lw-num' + ((Number(r.voorraad) || 0) <= 0 ? ' lw-bad' : ''), int.format(Number(r.voorraad) || 0)),
          el('td', 'lw-num', r.onderweg ? int.format(r.onderweg) : '—'), el('td', 'lw-num', a.perWk ? fmtWk(a.perWk) : '—'),
          el('td', a.kortVoor ? 'lw-bad' : '', a.opDatum ? dNl(a.opDatum) : 'na 60 wk'), el('td', 'lw-num', c ? String(c).replace('.', ',') : '—'), qtd, kt);
        tb.append(tr);
      }
    };
    const sluit = () => { bg.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') sluit(); };
    document.addEventListener('keydown', esc);
    x0.addEventListener('click', sluit); klaar.addEventListener('click', sluit);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) sluit(); });
    q.addEventListener('input', teken);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = tb.querySelector('.vr-add-go'); if (f) { e.preventDefault(); f.click(); } } });
    (document.getElementById('dash-root') || document.body).append(bg);
    teken(); q.focus();
  }
  // concept-inkooporder in Sumtracker met de aantallen uit dit voorstel
  function poKnop(items) {
    const wrap = el('div', 'vr-mkpo');
    const regels = items.filter((x) => x.q > 0 && !x.uit && x.r.pid);
    if (!regels.length) return wrap;
    const ids = {}; for (const x of regels) { const id = x.origine ? 20084 : x.r.leverancier_id; if (id != null) ids[id] = (ids[id] || 0) + x.q; }
    const contact = Object.entries(ids).sort((a, b) => b[1] - a[1])[0];
    const levNaam = (rows('vr_leveranciers') || []).find((l) => String(l.leverancier_id) === String(contact && contact[0]));
    const st = regels.reduce((t, x) => t + x.q, 0), eu = regels.reduce((t, x) => t + x.q * (x.r.kostprijs || 0), 0);
    const b = el('button', 'vr-btn', 'Maak concept-PO in Sumtracker'); b.type = 'button';
    const info = el('span', 'vr-po-s', `${regels.length} producten · ${int.format(st)} stuks · leverancier ${levNaam ? levNaam.leverancier : contact ? contact[0] : '?'}`);
    wrap.append(b, info);
    if (!contact) { b.disabled = true; info.textContent = 'Geen leverancier bekend voor deze producten'; return wrap; }
    b.addEventListener('click', async () => {
      if (!b.dataset.zeker) { b.dataset.zeker = '1'; b.textContent = `Ja, maak concept-PO (${int.format(st)} st, ± ${eur0.format(eu)})`; b.classList.add('vr-btn-warn'); return; }
      b.disabled = true; b.textContent = 'Bezig…';
      try {
        const r = await fetch('/api/st/concept-po', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: Number(contact[0]), notes: `Concept vanuit het dashboard (${dNl(today())}), ${regels.length} regels`, lines: regels.map((x) => ({ product_id: x.r.pid, quantity: x.q, sku: x.r.sku })) }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || r.status);
        b.textContent = `Concept-PO ${j.nummer} aangemaakt`; b.classList.remove('vr-btn-warn');
        info.textContent = `${j.regels} regels in Sumtracker als concept (draft). Controleer en bevestig hem in Sumtracker.` + (j.fouten && j.fouten.length ? ` Niet gelukt: ${j.fouten.join('; ')}` : '');
      } catch (e) { b.disabled = false; delete b.dataset.zeker; b.textContent = 'Maak concept-PO in Sumtracker'; info.textContent = 'Mislukt: ' + e.message; }
    });
    return wrap;
  }
  function group(items, kandidaten = []) {
    const P = dash.params(); const fill = !!P.vr_fill;
    const T0 = items.reduce((t, x) => t + (x.cbm ? x.q * x.cbm : 0), 0);
    const Tadv = items.reduce((t, x) => t + (x.cbm ? x.q0 * x.cbm : 0), 0);
    const uitG = items.filter((x) => x.uit && x.q0 > 0);
    const g0 = items[0] ? items[0].g : '', loc0 = items[0] ? ((HERK[items[0].r.sku] || {}).locatie || '') : '', m20 = mag20(g0, loc0);
    let C = containers(fill ? T0 : uitG.length ? Tadv : T0, P, m20);
    const maxC = Number(P.vr_max) || 0;
    let maxNote = null;
    if (maxC) {
      // maximaal N containers: vullen op urgentie (steeds 1 stuk erbij van wat na aankomst het kortst dekt), eerst binnen het advies, daarna met wat het best verkoopt
      const capM = maxC * num(P.vr_chq, 67);
      for (const x of items) x.q = 0;
      const cand = items.filter((x) => x.cbm && x.a.perWk > 0 && !x.uit);
      let free = capM;
      for (const fase of [1, 2]) {
        for (let n = 0; n < 8000; n++) {
          let best = null, bw = Infinity;
          for (const x of cand) { if (x.cbm > free || (fase === 1 && x.q >= x.q0)) continue; const w = (Math.max(0, x.a.atArr) + x.q) / x.a.perWk; if (w < bw) { bw = w; best = x; } }
          if (!best) break; best.q += 1; free -= best.cbm;
        }
      }
      const T1 = items.reduce((t, x) => t + (x.cbm ? x.q * x.cbm : 0), 0);
      const kort = items.filter((x) => x.q0 > 0 && x.q < x.q0 && !x.uit).sort((a, b) => (b.q0 - b.q) * (b.cbm || 0) - (a.q0 - a.q) * (a.cbm || 0));
      const extra = items.filter((x) => x.q > x.q0);
      maxNote = el('div', 'vr-uitnote');
      maxNote.append(el('b', '', `Max ${maxC} × 40ft (${int.format(capM)} cbm): `), document.createTextNode(Tadv > capM
        ? `${P.vr_tot ? 'nodig tot ' + dNl(P.vr_tot) : 'het advies'} is ${n1.format(Tadv)} cbm, dus ${n1.format(Tadv - capM)} cbm past niet. Eerst meegenomen wat het snelst op is; ingekort: ` + kort.slice(0, 6).map((x) => `${vol(x.r.naam).split(' · ').slice(0, 2).join(' · ')} ${x.q} i.p.v. ${x.q0}`).join(', ') + (kort.length > 6 ? ` en ${kort.length - 6} meer` : '') + '. Wat niet mee kan, komt in de volgende bestelling terug.'
        : `${P.vr_tot ? 'wat nodig is tot ' + dNl(P.vr_tot) : 'het advies'} (${n1.format(Tadv)} cbm) past; aangevuld tot ${n1.format(T1)} cbm met wat na aankomst het kortst toe kan` + (extra.length ? ': ' + extra.slice(0, 5).map((x) => `${vol(x.r.naam).split(' · ').slice(0, 2).join(' · ')} +${x.q - x.q0}`).join(', ') : '') + '.'));
    }
    // container vol maken (of een product eruit gehaald): steeds 1 stuk erbij van het product dat na aankomst het kortst dekt, tot de container(s) vol zijn
    let added = 0;
    if (!maxC && (fill || uitG.length) && C.cap > 0) {
      let free = (fill ? C.cap : Tadv) - T0; const cand = items.filter((x) => x.cbm && x.a.perWk > 0 && !x.uit); // zonder 'vol maken': alleen de vrijgekomen ruimte opvullen
      for (let n = 0; n < 5000 && cand.length; n++) {
        let best = null, bw = Infinity;
        for (const x of cand) { if (x.cbm > free) continue; const w = (Math.max(0, x.a.atArr) + x.q) / x.a.perWk; if (w < bw) { bw = w; best = x; } }
        if (!best) break; best.q += 1; free -= best.cbm; added += best.cbm;
      }
    }
    // zelf aangepaste aantallen (alleen voor jou, in de link) gaan boven het voorstel
    const QO = qoMap(); let aangepast = 0;
    for (const x of items) if (QO.has(x.r.sku) && !x.uit) { x.qv = x.q; x.q = QO.get(x.r.sku); aangepast++; }
    const T = items.reduce((t, x) => t + (x.cbm ? x.q * x.cbm : 0), 0); C = containers(T, P, maxC ? false : m20);
    const noCbm = items.filter((x) => !x.cbm && x.q > 0);
    const eur = items.reduce((t, x) => t + x.q * (x.r.kostprijs || 0), 0);
    const box = el('div', 'vr-cbox');
    box.append(el('div', 'lw-value', `${n1.format(T)} cbm`), el('div', '', C.txt), el('div', 'lw-delta', `${int.format(items.reduce((t, x) => t + x.q, 0))} stuks · ${eur0.format(eur)} inkoopwaarde (huidige kostprijs)`));
    const bar = el('div', 'vr-fill');
    let restT = T; for (const [k, cap] of C.list) { const d = el('div'); const f = Math.min(cap, restT); restT -= f; d.style.width = (cap / Math.max(C.cap, 1)) * 100 + '%'; d.style.background = `linear-gradient(90deg, #84bd3f ${(f / cap) * 100}%, transparent ${(f / cap) * 100}%)`; d.title = `${k}: ${n1.format(f)} van ${cap} cbm`; bar.append(d); }
    const parts = [box, bar];
    const info = []; // toelichtingen: onder de knop voor de concept-PO
    if (/^\d{4}-\d{2}-\d{2}$/.test(P.vr_tot || '')) { const n = el('div', 'vr-etd'); const nn = items.filter((x) => x.q0 > 0 && !x.uit); n.append(el('div', 'vr-etd-r', '')); n.firstChild.append(el('span', 'vr-etd-l', 'Dekken tot:'), el('b', '', dNl(P.vr_tot)), el('span', 'vr-etd-s', ` · ${nn.length} producten hebben samen ${int.format(nn.reduce((t, x) => t + x.q0, 0))} stuks (${n1.format(Tadv)} cbm) extra nodig om met wat er ligt en onderweg is tot die datum te komen (verwachte verkoop volgens begroting, zonder veiligheidsvoorraad).`)); info.push(n); }
    if (maxNote) info.push(maxNote);
    if (uitG.length) {
      const extra = items.filter((x) => x.q > x.q0).sort((a, b) => (b.q - b.q0) * (b.cbm || 0) - (a.q - a.q0) * (a.cbm || 0));
      const n = el('div', 'vr-uitnote');
      n.append(el('b', '', `${uitG.length} ${uitG.length === 1 ? 'product' : 'producten'} tijdelijk eruit (−${n1.format(uitG.reduce((t, x) => t + x.q0 * (x.cbm || 0), 0))} cbm). `),
        document.createTextNode(extra.length ? 'Aangevuld met wat na aankomst het kortst toe kan: ' + extra.slice(0, 6).map((x) => `${vol(x.r.naam).split(' · ').slice(0, 2).join(' · ')} +${x.q - x.q0}`).join(', ') + (extra.length > 6 ? ` en ${extra.length - 6} meer` : '') + '. ' : 'Niets om mee aan te vullen. '));
      const b = el('button', 'vr-link', 'alles terugzetten'); b.type = 'button'; b.addEventListener('click', () => { const rest = [...excl0()].filter((k) => !uitG.some((x) => x.r.sku === k)); dash.setParams({ vr_cx: rest.join(',') || null }); });
      n.append(b); info.push(n);
    }
    const vs = verscheping(items.filter((x) => x.q > 0));
    if (vs) info.push(vs);
    if (noCbm.length) parts.push(el('p', 'lw-note lw-bad', `${noCbm.length} producten hebben nog geen CBM en tellen niet mee in de containers. Vul de CBM per stuk hieronder in${isAdmin() ? '' : ' (alleen een beheerder kan dat opslaan)'}.`));
    const tbl = el('table', 'lw-table lw-stocktable'); const th = el('thead'); const hr = el('tr');
    ['Product', 'SKU · art.nr leverancier', 'Status', 'Bestellen', 'CBM/stuk', 'CBM', 'Inkoop', 'Voorraad tot', ''].forEach((h, i) => hr.append(el('th', i >= 3 && i !== 7 && i !== 8 ? 'lw-num' : '', h))); th.append(hr); tbl.append(th);
    const tb = el('tbody');
    for (const x of items.filter((x) => x.q > 0 || QO.has(x.r.sku) || (x.uit && x.q0 > 0) || (x.q0 > 0 && (!x.cbm || maxC))).sort((a, b) => a.uit - b.uit || a.a.rank - b.a.rank || b.q - a.q)) {
      const tr = el('tr', x.uit ? 'vr-uitrow' : '');
      const cbTd = el('td', 'lw-num');
      if (isAdmin()) { const i = el('input'); i.type = 'number'; i.step = '0.01'; i.min = 0; i.value = x.cbm ?? ''; i.placeholder = '?'; i.addEventListener('change', () => saveCbm(x.r.sku, i.value === '' ? null : Number(i.value))); cbTd.append(i); }
      else cbTd.textContent = x.cbm ? n2.format(x.cbm) : '?';
      const dt = x.a.perWk > 0 ? dektTot(x, x.q) : null;
      tr.append(el('td', 'lw-wrap', vol(x.r.naam)), el('td', '', x.r.sku + (HERK[x.r.sku] ? ' · ' + HERK[x.r.sku].artikel : '')), el('td', '', x.a.status), qtyCel(x), cbTd,
        el('td', 'lw-num', x.cbm ? n1.format(x.q * x.cbm) : '—'), el('td', 'lw-num', eur0.format(x.q * (x.r.kostprijs || 0))), el('td', '', x.uit ? 'eruit' : x.a.perWk > 0 ? (dt ? dNl(dt) : 'ruim (na 60 wk)') : '—'));
      const act = el('td'); const ab = el('button', 'vr-link', x.uit ? 'terugzetten' : 'eruit'); ab.type = 'button'; ab.title = x.uit ? 'Weer meenemen in dit voorstel' : 'Tijdelijk uit dit containervoorstel halen; de ruimte wordt aangevuld';
      ab.addEventListener('click', () => {
        const e = excl0(), o = qoMap();
        // zelf toegevoegd (geen advies): 'eruit' haalt hem helemaal weg, tot je hem opnieuw toevoegt
        if (!x.uit && x.q0 === 0 && o.has(x.r.sku)) { o.delete(x.r.sku); e.delete(x.r.sku); dash.setParams({ vr_qo: [...o.entries()].map(([k, v]) => `${k}:${v}`).join('|') || null, vr_cx: [...e].join(',') || null }); return; }
        if (x.uit) e.delete(x.r.sku); else e.add(x.r.sku); dash.setParams({ vr_cx: [...e].join(',') || null });
      });
      act.append(ab); tr.append(act);
      tb.append(tr);
    }
    tbl.append(tb); const tbx = el('div', 'lw-tablebox lw-tablebox-20'); tbx.append(tbl); parts.push(tbx);
    if (aangepast) { const n = el('p', 'lw-note'); const b = el('button', 'vr-link', 'zelf aangepaste aantallen wissen'); b.type = 'button'; b.addEventListener('click', () => { const o = qoMap(); for (const x of items) o.delete(x.r.sku); qoSet(o); }); n.append(document.createTextNode(`${aangepast} aantal${aangepast === 1 ? '' : 'len'} zelf aangepast. `), b); parts.push(n); }
    parts.push(toevoegen(items, kandidaten));
    if (isAdmin()) parts.push(poKnop(items));
    parts.push(...info);
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

  // ---------- dekking per product: één regel per product, openklappen voor details ----------
  const OPEN = new Set();
  const SCEN = [[0, '0%'], [10, '+10%'], [20, '+20%'], [30, '+30%'], ['b', 'Begroting']];
  const scenNaam = (g) => (g === 'b' ? 'begroting' : (g > 0 ? '+' : '') + g + '%');
  const etaOf = (x) => { const e = (CPETA_G.get(pon(x.po))) || x.datum; return e < today() ? today() : e; };
  let CPETA_G = new Map();
  const stCls2 = (s) => (s === 'Te laat' ? ' lw-bad' : s === 'Nu bestellen' ? ' lw-bad' : s === 'Binnen 4 weken' || s === 'Tekort tot levering' ? ' lw-warn' : ' lw-ok');
  const actieTxt = (a) => (a.rank === 0 ? 'Te laat' : a.rank === 1 ? 'Nu bestellen' : a.rank === 2 ? 'Binnen 4 weken' : a.status === 'Tekort tot levering' ? 'Tekort tot levering' : a.rank === 5 ? 'Voldoende' : 'Op tijd');
  // ---------- collectie (model + kleur) uit de productnaam ----------
  const MERKEN = ['Apple Bee', 'Belito®', 'Belito', 'Platinum', 'AeroCover', 'Hartman', '4Seasons', 'Tierra', 'Rocca', 'Valentino', 'Easyfires', 'Agusto', 'Ciro', 'Naturalis', 'Lauck'];
  const MULTI = ['Bora Bora', 'Camps Bay', 'Camp Bay', 'Pine Key', 'Moon Island', 'Chill Out', 'St. Lucia', 'St Lucia', 'Long Island', 'Lazy Susan', 'Teak Shield', 'Teak Cleaner', 'Teak Color'];
  const KLEUR = [[/carbon black|\bzwart|\bblack/i, 'Black'], [/oyster/i, 'Oyster'], [/taupe/i, 'Taupe'], [/antraciet|anthracite/i, 'Antraciet'], [/\bwit\b|\bwhite/i, 'Wit'], [/bronze/i, 'Bronze'], [/\bgrey|\bgrijs/i, 'Grey'], [/mokka|mocca/i, 'Mokka'], [/champagne/i, 'Champagne'], [/cognac/i, 'Cognac'], [/amber/i, 'Amber'], [/\bsand\b/i, 'Sand']];
  const COLCACHE = new Map();
  function collectie(r) {
    if (COLCACHE.has(r.sku)) return COLCACHE.get(r.sku);
    let n = String(r.naam || '').replace(/®/g, '').trim(), merk = r.merk || '';
    for (const m of MERKEN) { const mm = m.replace('®', ''); if (n.toLowerCase().startsWith(mm.toLowerCase() + ' ')) { merk = mm; n = n.slice(mm.length).trim(); break; } }
    const first = n.split('|')[0].trim();
    let model = MULTI.find((m) => first.toLowerCase().startsWith(m.toLowerCase())) || (first.split(/\s+/)[0] || '').replace(/[^\p{L}\p{N}/&.-]/gu, '');
    if (model === 'Camps Bay') model = 'Camp Bay';
    if (model === 'St Lucia') model = 'St. Lucia';
    model = model.charAt(0).toUpperCase() + model.slice(1);
    const kl = (KLEUR.find(([re]) => re.test(r.naam || '')) || [])[1] || '';
    const out = { merk, model: `${merk} ${model}`.trim(), col: `${merk} ${model}${kl ? ' ' + kl : ''}`.trim() };
    COLCACHE.set(r.sku, out); return out;
  }

  // ---------- voorraad per product ----------
  function dkDecorate() {
    const tbl = document.getElementById('tbl-dk'); if (!tbl || !MKX) return;
    const tb = tbl.querySelector('tbody'); const dk = rows('st_dekking'); if (!tb || !dk) return; prepDk(dk);
    const P = dash.params();
    CPETA_G = new Map((rows('cp_open') || []).filter((c) => c.eta).map((c) => [pon(c.po), c.eta]));
    const sz = SEIZ(); const stand = sz[0] ? sz[0].stand : null;
    const sEl = document.getElementById('dk-stand'); if (sEl) sEl.textContent = stand ? dNl(stand.slice(0, 10)) + ' ' + stand.slice(11, 16) : '—';
    // alle producten, belangrijkste (omzet 12 mnd) eerst
    const nVerb = dk.filter((r) => verborgen(r.sku)).length;
    const X = dk.filter((r) => !(HERK[r.sku] && HERK[r.sku].uitlopend) && (P.dk_verb ? verborgen(r.sku) : !verborgen(r.sku))).map((r) => { const x = MKX(r); x.ti = totInfo(r, window.vrVraag(r), x.origine); x.c = collectie(r); return x; })
      .sort((a, b) => (b.r.omzet_52w || 0) - (a.r.omzet_52w || 0) || (b.r.waarde_52w || 0) - (a.r.waarde_52w || 0));
    const totOmzet = X.reduce((t, x) => t + (x.r.omzet_52w || 0), 0) || 1;
    X.forEach((x, i) => { x.rang = i + 1; });
    const fLev = P.dk_lev || '', fCol = P.dk_col || '', fSt = P.dk_st || '', fQ = String(P.dk_q || '').toLowerCase();
    const inLev = X.filter((x) => !fLev || x.g === fLev);
    const inCol = inLev.filter((x) => !fCol || (fCol.startsWith('m:') ? x.c.model === fCol.slice(2) : x.c.col === fCol.slice(2)));
    const inQ = inCol.filter((x) => !fQ || (x.r.naam + ' ' + x.r.sku).toLowerCase().includes(fQ));
    // tegels (binnen de gekozen leverancier/collectie)
    const cat = { laat: (x) => !holdOf(x.r.sku) && x.a.rank === 0, nu: (x) => !holdOf(x.r.sku) && x.a.rank === 1, '4w': (x) => !holdOf(x.r.sku) && x.a.rank === 2, tijd: (x) => x.ti.tijdelijk };
    const tiles = document.getElementById('tiles-dk');
    const defs = [['laat', 'Te laat', 'op vóór een bestelling van nu binnen kan zijn'], ['nu', 'Nu bestellen', 'bestelmoment is bereikt'], ['4w', 'Binnen 4 weken bestellen', 'bestelmoment binnen 4 weken'], ['tijd', 'Tijdelijk op', 'op tot de volgende levering binnen is']];
    tiles.replaceChildren(...defs.map(([k, l, sub]) => {
      const a = inQ.filter(cat[k]); const val = a.reduce((t, x) => t + (x.a.qty || 0) * (x.r.kostprijs || 0), 0);
      const t = el('div', 'lw-tile lw-click'); t.setAttribute('role', 'button'); t.tabIndex = 0; t.setAttribute('aria-pressed', String(fSt === k));
      const v = el('div', 'lw-value', `${a.length} ${a.length === 1 ? 'product' : 'producten'}`); if ((k === 'laat' || k === 'nu') && a.length) v.classList.add('lw-bad');
      t.append(el('div', 'lw-label', l), v, el('div', 'lw-delta', sub + (val && k !== 'tijd' ? ` · advies ${eur0.format(val)}` : '')));
      const go = () => dash.setParams({ dk_st: fSt === k ? null : k });
      t.addEventListener('click', go); t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      return t;
    }));
    // filters: leverancier, collectie, zoeken
    const fb = document.getElementById('dk-filters');
    const typing = fb && fb.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (fb && !typing) {
      const chips = el('div', 'lw-mini');
      const mk = (k, l) => { const b = el('button', '', l); b.type = 'button'; b.setAttribute('aria-pressed', String(fLev === k)); b.addEventListener('click', () => dash.setParams({ dk_lev: k || null, dk_col: null })); return b; };
      chips.append(mk('', 'Alle leveranciers'), ...Object.entries(GNAAM).map(([k, n]) => mk(k, k === 'overig' ? 'Overige' : n)));
      const sel = el('select'); sel.append(new Option('Alle collecties', ''));
      const models = new Map();
      for (const x of inLev) { const m = models.get(x.c.model) || { omzet: 0, cols: new Map() }; m.omzet += x.r.omzet_52w || 0; m.cols.set(x.c.col, (m.cols.get(x.c.col) || 0) + (x.r.omzet_52w || 0)); models.set(x.c.model, m); }
      for (const [m, d] of [...models.entries()].sort((a, b) => b[1].omzet - a[1].omzet)) {
        const og = document.createElement('optgroup'); og.label = m;
        og.append(new Option(`${m} (alle kleuren)`, 'm:' + m));
        if (d.cols.size > 1 || [...d.cols.keys()][0] !== m) for (const [c] of [...d.cols.entries()].sort((a, b) => b[1] - a[1])) og.append(new Option(c, 'c:' + c));
        sel.append(og);
      }
      sel.value = fCol; sel.addEventListener('change', () => dash.setParams({ dk_col: sel.value || null }));
      const q = el('input'); q.type = 'search'; q.placeholder = 'Zoek product of SKU'; q.value = P.dk_q || '';
      q.addEventListener('change', () => dash.setParams({ dk_q: q.value || null }));
      const vb = el('button', 'vr-link', P.dk_verb ? 'terug naar alle producten' : `${nVerb} verborgen ${nVerb === 1 ? 'product' : 'producten'}`); vb.type = 'button'; vb.addEventListener('click', () => dash.setParams({ dk_verb: P.dk_verb ? null : 1 }));
      fb.replaceChildren(chips, sel, q, ...(nVerb || P.dk_verb ? [vb] : []));
    }
    let list = fSt ? inQ.filter(cat[fSt]) : inQ;
    const colNaam = fCol ? fCol.slice(2) + (fCol.startsWith('m:') ? ' (alle kleuren)' : '') : '';
    const omz = list.reduce((t, x) => t + (x.r.omzet_52w || 0), 0);
    document.getElementById('dk-title').textContent = [fLev ? GNAAM[fLev] : 'Alle leveranciers', colNaam, fSt ? defs.find((d) => d[0] === fSt)[1] : ''].filter(Boolean).join(' · ') + ` (${list.length} producten)`;
    if (!tb._vrClick) {
      tb._vrClick = true;
      tb.addEventListener('click', (e) => {
        if (e.target.closest('.dk-detail')) return;
        const tr = e.target.closest('tr.dk-row'); if (!tr) return;
        const k = tr.dataset.key; const was = OPEN.has(k); const top = tr.getBoundingClientRect().top; OPEN.clear(); if (!was) OPEN.add(k); dkDecorate(); const n = tb.querySelector(`tr.dk-row[data-key="${CSS.escape(k)}"]`); if (n) window.scrollBy(0, n.getBoundingClientRect().top - top);
      });
    }
    if (tbl.parentElement) tbl.parentElement.classList.toggle('dk-open', OPEN.size > 0);
    const metD = fLev === 'ab'; tbl.querySelectorAll('th.dk-dongen').forEach((e) => { e.hidden = !metD; });
    const out = [];
    for (const x of list.slice(0, 500)) {
      const r = x.r, a = x.a, k = keuze(r.sku), ti = x.ti;
      const tr = el('tr', 'dk-row'); tr.dataset.key = r.sku; tr.setAttribute('aria-expanded', String(OPEN.has(r.sku)));
      const nm = naamCel(el('td', 'lw-wrap'), r, el('span', 'dk-caret', OPEN.has(r.sku) ? '▾ ' : '▸ ')); nm.title = x.c.col;
      const om = el('td', 'lw-num'); om.append(document.createTextNode(r.omzet_52w ? eur0.format(r.omzet_52w) : '—'), el('span', 'dk-share', r.omzet_52w ? new Intl.NumberFormat(nl, { style: 'percent', maximumFractionDigits: 1 }).format(r.omzet_52w / totOmzet) : ''));
      const lev = (r.leveringen || []).slice().sort((p, q) => (etaOf(p) < etaOf(q) ? -1 : 1));
      const inc = el('td', '');
      inc.className = 'lw-num'; inc.textContent = lev.length ? '+' + int.format(lev.reduce((t, l) => t + (Number(l.stuks) || 0), 0)) : '—';
      const tot = el('td', ''); tot.textContent = totTxt(ti);
      if (k !== 'b') tot.append(el('span', 'dk-scen', ' ' + scenNaam(k)));
      if (ti.tijdelijk) tot.append(el('div', 'vr-mag', `${ti.nuOp ? 'nu op' : 'op vanaf ' + dNl(ti.van)}, weer binnen ${dNl(ti.terug)}`));
      if (ti.magTot) tot.append(el('div', 'vr-mag', `tot de container ${int.format(ti.magTot)} st uit het Apple Bee-magazijn`));
      const best = el('td', a.rank <= 1 ? 'lw-bad dk-strong' : a.rank === 2 ? 'dk-warn' : '', a.rank <= 1 ? 'nu' : a.bestelDatum ? dNl(a.bestelDatum) : '—');
      const hh = holdOf(r.sku); const act = el('td'); if (hh) act.append(el('span', 'lw-pill dk-hold', holdTxt(hh))); else { act.append(el('span', 'lw-pill' + stCls2(actieTxt(a)), actieTxt(a))); if (x.mag) act.append(el('div', 'vr-mag', `magazijn: ${int.format(x.mag)} st tot de container er is`)); }
      tr.append(el('td', 'lw-num', String(x.rang)), nm, el('td', 'lw-num' + ((Number(r.voorraad) || 0) <= 0 ? ' lw-bad' : ''), int.format(r.voorraad)), inc, tot, ...(metD ? [dongenCel(r, ti.magTot || x.mag)] : []), best,
        el('td', 'lw-num', a.qty && !hh ? int.format(a.qty) : '—'), act);
      out.push(tr);
      if (OPEN.has(r.sku)) { const d = el('tr', 'dk-detail'); const td = el('td'); td.colSpan = metD ? 9 : 8; td.append(detail(r, x)); d.append(td); out.push(d); }
    }
    tb.replaceChildren(...out);
    cbmPaneel(list);
  }
  // cbm per product bekijken en invullen (zelfde filters als de tabel)
  const levLijst = () => (rows('vr_leveranciers') || []).filter((l) => l.leverancier_id != null).map((l) => ({ id: l.leverancier_id, naam: l.leverancier })).sort((a, b) => a.naam.localeCompare(b.naam));
  function cbmPaneel(list) {
    const host = document.getElementById('dk-cbm-body'); if (!host) return;
    if (host.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    const P = dash.params(), leeg = !!P.dk_cbmleeg;
    const zonder = list.filter((x) => !cbmOf(x.r.sku));
    const rowsL = (leeg ? zonder : list).slice(0, 400);
    const top = el('div', 'dk-cbm-top');
    top.append(el('span', '', `${list.length - zonder.length} van ${list.length} producten hebben een cbm (binnen de gekozen filters).`));
    const b = el('button', 'vr-link', leeg ? 'alle producten tonen' : `alleen de ${zonder.length} zonder cbm tonen`); b.type = 'button'; b.addEventListener('click', () => dash.setParams({ dk_cbmleeg: leeg ? null : 1 }));
    top.append(b);
    const zk = el('input', 'dk-cbm-zoek'); zk.type = 'search'; zk.placeholder = 'Zoek op titel of SKU'; zk.value = cbmPaneel.q || '';
    const ls = el('select', 'dk-cbm-lev'); ls.append(new Option('Alle leveranciers', ''));
    const levTel = new Map(); for (const x of rowsL) levTel.set(x.r.leverancier || 'Onbekend', (levTel.get(x.r.leverancier || 'Onbekend') || 0) + 1);
    for (const [n, c] of [...levTel.entries()].sort((a, b) => b[1] - a[1])) ls.append(new Option(`${n} (${c})`, n));
    ls.value = levTel.has(cbmPaneel.lev) ? cbmPaneel.lev : '';
    const filt = () => { const q = (cbmPaneel.q = zk.value).toLowerCase().trim(), lv = (cbmPaneel.lev = ls.value); let n = 0; host.querySelectorAll('tbody tr').forEach((tr) => { const hit = (!q || tr.dataset.q.includes(q)) && (!lv || tr.dataset.lev === lv); tr.hidden = !hit; if (hit) n++; }); tel.textContent = q || lv ? `${n} getoond` : ''; };
    zk.addEventListener('input', filt); ls.addEventListener('change', filt);
    const tel = el('span', '');
    top.prepend(zk, ls, tel);
    if (!isAdmin()) top.append(el('span', '', 'Alleen een beheerder kan cbm opslaan.'));
    const t = el('table', 'lw-table'); const th = el('thead'); const hr = el('tr');
    ['Product', 'Leverancier', 'CBM per stuk', 'Bron', 'Stuks op voorraad', 'CBM op voorraad', ''].forEach((h, i) => hr.append(el('th', i >= 2 && i !== 3 && i !== 6 ? 'lw-num' : '', h))); th.append(hr); t.append(th);
    const tb = el('tbody');
    for (const x of rowsL) {
      const r = x.r, c = cbmOf(r.sku), tr = el('tr'); tr.dataset.q = (vol(r.naam) + ' ' + r.sku).toLowerCase(); tr.dataset.lev = r.leverancier || 'Onbekend';
      const nm = el('td', 'lw-wrap'); nm.append(document.createTextNode(vol(r.naam)), el('div', 'dk-sku', r.sku));
      const td = el('td', 'lw-num'); const inp = el('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = '—'; inp.value = c ? String(c).replace('.', ',') : ''; if (!c) inp.classList.add('dk-cbm-leeg'); inp.disabled = !isAdmin();
      inp.addEventListener('change', async () => { const v = Number(inp.value.replace(',', '.')); try { await saveCbm(r.sku, inp.value.trim() === '' || !(v > 0) ? null : v); inp.blur(); dkDecorate(); } catch (e) { inp.title = 'Opslaan mislukt: ' + e.message; inp.classList.add('dk-cbm-leeg'); } });
      td.append(inp);
      const bron = c ? (Number(CBM[r.sku]) > 0 ? (HERK[r.sku] ? 'Apple Bee containersheet' : 'ingevuld') : 'Apple Bee-portaal') : 'ontbreekt';
      const fys = Math.max(0, Number(r.in_stock ?? r.voorraad) || 0);
      const levTd = el('td', '');
      if (isAdmin() && (onbekendeLev({ leverancier: r._l0 }) || r.lev_handmatig)) {
        const sl = el('select', 'dk-cbm-levsel'); sl.append(new Option(r.lev_afgeleid ? `${r.leverancier} (afgeleid)` : r.lev_handmatig ? '— automatisch —' : 'Onbekend', ''));
        for (const l of levLijst()) sl.append(new Option(l.naam, String(l.id)));
        sl.value = r.lev_handmatig ? String(r.leverancier_id ?? '') : '';
        sl.addEventListener('change', () => { const l = levLijst().find((x) => String(x.id) === sl.value); saveLev(r.sku, l ? { id: l.id, naam: l.naam } : null); });
        levTd.append(sl);
      } else levTd.textContent = r.leverancier + (r.lev_afgeleid ? ' *' : '');
      tr.append(nm, levTd, td, el('td', c ? '' : 'lw-bad', bron), el('td', 'lw-num', int.format(fys)), el('td', 'lw-num', c && fys ? n1.format(c * fys) : ''));
      const vt = el('td'); const vbt = el('button', 'vr-link', verborgen(r.sku) ? 'terugzetten' : 'verbergen'); vbt.type = 'button'; vbt.title = verborgen(r.sku) ? 'Weer tonen in de lijsten' : 'Verkopen we niet meer: uit alle lijsten van Inkopen halen'; vbt.addEventListener('click', () => saveStat(r.sku, verborgen(r.sku) ? null : { type: 'weg', at: today() })); vt.append(vbt); tr.append(vt);
      tb.append(tr);
    }
    t.append(tb); const box = el('div', 'lw-tablebox'); box.append(t);
    queueMicrotask(filt);
    host.replaceChildren(top, box, el('p', 'lw-note', 'CBM = kubieke meter per stuk zoals verpakt (lengte × breedte × hoogte in meter). Wordt gebruikt voor het containervoorstel en de opslag. Voor een set de cbm van alle dozen samen.'));
  }
  function detail(r, x, metWaarom) {
    const box = el('div', 'dk-box'); const k = keuze(r.sku);
    const mnd = (s) => P0(s + '-01').toLocaleDateString(nl, { month: 'short', timeZone: 'UTC' }).replace('.', '');
    // kaartjes: voorraad, inkomend, voorraad tot, bestellen
    const cards = el('div', 'dk-cards');
    const card = (label, val, sub, cls) => { const c = el('div', 'dk-card' + (cls ? ' ' + cls : '')); c.append(el('div', 'dk-cl', label), el('div', 'dk-cv', val)); if (sub instanceof Node) c.append(sub); else if (sub) c.append(el('div', 'dk-cs', sub)); cards.append(c); };
    const lev = (r.leveringen || []).slice().sort((p, q) => (etaOf(p) < etaOf(q) ? -1 : 1));
    card('Voorraad nu', int.format(r.voorraad), `${int.format(r.in_stock ?? r.voorraad)} op voorraad, ${int.format((r.in_stock ?? r.voorraad) - r.voorraad)} al verkocht`);
    const lst = el('div', 'dk-cs'); if (lev.length) { const t = el('table', 'dk-potab'); for (const l of lev) { const tr = el('tr'); tr.append(el('td', '', l.po), el('td', 'lw-num', `${int.format(l.stuks)} st`), el('td', '', dNl(etaOf(l)))); t.append(tr); } lst.append(t, el('div', '', 'aankomst = ETA uit de containerplanning')); } else lst.textContent = 'niets besteld';
    card('Inkomend', lev.length ? '+' + int.format(lev.reduce((t, l) => t + (Number(l.stuks) || 0), 0)) : '—', lst);
    const ti = totInfo(r, window.vrVraag(r), x.origine);
    card('Voorraad tot', totTxt(ti), `scenario ${scenNaam(k)}` + (ti.tijdelijk ? ` · ${ti.nuOp ? 'nu op' : 'op vanaf ' + dNl(ti.van)}, weer binnen ${dNl(ti.terug)}` : '') + (ti.magTot ? ` · tot de container ${int.format(ti.magTot)} st uit het Apple Bee-magazijn` : ''), ti.tijdelijk ? 'dk-warnc' : '');
    card(actieTxt(x.a), x.a.rank <= 1 ? 'Nu bestellen' : x.a.bestelDatum ? 'uiterlijk ' + dNl(x.a.bestelDatum) : 'geen actie', x.a.qtyNu ? `advies ${int.format(x.a.qtyNu)} st · levertijd ${x.a.L} wk · bestel je nu, dan binnen ± ${dNl(x.a.aankomst)}${x.a.cny ? ' (incl. Chinees Nieuwjaar)' : x.a.leb ? ' (incl. Lebaran)' : ''}` + (x.mag ? ` · eerst ${int.format(x.mag)} st uit magazijn` : '') : `levertijd ${x.a.L} wk`, x.a.rank <= 1 ? 'dk-bad' : x.a.rank === 2 ? 'dk-warnc' : '');
    box.append(cards);
    // groei: standaard begroting, of 0%, of een eigen percentage
    const bar = el('div', 'lw-mini'); bar.append(el('span', 'dk-lbl', 'Verwachte groei:'));
    for (const [v, l] of [['b', 'Begroting'], [0, '0% (gelijk aan vorig seizoen)']]) { const b = el('button', '', l); b.type = 'button'; b.setAttribute('aria-pressed', String(String(k) === String(v))); b.addEventListener('click', (e) => { e.stopPropagation(); saveGroei(r.sku, v === 'b' ? null : v); }); bar.append(b); }
    const inp = el('input'); inp.type = 'number'; inp.step = 5; inp.placeholder = 'eigen %'; if (typeof k === 'number' && k !== 0) inp.value = k;
    inp.addEventListener('click', (e) => e.stopPropagation()); inp.addEventListener('change', () => saveGroei(r.sku, inp.value === '' ? null : Number(inp.value)));
    bar.append(inp, el('span', 'dk-lbl', '%'));
    box.append(bar);
    // per maand: verkocht vorige seizoenen, prognose, inkomend, voorraad eind maand
    const v = window.vrVraag(r), p = projectie(r, v, x.origine);
    const prog = new Map(), eind = new Map(), inM = new Map(), magM = new Map();
    // per maand op dagbasis: een week die over twee maanden loopt telt naar rato van de dagen mee
    for (let i = 0; i < v.length; i++) {
      for (let j = 0; j < 7; j++) { const m = addD(p.wk(i), j).slice(0, 7); prog.set(m, (prog.get(m) || 0) + v[i] / 7); if (p.mag[i]) magM.set(m, (magM.get(m) || 0) + p.mag[i] / 7); }
      eind.set(addD(p.wk(i), 6).slice(0, 7), p.proj[i]);
    }
    for (const l of r.leveringen || []) { const m = etaOf(l).slice(0, 7); inM.set(m, (inM.get(m) || 0) + (Number(l.stuks) || 0)); }
    const M = r.maanden || {};
    const pm = [...prog.keys()].slice(0, 12);
    const shift = (m, n) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
    const sz = (m) => `${m.slice(2, 4)}/${String(+m.slice(2, 4) + 1).padStart(2, '0')}`;
    const mt = el('table', 'lw-table vr-sub dk-mnd'); const mh = el('tr'); mh.append(el('th', '', 'Per maand'));
    pm.forEach((m, i) => mh.append(el('th', 'lw-num', mnd(m) + (i === 0 ? '*' : ''))));
    mh.append(el('th', 'lw-num', 'Totaal')); const mth = el('thead'); mth.append(mh); mt.append(mth);
    const mtb = el('tbody');
    const rowOf = (label, get, cls, tot = true) => { const tr = el('tr', cls || ''); tr.append(el('td', '', label)); let t = 0; pm.forEach((m) => { const x2 = get(m); if (x2 != null) t += x2; const td = el('td', 'lw-num', x2 == null || (cls === 'dk-in' && !x2) ? '' : (cls === 'dk-in' ? '+' : '') + int.format(Math.round(x2))); if (cls === 'dk-eind' && x2 != null) td.classList.add(x2 < 0 ? 'dk-neg' : x2 < (v[0] || 0) * 2 ? 'dk-low' : 'dk-pos'); tr.append(td); }); tr.append(el('td', 'lw-num', tot && !(cls === 'dk-in' && !t) ? (cls === 'dk-in' ? '+' : '') + int.format(Math.round(t)) : '')); mtb.append(tr); };
    for (const kk of [1]) { const f = shift(pm[0], -12 * kk); if (!Object.keys(M).some((m) => m >= f && m <= shift(f, 11))) continue; rowOf(`Verkocht seizoen ${sz(f)}`, (m) => { const key = shift(m, -12 * kk); return key in M ? M[key] : null; }, 'dk-hist'); }
    rowOf(`Verwacht ${sz(pm[0])} (${scenNaam(k)})`, (m) => prog.get(m), 'dk-prog');
    rowOf('Inkomend', (m) => inM.get(m) || 0, 'dk-in');
    if (magM.size) rowOf('Uit Apple Bee-magazijn', (m) => magM.get(m) || 0, 'dk-in');
    rowOf('Voorraad eind maand', (m) => eind.get(m), 'dk-eind', false);
    mt.append(mtb); const mb = el('div', 'lw-tablebox'); mb.append(mt); box.append(mb);
    box.append(el('p', 'lw-note', `* rest van deze maand. Verwacht = ${r.vraag_eigen ? 'verkoop van dit product in dezelfde maand vorig seizoen' : 'gemiddelde verkoop per week (product loopt nog geen jaar) verdeeld volgens het seizoenspatroon van de winkel'} × (1 + groei). Maanden waarin het product uitverkocht was tellen als lage verkoop: kies dan een hoger scenario. Je keuze wordt per product opgeslagen en geldt ook voor de bestellijst.`));
    box.append(holdKnoppen(r.sku));
    return box;
  }
  // uitleg bij het advies: waarom, wanneer we anders uitlopen en op welke aannames het rust
  function waarom(r, x) {
    const a = x.a, k = keuze(r.sku), v = window.vrVraag(r);
    const w = el('div', 'dk-why'); w.append(el('h4', '', 'Waarom dit advies'));
    const ol = el('ol');
    const li = (html, sub) => { const l = el('li'); l.innerHTML = html; if (sub) l.append(el('div', 'dk-why-s', sub)); ol.append(l); };
    const f = (n) => int.format(Math.round(n)), d = (s) => (s ? dNl(s) : '—'), esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const v13 = v.slice(0, 13).reduce((t, y) => t + y, 0);
    li(`<b>Verwachte verkoop:</b> ${f(v13)} st in de komende 13 weken, rond de aankomst van een nieuwe bestelling ± ${n1.format(a.perWk)} st per week.`,
      `Basis: ${r.vraag_eigen ? 'verkoop van dit product in dezelfde maanden vorig seizoen' : 'gemiddelde weekverkoop (product loopt nog geen jaar) × seizoenspatroon van de winkel'}, × groei ${scenNaam(k)}${k === 'b' ? ' (de begrote groei per maand)' : ''}. Vorig jaar 52 weken: ${f(r.verkocht_52w || 0)} st verkocht, laatste 13 weken ${f(r.verkocht_13w || 0)} st.`);
    const lev = (r.leveringen || []).slice().sort((p, q) => (etaOf(p) < etaOf(q) ? -1 : 1));
    li(`<b>Voorraad en onderweg:</b> nu ${f(r.voorraad)} st (vrij, na al verkochte orders)${lev.length ? ', onderweg ' + lev.map((l) => `${f(l.stuks)} st (${esc(l.po)}, ${d(etaOf(l))})`).join(', ') : ', niets onderweg'}.`,
      a.opDatum ? `Zonder nieuwe bestelling ${a.kortVoor && lev.length ? 'raak je op ' + d(a.opDatum) + ' tijdelijk op, nog vóór de volgende levering' : 'loop je uit op ± ' + d(a.opDatum)}.` : 'Zonder nieuwe bestelling heb je de komende 60 weken genoeg.');
    li(`<b>Levertijd:</b> ${a.L} weken (${esc(a.ltLev)}): ${a.ltBron}. Bestel je nu, dan binnen ± ${d(a.aankomst)}.`,
      a.cny ? 'Inclusief Chinees Nieuwjaar: fabrieken dicht ± 15 jan – eind feb, eerste schepen ± 10 maart; na 1 december besteld ± 3 weken later weg door drukte.' : a.leb ? 'Inclusief Lebaran: Indonesische fabrieken ± 2 weken dicht rond Idul Fitri.' : '');
    if (a.bp) li(`<b>Bestelpunt:</b> ${d(a.bp)} zakt de voorraad onder de veiligheidsvoorraad van ${a.B} weken verkoop (${f(a.bufNu)} st). De levering moet dan binnen zijn, dus <b>bestellen uiterlijk ${a.rank <= 1 ? 'nu' : d(a.bestelDatum)}</b>.`,
      a.kortVoor ? `Je raakt al eerder op (${d(a.opDatum)}) dan een bestelling van nu binnen kan zijn (${d(a.aankomst)})${x.mag ? `; ${f(x.mag)} st uit het Apple Bee-magazijn overbrugt dat gat` : ''}.` : '');
    else li('<b>Bestelpunt:</b> niet binnen 60 weken, dus geen bestelling nodig.');
    if (a.qtyNu) li(`<b>Hoeveelheid ${f(a.qtyNu)} st:</b> verkoop vanaf aankomst over ${a.D} weken dekking + ${a.B} weken veiligheid = ${f(a.need)} st, min ${f(Math.max(0, a.atArr))} st die er bij aankomst nog ligt${a.inWin ? `, min ${f(a.inWin)} st die in die periode al binnenkomt` : ''}.`,
      `Dekking en veiligheidsvoorraad pas je aan bij Instellingen${x.cbm ? ` · ${n1.format(a.qtyNu * x.cbm)} cbm` : ''}${r.kostprijs ? ` · inkoop ± ${eur0.format(a.qtyNu * r.kostprijs)}` : ''}.`);
    w.append(ol); return w;
  }
  // tot wanneer is er voorraad: eerste tekort ná de laatste levering; een tekort vóór een levering is tijdelijk ('nu op, weer binnen …')
  const totInfo = (r, v, ab) => {
    const p = projectie(r, v, ab); const magTot = Math.ceil(p.mag.reduce((a, b) => a + b, 0)); let last = -1; p.arr.forEach((q, i) => { if (q > 0) last = i; });
    let tot = null; for (let i = Math.max(0, last); i < p.proj.length; i++) if (p.proj[i] < 0) { tot = i; break; }
    const tijdelijk = p.op !== null && (tot === null || p.op < tot) && p.op <= last;
    const terug = tijdelijk ? p.arr.findIndex((q, i) => q > 0 && i >= p.op) : -1;
    const terugDt = tijdelijk ? (r.leveringen || []).map(etaOf).filter((d) => d >= addD(p.wk(p.op), -6)).sort()[0] : null;
    return { magTot, tot: tot === null ? null : p.wk(tot), tijdelijk, nuOp: p.op === 0, van: tijdelijk ? p.wk(p.op) : null, terug: terugDt || (terug >= 0 ? p.wk(terug) : null) };
  };
  const totTxt = (t) => (t.tot ? dNl(t.tot) : 'ruim (na 60 wk)');
  // ab = Apple Bee uit origine: een tekort vóór de laatste container wordt aangevuld uit het Apple Bee-magazijn
  const projectie = (r, v, ab) => {
    const H = v.length, t0 = (SEIZ()[0] || {}).week || today();
    const arr = new Array(H).fill(0);
    for (const x of r.leveringen || []) { const i = Math.max(0, Math.floor((P0(etaOf(x)) - P0(t0)) / DAY / 7)); if (i < H) arr[i] += Number(x.stuks) || 0; }
    let last = -1; arr.forEach((q, i) => { if (q > 0) last = i; });
    let s = Number(r.voorraad) || 0, op = null; const proj = [], mag = new Array(H).fill(0);
    if (ab && s < 0) { mag[0] += -s; s = 0; }
    for (let i = 0; i < H; i++) {
      s += arr[i] - v[i];
      if (ab && s < 0 && i < last) { mag[i] += -s; s = 0; }
      proj.push(s); if (op === null && s < 0) op = i;
    }
    return { proj, op, arr, mag, t0, wk: (i) => addD(t0, i * 7) };
  };
  // ---------- opslag: hoeveel cbm ligt er nu en wat komt eraan, tegenover de ruimte in de hallen ----------
  function renderOpslag() {
    const host = document.getElementById('vr-op-tbl'); if (!host) return;
    const dk = rows('st_dekking'), sz = SEIZ(); if (!dk || !sz.length) return;
    prepDk(dk);
    const P = dash.params();
    const m2 = num(P.vr_m2, 1100), hoog = num(P.vr_hoog, 2.5), benut = num(P.vr_benut, 60);
    document.querySelectorAll('#vr-op-set [data-op]').forEach((i) => {
      const d = { vr_m2: 1100, vr_hoog: 2.5, vr_benut: 60 }[i.dataset.op];
      if (document.activeElement !== i) i.value = num(P[i.dataset.op], d);
      if (!i._op) { i._op = 1; const zet = () => { const v = i.value === '' ? null : Number(i.value); if (v === null || v > 0) dash.setParams({ [i.dataset.op]: v }); }; i.addEventListener('input', () => { clearTimeout(i._t); i._t = setTimeout(zet, 400); }); i.addEventListener('change', zet); }
    });
    const cap = m2 * hoog * benut / 100;
    const vloer = (c) => (hoog > 0 && benut > 0 ? c / hoog / (benut / 100) : 0); // m² hal nodig, inclusief looppaden
    const M = (c) => `${int.format(c)} cbm (± ${int.format(vloer(c))} m²)`;
    const se = document.getElementById('op-stand'), st0 = (SEIZ()[0] || {}).stand; if (se) se.textContent = st0 ? dNl(st0.slice(0, 10)) + ' ' + st0.slice(11, 16) : '—';
    // cbm per product; zonder cbm: schatting via cbm per euro inkoop van de producten waar het wel bekend is
    let kc = 0, ke = 0; for (const r of dk) { const c = cbmOf(r.sku), k = Number(r.kostprijs) || 0; if (c && k) { kc += c; ke += k; } }
    const perEur = ke ? kc / ke : 0;
    const cb = (r) => { const c = cbmOf(r.sku); if (c) return [c, false]; const k = Number(r.kostprijs) || 0; return k && perEur ? [k * perEur, true] : [0, true]; };
    const t = today(), m0 = t.slice(0, 7);
    const shift = (m, n) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
    const months = Array.from({ length: 13 }, (_, i) => shift(m0, i));
    const eind = new Map(months.map((m) => [m, [0, 0]])), inM = new Map(months.map((m) => [m, [0, 0]]));
    let nuK = 0, nuS = 0, stK = 0, stS = 0; const ALL = [];
    for (const r of dk) {
      const [c, est] = cb(r); if (!c) continue;
      const fys = Math.max(0, Number(r.in_stock ?? r.voorraad) || 0);
      if (est) { nuS += fys * c; if (fys) stS += fys; } else { nuK += fys * c; if (fys) stK += fys; }
      const incM = new Map();
      for (const l of r.leveringen || []) { const m = etaOf(l).slice(0, 7); if (inM.has(m)) inM.get(m)[est ? 1 : 0] += (Number(l.stuks) || 0) * c; incM.set(m, (incM.get(m) || 0) + (Number(l.stuks) || 0)); }
      const ab = grpProd(r) === 'ab' && !!HERK[r.sku];
      const p = projectie(r, window.vrVraag(r), ab);
      const per = new Map(); for (let i = 0; i < p.proj.length; i++) per.set(addD(p.wk(i), 6).slice(0, 7), Math.max(0, p.proj[i]));
      const res = Math.max(0, (Number(r.in_stock ?? r.voorraad) || 0) - (Number(r.voorraad) || 0)); // al verkocht, nog niet geleverd
      const sm = new Map();
      for (const m of months) { let v = per.has(m) ? per.get(m) : null; if (v == null) continue; if (m === m0) v += res; eind.get(m)[est ? 1 : 0] += v * c; sm.set(m, v); }
      ALL.push({ r, c, est, fys, sm, incM });
    }
    const nu = nuK + nuS;
    // grootste posities in een gekozen maand: per collectie (openklikbaar) of per product, van groot naar klein
    {
      const sel = months.includes(P.op_m) ? P.op_m : m0;
      const per = ['p', 'l', 'm'].includes(P.op_per) ? P.op_per : 'c';
      const tg = document.getElementById('op-pos-t');
      const mkb = (k, l) => { const b = el('button', '', l); b.type = 'button'; b.setAttribute('aria-pressed', String(per === k)); b.addEventListener('click', () => dash.setParams({ op_per: k === 'c' ? null : k })); return b; };
      tg.replaceChildren(mkb('l', 'Per leverancier'), mkb('m', 'Per merk'), mkb('c', 'Per collectie'), mkb('p', 'Per product'));
      const mb = document.getElementById('op-pos-m');
      mb.replaceChildren(el('span', 'op-m-l', 'Bekijk maand:'), ...months.map((m) => { const tot = m === m0 ? nu : eind.get(m)[0] + eind.get(m)[1]; const b = el('button', 'op-m-b ' + (tot > cap ? 'op-over' : tot > cap * 0.85 ? 'op-krap' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(m === sel)); b.append(el('b', '', m === m0 ? 'nu' : mNl(m).replace(' 20', " '")), el('span', '', pct0.format(tot / cap))); b.addEventListener('click', () => dash.setParams({ op_m: m === m0 ? null : m })); return b; }));
      const isNu = sel === m0;
      const inNa = (x) => [...x.incM.entries()].filter(([m]) => m > sel).reduce((t, [, q]) => t + q, 0) * x.c;
      const POS = ALL.map((x) => { const st = isNu ? x.fys : (x.sm.get(sel) || 0); return { ...x, st, cbm: st * x.c, d: (st - x.fys) * x.c, inc: inNa(x) }; }).filter((x) => x.st > 0.5);
      const tot = POS.reduce((t, x) => t + x.cbm, 0) || 1;
      let groepen;
      const wrd = (x) => x.st * (Number(x.r.kostprijs) || 0);
      const totW = POS.reduce((t, x) => t + wrd(x), 0) || 1;
      const merkVan = (r) => { const k = String(r.sku || ''); if (/^AB-/i.test(k) || r.leverancier === 'Apple Bee') return 'Apple Bee'; if (/^GI-/i.test(k)) return 'Garden Impressions'; if (/^EASY-/i.test(k)) return 'Easyfires'; if (/^HAR/i.test(k)) return 'Hartman'; if (/^4SO-/i.test(k)) return '4Seasons'; const m = (collectie(r).merk || r.merk || '').replace(/®/g, '').trim(); return /^belito/i.test(m) || /^BEL/i.test(k) ? 'Belito' : /aerocover|platinum/i.test(m) || /^(AERO|PLATINUM)/i.test(k) ? 'Platinum' : m || 'Overig'; };
      if (per === 'p') groepen = POS.map((x) => ({ naam: vol(x.r.naam), sub: x.r.sku, lev: x.r.leverancier, stuks: x.st, cbm: x.cbm, d: x.d, inc: x.inc, est: x.est, w: wrd(x), items: null }));
      else {
        const m = new Map();
        const keyOf = (x) => (per === 'l' ? x.r.leverancier || 'Onbekend' : per === 'm' ? merkVan(x.r) : collectie(x.r).col || vol(x.r.naam));
        for (const x of POS) { const k = keyOf(x); const g = m.get(k) || { naam: k, lev: per === 'l' ? '' : per === 'm' ? '' : x.r.leverancier, stuks: 0, cbm: 0, d: 0, inc: 0, estC: 0, w: 0, items: [] }; g.stuks += x.st; g.cbm += x.cbm; g.d += x.d; g.inc += x.inc; g.w += wrd(x); if (x.est) g.estC += x.cbm; g.items.push(x); m.set(k, g); }
        if (per === 'm') for (const g of m.values()) { const lv = {}; for (const x of g.items) lv[x.r.leverancier] = (lv[x.r.leverancier] || 0) + x.cbm; g.lev = Object.entries(lv).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(', '); }
        groepen = [...m.values()].map((g) => ({ ...g, est: g.estC > g.cbm / 2, sub: `${g.items.length} ${g.items.length === 1 ? 'product' : 'producten'}` }));
      }
      groepen.sort((a, b) => b.cbm - a.cbm);
      const max = groepen[0] ? groepen[0].cbm : 1;
      const OPG = renderOpslag.open || (renderOpslag.open = new Set());
      const dTxt = (v) => (Math.abs(v) < 0.05 ? '' : (v > 0 ? '+' : '−') + n1.format(Math.abs(v)));
      const lastH = isNu ? 'Komt erbij' : 't.o.v. nu';
      const lastV = (g) => (isNu ? (g.inc ? '+' + n1.format(g.inc) : '') : dTxt(g.d));
      const t2 = document.getElementById('op-pos'); const th2 = el('thead'); const hr2 = el('tr');
      ['#', { p: 'Product', c: 'Collectie', l: 'Leverancier', m: 'Merk' }[per], per === 'm' ? 'Leveranciers' : per === 'l' ? '' : 'Leverancier', 'Stuks', 'cbm', 'm² hal', '% van de hal', 'Aandeel cbm', 'Inkoopwaarde', 'Aandeel waarde', '', lastH].forEach((h, i) => hr2.append(el('th', i === 0 || (i >= 3 && i !== 10) ? 'lw-num' : '', h))); th2.append(hr2);
      const tb2 = el('tbody'); let cum = 0;
      groepen.slice(0, P.op_alles ? 300 : 20).forEach((g, i) => {
        cum += g.cbm;
        const tr = el('tr', g.items ? 'op-grp' : '');
        const nm = el('td', 'lw-wrap'); if (g.items) nm.append(el('span', 'dk-caret', OPG.has(g.naam) ? '▾ ' : '▸ ')); nm.append(document.createTextNode(g.naam + (g.est ? ' *' : '')), el('div', 'dk-sku', g.sub));
        const bc = el('td', 'op-barcel'); const pb = el('div', 'op-pbar'); const f = el('div', g.est ? 'op-est' : ''); f.style.width = (g.cbm / max) * 100 + '%'; pb.append(f); bc.append(pb);
        tr.append(el('td', 'lw-num', String(i + 1)), nm, el('td', '', g.lev || ''), el('td', 'lw-num', int.format(g.stuks)), el('td', 'lw-num', n1.format(g.cbm)), el('td', 'lw-num', int.format(vloer(g.cbm))),
          el('td', 'lw-num', pct0.format(g.cbm / cap)), el('td', 'lw-num', pct0.format(g.cbm / tot)), el('td', 'lw-num', eur0.format(g.w)), el('td', 'lw-num', pct0.format(g.w / totW)), bc, el('td', 'lw-num' + (!isNu && g.d > 0 ? ' op-up' : !isNu && g.d < 0 ? ' op-down' : ''), lastV(g)));
        tr.title = `Samen met de posities hierboven ${pct0.format(cum / tot)} van alle voorraad`;
        if (g.items) tr.addEventListener('click', () => { if (OPG.has(g.naam)) OPG.delete(g.naam); else OPG.add(g.naam); renderOpslag(); });
        tb2.append(tr);
        if (g.items && OPG.has(g.naam)) for (const x of g.items.slice().sort((a, b) => b.cbm - a.cbm)) {
          const s2 = el('tr', 'op-sub'); const nm2 = el('td', 'lw-wrap'); nm2.append(document.createTextNode(vol(x.r.naam) + (x.est ? ' *' : '')), el('div', 'dk-sku', x.r.sku + (x.est ? ' · cbm geschat' : ` · ${String(x.c).replace('.', ',')} cbm/st`)));
          s2.append(el('td', ''), nm2, el('td', '', x.r.leverancier || ''), el('td', 'lw-num', int.format(x.st)), el('td', 'lw-num', n1.format(x.cbm)), el('td', 'lw-num', int.format(vloer(x.cbm))), el('td', 'lw-num', pct0.format(x.cbm / cap)), el('td', 'lw-num', pct0.format(x.cbm / tot)), el('td', 'lw-num', eur0.format(wrd(x))), el('td', 'lw-num', pct0.format(wrd(x) / totW)), el('td', ''), el('td', 'lw-num', lastV(x)));
          tb2.append(s2);
        }
      });
      if (groepen.length > 20) { const tr = el('tr'); const td = el('td'); td.colSpan = 12; const b = el('button', 'vr-link', P.op_alles ? 'alleen top 20 tonen' : `alle ${groepen.length} tonen`); b.type = 'button'; b.addEventListener('click', () => dash.setParams({ op_alles: P.op_alles ? null : 1 })); td.append(b); tr.append(td); tb2.append(tr); }
      t2.replaceChildren(th2, tb2);
      const top20 = groepen.slice(0, 20).reduce((t, g) => t + g.cbm, 0);
      document.getElementById('op-pos-h').textContent = `Top 20 grootste posities · ${isNu ? 'nu' : 'eind ' + mNl(sel)} · hal ${pct0.format(tot / cap)} vol · top 20 = ${pct0.format(top20 / tot)} van de voorraad`;
    }
    const pk = months.slice(1).reduce((b, m) => { const v = eind.get(m)[0] + eind.get(m)[1]; return v > b.v ? { m, v } : b; }, { m: null, v: 0 });
    const inTot = months.reduce((a, m) => a + inM.get(m)[0] + inM.get(m)[1], 0);
    const lvl = (c) => (c > cap ? 'op-over' : c > cap * 0.85 ? 'op-krap' : 'op-ok');
    const KL = { 'op-ok': ['#1f4b47', '#8fb3ae'], 'op-krap': ['#c98a00', '#ebcf8f'], 'op-over': ['#c0392b', '#e8a097'] };
    const mnd = (m) => (m === m0 ? 'nu' : mNl(m).replace(' 20', " '"));
    // drie kerncijfers met een vulbalk tegenover de ruimte
    const hero = document.getElementById('op-hero');
    const kaart = (label, c, sub, metBalk) => {
      const d = el('div', 'op-k'); d.append(el('div', 'op-k-l', label));
      const v = el('div', 'op-k-v', `${int.format(c)} cbm`); v.append(el('small', '', `± ${int.format(vloer(c))} m²`)); d.append(v);
      if (metBalk) { const b = el('div', 'op-bar'); const f = el('div'); f.style.width = Math.min(100, (c / cap) * 100) + '%'; f.style.background = KL[lvl(c)][0]; b.append(f); d.append(b); const s2 = el('div', 'op-k-s'); s2.append(el('span', 'op-pct ' + lvl(c), pct0.format(c / cap) + ' vol'), document.createTextNode(' · ' + sub)); d.append(s2); }
      else d.append(el('div', 'op-k-s', sub));
      return d;
    };
    hero.replaceChildren(
      kaart('Nu in de hallen', nu, `ruimte ${int.format(cap)} cbm (${int.format(m2)} m²)`, true),
      kaart('Drukste maand', pk.v, pk.m ? `eind ${mNl(pk.m)}` : '—', true),
      kaart('Komt eraan (12 mnd)', inTot, `${months.filter((m) => inM.get(m)[0] + inM.get(m)[1] > 0).length} maanden met containers (containerplanning)`, false));
    const sum = document.getElementById('op-set-sum'); if (sum) sum.textContent = `= ${int.format(cap)} cbm opslagruimte · voor iedereen opgeslagen`;
    document.getElementById('op-legend').innerHTML = `<span><i style="background:${KL['op-ok'][0]}"></i>tot 85%</span><span><i style="background:${KL['op-krap'][0]}"></i>85–100%</span><span><i style="background:${KL['op-over'][0]}"></i>te vol</span><span><i style="background:${KL['op-ok'][1]}"></i>lichter = geschatte cbm</span>`;
    // grafiek
    const box = document.getElementById('vr-op-chart'); box.replaceChildren();
    const W = Math.max(320, box.clientWidth || 1100), H = 260, top = 26, bot = H - 26, left = 46;
    const vals = months.map((m) => ({ m, k: m === m0 ? nuK : eind.get(m)[0], s: m === m0 ? nuS : eind.get(m)[1], i: inM.get(m)[0] + inM.get(m)[1] }));
    const hi = Math.max(cap, ...vals.map((v) => v.k + v.s)) * 1.12;
    const y = d3.scaleLinear([0, hi], [bot, top]).nice(), x = d3.scaleBand(months, [left, W - 6]).padding(0.3);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', left).attr('x2', W - 6).attr('y1', y).attr('y2', y).attr('stroke', '#eceae4');
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', left - 8).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').attr('font-size', 11).attr('fill', '#8a877f').text((v) => int.format(v));
    for (const v of vals) {
      const tot = v.k + v.s, [c1, c2] = KL[lvl(tot)], bx = x(v.m), bw = x.bandwidth();
      svg.append('rect').attr('x', bx).attr('width', bw).attr('y', y(tot)).attr('height', Math.max(0, bot - y(tot))).attr('rx', 4).attr('fill', c2);
      svg.append('rect').attr('x', bx).attr('width', bw).attr('y', y(v.k)).attr('height', Math.max(0, bot - y(v.k))).attr('rx', 4).attr('fill', c1);
      svg.append('text').attr('x', bx + bw / 2).attr('y', y(tot) - 6).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 600).attr('fill', c1).text(pct0.format(tot / cap));
      svg.append('text').attr('x', bx + bw / 2).attr('y', H - 8).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', v.m === m0 ? '#1f4b47' : '#8a877f').attr('font-weight', v.m === m0 ? 600 : 400).text(mnd(v.m));
      if (v.m === (months.includes(P.op_m) ? P.op_m : m0)) svg.append('rect').attr('x', bx - 6).attr('width', bw + 12).attr('y', top - 18).attr('height', bot - top + 18).attr('rx', 6).attr('fill', 'none').attr('stroke', '#84bd3f').attr('stroke-width', 2);
      svg.append('rect').attr('x', bx - 4).attr('width', bw + 8).attr('y', top).attr('height', bot - top).attr('fill', 'transparent').style('cursor', 'pointer').on('click', () => dash.setParams({ op_m: v.m === m0 ? null : v.m })).append('title').text(`${mnd(v.m)}: ${int.format(tot)} cbm (± ${int.format(vloer(tot))} m²), ${pct0.format(tot / cap)} vol${v.i ? ` · binnen: ${int.format(v.i)} cbm` : ''}`);
    }
    svg.append('line').attr('x1', left).attr('x2', W - 6).attr('y1', y(cap)).attr('y2', y(cap)).attr('stroke', '#c0392b').attr('stroke-width', 1.5).attr('stroke-dasharray', '5 4');
    svg.append('text').attr('x', W - 8).attr('y', y(cap) - 6).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', '#c0392b').text(`vol: ${int.format(cap)} cbm (${int.format(m2)} m²)`);
    // tabel: per maand binnenkomend, voorraad (cbm en m²) en bezetting
    const th = el('thead'), hr = el('tr'); hr.append(el('th', '', '')); for (const m of months) hr.append(el('th', '', mnd(m))); th.append(hr);
    const tb = el('tbody');
    const r1 = el('tr'); r1.append(el('td', '', 'Containers binnen')); const r2 = el('tr'); r2.append(el('td', '', 'Voorraad eind maand')); const r3 = el('tr'); r3.append(el('td', '', 'Bezetting'));
    for (const v of vals) {
      const tot = v.k + v.s;
      const a = el('td'); if (v.i) { a.append(document.createTextNode(`+${int.format(v.i)}`), el('small', '', `${int.format(vloer(v.i))} m²`)); } r1.append(a);
      const b = el('td'); b.append(document.createTextNode(int.format(tot)), el('small', '', `${int.format(vloer(tot))} m²`)); r2.append(b);
      const c = el('td'); c.append(el('span', 'op-pill ' + lvl(tot), pct0.format(tot / cap))); r3.append(c);
    }
    tb.append(r1, r2, r3); host.replaceChildren(th, tb);
    document.getElementById('vr-op-note').textContent = `Bedragen in cbm, met tussen haakjes de vloer die je nodig hebt: cbm ÷ stapelhoogte ÷ % vloer voor opslag (de rest is looppad). Voorraad eind maand = wat er nu ligt + containers − verwachte verkoop (begroting). Nu = fysiek in de hallen, inclusief verkocht maar nog niet geleverd. Van ${int.format(stK)} stuks is de cbm bekend; voor ${int.format(stS)} stuks zonder cbm is die geschat via de gemiddelde cbm per euro inkoop (${n2.format(perEur * 1000)} cbm per € 1.000), in de grafiek lichter. Vul de cbm aan bij Inkopen › Voorraad per product › CBM per product.`;
  }

  dash.onData(() => keepPos(() => { try { renderOpslag(); } catch (e) { console.error('[voorraad] opslag', e); } try { renderBg(); } catch (e) { console.error('[voorraad] begroting', e); } try { render(); } catch (e) { console.error('[voorraad]', e); } try { dkDecorate(); } catch (e) { console.error('[voorraad] detail', e); } }));
})();
