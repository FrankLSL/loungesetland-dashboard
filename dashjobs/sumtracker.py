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
