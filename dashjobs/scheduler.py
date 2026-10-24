"""Planning van de automatische taken (Europe/Amsterdam), in het webproces zelf (één replica)."""
import os, threading, time, datetime, traceback
import store
from . import jobs, shopify, windsor, sumtracker, profitmetrics, onedrive
from .common import AMS

# naam → (functie, omschrijving, voorwaarde)
JOBS = {
    'shop_sales_daily': (jobs.shop_sales_daily, 'Shopify-omzet per dag', shopify.configured),
    'ontvangsten': (jobs.ontvangsten, 'Shopify-ontvangsten per dag', shopify.configured),
    'shop_sales_recent': (jobs.shop_sales_recent, 'Omzet laatste 7 dagen', shopify.configured),
    'shop_products_recent': (jobs.shop_products_recent, 'Productverkoop laatste 7 dagen', shopify.configured),
    'shop_open': (jobs.shop_open, 'Openstaande klantbetalingen', shopify.configured),
    'shop_sessions_daily': (jobs.shop_sessions_daily, 'Sessies per dag (2 jaar)', shopify.configured),
    'shop_sessions_recent': (jobs.shop_sessions_recent, 'Sessies laatste 14 dagen', shopify.configured),
    'shop_fulfil_daily': (jobs.shop_fulfil_daily, 'Uitleveringen per dag', shopify.configured),
    'shop_products_daily': (jobs.shop_products_daily, 'Productverkoop per dag (2 jaar)', shopify.configured),
    'shop_search_month': (jobs.shop_search_month, 'Zoekbezoek per maand', shopify.configured),
    'sumtracker_stock': (jobs.sumtracker_stock, 'Voorraad (Sumtracker)', sumtracker.configured),
    'ads_daily': (jobs.ads_daily, 'Meta en Google per dag', windsor.configured),
    'ads_campaigns': (jobs.ads_campaigns, 'Campagnes (42 dagen)', windsor.configured),
    'gbp_daily': (jobs.gbp_daily, 'Google-bedrijfsprofiel', windsor.configured),
    'meta_ads': (jobs.meta_ads, 'Meta-advertenties (moeheid)', windsor.configured),
    'markt_kp': (jobs.markt_kp, 'Zoekvolume (Zoekwoordplanner)', windsor.configured),
    'pm_daily': (jobs.pm_daily, 'ProfitMetrics per dag', profitmetrics.configured),
    'weer': (jobs.weer, 'Weerverwachting', lambda: True),
    'containers': (jobs.containers, 'Containerplanning + koers', lambda: True),
    'shop_sku_weekly': (jobs.shop_sku_weekly, 'Verkoop per SKU per week', shopify.configured),
    'voorraad_analyse': (jobs.voorraad_analyse, 'Voorraaddekking en marge per merk', lambda: sumtracker.configured() and shopify.configured()),
}


def _monday_mail():
    from . import monday
    return monday.send()


JOBS['maandagmail'] = (_monday_mail, 'Maandagbericht per mail', lambda: True)


def _pm_keepalive():
    tok = profitmetrics._oauth_token()
    return 'toegang verlengd' if tok else 'geen koppeling'


JOBS['pm_toegang'] = (_pm_keepalive, 'ProfitMetrics-toegang verlengen', lambda: bool(os.getenv('PROFITMETRICS_CLIENT_ID')))

# (taken, dagen 0=ma..6=zo of None = elke dag, uren, minuut)
SCHEDULE = [
    (['shop_sales_daily', 'ontvangsten'], None, [6], 22),
    (['shop_sales_recent', 'shop_products_recent'], None, list(range(8, 23)), 7),
    (['shop_open'], None, [8, 10, 12, 14, 16, 18, 20], 12),
    (['ads_daily', 'ads_campaigns', 'shop_sessions_recent', 'pm_daily', 'weer', 'gbp_daily', 'shop_search_month', 'meta_ads'], None, [0, 6, 12], 8),
    (['sumtracker_stock', 'shop_sku_weekly', 'voorraad_analyse'], None, [0, 6, 12], 1),
    (['markt_kp'], [0], [6], 33),
    (['shop_sessions_daily', 'shop_fulfil_daily', 'shop_products_daily'], [0], [6], 41),
    (['containers'], None, list(range(7, 22)), 37),
    (['maandagmail'], [0], [7], 30),
    (['pm_toegang'], None, list(range(24)), 3),
]

_running = threading.Lock()
_busy = set()


def run(name, by='planning'):
    fn, label, ok = JOBS[name]
    if name in _busy:
        return False, 'draait al'
    if not ok():
        return False, 'niet gekoppeld'
    _busy.add(name)
    rid = store.run_start(name)
    try:
        msg = fn() or 'klaar'
        store.run_end(rid, True, msg)
        return True, msg
    except Exception as e:
        store.run_end(rid, False, f'{e}\n{traceback.format_exc()[-1500:]}')
        return False, str(e)
    finally:
        _busy.discard(name)


# per dashboard-tab: welke taken de cijfers op dat tabblad verversen
PAGINA = {
    'week': ['shop_sales_recent', 'shop_products_recent', 'shop_open', 'shop_sessions_recent', 'pm_daily', 'ads_daily', 'sumtracker_stock', 'voorraad_analyse'],
    'liquiditeit': ['containers', 'shop_open', 'ontvangsten', 'shop_sales_recent', 'pm_daily'],
    'ads': ['ads_daily', 'ads_campaigns', 'meta_ads', 'gbp_daily', 'shop_search_month', 'shop_sessions_recent', 'shop_sales_recent', 'pm_daily', 'weer'],
    'voorraad': ['sumtracker_stock', 'containers', 'shop_sku_weekly', 'voorraad_analyse'],
}
PENDING = set()


def run_many(names, by='planning'):
    for n in names:
        try:
            run(n, by)
        finally:
            PENDING.discard(n)


def run_async(names, by='hand'):
    PENDING.update(names)
    threading.Thread(target=run_many, args=(names, by), daemon=True).start()


def _loop():
    last = None
    while True:
        try:
            now = datetime.datetime.now(AMS)
            key = now.strftime('%Y-%m-%d %H:%M')
            if key != last:
                last = key
                for names, wd, hours, minute in SCHEDULE:
                    if now.minute == minute and now.hour in hours and (wd is None or now.weekday() in wd):
                        run_async(names, 'planning')
        except Exception:
            traceback.print_exc()
        time.sleep(20)


def start():
    if os.getenv('DASH_NO_SCHEDULER'):
        return
    threading.Thread(target=_loop, daemon=True).start()
    # at every start: run the data tasks that never ran or failed last time (so a fix is tried right after a deploy)
    last = {r['job']: r for r in store.last_runs_per_job()}
    todo = [n for n in JOBS if n not in ('maandagmail', 'pm_toegang') and (n not in last or not last[n].get('ok'))]
    if todo:
        run_async(todo, by='start')
