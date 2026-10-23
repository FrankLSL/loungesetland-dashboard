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
def _sales_q(q):
    """sales_reversals heet in sommige API-versies 'returns': dan die kolom gebruiken en terugzetten."""
    try:
        return shopify.shopifyql(q)
    except RuntimeError as e:
        if 'sales_reversals' not in str(e):
            raise
        rows = shopify.shopifyql(q.replace('sales_reversals', 'returns'))
        for r in rows:
            r['sales_reversals'] = r.get('returns')
        return rows


def shop_sales_daily():
    rows = _sales_q(f"FROM sales SHOW orders, gross_sales, discounts, sales_reversals, net_sales, taxes, total_sales TIMESERIES day SINCE 2023-10-01 UNTIL {yesterday()} LIMIT 100000")
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
    rows = _sales_q('FROM sales SHOW orders, sales_reversals, taxes, total_sales TIMESERIES day SINCE -6d UNTIL today')
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
      if onedrive.SHARE_URL:
        import hashlib
        from .common import AMS
        data, dt = onedrive.share_download()
        h = hashlib.sha256(data).hexdigest()
        if h == store.kv_get('cp_hash') and store.dataset_rows('cp_open') is not None and store.kv_get('cp_rate') == rate:
            msg = 'containerplanning ongewijzigd'
        else:
            with tempfile.TemporaryDirectory() as td:
                x, j, c = Path(td) / 'cp.xlsx', Path(td) / 'cp.json', Path(td) / 'cp.csv'
                x.write_bytes(data)
                p = subprocess.run([sys.executable, '-I', str(HERE / 'build_cp.py'), str(x), str(j), str(rate), rdate, str(c)], capture_output=True, text=True)
                if p.returncode:
                    raise RuntimeError('Excel inlezen mislukt: ' + (p.stderr or p.stdout)[-300:])
                rows = json.loads(j.read_text())
                store.save_dataset('cp_open', rows)
                store.put_blob('containerplanning_open.csv', c.read_bytes(), 'text/csv; charset=utf-8')
            if h != store.kv_get('cp_hash'):
                stand = (dt.astimezone(AMS) if dt else datetime.datetime.now(AMS)).strftime('%Y-%m-%dT%H:%M')
            store.kv_set('cp_hash', h); store.kv_set('cp_rate', rate)
            msg = f'{len(rows)} PO\'s ingelezen'
      else:
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


# =====================================================================
# Voorraaddekking per bestseller en marge per merk/categorie
# =====================================================================
def shop_sku_weekly():
    """Verkochte stuks en netto-omzet (excl. btw) per SKU per week, sinds de week van 30 sep 2024."""
    rows = shopify.shopifyql(f'FROM sales SHOW net_items_sold, net_sales GROUP BY product_variant_sku TIMESERIES week SINCE 2024-09-30 UNTIL {yesterday()} LIMIT 100000')
    out = [{'week': _d10(shopify.day_of(r, 'week')), 'sku': (r.get('product_variant_sku') or '').strip(), 'stuks': i0(r.get('net_items_sold')),
            'omzet': r2(r.get('net_sales'))} for r in rows]
    out = [r for r in out if r['stuks'] or r['omzet']]
    store.save_dataset('shop_sku_weekly', sorted(out, key=lambda r: (r['week'], r['sku'])))
    return f'{len(out)} rijen'


BRANDS = [('apple bee', 'Apple Bee'), ('belito', 'Belito'), ('aerocover', 'Platinum'), ('platinum', 'Platinum'), ('4seasons', '4Seasons'),
          ('4 seasons', '4Seasons'), ('hartman', 'Hartman'), ('tierra', 'Tierra'), ('garden impressions', 'Garden Impressions'), ('suns', 'SUNS')]
