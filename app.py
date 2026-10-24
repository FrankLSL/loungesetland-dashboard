"""Loungesetland dashboard — webapp (weekrapport, liquiditeitsprognose, ads).

Lokaal starten:  uvicorn app:app --reload   (zonder ADMIN_PASSWORD geen inlogscherm)
Op Railway: zie DEPLOY.md.
"""
import os, json, html, secrets, gzip
from pathlib import Path
from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

import store, auth
from dashjobs import scheduler, profitmetrics, onedrive, shopify, windsor, sumtracker

BASE = Path(__file__).parent
WEB = BASE / 'web'
PAGE_FILES = {'ads.js', 'markt.js', 'voorraad.js'}
ANY_USER_DOCS = ('ads/opschaalplan',)  # afgeleid van wat de pagina berekent: elke ingelogde gebruiker mag dit bijwerken

store.init()
app = FastAPI(title='Loungesetland dashboard', docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.mount('/static', StaticFiles(directory=WEB / 'static'), name='static')


# ---------- seed: eerste start met de gegevens uit het oude dashboard ----------
def _seed():
    # import on first start, and again whenever seed/VERSION changes (overwrites datasets and docs; users stay)
    sd = BASE / 'seed'
    vf = sd / 'VERSION'
    ver = vf.read_text().strip() if vf.exists() else '1'
    if store.dataset_count() > 0 and store.kv_get('seed_version') == ver:
        return
    for f in sorted((sd / 'datasets').glob('*.json*')):
        raw = gzip.decompress(f.read_bytes()) if f.suffix == '.gz' else f.read_bytes()
        d = json.loads(raw)
        store.set_dataset_meta(d['id'], d.get('meta') or {})
        if d.get('rows') is not None:
            store.save_dataset(d['id'], d['rows'], by=(d.get('meta') or {}).get('updated', {}).get('by', 'import'))
    for f in sorted((sd / 'docs').glob('*.json')):
        d = json.loads(f.read_text())
        store.set_doc(d['path'], d['data'], 'import')
    for f in sorted((sd / 'blobs').glob('*')):
        store.put_blob(f.name, f.read_bytes(), 'text/csv; charset=utf-8' if f.suffix == '.csv' else 'application/octet-stream')
    store.kv_set('seed_version', ver)


_seed()
if not store.kv_get('db_created'):
    import datetime as _dt
    store.kv_set('db_created', _dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'))


@app.on_event('startup')
def _start():
    scheduler.start()


# ---------- inloggen ----------
@app.middleware('http')
async def _guard(request: Request, call_next):
    path = request.url.path
    if auth.is_open(path):
        return await call_next(request)
    u = auth.current(request)
    if not u:
        if path.startswith('/api/'):
            return JSONResponse({'detail': 'Niet ingelogd'}, status_code=401)
        return RedirectResponse('/login', status_code=303)
    request.state.user = u
    return await call_next(request)


def _admin(request):
    if request.state.user['r'] != 'beheerder':
        raise HTTPException(403, 'Alleen voor beheerders')


@app.get('/healthz')
def healthz():
    # no secrets: only whether things are set up and how the last runs went
    d = str(store.DATA)
    runs = [{'job': r.get('job'), 'ok': bool(r.get('ok')), 'at': r.get('finished') or r.get('started'), 'msg': str(r.get('message') or '')[:160]} for r in store.last_runs_per_job()]
    return {'ok': True, 'volume': os.path.ismount(d), 'db_created': store.kv_get('db_created'), 'data_dir': d, 'seed_version': store.kv_get('seed_version'),
            'datasets': store.dataset_count(), 'scheduler': not os.getenv('DASH_NO_SCHEDULER'),
            'connections': {'shopify': shopify.configured(), 'windsor': windsor.configured(), 'sumtracker': sumtracker.configured(),
                            'profitmetrics': profitmetrics.configured(), 'containerplanning': bool(onedrive.SHARE_URL) or (onedrive.configured() and onedrive.connected()),
                            'mail': bool(os.getenv('SMTP_HOST') or os.getenv('BREVO_API_KEY') or os.getenv('RESEND_API_KEY')) or (onedrive.configured() and onedrive.connected())},
            'runs': runs, 'cp_share_debug': store.kv_get('cp_share_debug'),
            'pm_redirect': (os.getenv('PUBLIC_URL') or '(PUBLIC_URL leeg)'), 'pm_client_start': os.getenv('PROFITMETRICS_CLIENT_ID', '')[:6],
            'pm_token': store.kv_get('pm_token_info'), 'pm_has_refresh': bool(store.kv_get('pm_refresh')), 'pm_refresh_error': store.kv_get('pm_refresh_error')}


@app.get('/login', response_class=HTMLResponse)
def login_get():
    return auth.login_page()


@app.post('/login')
def login_post(username: str = Form(''), password: str = Form('')):
    u, role = auth.login_check(username, password)
    if not u:
        return auth.login_page('Onjuiste gebruikersnaam of wachtwoord.')
    return auth.login_response(u, role)


@app.get('/logout')
def logout():
    return auth.logout_response()


# ---------- de pagina ----------
def _boot(user):
    metas = store.dataset_meta_all()
    ds = {k: {'title': v.get('title'), 'source': {'kind': (v.get('source') or {}).get('kind', 'file'), **({'args': v['source'].get('args')} if (v.get('source') or {}).get('kind') == 'query' else {})},
              'updated_at': v.get('updated_at'), 'staleAfterHours': v.get('staleAfterHours')} for k, v in metas.items()}
    defaults = (store.get_doc('dash/params') or {}).get('data') or {}
    return {'datasets': ds, 'paramDefaults': defaults, 'user': {'u': user['u'], 'r': user['r'], 'n': user.get('n')}}


@app.get('/', response_class=HTMLResponse)
def index(request: Request):
    u = request.state.user
    page = (WEB / 'index.html').read_text(encoding='utf-8')
    boot = json.dumps(_boot(u), ensure_ascii=False).replace('</', '<\\/')
    title = ((store.get_doc('dash/meta') or {}).get('data') or {}).get('title') or 'Loungesetland dashboard'
    refresh = ('<button type="button" class="lsl-barbtn" id="lsl-ref-page" title="Haalt alleen de cijfers van het dashboard waar je nu bent opnieuw op">↻ Dit dashboard verversen</button>'
               '<form method="post" action="/status/run-all" style="display:inline;margin:0"><button class="lsl-barbtn" title="Haalt alle cijfers nu opnieuw op">↻ Alles verversen</button></form>') if u['r'] == 'beheerder' else ''
    links = f'<span>{html.escape(u.get("n") or u["u"])}</span>{refresh}<a href="/status">Status</a>' + ('<a href="/gebruikers">Gebruikers</a>' if u['r'] == 'beheerder' else '') + (
        '<a href="/logout">Uitloggen</a>' if auth.enabled() else '')
    return HTMLResponse(f'''<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/static/base.css">
<script src="/static/d3.min.js"></script>
<script>window.__DASH_BOOT__ = {boot};</script>
<script src="/static/dash-shim.js"></script>
</head><body><div class="lsl-bar">{links}</div>
<div id="dash-root">
{page}
</div></body></html>''')


# ---------- data ----------
@app.get('/api/data/{ds}')
def api_data(ds: str):
    raw, upd = store.dataset_rows_raw(ds)
    if raw is None:
        raise HTTPException(404, 'Nog geen gegevens voor ' + ds)
    return Response('{"rows":' + raw + ',"updated_at":' + json.dumps(upd) + '}', media_type='application/json', headers={'Cache-Control': 'private, max-age=60'})


@app.post('/api/query/{ds}')
async def api_query(ds: str, request: Request):
    m = store.dataset_meta(ds) or {}
    src = m.get('source') or {}
    if src.get('kind') != 'query':
        raise HTTPException(404, 'Geen live bron: ' + ds)
    body = await request.json()
    args = dict(src.get('args') or {})
    args.update({k: v for k, v in (body.get('args') or {}).items() if k in ('fromIncl', 'toExcl', 'compareFromIncl', 'compareToExcl')})
    if src.get('connector') == 'ProfitMetrics':
        try:
            from starlette.concurrency import run_in_threadpool
            return {'answer': await run_in_threadpool(profitmetrics.export, args)}
        except Exception as e:
            raise HTTPException(400, f'Kon {ds} niet berekenen: {e}')
    raise HTTPException(400, 'Onbekende bron')


@app.get('/api/doc/{path:path}')
def doc_get(path: str):
    d = store.get_doc(path)
    if not d:
        raise HTTPException(404)
    return {'data': d['data'], 'updated_at': d['updated_at']}


async def _doc_write(path, request, merge):
    u = request.state.user
    if u['r'] != 'beheerder' and path not in ANY_USER_DOCS:
        raise HTTPException(403, 'Alleen een beheerder kan dit opslaan')
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(400)
    if merge:
        store.merge_doc(path, data, u['u'])
    else:
        store.set_doc(path, data, u['u'])
    return {'ok': True}


@app.put('/api/doc/{path:path}')
async def doc_put(path: str, request: Request):
    return await _doc_write(path, request, False)


@app.patch('/api/doc/{path:path}')
async def doc_patch(path: str, request: Request):
    return await _doc_write(path, request, True)


@app.get('/api/blob/{name}')
def blob(name: str):
    mime, data = store.get_blob(name)
    if data is None:
        raise HTTPException(404)
    return Response(data, media_type=mime, headers={'Content-Disposition': f'attachment; filename="{name}"'})


# ---------- gebruikers ----------
@app.get('/gebruikers', response_class=HTMLResponse)
def users_get(request: Request, msg: str = ''):
    _admin(request)
    return auth.users_page(request.state.user, msg)


@app.post('/gebruikers')
def users_post(request: Request, username: str = Form(...), name: str = Form(''), password: str = Form(''), role: str = Form('bekijker')):
    _admin(request)
    username = username.strip().lower()
    if role not in auth.ROLES or not username or username == os.getenv('ADMIN_USER', 'frank').lower():
        return auth.users_page(request.state.user, 'Ongeldige invoer.')
    exists = store.user(username)
    if not exists and len(password) < 8:
        return auth.users_page(request.state.user, 'Kies een wachtwoord van minstens 8 tekens.')
    store.save_user(username, name.strip(), auth.hash_pw(password) if password else None, role)
    return RedirectResponse('/gebruikers?msg=Opgeslagen', status_code=303)


@app.post('/gebruikers/verwijderen')
def users_del(request: Request, username: str = Form(...)):
    _admin(request)
    store.delete_user(username)
    return RedirectResponse('/gebruikers?msg=Verwijderd', status_code=303)


# ---------- status, koppelingen, taken ----------
def _base_url(request):
    u = (os.getenv('PUBLIC_URL') or str(request.base_url)).strip().rstrip('/')
    # behind Railway's proxy the request looks like http; the public address is https
    if u.startswith('http://') and 'localhost' not in u and '127.0.0.1' not in u:
        u = 'https://' + u[7:]
    if not u.startswith('http'):
        u = 'https://' + u
    return u


@app.get('/status', response_class=HTMLResponse)
def status(request: Request, msg: str = ''):
    u = request.state.user
    adm = u['r'] == 'beheerder'
    con = [('Shopify', shopify.configured()), ('Windsor (Meta, Google, bedrijfsprofiel, zoekwoorden)', windsor.configured()),
           ('ProfitMetrics', profitmetrics.configured()), ('Sumtracker', sumtracker.configured()),
           ('Containerplanning (deellink)' if onedrive.SHARE_URL else 'Microsoft (OneDrive + mail)', bool(onedrive.SHARE_URL) or (onedrive.configured() and onedrive.connected())),
           ('Mail (SMTP)', bool(os.getenv('SMTP_HOST')))]
    msu = store.kv_get('ms_user') or {}
    rows = ''.join(f'<tr><td>{n}</td><td class="{"good" if ok else "bad"}">{"gekoppeld" if ok else "niet gekoppeld"}</td></tr>' for n, ok in con)
    od = ''
    if adm and onedrive.configured():
        od = f'<p>{"Gekoppeld als " + html.escape(msu.get("mail") or "") + ". " if onedrive.connected() else ""}<a class="lsl-btn" href="/onedrive/login">{"Opnieuw koppelen" if onedrive.connected() else "Koppel OneDrive"}</a></p>'
    if adm and os.getenv('PROFITMETRICS_CLIENT_ID'):
        od += f'<p>{"ProfitMetrics is gekoppeld. " if store.kv_get("pm_refresh") else ""}<a class="lsl-btn" href="/profitmetrics/login">{"Opnieuw koppelen" if store.kv_get("pm_refresh") else "Koppel ProfitMetrics"}</a></p>'
    last = {r['job']: r for r in store.last_runs_per_job()}
    jr = ''
    for name, (fn, label, ok) in scheduler.JOBS.items():
        r = last.get(name)
        when = (r['finished'] or r['started'] or '')[:16].replace('T', ' ') if r else '—'
        res = '' if not r else (('<span class="good">gelukt</span> ' if r['ok'] else '<span class="bad">mislukt</span> ') + html.escape((r['message'] or '').splitlines()[0][:160] if r['message'] else ''))
        btn = f'<form method="post" action="/status/run/{name}" style="display:inline"><button class="lsl-link" style="color:#1f4b47">nu draaien</button></form>' if adm else ''
        jr += f'<tr><td>{label}<br><small>{name}</small></td><td><small>{when} UTC</small><br>{res}</td><td>{btn}</td></tr>'
    metas = store.dataset_meta_all()
    dr = ''.join(f'<tr><td>{html.escape(v.get("title") or k)}<br><small>{k}</small></td><td><small>{(v.get("updated_at") or "—")[:16].replace("T", " ")}</small></td></tr>' for k, v in sorted(metas.items()))
    note = f'<p class="lsl-ok">{html.escape(msg)}</p>' if msg else ''
    return auth.page('Status', f'''<p><a href="/">← terug naar het dashboard</a></p><h1>Status</h1>{note}
<h2>Koppelingen</h2><table class="lsl-table">{rows}</table>{od}
<h2>Automatische taken</h2>{'<form method="post" action="/status/run-all" style="margin:0 0 10px"><button class="lsl-btn">↻ Alles nu verversen</button></form>' if adm else ''}<table class="lsl-table"><tr><th>Taak</th><th>Laatste keer</th><th></th></tr>{jr}</table>
<h2>Bronnen</h2><table class="lsl-table"><tr><th>Bron</th><th>Bijgewerkt (UTC)</th></tr>{dr}</table>''')


@app.post('/status/run-all')
def status_run_all(request: Request):
    _admin(request)
    names = [n for n, (fn, label, ok) in scheduler.JOBS.items() if n not in ('maandagmail', 'pm_toegang') and ok()]
    scheduler.run_async(names, request.state.user['u'])
    return RedirectResponse('/status?msg=Alle ' + str(len(names)) + ' taken gestart; dat duurt 1 à 2 minuten. Ververs deze pagina daarna.', status_code=303)


@app.post('/api/refresh/{page}')
def api_refresh_page(page: str, request: Request):
    _admin(request)
    names = [n for n in scheduler.PAGINA.get(page, []) if n in scheduler.JOBS and scheduler.JOBS[n][2]()]
    if not names:
        raise HTTPException(404, 'Onbekend dashboard')
    names = [n for n in names if n not in scheduler.PENDING]
    if names:
        scheduler.run_async(names, request.state.user['u'])
    return {'gestart': names, 'bezig': sorted(scheduler.PENDING)}


@app.get('/api/refresh-status')
def api_refresh_status(request: Request, jobs: str = ''):
    want = [j for j in jobs.split(',') if j]
    left = [j for j in want if j in scheduler.PENDING]
    last = {r['job']: r for r in store.last_runs_per_job()}
    fails = [scheduler.JOBS[j][1] for j in want if j not in left and j in last and last[j].get('finished') and not last[j].get('ok')]
    return {'bezig': left, 'mislukt': fails}


@app.post('/status/run/{name}')
def status_run(name: str, request: Request):
    _admin(request)
    if name not in scheduler.JOBS:
        raise HTTPException(404)
    scheduler.run_async([name], request.state.user['u'])
    return RedirectResponse('/status?msg=' + name + ' gestart; ververs de pagina over een minuut.', status_code=303)


@app.get('/onedrive/login')
def od_login(request: Request):
    _admin(request)
    st = secrets.token_urlsafe(16)
    store.kv_set('ms_state', st)
    return RedirectResponse(onedrive.login_url(_base_url(request), st))


@app.get('/onedrive/callback')
def od_callback(request: Request, code: str = '', state: str = '', error: str = '', error_description: str = ''):
    if error:
        return auth.page('OneDrive', f'<p class="lsl-err">Koppelen mislukt: {html.escape(error_description or error)}</p><p><a href="/status">Terug</a></p>')
    if not state or state != store.kv_get('ms_state'):
        return auth.page('OneDrive', '<p class="lsl-err">Ongeldige aanvraag; probeer opnieuw via Status.</p><p><a href="/status">Terug</a></p>')
    me = onedrive.finish_login(_base_url(request), code)
    scheduler.run_async(['containers'], 'koppeling')
    return RedirectResponse('/status?msg=OneDrive gekoppeld als ' + (me.get('mail') or me.get('userPrincipalName') or ''), status_code=303)


@app.get('/mail/voorbeeld', response_class=HTMLResponse)
def mail_preview(request: Request):
    _admin(request)
    from dashjobs import monday
    subject, page = monday.build()
    return HTMLResponse('<title>' + html.escape(subject) + '</title>' + page)


@app.get('/profitmetrics/login')
def pm_login(request: Request):
    _admin(request)
    st = secrets.token_urlsafe(16)
    store.kv_set('pm_state', st)
    return RedirectResponse(profitmetrics.login_url(_base_url(request), st))


@app.get('/profitmetrics/callback')
def pm_callback(request: Request, code: str = '', state: str = '', error: str = '', error_description: str = ''):
    if error:
        return auth.page('ProfitMetrics', f'<p class="lsl-err">Koppelen mislukt: {html.escape(error_description or error)}</p><p><a href="/status">Terug</a></p>')
    if not state or state != store.kv_get('pm_state'):
        return auth.page('ProfitMetrics', '<p class="lsl-err">Ongeldige aanvraag; probeer opnieuw via Status.</p><p><a href="/status">Terug</a></p>')
    try:
        profitmetrics.finish_login(_base_url(request), code)
    except Exception as e:
        return auth.page('ProfitMetrics', f'<p class="lsl-err">{html.escape(str(e))}</p><p><a href="/status">Terug</a></p>')
    scheduler.run_async(['pm_daily'], 'koppeling')
    return RedirectResponse('/status?msg=ProfitMetrics gekoppeld', status_code=303)


@app.get('/{name}', include_in_schema=False)
def page_file(name: str):
    if name in PAGE_FILES:
        return FileResponse(WEB / name, media_type='text/javascript', headers={'Cache-Control': 'no-cache'})
    raise HTTPException(404)
