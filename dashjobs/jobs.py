"""Alle automatische datataken. Elke taak schrijft één of meer bronnen in de opslag.

Taken (planning in scheduler.py):
  shop_daily     Shopify-omzet per dag sinds okt 2023 + ontvangsten per dag
  shop_recent    omzet en productverkoop laatste 7 dagen (incl. vandaag) + openstaande klantbetalingen
  shop_weekly    sessies, uitleveringen, productverkoop (2 jaar) + Sumtracker-voorraad
  ads_daily      Meta/Google per dag en per campagne, sessies 14 dagen, ProfitMetrics, weer,
                 Google-bedrijfsprofiel, zoekbezoek per maand, Meta-advertenties (moeheid)
  markt_kp       zoekvolume per maand uit de Google Zoekwoordplanner
  containers     containerplanning uit OneDrive + wisselkoers USD→EUR
"""
import os, re, io, json, csv, datetime, subprocess, tempfile, collections, sys
from pathlib import Path
import store
from . import shopify, windsor, sumtracker, profitmetrics, onedrive
from .common import today, yesterday, days_ago, num, r2, i0, http

HERE = Path(__file__).parent


def _merge(old, new, key):
    m = {key(r): r for r in (old or [])}
    for r in new:
        m[key(r)] = r
    return [m[k] for k in sorted(m)]


def _d10(v):
    return str(v)[:10]


# =====================================================================
# Shopify
# =====================================================================
def shop_sales_daily():
    rows = shopify.shopifyql(f"FROM sales SHOW orders, gross_sales, discounts, sales_reversals, net_sales, taxes, total_sales TIMESERIES day SINCE 2023-10-01 UNTIL {yesterday()} LIMIT 100000")
    out = [{'day': _d10(shopify.day_of(r)), 'orders': i0(r.get('orders')), 'omzet': r2(num(r.get('total_sales')) - num(r.get('taxes'))),
            'omzet_incl': r2(r.get('total_sales')), 'retouren': r2(-num(r.get('sales_reversals')))} for r in rows]
    out.sort(key=lambda r: r['day'])
    store.save_dataset('shop_sales_daily', out)
    return f'{len(out)} dagen'


def ontvangsten():
    rows = shopify.shopifyql(f"FROM payments SHOW net_payments TIMESERIES day SINCE 2024-10-01 UNTIL {yesterday()} LIMIT 100000")
    out = [{'day': _d10(shopify.day_of(r)), 'ontvangen': r2(r.get('net_payments'))} for r in rows]
    out.sort(key=lambda r: r['day'])
    store.save_dataset('ontvangsten', out)
    return f'{len(out)} dagen'


def shop_sales_recent():
    rows = shopify.shopifyql('FROM sales SHOW orders, sales_reversals, taxes, total_sales TIMESERIES day SINCE -6d UNTIL today')
    out = [{'day': _d10(shopify.day_of(r)), 'orders': i0(r.get('orders')), 'omzet': r2(num(r.get('total_sales')) - num(r.get('taxes'))),
            'omzet_incl': r2(r.get('total_sales')), 'retouren': r2(-num(r.get('sales_reversals')))} for r in rows]
    store.save_dataset('shop_sales_recent', sorted(out, key=lambda r: r['day']))
    return f'{len(out)} dagen'


def shop_products_recent():
    rows = shopify.shopifyql('FROM sales SHOW net_items_sold, orders, net_sales GROUP BY product_title TIMESERIES day SINCE -6d UNTIL today LIMIT 5000')
    out = [{'day': _d10(shopify.day_of(r)), 'product_title': r.get('product_title') or '', 'net_items_sold': i0(r.get('net_items_sold')),
            'orders': i0(r.get('orders')), 'net_sales': r2(r.get('net_sales'))} for r in rows]
    store.save_dataset('shop_products_recent', out)
    return f'{len(out)} rijen'