SKU_BRANDS = [('AB-', 'Apple Bee'), ('BEL-', 'Belito'), ('PLAT', 'Platinum'), ('AERO', 'Platinum'), ('4S', '4Seasons'), ('HART', 'Hartman')]
CATS = [('loungeset', 'Loungesets'), ('hoek', 'Loungesets'), ('tuinset', 'Tuinsets'), ('dining', 'Tuinsets'), ('hoes', 'Hoezen'), ('parasol', 'Parasols'),
        ('tafel', 'Tafels'), ('stoel', 'Stoelen en hockers'), ('hocker', 'Stoelen en hockers'), ('chair', 'Stoelen en hockers'),
        ('bank', 'Banken en modules'), ('module', 'Banken en modules'), ('kussen', 'Kussens en accessoires'), ('accessoire', 'Kussens en accessoires')]


def _merk(p):
    if 'montage' in (p.get('name') or '').lower():
        return 'Montage en diensten'
    n = ' ' + (p.get('name') or '').lower().replace('®', '') + ' '
    for k, v in BRANDS:
        if (' ' + k) in n[:40]:
            return v
    sku = (p.get('sku') or '').upper()
    for k, v in SKU_BRANDS:
        if sku.startswith(k):
            return v
    w = (p.get('name') or '').split()
    return w[0].replace('®', '') if w else 'Onbekend'


def _cat(p):
    if 'montage' in (p.get('name') or '').lower():
        return 'Montage en diensten'
    for c in list(p.get('categories') or []) + [p.get('name') or '']:
        c = str(c).lower()
        for k, v in CATS:
            if k in c:
                return v
    return 'Overig'


