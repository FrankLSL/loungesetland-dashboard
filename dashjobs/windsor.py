"""Windsor.ai REST-API: Meta Ads, Google Ads (ook Zoekwoordplanner) en Google-bedrijfsprofiel.

Variabele: WINDSOR_API_KEY (Windsor → account → API key).
"""
import os, json
from .common import http

BASE = 'https://connectors.windsor.ai/'
META_ACCOUNT = os.getenv('META_ACCOUNT_ID', '1496650691233325')
GOOGLE_ACCOUNT = os.getenv('GOOGLE_ADS_ACCOUNT_ID', '475-735-1582')
GBP_ACCOUNT = os.getenv('GBP_LOCATION_ID', 'locations/4692596093450773345')


def configured():
    return bool(os.getenv('WINDSOR_API_KEY', '').strip())


def get(connector, fields, date_from=None, date_to=None, accounts=None, filters=None, options=None, max_rows=None):
    p = {'api_key': os.getenv('WINDSOR_API_KEY', '').strip(), 'fields': ','.join(fields)}
    if date_from:
        p['date_from'] = str(date_from)
    if date_to:
        p['date_to'] = str(date_to)
    if accounts:
        p['select_accounts'] = ','.join(accounts)
    if filters:
        p['filter'] = json.dumps(filters)
    if options:
        # Windsor reads connector options from an 'options' JSON parameter; also sent top-level for older endpoints
        p['options'] = json.dumps(options)
        p.update({k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in options.items()})
    if max_rows:
        p['_max_rows'] = max_rows
    r = http('GET', BASE + connector, params=p, timeout=300)
    try:
        j = r.json()
    except ValueError:
        raise RuntimeError(f'Windsor {connector}: HTTP {r.status_code} {r.text[:200]}')
    if not r.ok or (isinstance(j, dict) and j.get('error')):
        raise RuntimeError(f'Windsor {connector}: ' + json.dumps(j.get('error') if isinstance(j, dict) else j)[:300])
    return j.get('data', []) if isinstance(j, dict) else j