OPEN_Q = '''query($first:Int!, $after:String){ orders(first:$first, after:$after, sortKey:CREATED_AT, query:"NOT status:cancelled AND (financial_status:pending OR financial_status:partially_paid OR financial_status:authorized)") { pageInfo { hasNextPage endCursor } nodes { name createdAt displayFinancialStatus displayFulfillmentStatus cancelledAt closed note tags totalPriceSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount } } totalOutstandingSet { shopMoney { amount } } totalReceivedSet { shopMoney { amount } } customAttributes { key value } } } }'''


def shop_open():
    nodes, after = [], None
    for _ in range(40):
        o = shopify.graphql(OPEN_Q, {'first': 100, 'after': after})['orders']
        nodes += o['nodes']
        if not o['pageInfo']['hasNextPage']:
            break
        after = o['pageInfo']['endCursor']
    with tempfile.TemporaryDirectory() as td:
        src, dst = Path(td) / 'orders.json', Path(td) / 'out.json'
        src.write_text(json.dumps({'data': {'orders': {'nodes': nodes}}}, ensure_ascii=False))
        subprocess.run([sys.executable, '-I', str(HERE / 'build_open.py'), str(src), str(dst), today().isoformat()], check=True, capture_output=True, text=True)
        rows = json.loads(dst.read_text())
    store.save_dataset('shop_open', rows)
    return f'{len(rows)} orders, € {sum(r["openstaand"] for r in rows):,.0f} open'


def _sessions(q):
    rows = shopify.shopifyql(q)
    return [{'day': _d10(shopify.day_of(r)), 'sessions': i0(r.get('sessions')), 'sessions_with_cart_additions': i0(r.get('sessions_with_cart_additions')),
             'sessions_that_reached_checkout': i0(r.get('sessions_that_reached_checkout')), 'sessions_that_completed_checkout': i0(r.get('sessions_that_completed_checkout'))} for r in rows]


def shop_sessions_daily():
    out = _sessions('FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -730d UNTIL -1d LIMIT 100000')
    store.save_dataset('shop_sessions_daily', sorted(out, key=lambda r: r['day']))
    return f'{len(out)} dagen'


def shop_sessions_recent():
    out = _sessions(f'FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -14d UNTIL {yesterday()} LIMIT 1000')
    store.save_dataset('shop_sessions_recent', sorted(out, key=lambda r: r['day']))
    return f'{len(out)} dagen'


def shop_fulfil_daily():
    rows = shopify.shopifyql('FROM fulfillments SHOW orders_fulfilled TIMESERIES day SINCE -730d UNTIL -1d LIMIT 100000')
    out = sorted([{'day': _d10(shopify.day_of(r)), 'orders_fulfilled': i0(r.get('orders_fulfilled'))} for r in rows], key=lambda r: r['day'])
    store.save_dataset('shop_fulfil_daily', out)
    return f'{len(out)} dagen'


def shop_products_daily():
    rows = shopify.shopifyql('FROM sales SHOW net_items_sold, orders, net_sales GROUP BY product_title TIMESERIES day SINCE -730d UNTIL -1d LIMIT 100000')
    out = [{'day': _d10(shopify.day_of(r)), 'product_title': r.get('product_title') or '', 'net_items_sold': i0(r.get('net_items_sold')),
            'orders': i0(r.get('orders')), 'net_sales': r2(r.get('net_sales'))} for r in rows]
    out = [r for r in out if r['net_items_sold'] or r['orders'] or r['net_sales']]
    store.save_dataset('shop_products_daily', out)
    return f'{len(out)} rijen'


def shop_search_month():
    y = yesterday()
    rows = shopify.shopifyql(f"FROM sessions SHOW sessions WHERE referrer_source = 'search' TIMESERIES month SINCE -24m UNTIL {y}")
    out = []
    for r in rows:
        m = str(shopify.day_of(r, 'month'))[:7]
        x = {'maand': m, 'sessies': i0(r.get('sessions'))}
        if m == y.isoformat()[:7]:
            x['tm'] = y.isoformat()
        out.append(x)
    store.save_dataset('shop_search_month', sorted(out, key=lambda r: r['maand']))
    return f'{len(out)} maanden'


