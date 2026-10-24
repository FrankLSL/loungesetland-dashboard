"""Apple Bee dealerportaal (applebee.nl): magazijnvoorraad Dongen, prijzen en volume per artikel.

Inloggen gaat met een inloglink per mail (geen wachtwoord): het dashboard vraagt de link aan,
de beheerder plakt de link uit de mail in het dashboard, de server opent hem en bewaart de sessie.
De sessie (cookies) staat in de kv-store en wordt bij elk gebruik ververst.
De gegevens komen uit de server-actie 'getArticleInfo' van de site; het actie-id wordt zo nodig opnieuw
uit de JavaScript van de site gehaald (het verandert als Apple Bee de site bijwerkt).
"""
import json, re
import requests
import store

BASE = 'https://applebee.nl'
UA = {'User-Agent': 'Mozilla/5.0 (Loungesetland dashboard)'}
PAGE = BASE + '/bora-bora-taupe/loungebanken/lounge-tuinbank'  # productpagina: daar hoort de actie getArticleInfo bij


def _session():
    s = requests.Session()
    s.headers.update(UA)
    for k, v in (store.kv_get('ab_cookies') or {}).items():
        s.cookies.set(k, v, domain='applebee.nl')
    return s


def _save(s):
    jar = {c.name: c.value for c in s.cookies if 'applebee.nl' in (c.domain or 'applebee.nl')}
    store.kv_set('ab_cookies', jar)


def connected():
    return bool(store.kv_get('ab_user'))


def start_login(email):
    """Vraagt een inloglink aan; Apple Bee mailt die naar `email`."""
    s = requests.Session(); s.headers.update(UA)
    csrf = s.get(BASE + '/api/auth/csrf', timeout=30).json()['csrfToken']
    r = s.post(BASE + '/api/auth/signin/nodemailer', data={'email': email, 'csrfToken': csrf, 'callbackUrl': BASE + '/bestellijst'},
               headers={'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1'}, timeout=30, allow_redirects=False)
    if r.status_code >= 400:
        raise RuntimeError(f'Inloglink aanvragen mislukt ({r.status_code})')
    _save(s)
    return True


def finish_login(link):
    """Opent de inloglink uit de mail en bewaart de sessie."""
    link = (link or '').strip()
    if not link.startswith(BASE + '/api/auth/callback/'):
        raise ValueError('Dit is geen inloglink van applebee.nl (die begint met https://applebee.nl/api/auth/callback/…)')
    s = _session()
    s.get(link, timeout=30, allow_redirects=True)
    info = s.get(BASE + '/api/auth/session', timeout=30).json() or {}
    if not info.get('user'):
        raise RuntimeError('Inloggen niet gelukt; de link is misschien al gebruikt of verlopen. Vraag een nieuwe aan.')
    _save(s)
    store.kv_set('ab_user', {'naam': info['user'].get('name'), 'email': info['user'].get('email'), 'bedrijf': (info.get('company') or {}).get('name'), 'tot': info.get('expires')})
    return info


def _action_id(s, name='getArticleInfo', force=False):
    ids = store.kv_get('ab_actions') or {}
    if ids.get(name) and not force:
        return ids[name]
    html = s.get(PAGE, timeout=30).text
    for src in dict.fromkeys(re.findall(r'(/_next/static/chunks/[^"\']+\.js)', html)):
        js = s.get(BASE + src, timeout=30).text
        for aid, nm in re.findall(r'"([0-9a-f]{40,44})"[^"]{0,120}?"([A-Za-z0-9_$]{3,60})"\)', js):
            ids[nm] = aid
        if name in ids:
            break
    store.kv_set('ab_actions', ids)
    if name not in ids:
        raise RuntimeError(f'Kon de functie {name} niet vinden op applebee.nl (site gewijzigd?)')
    return ids[name]


def _call(s, name, args, retry=True):
    aid = _action_id(s, name, force=not retry)
    r = s.post(PAGE, data=json.dumps(args), timeout=60,
               headers={'Next-Action': aid, 'Content-Type': 'text/plain;charset=UTF-8', 'Accept': 'text/x-component'})
    if (r.status_code == 404 or 'Server action not found' in r.text or r.text.strip() == '{}') and retry:
        if True:
            return _call(s, name, args, retry=False)
    r.raise_for_status()
    for line in r.text.splitlines():
        if line.startswith('1:'):
            return json.loads(line[2:])
    raise RuntimeError('Onverwacht antwoord van applebee.nl')


def article_info(arts):
    s = _session()
    info = s.get(BASE + '/api/auth/session', timeout=30).json() or {}  # houdt de sessie levend
    if not info.get('user'):
        store.kv_set('ab_user', None)
        raise RuntimeError('Apple Bee-portaal: niet (meer) ingelogd. Koppel opnieuw via Status.')
    u = store.kv_get('ab_user') or {}; u['tot'] = info.get('expires'); store.kv_set('ab_user', u)
    out = []
    arts = list(dict.fromkeys(a for a in arts if a))
    for i in range(0, len(arts), 80):
        out += _call(s, 'getArticleInfo', [arts[i:i + 80]]) or []
    _save(s)
    return out
