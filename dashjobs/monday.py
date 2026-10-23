"""Maandagbericht per mail: advies voor de ads en een korte terugblik op vorige week (zondag t/m zaterdag).

Versturen gaat via de gekoppelde Microsoft-mailbox (OneDrive-koppeling met Mail.Send) of anders via SMTP
(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM). Ontvangers: MAIL_TO (komma-gescheiden).
"""
import os, datetime, html, smtplib, ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import store
from . import onedrive
from .common import today, num

E = lambda v: '€ ' + f'{v:,.0f}'.replace(',', '.')
P = lambda v: f'{v * 100:.1f}'.replace('.', ',') + '%'
MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
DMY = lambda s: (lambda d: f'{d.day} {MND[d.month - 1]}')(datetime.date.fromisoformat(s[:10]))


def _week():
    t = today()
    sun = t - datetime.timedelta(days=(t.weekday() + 1) % 7)  # zondag van deze week
    a = sun - datetime.timedelta(days=7)
    return a, sun - datetime.timedelta(days=1)


def _sum(rows, key, a, b, f):
    return sum(num(r.get(f)) for r in rows or [] if a <= r[key][:10] <= b)


DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']
DAGNAAM = lambda s: DAGEN[datetime.date.fromisoformat(s[:10]).weekday()]
GREEN, INK, MUTED, LINE, SOFT = '#1f4b47', '#24221f', '#6b6b6b', '#e6e2da', '#f4f1ea'


def _pct(a, b):
    return None if not b else a / b - 1


def _trend(g, up='meer', down='minder'):
    if g is None:
        return ''
    if abs(g) < 0.03:
        return 'ongeveer gelijk'
    if g >= 1:
        return (f"{g + 1:.1f}".replace('.', ',').replace(',0', '') + ' keer zoveel').replace('2 keer', 'twee keer')
    return f"{abs(g) * 100:.0f}% {up if g > 0 else down}"


def _daily(rows, key, a, b, f):
    out = {}
    for r in rows or []:
        d = str(r.get(key, ''))[:10]
        if a <= d <= b:
            out[d] = out.get(d, 0) + num(r.get(f))
    return out