# =====================================================================
# Sumtracker
# =====================================================================
def sumtracker_stock():
    levels = {}
    for r in sumtracker.paged('stock/levels/'):
        levels[r.get('id')] = r
    L = list(levels.values())
    cost = lambda r: num((r.get('product') or {}).get('wavg_landed_cost'))
    pos = [r for r in L if num(r.get('in_stock')) > 0]
    peil = today().isoformat()
    waarde = sum(num(r['in_stock']) * cost(r) for r in pos)
    neg = [r for r in L if num(r.get('in_stock')) < 0]
    nocost = [r for r in pos if cost(r) == 0]
    summary = [{'peildatum': peil, 'voorraadwaarde': round(waarde, 2), 'stuks': i0(sum(num(r['in_stock']) for r in pos)), 'skus_op_voorraad': len(pos),
                'incoming_stuks': i0(sum(num(r.get('incoming')) for r in L)), 'negatieve_voorraad_skus': len(neg), 'zonder_kostprijs_skus': len(nocost)}]
    srt = sorted(pos, key=lambda r: (-num(r['in_stock']) * cost(r), (r.get('product') or {}).get('sku') or ''))
    posities = [{'rang': i + 1, 'sku': (r.get('product') or {}).get('sku'), 'naam': (r.get('product') or {}).get('name'), 'voorraad': i0(r['in_stock']),
                 'kostprijs': r2(cost(r)), 'waarde': r2(num(r['in_stock']) * cost(r)), 'incoming': i0(r.get('incoming'))} for i, r in enumerate(srt)]
    alerts = [{'sku': (r.get('product') or {}).get('sku'), 'naam': (r.get('product') or {}).get('name'), 'voorraad': i0(r['in_stock']), 'probleem': 'Negatieve voorraad'} for r in neg] + \
             [{'sku': (r.get('product') or {}).get('sku'), 'naam': (r.get('product') or {}).get('name'), 'voorraad': i0(r['in_stock']), 'probleem': 'Geen kostprijs'} for r in nocost]
    hist = [h for h in (store.dataset_rows('st_history') or []) if h.get('peildatum') != peil] + [{'peildatum': peil, 'voorraadwaarde': round(waarde, 2)}]
    store.save_dataset('st_summary', summary)
    store.save_dataset('st_top15', posities)
    store.save_dataset('st_alerts', alerts)
    store.save_dataset('st_history', sorted(hist, key=lambda h: h['peildatum']))
    return f'voorraadwaarde € {waarde:,.0f}, {len(neg)} negatief'


# =====================================================================
# Windsor: Meta, Google Ads, bedrijfsprofiel, zoekwoordplanner
# =====================================================================
def ads_daily():
    y = yesterday()
    f, t = days_ago(9, y), y
    m = windsor.get('facebook', ['date', 'spend', 'impressions', 'link_clicks', 'actions_landing_page_view', 'actions_add_to_cart',
                                 'actions_offsite_conversion_fb_pixel_purchase', 'action_values_offsite_conversion_fb_pixel_purchase'], f, t, [windsor.META_ACCOUNT])
    g = windsor.get('google_ads', ['date', 'spend', 'impressions', 'clicks', 'conversions', 'conversion_value'], f, t, [windsor.GOOGLE_ACCOUNT])
    agg = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in m:
        a = agg[(r['date'][:10], 'm')]
        for k, src in (('s', 'spend'), ('i', 'impressions'), ('c', 'link_clicks'), ('lpv', 'actions_landing_page_view'), ('atc', 'actions_add_to_cart'),
                       ('cv', 'actions_offsite_conversion_fb_pixel_purchase'), ('v', 'action_values_offsite_conversion_fb_pixel_purchase')):
            a[k] += num(r.get(src))
    for r in g:
        a = agg[(r['date'][:10], 'g')]
        for k, src in (('s', 'spend'), ('i', 'impressions'), ('c', 'clicks'), ('cv', 'conversions'), ('v', 'conversion_value')):
            a[k] += num(r.get(src))
    new = []
    for (d, p), a in agg.items():
        row = {'d': d, 'p': p, 's': round(a['s'], 2), 'i': int(a['i']), 'c': int(a['c']), 'cv': round(a['cv'], 2), 'v': round(a['v'], 2)}
        if p == 'm':
            row.update(lpv=int(a['lpv']), atc=int(a['atc']))
        new.append(row)
    rows = _merge(store.dataset_rows('ads_daily'), new, lambda r: (r['d'], r['p']))
    store.save_dataset('ads_daily', rows)
    return f'{len(new)} dag/platform-rijen'


