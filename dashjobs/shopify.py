"""Shopify Admin API (GraphQL + ShopifyQL-analytics).

Variabelen (zelfde app als de planner):
  SHOPIFY_SHOP            winkel.myshopify.com
  SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET   (Dev Dashboard-app, client credentials)  — of —
  SHOPIFY_ACCESS_TOKEN    (admin custom app)
Benodigde rechten: read_orders, read_reports (ShopifyQL).
"""
import os, time, json
from .common import http

API_VERSION = os.getenv('SHOPIFY_API_VERSION', '2025-10')
_tok = {'t': None, 'x': 0}


def shop():
    return os.getenv('SHOPIFY_SHOP', '').strip()


def configured():
    return bool(shop() and (os.getenv('SHOPIFY_ACCESS_TOKEN') or (os.getenv('SHOPIFY_CLIENT_ID') and os.getenv('SHOPIFY_CLIENT_SECRET'))))


def token():
    static = os.getenv('SHOPIFY_ACCESS_TOKEN', '').strip()
    if static:
        return static
    if _tok['t'] and time.time() < _tok['x']:
        return _tok['t']
    r = http('POST', f'https://{shop()}/admin/oauth/access_token', data={
        'grant_type': 'client_credentials', 'client_id': os.getenv('SHOPIFY_CLIENT_ID', '').strip(),
        'client_secret': os.getenv('SHOPIFY_CLIENT_SECRET', '').strip()})
    if not r.ok:
        raise RuntimeError(f'Shopify-token mislukt (HTTP {r.status_code}): {r.text[:200]}')
    j = r.json()
    _tok['t'], _tok['x'] = j['access_token'], time.time() + int(j.get('expires_in', 86399)) - 300
    return _tok['t']


def graphql(query, variables=None):
    r = http('POST', f'https://{shop()}/admin/api/{API_VERSION}/graphql.json',
             headers={'X-Shopify-Access-Token': token(), 'Content-Type': 'application/json'},
             json={'query': query, 'variables': variables or {}})
    if not r.ok:
        raise RuntimeError(f'Shopify HTTP {r.status_code}: {r.text[:300]}')
    j = r.json()
    if j.get('errors'):
        raise RuntimeError('Shopify: ' + json.dumps(j['errors'])[:400])
    return j['data']


SQL_Q = '''query($q:String!){ shopifyqlQuery(query:$q){ parseErrors tableData { columns { name dataType } rows } } }'''


def shopifyql(q):
    """Voert een ShopifyQL-query uit; geeft een lijst dicts (kolomnaam → waarde)."""
    d = graphql(SQL_Q, {'q': q})['shopifyqlQuery']
    if d.get('parseErrors'):
        raise RuntimeError('ShopifyQL: ' + json.dumps(d['parseErrors'])[:400])
    t = d.get('tableData') or {}
    cols = [c['name'] for c in t.get('columns') or []]
    rows = t.get('rows') or []
    if isinstance(rows, str):
        rows = json.loads(rows)
    out = []
    for r in rows:
        if isinstance(r, dict):
            out.append(r)
        else:
            out.append(dict(zip(cols, r)))
    return out


def day_of(row, key='day'):
    """ShopifyQL geeft een datumkolom als 'day'/'hour'/'month' met waarde '2026-10-13' of een tijdstempel."""
    for k in (key, 'day', 'hour', 'month', 'date'):
        if k in row and row[k]:
            return str(row[k])
    return ''
