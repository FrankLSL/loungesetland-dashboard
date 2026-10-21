"""ProfitMetrics.

Twee delen:
1. fetch_daily(): haalt de dagcijfers op bij ProfitMetrics (variabele PROFITMETRICS_API_KEY) en bewaart ze in de
   bron `pm_full` (één rij per dag met alle optelbare metrics).
2. export(args): beantwoordt de 'live' vragen van de pagina (weekreeks, periodetotalen, vergelijking) in exact
   hetzelfde formaat als de ProfitMetrics-export, maar gerekend uit `pm_full`. Alle metrics zijn per dag optelbaar;
   verhoudingen (marges, ROAS, POAS, orderwaarde, kosten per nieuwe klant) worden uit de totalen berekend.
"""
import os, datetime, json
from .common import http, num
import store

PUBLIC_ID = os.getenv('PROFITMETRICS_PUBLIC_ID', '2F574A0E085F4ED6')
SUM = ['turnover', 'number_of_orders', 'gross_profit', 'contribution_margin', 'net_profit', 'total_adspend',
       'adspend_google', 'adspend_meta', 'new_customers', 'returning_customers']


def configured():
    return bool(os.getenv('PROFITMETRICS_API_KEY', '').strip())


# ---------- ophalen ----------
def fetch_daily(date_from, date_to_excl):
    """[{d, turnover, ...}] per dag. Endpoint en sleutel via variabelen (zie DEPLOY.md)."""
    url = os.getenv('PROFITMETRICS_API_URL', '').strip()
    key = os.getenv('PROFITMETRICS_API_KEY', '').strip()
    if not url or not key:
        raise RuntimeError('ProfitMetrics is nog niet gekoppeld (PROFITMETRICS_API_URL / PROFITMETRICS_API_KEY ontbreken)')
    hdr = os.getenv('PROFITMETRICS_AUTH_HEADER', 'Authorization')
    pre = os.getenv('PROFITMETRICS_AUTH_PREFIX', 'Bearer ')
    body = {'publicIds': [PUBLIC_ID], 'resolution': 'DAY', 'timezone': 'Europe/Amsterdam', 'fromIncl': str(date_from),
            'toExcl': str(date_to_excl), 'metrics': [m.upper() for m in SUM]}
    r = http('POST', url, headers={hdr: pre + key, 'Content-Type': 'application/json'}, json=body)
    if not r.ok:
        raise RuntimeError(f'ProfitMetrics HTTP {r.status_code}: {r.text[:300]}')
    j = r.json()
    pts = (j.get('data') or {}).get('data') if isinstance(j.get('data'), dict) else (j.get('data') or j)
    out = []
    for p in pts or []:
        row = {'d': str(p['timestamp'])[:10]}
        for k, v in (p.get('metrics') or {}).items():
            row[k.lower()] = round(num(v.get('value') if isinstance(v, dict) else v), 4)
        out.append(row)
    return out


# ---------- beantwoorden uit pm_full ----------
def _d(s):
    return datetime.date.fromisoformat(str(s)[:10])


def _rows():
    return {r['d']: r for r in (store.dataset_rows('pm_full') or [])}


def _sum(R, a, b_excl):
    t = {k: 0.0 for k in SUM}
    d = a
    while d < b_excl:
        r = R.get(d.isoformat())
        if r:
            for k in SUM:
                t[k] += num(r.get(k))
        d += datetime.timedelta(days=1)
    return t


def _derive(t):
    div = lambda x, y: (x / y) if y else None
    out = dict(t)
    out['turnover_avg'] = div(t['turnover'], t['number_of_orders'])
    out['gross_profit_ratio'] = (div(t['gross_profit'], t['turnover']) or 0) * 100 if t['turnover'] else None
    out['contribution_margin_ratio'] = (div(t['contribution_margin'], t['turnover']) or 0) * 100 if t['turnover'] else None
    out['net_profit_ratio'] = (div(t['net_profit'], t['turnover']) or 0) * 100 if t['turnover'] else None
    out['total_adspend_ratio'] = (div(t['total_adspend'], t['turnover']) or 0) * 100 if t['turnover'] else None
    out['blended_roas'] = div(t['turnover'], t['total_adspend'])
    out['blended_poas'] = div(t['gross_profit'], t['total_adspend'])
    out['n_cac'] = div(t['total_adspend'], t['new_customers'])
    return out


def _metric(name, cur, cmp):
    v = cur.get(name.lower())
    c = cmp.get(name.lower()) if cmp is not None else None
    m = {'value': 'N/A' if v is None else round(v, 6), 'compareValue': None, 'valueDiff': None, 'percentageDiff': None}
    if cmp is not None:
        c = 0.0 if c is None else c
        m['compareValue'] = round(c, 6)
        if v is not None:
            m['valueDiff'] = round(v - c, 6)
            m['percentageDiff'] = round((v - c) / abs(c) * 100, 4) if c else None
    return m


def export(args):
    """Zelfde vorm als export_dashboard_metrics: {success, data: {data: [{timestamp, compareTimestamp, metrics}]}}."""
    R = _rows()
    metrics = args.get('metrics') or [m.upper() for m in SUM]
    res = (args.get('resolution') or 'DAY').upper()
    a, b = _d(args['fromIncl']), _d(args['toExcl'])
    has_cmp = bool(args.get('compareFromIncl') and args.get('compareToExcl'))
    ca, cb = (_d(args['compareFromIncl']), _d(args['compareToExcl'])) if has_cmp else (None, None)
    pts = []
    if res == 'TOTAL':
        cur = _derive(_sum(R, a, b))
        cmp = _derive(_sum(R, ca, cb)) if has_cmp else None
        pts.append({'timestamp': b.isoformat(), 'compareTimestamp': cb.isoformat() if has_cmp else None,
                    'metrics': {m: _metric(m, cur, cmp) for m in metrics}})
    else:
        step = {'DAY': 1, 'WEEK': 7}.get(res, 1)
        n = max(1, -(-(b - a).days // step))
        nc = max(1, -(-(cb - ca).days // step)) if has_cmp else 0
        for i in range(max(n, nc)):
            s = a + datetime.timedelta(days=i * step)
            cur = _derive(_sum(R, s, min(s + datetime.timedelta(days=step), b))) if i < n else _derive({k: 0.0 for k in SUM})
            cmp = None
            ct = None
            if has_cmp:
                cs = ca + datetime.timedelta(days=i * step)
                ct = cs.isoformat()
                cmp = _derive(_sum(R, cs, min(cs + datetime.timedelta(days=step), cb))) if i < nc else _derive({k: 0.0 for k in SUM})
            pts.append({'timestamp': s.isoformat(), 'compareTimestamp': ct, 'metrics': {m: _metric(m, cur, cmp) for m in metrics}})
    return {'success': True, 'data': {'data': pts}}