def voorraad_analyse():
    """Weken voorraad per bestseller (met de volgende inkooplevering) en marge per merk en categorie.
    Leest Sumtracker (producten, bundels, voorraad, open inkooporders) en shop_sku_weekly."""
    sales = store.dataset_rows('shop_sku_weekly')
    if not sales:
        shop_sku_weekly()
        sales = store.dataset_rows('shop_sku_weekly') or []
    prods = {p['id']: p for p in sumtracker.paged('products/')}
    by_sku = {}
    for p in prods.values():
        if p.get('sku'):
            by_sku.setdefault(p['sku'].strip().upper(), p)
    comps = collections.defaultdict(list)
    for l in sumtracker.paged('products/bundles/lines/'):
        cid = l.get('component_id') or (l.get('component') or {}).get('id')
        if cid and cid not in prods and l.get('component'):
            prods[cid] = l['component']
        comps[l.get('product_id')].append((cid, num(l.get('quantity')) or 1))
    stock = {}
    for r in sumtracker.paged('stock/levels/'):
        s = stock.setdefault(r.get('product_id'), {'in_stock': 0, 'available': 0, 'incoming': 0})
        for k in s:
            s[k] += num(r.get(k))
    cost = lambda pid: num((prods.get(pid) or {}).get('wavg_landed_cost'))

    def explode(pid, q, depth=0):
        """Bundel → componenten (stuks), anders het product zelf."""
        if comps.get(pid) and depth < 3:
            out = []
            for cid, n in comps[pid]:
                out += explode(cid, q * n, depth + 1)
            return out
        return [(pid, q)]

    # ---- open inkooporders met regels (open = besteld − geleverd) ----
    td = today()
    pos = [p for p in sumtracker.paged('purchases/orders/', max_pages=3) if p.get('expected_arrival_date')
           and str(p['expected_arrival_date']) >= (td - datetime.timedelta(days=120)).isoformat()]
    arrivals = collections.defaultdict(list)  # product_id → [(datum, stuks, po)]
    for p in pos:
        for l in sumtracker.paged(f"purchases/orders/{p['id']}/lines/"):
            q = num(l.get('quantity')) - num(l.get('delivered_quantity'))
            if q > 0:
                if l.get('product') and l.get('product_id') not in prods:
                    prods[l['product_id']] = l['product']
                arrivals[l.get('product_id')].append((max(str(p['expected_arrival_date']), td.isoformat()), q, p.get('number') or str(p['id'])))

    # ---- vraag per component per week ----
    weeks = sorted({r['week'] for r in sales})
    vraag = collections.defaultdict(lambda: collections.defaultdict(float))  # pid → week → stuks
    onbekend = collections.defaultdict(float)
    for r in sales:
        p = by_sku.get(r['sku'].upper()) if r['sku'] else None
        if not p:
            onbekend[r['sku'] or '(geen SKU)'] += r['omzet']
            continue
        for cid, q in explode(p['id'], r['stuks']):
            vraag[cid][r['week']] += q
    wk = lambda d: (d - datetime.timedelta(days=d.weekday()))
    cur = wk(td)
    last52 = [(cur - datetime.timedelta(weeks=i)).isoformat() for i in range(1, 53)]
    # seizoenspatroon: totale stuks per week vorig jaar t.o.v. het weekgemiddelde (zelfde kalenderweek)
    tot_w = collections.defaultdict(float)
    for pid, ws in vraag.items():
        for w, q in ws.items():
            tot_w[w] += q
    gem = sum(tot_w.get(w, 0) for w in last52) / 52 or 1
    def seizoen(d):  # index voor de week die begint op d, op basis van dezelfde week een jaar eerder (±1 week gemiddeld)
        b = wk(d - datetime.timedelta(weeks=52))
        vals = [tot_w.get((b + datetime.timedelta(weeks=k)).isoformat(), 0) for k in (-1, 0, 1)]
        return max(0.15, (sum(vals) / 3) / gem)
    HOR = 40
    fut = [cur + datetime.timedelta(weeks=i) for i in range(HOR)]
    idx = [seizoen(d) for d in fut]

    rows = []
    for pid, ws in vraag.items():
        p = prods.get(pid) or {}
        if (p.get('bundle_type') or 'NONE') != 'NONE':
            continue
        first = min((w for w, q in ws.items() if q > 0), default=None)
        if not first:
            continue
        n_w = sum(1 for w in last52 if w >= first)
        verkocht52 = sum(ws.get(w, 0) for w in last52)
        if verkocht52 <= 0 or n_w < 4:
            continue
        # basis: gemiddelde per week over de weken dat het product verkocht werd (max 52), gecorrigeerd voor seizoen in die weken
        seiz_in = sum(seizoen(datetime.date.fromisoformat(w) + datetime.timedelta(weeks=52)) for w in last52 if w >= first) or n_w
        basis = verkocht52 / seiz_in
        st = stock.get(pid, {'in_stock': 0, 'available': 0, 'incoming': 0})
        voorraad = st['available']
        arr = sorted(arrivals.get(pid, []))
        # week-voor-week doorrekenen: voorraad + leveringen − verwachte verkoop
        lev = collections.defaultdict(float)
        for d, q, _ in arr:
            lev[wk(datetime.date.fromisoformat(d))] += q
        s, s_zonder, op, op_zonder = voorraad, voorraad, None, None
        kort = {}
        for i, d in enumerate(fut):
            v = basis * idx[i]
            s += lev.get(d, 0)
            if s >= v:
                s -= v
            else:
                if op is None:
                    op = d
                kort[d] = v - max(s, 0)
                s = 0
            s_zonder -= v
            if op_zonder is None and s_zonder < 0:
                op_zonder = d
        nxt = next(((d, q, n) for d, q, n in arr), None)
        per_week_nu = basis * sum(idx[:4]) / 4
        weken = None
        if voorraad <= 0:
            weken = 0.0
        else:
            rest, w = voorraad, 0.0
            for i in range(HOR):
                v = basis * idx[i]
                if rest <= v:
                    w += rest / v if v else 1
                    break
                rest -= v
                w += 1
            else:
                w = float(HOR)
            weken = round(w, 1)
        eerste = wk(datetime.date.fromisoformat(arr[0][0])) if arr else None
        # gemiste verkoop: tot de eerste levering, of (zonder inkoop) in de komende 26 weken
        grens = eerste if eerste else cur + datetime.timedelta(weeks=26)
        tekort = sum(q for d, q in kort.items() if d < grens)
        if op_zonder is None:
            status = 'Voldoende'
        elif op is None:
            status = 'Levering op tijd'
        elif not arr:
            status = 'Geen inkoop gepland'
        elif op < eerste:
            status = 'Tekort vóór levering'
        else:
            status = 'Tekort na levering'
        rows.append({'sku': p.get('sku'), 'naam': p.get('name'), 'merk': _merk(p), 'categorie': _cat(p), 'voorraad': i0(voorraad),
                     'onderweg': i0(sum(q for _, q, _ in arr)), 'verkocht_52w': i0(verkocht52), 'per_week_nu': round(per_week_nu, 1),
                     'per_week_piek': round(basis * max(idx), 1), 'weken': weken, 'op_zonder': op_zonder.isoformat() if op_zonder else None,
                     'op': op.isoformat() if op else None, 'tekort_stuks': i0(round(tekort)),
                     'volgende': nxt[0] if nxt else None, 'volgende_stuks': i0(nxt[1]) if nxt else None, 'volgende_po': nxt[2] if nxt else None,
                     'leveringen': [{'datum': d, 'stuks': i0(q), 'po': n} for d, q, n in arr][:6],
                     'status': status, 'waarde_52w': r2(verkocht52 * cost(pid))})
    rows.sort(key=lambda r: -r['waarde_52w'])
    for i, r in enumerate(rows):
        r['rang'] = i + 1
    from .common import AMS
    stand = datetime.datetime.now(AMS).strftime('%Y-%m-%dT%H:%M')
    seiz = [{'week': d.isoformat(), 'index': round(x, 2), 'stand': stand} for d, x in zip(fut, idx)]
    store.save_dataset('st_dekking', rows)
    store.save_dataset('st_seizoen', seiz)

    # ---- marge per merk en categorie ----
    def marge(van, tot):
        agg = {}
        zonder = 0.0
        for r in sales:
            if not (van <= r['week'] <= tot):
                continue
            p = by_sku.get(r['sku'].upper()) if r['sku'] else None
            if not p:
                zonder += r['omzet']
                continue
            parts = explode(p['id'], r['stuks'])
            k = sum(cost(cid) * q for cid, q in parts)
            mist = any(cost(cid) <= 0 for cid, _ in parts) and r['stuks'] > 0
            for dim, key in (('merk', _merk(p)), ('categorie', _cat(p))):
                a = agg.setdefault((dim, key), {'omzet': 0.0, 'kosten': 0.0, 'stuks': 0, 'omzet_zk': 0.0})
                if mist:
                    a['omzet_zk'] += r['omzet']
                else:
                    a['omzet'] += r['omzet']; a['kosten'] += k
                a['stuks'] += r['stuks']
        return agg, zonder
    out = []
    y0 = datetime.date(td.year, 1, 1)
    periods = [('jaar', f'{td.year} t/m vorige week', wk(y0).isoformat(), (cur - datetime.timedelta(weeks=1)).isoformat()),
               ('12m', 'laatste 52 weken', last52[-1], last52[0]),
               ('4w', 'laatste 4 weken', last52[3], last52[0])]
    for pk, label, van, tot in periods:
        agg, zonder = marge(van, tot)
        for (dim, key), a in agg.items():
            out.append({'periode': pk, 'periode_label': label, 'van': van, 'tot': tot, 'dim': dim, 'naam': key, 'omzet': r2(a['omzet']), 'kosten': r2(a['kosten']),
                        'marge': r2(a['omzet'] - a['kosten']), 'marge_pct': round((a['omzet'] - a['kosten']) / a['omzet'] * 100, 1) if a['omzet'] > 0 else None,
                        'stuks': a['stuks'], 'omzet_zonder_kostprijs': r2(a['omzet_zk'])})
        out.append({'periode': pk, 'periode_label': label, 'van': van, 'tot': tot, 'dim': 'onbekend', 'naam': 'Niet in Sumtracker', 'omzet': r2(zonder)})
    store.save_dataset('marge_merk', out)
    tek = sum(1 for r in rows[:40] if r['status'].startswith('Tekort') or r['status'] == 'Geen inkoop gepland')
    jaar = [r for r in out if r['periode'] == 'jaar' and r['dim'] == 'merk']
    o, k = sum(r['omzet'] for r in jaar), sum(r['kosten'] for r in jaar)
    return f'{len(rows)} producten, {tek} van top 40 met tekort; marge {td.year} {((o - k) / o * 100) if o else 0:.1f}%; {len(pos)} PO\'s'