def build():
    """Maandagbrief: een kort verhaal over vorige week (zo t/m za) en waar je deze week op let."""
    a, b = _week()
    A, B = a.isoformat(), b.isoformat()
    pA, pB = (a - datetime.timedelta(days=7)).isoformat(), (b - datetime.timedelta(days=7)).isoformat()
    lA, lB = (a - datetime.timedelta(days=364)).isoformat(), (b - datetime.timedelta(days=364)).isoformat()
    t0 = today()
    T0 = t0.isoformat()
    blocks = []

    # ---------- omzet en verloop van de week (Shopify)
    seen = {}
    for r in (store.dataset_rows('shop_sales_daily') or []) + (store.dataset_rows('shop_sales_recent') or []):
        seen[r['day'][:10]] = r
    sd = list(seen.values())
    om, omp, oml = _sum(sd, 'day', A, B, 'omzet'), _sum(sd, 'day', pA, pB, 'omzet'), _sum(sd, 'day', lA, lB, 'omzet')
    orders = _sum(sd, 'day', A, B, 'orders')
    perdag = _daily(sd, 'day', A, B, 'omzet')
    odag = _daily(sd, 'day', A, B, 'orders')
    best = max(perdag.items(), key=lambda x: x[1]) if perdag else None
    slecht = min(perdag.items(), key=lambda x: x[1]) if perdag else None
    g_ly, g_pw = _pct(om, oml), _pct(om, omp)
    if g_ly is not None and g_ly > 0.1:
        t = f"Een goede week: we deden <b>{E(om)}</b> omzet uit {int(orders)} orders, {_trend(g_ly)}{' als' if g_ly >= 1 else ' dan'} dezelfde week vorig jaar ({E(oml)})."
    elif g_ly is not None and g_ly < -0.1:
        t = f"Een rustigere week: <b>{E(om)}</b> omzet uit {int(orders)} orders, {_trend(g_ly)}{' als' if g_ly >= 1 else ' dan'} dezelfde week vorig jaar ({E(oml)})."
    else:
        t = f"Vorige week deden we <b>{E(om)}</b> omzet uit {int(orders)} orders" + (f", {_trend(g_ly)} als dezelfde week vorig jaar ({E(oml)})." if g_ly is not None else '.')
    if g_pw is not None:
        t += f" Ten opzichte van de week ervoor is dat {_trend(g_pw)}."
    if best and best[1] > 0:
        t += f" De beste dag was <b>{DAGNAAM(best[0])}</b> met {E(best[1])} ({int(odag.get(best[0], 0))} orders)"
        t += f"; {DAGNAAM(slecht[0])} was het rustigst ({E(slecht[1])})." if slecht and slecht[0] != best[0] else '.'
    if orders:
        t += f" Een bestelling was gemiddeld {E(om / orders)}."
    blocks.append(('Hoe ging de week', t))

    # ---------- winst (ProfitMetrics)
    pm = store.dataset_rows('pm_full') or []
    bw, ads, np_ = _sum(pm, 'd', A, B, 'gross_profit'), _sum(pm, 'd', A, B, 'total_adspend'), _sum(pm, 'd', A, B, 'net_profit')
    tpm = _sum(pm, 'd', A, B, 'turnover')
    if tpm or ads:
        t = f"Daar bleef <b>{E(bw)} brutowinst</b> van over" + (f" ({P(bw / tpm)} marge)" if tpm else '') + f". We gaven {E(ads)} uit aan advertenties"
        if ads:
            t += ', dus elke euro ads leverde ' + f'{bw / ads:.1f}'.replace('.', ',') + ' euro brutowinst op (POAS)'
        t += '. '
        if np_ >= 0:
            t += f"Na alle kosten in ProfitMetrics bleef er netto <b>{E(np_)}</b> over."
        else:
            t += f"Na alle kosten in ProfitMetrics kwamen we netto <b>{E(-np_)}</b> tekort: de vaste kosten lopen door terwijl de omzet in deze tijd van het jaar lager ligt."
        blocks.append(('Wat hielden we eraan over', t))

    # ---------- wat verkochten we
    pr = {}
    for r in store.dataset_rows('shop_products_daily') or []:
        if A <= r['day'][:10] <= B and num(r.get('orders')) > 0:
            k = r.get('product_title') or '?'
            pr[k] = pr.get(k, 0) + num(r.get('net_sales'))
    top = sorted(pr.items(), key=lambda x: -x[1])[:3]
    if top:
        blocks.append(('Toppers van de week', 'Het meest verkocht (netto-omzet): ' + '; '.join(f'{html.escape(n)} ({E(v)})' for n, v in top) + '.'))

    # ---------- website en bezorging
    ss = store.dataset_rows('shop_sessions_daily') or []
    ses, sesl = _sum(ss, 'day', A, B, 'sessions'), _sum(ss, 'day', lA, lB, 'sessions')
    cmp_, cmpl = _sum(ss, 'day', A, B, 'sessions_that_completed_checkout'), _sum(ss, 'day', lA, lB, 'sessions_that_completed_checkout')
    ful = _sum(store.dataset_rows('shop_fulfil_daily') or [], 'day', A, B, 'orders_fulfilled')
    if ses:
        t = f"{int(ses):,} bezoekers op de website".replace(',', '.') + (f" ({_trend(_pct(ses, sesl))}{' als' if _pct(ses, sesl) >= 1 else ' dan'} vorig jaar)" if sesl else '')
        t += f", waarvan {P(cmp_ / ses)} online afrekende" + (f" (vorig jaar {P(cmpl / sesl)})" if sesl else '') + '.'
        t += f" Onze bezorgers leverden <b>{int(ful)} orders</b> af."
        blocks.append(('Website en bezorging', t))

    # ---------- waar letten we deze week op
    let = []
    fx = (store.dataset_rows('fx') or [{}])[0]
    rate = num(fx.get('usd_eur')) or 0.9
    wk_end = (t0 + datetime.timedelta(days=7)).isoformat()
    cp = store.dataset_rows('cp_open') or []
    for r in cp:
        if not r.get('eta'):
            continue
        lev_naam = html.escape(str(r.get('leverancier') or ''))
        if not r.get('container_betaald') and num(r.get('open_usd')) > 0 and (r.get('betalen_voor') or '9') <= wk_end:
            when = 'de betaaldatum is al verstreken' if (r.get('betalen_voor') or '') < T0 else 'vóór ' + DAGNAAM(r['betalen_voor']) + ' ' + DMY(r['betalen_voor'])
            let.append(f"Container <b>{html.escape(r['po'])}</b> ({lev_naam}) betalen, {when}: {E(num(r['open_usd']) * rate)}.")
        if T0 <= r['eta'] <= wk_end:
            let.append(f"Container <b>{html.escape(r['po'])}</b> ({lev_naam}) komt rond {DAGNAAM(r['eta'])} {DMY(r['eta'])} binnen" + (f"; vracht {E(num(r.get('vracht_usd')) * rate)}." if num(r.get('vracht_usd')) else '.'))
    op_rows = store.dataset_rows('shop_open') or []
    nb = [r for r in op_rows if str(r.get('categorie', '')).startswith('Geleverd')]
    if nb:
        let.append(f"{len(nb)} geleverde order(s) nog niet helemaal betaald, samen {E(sum(num(r['openstaand']) for r in nb))}: " + ', '.join(html.escape(r['order']) for r in nb[:6]) + '.')
    lev = [r for r in op_rows if T0 <= (r.get('bezorgdatum') or '9') <= wk_end and not str(r.get('categorie', '')).startswith('Geleverd')]
    if lev:
        let.append(f"Deze week bezorgen we {len(lev)} order(s) waar nog {E(sum(num(r['openstaand']) for r in lev))} op openstaat: betaling bij levering regelen.")
    st = (store.dataset_rows('st_summary') or [{}])[0]
    neg = int(num(st.get('negatieve_voorraad_skus'))) if st else 0
    if neg:
        let.append(f"{neg} artikel(en) staan op negatieve voorraad in Sumtracker; even rechtzetten zodat de webshop klopt.")
    plan = (store.get_doc('ads/opschaalplan') or {}).get('data') or {}
    nxt = next((w for w in plan.get('weken', []) if w.get('actie') in ('verhogen', 'verlagen') and T0 <= w['week'] <= (t0 + datetime.timedelta(days=21)).isoformat()), None)
    if nxt:
        let.append(f"Advertenties: vanaf {DAGNAAM(nxt['week'])} {DMY(nxt['week'])} het dagbudget <b>{nxt['actie']}</b> naar {E(num(nxt['per_dag']))} (Meta {E(num(nxt['meta_dag']))}, Google {E(num(nxt['google_dag']))}).")
    elif plan.get('advies'):
        ad = plan['advies']
        let.append(f"Advertenties: {html.escape(ad.get('titel', 'volg het plan')).lower()}, dagbudget {E(num(ad.get('per_dag')))} (Meta {E(num(ad.get('meta_dag')))}, Google {E(num(ad.get('google_dag')))}).")
    weer = [r for r in store.dataset_rows('weer') or [] if T0 <= r['d'] <= wk_end]
    if weer:
        nat = [r for r in weer if num(r.get('regen')) >= 5]
        warm = max(weer, key=lambda r: num(r.get('tmax')))
        w = f"Weer: warmste dag {DAGNAAM(warm['d'])} ({num(warm['tmax']):.0f}°)"
        w += (f", flinke regen op {', '.join(DAGNAAM(r['d']) for r in nat)}; houd daar rekening mee in de bezorgplanning." if nat else ', weinig regen verwacht.')
        let.append(w)
    bad = [r for r in store.last_runs_per_job() if not r['ok']]
    if bad:
        let.append('Niet bijgewerkt in het dashboard: ' + ', '.join(html.escape(r['job']) for r in bad) + '.')
    if let:
        blocks.append(('Waar letten we deze week op', '<ul style="margin:6px 0 0;padding-left:18px">' + ''.join(f'<li style="margin:0 0 6px">{x}</li>' for x in let) + '</ul>'))

    # ---------- geld en voorraad
    if st:
        tot_open = sum(num(r['openstaand']) for r in op_rows)
        lim = (t0 + datetime.timedelta(days=30)).isoformat()
        due = 0.0
        for r in cp:
            if r.get('eta') and not r.get('container_betaald') and (r.get('betalen_voor') or '9') <= lim:
                due += num(r.get('open_usd')) * rate
            if r.get('eta') and r['eta'] <= lim:
                due += num(r.get('vracht_usd')) * rate
        aanb = sum(num(r.get('aanbetaling_eur')) + num(r.get('betaling2_eur')) for r in cp if not r.get('eta') or r['eta'] > T0)
        vw = num(st.get('voorraadwaarde'))
        blocks.append(('Geld en voorraad', f"Er zit <b>{E(vw + aanb)}</b> in goederen: {E(vw)} op voorraad en {E(aanb)} al betaald voor containers die onderweg zijn. Klanten moeten ons nog {E(tot_open)} betalen; aan containers en vracht gaat er de komende 30 dagen {E(due)} uit."))

    url = os.getenv('PUBLIC_URL') or ''
    head = ('<div style="background:' + GREEN + ';color:#fff;padding:22px 26px;border-radius:10px 10px 0 0">'
            '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Loungesetland &middot; maandagbrief</div>'
            f'<div style="font-size:22px;font-weight:700;margin-top:4px">Week van {DMY(A)} t/m {DMY(B)}</div></div>')
    body = ''.join(f'<h3 style="color:{GREEN};margin:22px 0 6px;font-size:16px">{h}</h3><div style="line-height:1.6">{p}</div>' for h, p in blocks)
    foot = (f'<p style="margin:26px 0 0"><a href="{url}" style="background:{GREEN};color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:600">Open het dashboard</a></p>' if url else '')
    foot += f'<p style="color:{MUTED};font-size:12px;margin-top:20px">Omzet uit Shopify (excl. btw), winst uit ProfitMetrics, voorraad uit Sumtracker, containers uit de containerplanning. Een week loopt van zondag t/m zaterdag.</p>'
    page = (f'<div style="background:{SOFT};padding:20px 0"><div style="font-family:Poppins,Segoe UI,Arial,sans-serif;font-size:14px;color:{INK};'
            f'max-width:640px;margin:0 auto;background:#fff;border-radius:10px;border:1px solid {LINE}">{head}<div style="padding:16px 26px 26px">Goedemorgen,{body}{foot}</div></div></div>')
    return f'Maandagbrief Loungesetland · week van {DMY(A)}', page


