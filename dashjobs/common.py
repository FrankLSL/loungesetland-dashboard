"""Hulpmiddelen voor de datataken: datums in Europe/Amsterdam, afronden, HTTP met herhaalpogingen."""
import datetime, time, zoneinfo
import requests

AMS = zoneinfo.ZoneInfo('Europe/Amsterdam')


def today():
    return datetime.datetime.now(AMS).date()


def yesterday():
    return today() - datetime.timedelta(days=1)


def iso(d):
    return d.isoformat()


def days_ago(n, base=None):
    return (base or today()) - datetime.timedelta(days=n)


def utc_hour_to_ams_day(ts):
    """'2026-10-13T22:00:00Z' (of zonder Z) → '2026-10-14' in Amsterdamse tijd."""
    s = str(ts).replace('Z', '+00:00')
    dt = datetime.datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(AMS).date().isoformat()


def num(v):
    if v is None or v == 'N/A' or v == '':
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def r2(v):
    return round(num(v), 2)


def i0(v):
    return int(round(num(v)))


def http(method, url, tries=3, **kw):
    kw.setdefault('timeout', 90)
    last = None
    for a in range(tries):
        try:
            r = requests.request(method, url, **kw)
            if r.status_code in (429, 500, 502, 503, 504) and a < tries - 1:
                time.sleep(3 * (a + 1))
                continue
            return r
        except requests.RequestException as e:
            last = e
            time.sleep(3 * (a + 1))
    raise RuntimeError(f'Verbinding mislukt: {last}')
