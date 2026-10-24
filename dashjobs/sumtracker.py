"""Sumtracker (voorraad). Variabele: SUMTRACKER_API_KEY (zelfde als de planner)."""
import os
from .common import http

BASE = os.getenv('SUMTRACKER_BASE', 'https://inventory-api.sumtracker.com/api/version/2025-03/')
_prefix = [os.getenv('SUMTRACKER_AUTH', '')]


def configured():
    return bool(os.getenv('SUMTRACKER_API_KEY', '').strip())


def _get(url, params=None):
    key = os.getenv('SUMTRACKER_API_KEY', '').strip()
    if not url.startswith('http'):
        url = BASE + url.lstrip('/')
    last = None
    for p in ([_prefix[0]] if _prefix[0] else ['Api-Key', 'Token', 'Bearer']):
        r = http('GET', url, params=params, headers={'Authorization': f'{p} {key}', 'Accept': 'application/json'})
        if r.status_code in (401, 403):
            last = r
            continue
        r.raise_for_status()
        _prefix[0] = p
        return r.json()
    raise PermissionError(f'Sumtracker weigert de sleutel ({last.status_code if last is not None else "?"})')


def paged(path, params=None, max_pages=200):
    params = dict(params or {}, limit=100)
    data = _get(path, params)
    out = list(data.get('results', []))
    n = 1
    while data.get('next') and n < max_pages:
        data = _get(data['next'])
        out += data.get('results', [])
        n += 1
    return out


def _req(method, path, json_body=None):
    if not _prefix[0]:
        _get('purchases/contacts/', {'limit': 1})
    key = os.getenv('SUMTRACKER_API_KEY', '').strip()
    url = path if path.startswith('http') else BASE + path.lstrip('/')
    pre = _prefix[0] or 'Api-Key'
    r = http(method, url, json=json_body, headers={'Authorization': f'{pre} {key}', 'Accept': 'application/json'}, tries=1)
    return r




def create_draft_po(contact_id, lines, notes=''):
    """Maakt een concept-inkooporder (draft) met regels [{product_id, quantity, cost}]. Geeft (id, nummer)."""
    import store
    wh = store.kv_get('po_warehouse')
    if not wh:
        raise RuntimeError('Geen magazijn bekend; draai eerst de voorraadanalyse')
    r = _req('POST', 'purchases/orders/', {'contact_id': int(contact_id), 'warehouse_id': int(wh), 'notes': notes[:500]})
    if r.status_code >= 300:
        raise RuntimeError(f'Sumtracker weigerde de inkooporder ({r.status_code}): {r.text[:300]}')
    po = r.json()
    fout = []
    for l in lines:
        body = {'product_id': int(l['product_id']), 'quantity': int(l['quantity'])}
        if l.get('cost') is not None:
            body['cost'] = round(float(l['cost']), 4)
        rr = _req('POST', f"purchases/orders/{po['id']}/lines/", body)
        if rr.status_code >= 300:
            fout.append(f"{l.get('sku') or l['product_id']}: {rr.text[:160]}")
    return po.get('id'), po.get('number'), po.get('status'), fout