def send():
    to = [a.strip() for a in os.getenv('MAIL_TO', '').split(',') if a.strip()]
    if not to:
        raise RuntimeError('MAIL_TO is niet ingesteld')
    subject, body = build()
    if onedrive.configured() and onedrive.connected() and os.getenv('MAIL_VIA', 'microsoft') == 'microsoft':
        onedrive.send_mail(to, subject, body)
        return f'verstuurd via Microsoft naar {", ".join(to)}'
    host = os.getenv('SMTP_HOST')
    if not host:
        raise RuntimeError('Geen mailroute: koppel Microsoft (OneDrive) of stel SMTP_HOST in')
    msg = MIMEMultipart('alternative')
    msg['Subject'], msg['From'], msg['To'] = subject, os.getenv('MAIL_FROM') or os.getenv('SMTP_USER'), ', '.join(to)
    msg.attach(MIMEText(body, 'html', 'utf-8'))
    port = int(os.getenv('SMTP_PORT', '587'))
    # port 465 = SSL from the start (one.com), otherwise STARTTLS
    conn = smtplib.SMTP_SSL(host, port, timeout=60, context=ssl.create_default_context()) if port == 465 else smtplib.SMTP(host, port, timeout=60)
    with conn as s:
        if port != 465:
            s.starttls(context=ssl.create_default_context())
        if os.getenv('SMTP_USER'):
            s.login(os.getenv('SMTP_USER'), os.getenv('SMTP_PASSWORD', ''))
        s.send_message(msg)
    return f'verstuurd via SMTP naar {", ".join(to)}'