def ads_campaigns():
    y = yesterday()
    f = days_ago(41, y)
    m = windsor.get('facebook', ['date', 'campaign', 'campaign_id', 'campaign_status', 'campaign_daily_budget', 'spend', 'impressions', 'link_clicks', 'actions_add_to_cart',
                                 'actions_offsite_conversion_fb_pixel_purchase', 'action_values_offsite_conversion_fb_pixel_purchase', 'frequency'], f, y, [windsor.META_ACCOUNT])
    g = windsor.get('google_ads', ['date', 'campaign', 'campaign_id', 'campaign_status', 'campaign_type', 'budget_amount', 'spend', 'impressions', 'clicks', 'conversions',
                                   'conversion_value', 'search_impression_share', 'search_budget_lost_impression_share', 'search_rank_lost_impression_share'], f, y, [windsor.GOOGLE_ACCOUNT])
    rows = []
    for r in m:
        b = r.get('campaign_daily_budget')
        rows.append({'d': r['date'][:10], 'p': 'm', 'id': str(r.get('campaign_id')), 'n': r.get('campaign'), 't': 'META', 'st': r.get('campaign_status'),
                     'b': (num(b) / 100 if b not in (None, '') else None), 's': r2(r.get('spend')), 'i': i0(r.get('impressions')), 'c': i0(r.get('link_clicks')),
                     'atc': i0(r.get('actions_add_to_cart')), 'cv': r2(r.get('actions_offsite_conversion_fb_pixel_purchase')),
                     'v': r2(r.get('action_values_offsite_conversion_fb_pixel_purchase')), 'f': r2(r.get('frequency'))})
    for r in g:
        nn = lambda k: (None if r.get(k) in (None, '') else num(r.get(k)))
        rows.append({'d': r['date'][:10], 'p': 'g', 'id': str(r.get('campaign_id')), 'n': r.get('campaign'), 't': r.get('campaign_type'), 'st': r.get('campaign_status'),
                     'b': nn('budget_amount'), 's': r2(r.get('spend')), 'i': i0(r.get('impressions')), 'c': i0(r.get('clicks')), 'cv': r2(r.get('conversions')),
                     'v': r2(r.get('conversion_value')), 'is': nn('search_impression_share'), 'lb': nn('search_budget_lost_impression_share'), 'lr': nn('search_rank_lost_impression_share')})
    rows.sort(key=lambda r: (r['d'], r['p'], r['n'] or ''))
    store.save_dataset('ads_campaigns', rows)
    return f'{len(rows)} rijen'


