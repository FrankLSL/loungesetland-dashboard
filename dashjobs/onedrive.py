"""OneDrive via Microsoft Graph (gedelegeerde login: werkt voor zowel zakelijke als persoonlijke OneDrive).

Eenmalig: een app-registratie in Microsoft Entra (zie DEPLOY.md) → variabelen MS_CLIENT_ID, MS_CLIENT_SECRET.
Daarna klikt Frank in het dashboard op 'Koppel OneDrive'; het vernieuwingstoken staat in de database.
Optioneel ook Mail.Send: dan gaat het maandagbericht via zijn eigen Microsoft-mailbox.
"""
import os, time, urllib.parse
from .common import http
import store

AUTH = 'https://login.microsoftonline.com/' + os.getenv('MS_TENANT', 'common') + '/oauth2/v2.0/'
SCOPES = 'offline_access Files.Read User.Read Mail.Send'
CONTAINER_PATH = os.getenv('CONTAINERPLANNING_PATH', 'Loungesetland/1.0 Live documenten/Containerplanning 2026.xlsx')


SHARE_URL = os.getenv('CONTAINERPLANNING_SHARE_URL', '').strip()


def configured():
    return bool(os.getenv('MS_CLIENT_ID') and os.getenv('MS_CLIENT_SECRET'))


def share_download(url=SHARE_URL):
    """Download via een deellink ('Iedereen met de link kan weergeven'); geen Microsoft-app nodig.
    Geeft (bytes, laatst_gewijzigd_of_None). Probeert eerst ?download=1, daarna de OneDrive-shares-API."""
    import base64, email.utils
    sep = '&' if '?' in url else '?'
    tries = [url + sep + 'download=1',
             'https://api.onedrive.com/v1.0/shares/u!' + base64.urlsafe_b64encode(url.encode()).decode().rstrip('=') + '/root/content']
    last = ''
    for u in tries:
        r = http('GET', u, timeout=300, allow_redirects=True)
        ct = r.headers.get('content-type', '')
        if r.ok and r.content[:2] == b'PK':  # xlsx = zip
            lm = r.headers.get('last-modified')
            dt = email.utils.parsedate_to_datetime(lm) if lm else None
            return r.content, dt
        last = f'{r.status_code} {ct[:40]}'
    raise RuntimeError('deellink gaf geen Excel-bestand terug (' + last + '); controleer of de link op "Iedereen met de link" staat')


def connected():
    return bool(store.kv_get('ms_refresh'))


def redirect_uri(base):
    return base.rstrip('/') + '/onedrive/callback'


def login_url(base, state):
    q = {'client_id': os.getenv('MS_CLIENT_ID'), 'response_type': 'code', 'redirect_uri': redirect_uri(base),
         'response_mode': 'query', 'scope': SCOPES, 'state': state, 'prompt': 'select_account'}
    return AUTH + 'authorize?' + urllib.parse.urlencode(q)


def _token_req(data):
    data = dict(data, client_id=os.getenv('MS_CLIENT_ID'), client_secret=os.getenv('MS_CLIENT_SECRET'))
    r = http('POST', AUTH + 'token', data=data)
    j = r.json()
    if not r.ok or 'access_token' not in j:
        raise RuntimeError('Microsoft-login mislukt: ' + str(j.get('error_description') or j)[:300])
    if j.get('refresh_token'):
        store.kv_set('ms_refresh', j['refresh_token'])
    store.kv_set('ms_access', {'t': j['access_token'], 'x': time.time() + int(j.get('expires_in', 3600)) - 120})
    return j['access_token']


def finish_login(base, code):
    tok = _token_req({'grant_type': 'authorization_code', 'code': code, 'redirect_uri': redirect_uri(base), 'scope': SCOPES})
    me = http('GET', 'https://graph.microsoft.com/v1.0/me', headers={'Authorization': 'Bearer ' + tok}).json()
    store.kv_set('ms_user', {'name': me.get('displayName'), 'mail': me.get('mail') or me.get('userPrincipalName')})
    return me


def access_token():
    a = store.kv_get('ms_access') or {}
    if a.get('t') and a.get('x', 0) > time.time():
        return a['t']
    rt = store.kv_get('ms_refresh')
    if not rt:
        raise RuntimeError('OneDrive is nog niet gekoppeld (knop "Koppel OneDrive" op de statuspagina)')
    return _token_req({'grant_type': 'refresh_token', 'refresh_token': rt, 'scope': SCOPES})


def file_info(path=CONTAINER_PATH):
    p = urllib.parse.quote(path)
    r = http('GET', f'https://graph.microsoft.com/v1.0/me/drive/root:/{p}', headers={'Authorization': 'Bearer ' + access_token()})
    if not r.ok:
        raise RuntimeError(f'OneDrive: bestand niet gevonden ({r.status_code}): {path}')
    return r.json()


def download(path=CONTAINER_PATH):
    p = urllib.parse.quote(path)
    r = http('GET', f'https://graph.microsoft.com/v1.0/me/drive/root:/{p}:/content', headers={'Authorization': 'Bearer ' + access_token()}, timeout=300)
    if not r.ok:
        raise RuntimeError(f'OneDrive-download mislukt ({r.status_code})')
    return r.content


def send_mail(to, subject, html_body):
    msg = {'message': {'subject': subject, 'body': {'contentType': 'HTML', 'content': html_body},
                       'toRecipients': [{'emailAddress': {'address': a}} for a in to]}, 'saveToSentItems': True}
    r = http('POST', 'https://graph.microsoft.com/v1.0/me/sendMail', headers={'Authorization': 'Bearer ' + access_token(), 'Content-Type': 'application/json'}, json=msg)
    if r.status_code not in (200, 202):
        raise RuntimeError(f'Mail versturen mislukt ({r.status_code}): {r.text[:200]}')
