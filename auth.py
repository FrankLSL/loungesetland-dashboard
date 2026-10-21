"""Inloggen en gebruikers.

- De eigenaar staat in Railway-variabelen: ADMIN_USER + ADMIN_PASSWORD (altijd beheerder).
- Overige gebruikers beheert een beheerder op /gebruikers.
- Rollen: beheerder (alles, ook instellingen en gebruikers) en bekijker (alleen kijken; filters en
  periodes kiezen mag, maar gedeelde instellingen opslaan niet).
"""
import os, hmac, hashlib, base64, json, time, html
from fastapi import Request
from fastapi.responses import HTMLResponse, RedirectResponse
import store

COOKIE = 'lsl_dash'
SESSION_DAYS = 30
OPEN_PATHS = ('/login', '/logout', '/healthz', '/static/', '/onedrive/callback')
ROLES = {'beheerder': 'Beheerder', 'bekijker': 'Bekijker'}


def _secret():
    s = os.getenv('SECRET_KEY') or ('lsl-dash:' + (os.getenv('ADMIN_PASSWORD') or 'lokaal'))
    return hashlib.sha256(s.encode()).digest()


def hash_pw(pw, salt=None):
    salt = salt or os.urandom(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 200_000)
    return base64.b64encode(salt).decode() + '$' + base64.b64encode(h).decode()


def check_pw(pw, stored):
    try:
        salt_b64, _ = stored.split('$', 1)
        return hmac.compare_digest(hash_pw(pw, base64.b64decode(salt_b64)), stored)
    except Exception:
        return False


def make_token(user, role):
    body = base64.urlsafe_b64encode(json.dumps({'u': user, 'r': role, 'x': int(time.time()) + SESSION_DAYS * 86400}).encode()).decode()
    return body + '.' + hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()


def read_token(tok):
    try:
        body, sig = tok.rsplit('.', 1)
        if not hmac.compare_digest(sig, hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()):
            return None
        d = json.loads(base64.urlsafe_b64decode(body.encode()))
        return d if d.get('x', 0) > time.time() else None
    except Exception:
        return None


def enabled():
    return bool(os.getenv('ADMIN_PASSWORD'))


def current(request: Request):
    """{'u': gebruikersnaam, 'r': rol, 'n': naam} of None."""
    if not enabled():
        return {'u': 'lokaal', 'r': 'beheerder', 'n': 'Lokaal'}
    d = read_token(request.cookies.get(COOKIE, ''))
    if not d:
        return None
    if d['u'] == os.getenv('ADMIN_USER', 'frank'):
        return {**d, 'r': 'beheerder', 'n': d['u'].title()}
    u = store.user(d['u'])
    return {**d, 'r': u['role'], 'n': u['name'] or u['username']} if u else None


def is_open(path):
    return any(path == p or (p.endswith('/') and path.startswith(p)) for p in OPEN_PATHS)


def login_check(username, password):
    username = (username or '').strip().lower()
    admin = os.getenv('ADMIN_USER', 'frank').lower()
    if username == admin and password and hmac.compare_digest(password, os.getenv('ADMIN_PASSWORD', '')):
        return username, 'beheerder'
    u = store.user(username)
    if u and check_pw(password or '', u['pw_hash']):
        return username, u['role']
    return None, None


PAGE = '''<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Loungesetland</title><link rel="stylesheet" href="/static/base.css"></head>
<body class="lsl-plain"><main class="lsl-box">{body}</main></body></html>'''


def page(title, body):
    return HTMLResponse(PAGE.format(title=html.escape(title), body=body))


def login_page(error=''):
    err = f'<p class="lsl-err">{html.escape(error)}</p>' if error else ''
    return page('Inloggen', f'''<h1><span class="lsl-sun">☀</span> Loungeset<span class="lsl-lime">land</span></h1>
<p class="lsl-sub">Dashboard: weekrapport, liquiditeit en ads</p>{err}
<form method="post" action="/login" class="lsl-form">
<label>Gebruikersnaam<input name="username" autocomplete="username" autofocus required></label>
<label>Wachtwoord<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Inloggen</button></form>''')


def login_response(username, role):
    r = RedirectResponse('/', status_code=303)
    r.set_cookie(COOKIE, make_token(username, role), max_age=SESSION_DAYS * 86400, httponly=True, samesite='lax', secure=bool(os.getenv('RAILWAY_ENVIRONMENT')))
    return r


def logout_response():
    r = RedirectResponse('/login', status_code=303)
    r.delete_cookie(COOKIE)
    return r


def users_page(me, msg=''):
    rows = ''.join(
        f'<tr><td>{html.escape(u["username"])}</td><td>{html.escape(u["name"] or "")}</td><td>{ROLES.get(u["role"], u["role"])}</td>'
        f'<td><form method="post" action="/gebruikers/verwijderen" onsubmit="return confirm(\'Verwijderen?\')"><input type="hidden" name="username" value="{html.escape(u["username"])}"><button class="lsl-link">verwijderen</button></form></td></tr>'
        for u in store.users())
    admin = html.escape(os.getenv('ADMIN_USER', 'frank'))
    note = f'<p class="lsl-ok">{html.escape(msg)}</p>' if msg else ''
    return page('Gebruikers', f'''<p><a href="/">← terug naar het dashboard</a></p><h1>Gebruikers</h1>{note}
<p class="lsl-sub">{admin} is de eigenaar (beheerder, ingesteld in Railway). Een <b>bekijker</b> kan alles zien en periodes kiezen, maar geen gedeelde instellingen opslaan. Een <b>beheerder</b> kan ook instellingen wijzigen en gebruikers beheren.</p>
<table class="lsl-table"><tr><th>Gebruikersnaam</th><th>Naam</th><th>Rol</th><th></th></tr>{rows or '<tr><td colspan="4">Nog geen andere gebruikers.</td></tr>'}</table>
<h2>Gebruiker toevoegen of wachtwoord wijzigen</h2>
<form method="post" action="/gebruikers" class="lsl-form">
<label>Gebruikersnaam<input name="username" required pattern="[a-zA-Z0-9._-]+"></label>
<label>Naam<input name="name"></label>
<label>Wachtwoord (min. 8 tekens; leeg = ongewijzigd bij bestaande gebruiker)<input name="password" type="password" minlength="8"></label>
<label>Rol<select name="role"><option value="bekijker">Bekijker</option><option value="beheerder">Beheerder</option></select></label>
<button type="submit">Opslaan</button></form>''')