def gbp_daily():
    y = yesterday()
    rows = windsor.get('google_my_business', ['date', 'impressions', 'impressions_desktop_search', 'impressions_mobile_search', 'impressions_desktop_maps',
                                              'impressions_mobile_maps', 'direction_requests', 'call_clicks', 'website_clicks'], days_ago(13, y), y, [windsor.GBP_ACCOUNT])
    agg = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in rows:
        a = agg[r['date'][:10]]
        a['imp'] += num(r.get('impressions'))
        a['zoek'] += num(r.get('impressions_desktop_search')) + num(r.get('impressions_mobile_search'))
        a['maps'] += num(r.get('impressions_desktop_maps')) + num(r.get('impressions_mobile_maps'))
        a['route'] += num(r.get('direction_requests'))
        a['bel'] += num(r.get('call_clicks'))
        a['web'] += num(r.get('website_clicks'))
    old = {r['d']: r for r in (store.dataset_rows('gbp_daily') or [])}
    for d, a in agg.items():
        row = {'d': d, **{k: int(a[k]) for k in ('imp', 'zoek', 'maps', 'route', 'bel', 'web')}}
        if row['imp'] > 0 or d not in old:
            old[d] = row
    store.save_dataset('gbp_daily', [old[k] for k in sorted(old)])
    return f'{len(agg)} dagen'


def meta_ads():
    y = yesterday()
    W = {'7d': (days_ago(6, y), y), 'v7d': (days_ago(13, y), days_ago(7, y)), '28d': (days_ago(27, y), y)}
    AF = ['campaign', 'campaign_id', 'ad_name', 'ad_id', 'ad_created_time', 'reach', 'frequency', 'impressions', 'link_clicks', 'spend', 'actions_add_to_cart',
          'actions_offsite_conversion_fb_pixel_purchase', 'action_values_offsite_conversion_fb_pixel_purchase']
    CF = AF[5:]
    peil = today().isoformat()

    def rec(w, lvl, r):
        return {'w': w, 'lvl': lvl, 'id': str(r.get('ad_id', 'acct')), 'n': r.get('ad_name', 'Account'), 'c': r.get('campaign', ''), 'ct': (r.get('ad_created_time') or '')[:10],
                'r': i0(r.get('reach')), 'f': r2(r.get('frequency')), 'i': i0(r.get('impressions')), 'k': i0(r.get('link_clicks')), 's': r2(r.get('spend')),
                'atc': i0(r.get('actions_add_to_cart')), 'p': r2(r.get('actions_offsite_conversion_fb_pixel_purchase')),
                'v': r2(r.get('action_values_offsite_conversion_fb_pixel_purchase')), 'peil': peil}
    res = []
    for w, (a, b) in W.items():
        res += [rec(w, 'ad', r) for r in windsor.get('facebook', AF, a, b, [windsor.META_ACCOUNT], filters=[['spend', 'gt', 0]])]
    for w, (a, b) in W.items():
        res += [rec(w, 'acct', r) for r in windsor.get('facebook', CF, a, b, [windsor.META_ACCOUNT])]
    if not any(r['lvl'] == 'acct' and r['w'] == '7d' for r in res):
        raise RuntimeError('geen accountcijfers van Meta')
    store.save_dataset('meta_ads', res)
    return f'{len(res)} rijen'


GROEP_RULES = (
    ('accessoires', ['kussen', 'hoes', 'hoezen', 'beschermhoes', 'afdek']),
    ('buiten', ['binnen', 'woonkamer', 'dames', 'wear', 'kleding', 'garten', 'marktplaats', 'tweede hands', 'tweedehands', 'bankstel', 'opblaas']),
)
KETENS = ['action', 'lidl', 'kwantum', 'jysk', 'ikea', 'leen bakker', 'leenbakker', 'gamma', 'karwei', 'praxis', 'hornbach', 'intratuin', 'cranenbroek', 'vidaxl', 'vida xl', 'aldi', 'sklum', 'tectake', 'kees smit']
MERKEN = ['apple bee', 'applebee', 'hartman', 'garden impressions', '4so', 'exotan', 'sunbrella', 'fatboy', '4 seasons', '4seasons', '4 season', 'life ', 'suns ', ' suns', 'sens line', 'royal garden', 'tierra', 'kettler', 'borek', 'fonteyn']


