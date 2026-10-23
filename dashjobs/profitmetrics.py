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
    return bool(os.getenv('PROFITMETRICS_API_KEY', '').strip() or os.getenv('PROFITMETRICS_CLIENT_ID', '').strip())


# ---------- ophalen ----------
MCP_URL = os.getenv('PROFITMETRICS_MCP_URL', 'https://api.my.profitmetrics.io/mcp')


def _rpc_parse(r):
    """Antwoord van een MCP-server: JSON, of server-sent events met 'data:'-regels."""
    ct = r.headers.get('content-type', '')
    if 'event-stream' in ct:
        last = None
        for line in r.text.splitlines():
            if line.startswith('data:'):
                try:
                    last = json.loads(line[5:].strip())
                except ValueError:
                    pass
        return last or {}
    try:
        return r.json()
    except ValueError:
        return {'error': {'message': r.text[:200]}}


AUTH_BASE = os.getenv('PROFITMETRICS_AUTH_BASE', 'https://my.profitmetrics.io/auth')


def _keep(j):
    import time
    store.kv_set('pm_token_info', {'refresh': bool(j.get('refresh_token')), 'expires_in': j.get('expires_in'), 'scope': j.get('scope'), 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    if j.get('refresh_token'):
        store.kv_set('pm_refresh', j['refresh_token'])
    store.kv_set('pm_oauth', {'t': j['access_token'], 'x': time.time() + int(j.get('expires_in', 3600)) - 120})
    return j['access_token']


def login_url(base, state):
    """Eenmalig inloggen (authorization code + PKCE); daarna ververst de app zelf met het refresh-token."""
    import secrets, hashlib, base64, urllib.parse
    ver = secrets.token_urlsafe(48)
    store.kv_set('pm_pkce', ver)
    ch = base64.urlsafe_b64encode(hashlib.sha256(ver.encode()).digest()).decode().rstrip('=')
    q = {'response_type': 'code', 'client_id': os.getenv('PROFITMETRICS_CLIENT_ID', '').strip(), 'redirect_uri': base.rstrip('/') + '/profitmetrics/callback',
         'scope': 'openid sites.read metrics.read', 'state': state, 'code_challenge': ch, 'code_challenge_method': 'S256', 'resource': MCP_URL}
    return AUTH_BASE + '/oauth2/authorize?' + urllib.parse.urlencode(q)


def finish_login(base, code):
    cid, sec = os.getenv('PROFITMETRICS_CLIENT_ID', '').strip(), os.getenv('PROFITMETRICS_CLIENT_SECRET', '').strip()
    r = http('POST', AUTH_BASE + '/oauth2/token', data={'grant_type': 'authorization_code', 'code': code, 'redirect_uri': base.rstrip('/') + '/profitmetrics/callback',
                                                        'code_verifier': store.kv_get('pm_pkce') or '', 'resource': MCP_URL}, auth=(cid, sec), tries=1)
    if not r.ok:
        raise RuntimeError(f'ProfitMetrics-login mislukt ({r.status_code}): {r.text[:200]}')
    return _keep(r.json())


import threading
_tok_lock = threading.Lock()


def _oauth_token():
    # one refresh at a time: refresh tokens are single-use, so parallel page requests must not race
    with _tok_lock:
        return _oauth_token_locked()


def _oauth_token_locked():
    """Client credentials (Agent Connections in ProfitMetrics): token-adres via de OAuth-metadata van de MCP-server."""
    cid, sec = os.getenv('PROFITMETRICS_CLIENT_ID', '').strip(), os.getenv('PROFITMETRICS_CLIENT_SECRET', '').strip()
    if not (cid and sec):
        return None
    import time, urllib.parse
    c = store.kv_get('pm_oauth') or {}
    if c.get('t') and c.get('x', 0) > time.time():
        return c['t']
    u = urllib.parse.urlparse(MCP_URL)
    base = f'{u.scheme}://{u.netloc}'
    tok_url = os.getenv('PROFITMETRICS_TOKEN_URL', 'https://my.profitmetrics.io/auth/oauth2/token').strip()
    if not tok_url:
        auth_server = base
        for meta in (base + '/.well-known/oauth-protected-resource' + u.path, base + '/.well-known/oauth-protected-resource'):
            r = http('GET', meta, tries=1)
            if r.ok and r.headers.get('content-type', '').startswith('application/json'):
                srv = (r.json().get('authorization_servers') or [None])[0]
                if srv:
                    auth_server = srv.rstrip('/'); break
        for meta in (auth_server + '/.well-known/oauth-authorization-server', auth_server + '/.well-known/openid-configuration'):
            r = http('GET', meta, tries=1)
            if r.ok:
                try:
                    tok_url = r.json().get('token_endpoint')
                except ValueError:
                    tok_url = None
                if tok_url:
                    break
        if not tok_url:
            raise RuntimeError('ProfitMetrics: token-adres niet gevonden via ' + auth_server)
    rt = store.kv_get('pm_refresh')
    if rt:
        r = http('POST', tok_url, data={'grant_type': 'refresh_token', 'refresh_token': rt, 'resource': MCP_URL}, auth=(cid, sec), tries=1)
        if not r.ok:
            r = http('POST', tok_url, data={'grant_type': 'refresh_token', 'refresh_token': rt, 'client_id': cid, 'client_secret': sec}, tries=1)
        if r.ok:
            return _keep(r.json())
        store.kv_set('pm_refresh_error', f'{r.status_code} {r.text[:150]}')
    key = os.getenv('PROFITMETRICS_API_KEY', '').strip()
    if key:
        r = http('POST', tok_url, data={'grant_type': 'urn:ietf:params:oauth:grant-type:token-exchange', 'subject_token': key,
                                        'subject_token_type': 'urn:ietf:params:oauth:token-type:access_token',
                                        'scope': 'metrics.read sites.read', 'resource': MCP_URL}, auth=(cid, sec), tries=1)
        if r.ok:
            return _keep(r.json())
    form = {'grant_type': 'client_credentials', 'scope': 'metrics.read sites.read', 'resource': MCP_URL}
    r = http('POST', tok_url, data=form, auth=(cid, sec), tries=1)
    if not r.ok:
        r = http('POST', tok_url, data=dict(form, client_id=cid, client_secret=sec), tries=1)
    if not r.ok:
        r = http('POST', tok_url, data={'grant_type': 'client_credentials'}, auth=(cid, sec), tries=1)
    if not r.ok and r.status_code == 400 and 'unauthorized_client' in r.text:
        raise RuntimeError('ProfitMetrics: deze koppeling mag niet automatisch inloggen; klik op Status op "Koppel ProfitMetrics" en log één keer in')
    if not r.ok:
        raise RuntimeError(f'ProfitMetrics-token mislukt ({r.status_code}) bij {tok_url}: {r.text[:200]}')
    return _keep(r.json())


def _mcp_call(tool, arguments):
    """Roept een tool aan op de ProfitMetrics MCP-server: met een OAuth-token (client ID/secret) of de API-sleutel."""
    key = os.getenv('PROFITMETRICS_API_KEY', '').strip()
    tok = _oauth_token()
    styles = ([{'Authorization': 'Bearer ' + tok}] if tok else []) + ([{'Authorization': 'Bearer ' + key}, {'X-API-Key': key}, {'Authorization': key}] if key else [])
    if os.getenv('PROFITMETRICS_AUTH_HEADER'):
        styles.insert(0, {os.getenv('PROFITMETRICS_AUTH_HEADER'): os.getenv('PROFITMETRICS_AUTH_PREFIX', '') + key})
    notes = []
    for auth in styles:
        h = dict(auth, **{'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
        r = http('POST', MCP_URL, headers=h, json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
            'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'loungesetland-dashboard', 'version': '1'}}}, tries=1)
        if r.status_code in (401, 403):
            notes.append(f"{list(auth)[0]}: {r.status_code} {r.headers.get('www-authenticate', '')[:120]}"); continue
        if not r.ok:
            notes.append(f'{list(auth)[0]}: {r.status_code} {r.text[:120]}'); continue
        sid = r.headers.get('mcp-session-id')
        if sid:
            h['mcp-session-id'] = sid
        http('POST', MCP_URL, headers=h, json={'jsonrpc': '2.0', 'method': 'notifications/initialized'}, tries=1)
        r2 = http('POST', MCP_URL, headers=h, json={'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                                                     'params': {'name': tool, 'arguments': arguments}}, timeout=180)
        j = _rpc_parse(r2)
        if j.get('error'):
            raise RuntimeError('ProfitMetrics MCP: ' + json.dumps(j['error'])[:300])
        res = j.get('result') or {}
        if res.get('structuredContent'):
            return res['structuredContent']
        for c in res.get('content') or []:
            if c.get('type') == 'text':
                try:
                    return json.loads(c['text'])
                except ValueError:
                    raise RuntimeError('ProfitMetrics MCP: ' + c['text'][:300])
        raise RuntimeError('ProfitMetrics MCP: leeg antwoord ' + json.dumps(j)[:200])
    raise RuntimeError('ProfitMetrics MCP: sleutel geweigerd (' + '; '.join(notes) + ')')


def fetch_daily(date_from, date_to_excl):
    """[{d, turnover, ...}] per dag, via de ProfitMetrics MCP-server (of een REST-adres in PROFITMETRICS_API_URL)."""
    key = os.getenv('PROFITMETRICS_API_KEY', '').strip()
    if not key and not os.getenv('PROFITMETRICS_CLIENT_ID'):
        raise RuntimeError('ProfitMetrics is nog niet gekoppeld (PROFITMETRICS_CLIENT_ID/SECRET of PROFITMETRICS_API_KEY ontbreekt)')
    body = {'publicIds': [PUBLIC_ID], 'resolution': 'DAY', 'timezone': 'Europe/Amsterdam', 'fromIncl': str(date_from),
            'toExcl': str(date_to_excl), 'metrics': [m.upper() for m in SUM]}
    url = os.getenv('PROFITMETRICS_API_URL', '').strip()
    if url:
        hdr = os.getenv('PROFITMETRICS_AUTH_HEADER', 'Authorization')
        pre = os.getenv('PROFITMETRICS_AUTH_PREFIX', 'Bearer ')
        r = http('POST', url, headers={hdr: pre + key, 'Content-Type': 'application/json'}, json=body)
        if not r.ok:
            raise RuntimeError(f'ProfitMetrics HTTP {r.status_code}: {r.text[:300]}')
        j = r.json()
    else:
        j = _mcp_call('export_dashboard_metrics', body)
    if isinstance(j, dict) and j.get('success') is False:
        raise RuntimeError('ProfitMetrics: ' + json.dumps(j)[:300])
    d = j.get('data') if isinstance(j, dict) else j
    pts = d.get('data') if isinstance(d, dict) else d
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


_live_cache = {}


def export(args):
    """Live bij ProfitMetrics (MCP, 5 minuten bewaard); lukt dat niet, dan uit de dagcijfers (pm_full)."""
    import time
    if _oauth_ready():
        k = json.dumps(args, sort_keys=True)
        hit = _live_cache.get(k)
        if hit and hit[0] > time.time():
            return hit[1]
        try:
            a = dict(args); a.setdefault('publicIds', [PUBLIC_ID]); a.setdefault('timezone', 'Europe/Amsterdam')
            j = _mcp_call('export_dashboard_metrics', a)
            if isinstance(j, dict) and j.get('success') is not False and j.get('data') is not None:
                _live_cache[k] = (time.time() + 300, j)
                if len(_live_cache) > 200:
                    _live_cache.clear()
                return j
        except Exception:
            pass
    return export_saved(args)


def _oauth_ready():
    return bool(store.kv_get('pm_refresh') or (store.kv_get('pm_oauth') or {}).get('t'))


def export_saved(args):
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