def _groep(k):
    for g, ws in GROEP_RULES:
        if any(w in k for w in ws):
            return g
    if not any(w in k for w in ['lounge', 'tuinset', 'tuin set', 'tuinmeubelset', 'tuinmeubel set', 'dining set', 'eetset']):
        return None
    if any(w in k for w in KETENS):
        return 'ketens'
    if any(w in k for w in MERKEN):
        return 'merken'
    return 'lounge' if 'lounge' in k else 'tuinset'


def markt_kp():
    t = today()
    start = (t.replace(day=1) - datetime.timedelta(days=400)).replace(day=1)
    raw = windsor.get('google_ads', ['keyword', 'date', 'monthly_searches'], start, yesterday(), [windsor.GOOGLE_ACCOUNT],
                      filters=[['avg_monthly_searches', 'gte', 200]],
                      options={'keyword_seeds': 'loungeset,loungebank,lounge set,tuinset', 'geo_target_constants': '2528', 'language': '1010'})
    kw = collections.defaultdict(dict)
    for r in raw:
        kw[str(r['keyword']).strip().lower()][str(r['date'])[:7]] = i0(r.get('monthly_searches'))
    months = sorted({m for v in kw.values() for m in v})
    stems = lambda k: {w.rstrip('s') for w in re.split(r'[ -]+', k.replace('persoons', 'personen')) if len(w) >= 4}
    byser, rows = {}, []
    for k in sorted(kw, key=lambda k: -sum(kw[k].values())):
        g = _groep(k)
        if g is None or g in ('accessoires', 'buiten'):
            continue
        ser = tuple(kw[k].get(m, 0) for m in months)
        st = stems(k)
        prev = byser.setdefault(ser, [])
        if any(st & p or (len(set(ser)) > 1 and sum(ser) >= 12000) for p in prev):
            continue
        prev.append(st)
        rows += [{'zoekwoord': k, 'groep': g, 'maand': m, 'volume': v, 'peil': t.isoformat()} for m, v in zip(months, ser)]
    if len(months) < 12 or len(rows) < 1000:
        raise RuntimeError(f'te weinig zoekwoorddata ({len(months)} maanden, {len(rows)} rijen)')
    keep = [r for r in (store.dataset_rows('markt_kp') or []) if r['maand'] < months[0]]
    store.save_dataset('markt_kp', keep + rows)
    return f'{len(rows) // len(months)} zoektermen, {months[0]} t/m {months[-1]}'


# =====================================================================
# ProfitMetrics
# =====================================================================
def pm_daily():
    y = yesterday()
    new = profitmetrics.fetch_daily(days_ago(13, y), today())
    full = _merge(store.dataset_rows('pm_full'), new, lambda r: r['d'])
    store.save_dataset('pm_full', full)
    out = [{'d': r['d'], 'omzet': r2(r.get('turnover')), 'bw': r2(r.get('gross_profit')), 'ads': r2(r.get('total_adspend')), 'ag': r2(r.get('adspend_google')),
            'am': r2(r.get('adspend_meta')), 'np': r2(r.get('net_profit')), 'o': i0(r.get('number_of_orders')), 'nk': i0(r.get('new_customers'))} for r in full]
    store.save_dataset('pm_daily', out)
    return f'{len(new)} dagen ververst'


# =====================================================================
# Weer (MET Norway) en wisselkoers
# =====================================================================
def weer():
    r = http('GET', 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=51.87&lon=4.60',
             headers={'User-Agent': 'loungesetland-dashboard/1.0 (info@loungesetland.nl)'})
    r.raise_for_status()
    from .common import AMS
    days = collections.OrderedDict()
    for ts in r.json()['properties']['timeseries']:
        t = datetime.datetime.fromisoformat(ts['time'].replace('Z', '+00:00')).astimezone(AMS)
        d = days.setdefault(t.date().isoformat(), {'t': [], 'w': [], 'r1': 0.0, 'r6': 0.0, 'has1': False, 'sym': collections.Counter(), 'hrs': set()})
        det = ts['data']['instant']['details']
        d['t'].append(det.get('air_temperature'))
        d['w'].append(det.get('wind_speed') or 0)
        d['hrs'].add(t.hour)
        n1, n6 = ts['data'].get('next_1_hours'), ts['data'].get('next_6_hours')
        if n1:
            d['r1'] += num(n1['details'].get('precipitation_amount')); d['has1'] = True
            if 8 <= t.hour <= 20:
                d['sym'][n1['summary']['symbol_code']] += 1
        elif n6:
            if t.hour % 6 == 0:
                d['r6'] += num(n6['details'].get('precipitation_amount'))
            if 8 <= t.hour <= 20:
                d['sym'][n6['summary']['symbol_code']] += 1
    out, peil = [], today().isoformat()
    items = list(days.items())
    for i, (day, d) in enumerate(items):
        temps = [x for x in d['t'] if x is not None]
        if not temps:
            continue
        if i == len(items) - 1 and len(d['hrs']) < 4:
            continue  # alleen een stukje van de laatste dag
        out.append({'d': day, 'tmax': round(max(temps), 1), 'tmin': round(min(temps), 1), 'regen': round(d['r1'] + d['r6'], 1), 'wind': round(max(d['w']), 1),
                    'symbool': d['sym'].most_common(1)[0][0] if d['sym'] else 'cloudy', 'peil': peil})
    store.save_dataset('weer', out)
    return f'{len(out)} dagen'


def containers():
    fx = http('GET', 'https://api.frankfurter.dev/v1/latest?from=USD&to=EUR').json()
    rate, rdate = float(fx['rates']['EUR']), fx['date']
    old_fx = (store.dataset_rows('fx') or [{}])[0]
    stand, csv_url, msg = old_fx.get('planning_stand'), old_fx.get('csv_url') or '/api/blob/containerplanning_open.csv', ''
    try:
        info = onedrive.file_info()
        mod = info.get('lastModifiedDateTime', '')
        from .common import AMS
        stand_new = datetime.datetime.fromisoformat(mod.replace('Z', '+00:00')).astimezone(AMS).strftime('%Y-%m-%dT%H:%M') if mod else None
        if stand_new and stand_new == stand and store.dataset_rows('cp_open') is not None and store.kv_get('cp_rate') == rate:
            msg = 'containerplanning ongewijzigd'
        else:
            data = onedrive.download()
            with tempfile.TemporaryDirectory() as td:
                x, j, c = Path(td) / 'cp.xlsx', Path(td) / 'cp.json', Path(td) / 'cp.csv'
                x.write_bytes(data)
                p = subprocess.run([sys.executable, '-I', str(HERE / 'build_cp.py'), str(x), str(j), str(rate), rdate, str(c)], capture_output=True, text=True)
                if p.returncode:
                    raise RuntimeError('Excel inlezen mislukt: ' + (p.stderr or p.stdout)[-300:])
                rows = json.loads(j.read_text())
                store.save_dataset('cp_open', rows)
                store.put_blob('containerplanning_open.csv', c.read_bytes(), 'text/csv; charset=utf-8')
            stand = stand_new
            store.kv_set('cp_rate', rate)
            msg = f'{len(rows)} PO\'s ingelezen'
    except Exception as e:
        msg = f'containerplanning niet ingelezen: {e}'
    store.save_dataset('fx', [{'date': rdate, 'usd_eur': rate, 'bron': 'ECB via frankfurter.dev', 'planning_stand': stand, 'csv_url': csv_url}])
    if msg.startswith('containerplanning niet'):
        raise RuntimeError(f'koers {rate} bijgewerkt, maar {msg}')
    return f'koers {rate}; {msg}'
