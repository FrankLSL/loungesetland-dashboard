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


def build():
    a, b = _week()
    A, B = a.isoformat(), b.isoformat()
    lA, lB = (a - datetime.timedelta(days=364)).isoformat(), (b - datetime.timedelta(days=364)).isoformat()
    parts = []
    # --- ads
    op = (store.get_doc('ads/opschaalplan') or {}).get('data')
    if op and op.get('advies'):
        ad = op['advies']
        txt = f"<b>{html.escape(ad.get('titel', ''))}</b>: dagbudget {E(num(ad.get('per_dag')))} (Meta {E(num(ad.get('meta_dag')))}, Google {E(num(ad.get('google_dag')))}). {html.escape(ad.get('toelichting', ''))}"
        nxt = next((w for w in op.get('weken', []) if w.get('actie') in ('verhogen', 'verlagen') and today().isoformat() <= w['week'] <= (today() + datetime.timedelta(days=28)).isoformat()), None)
        if nxt:
            txt += f"<br>Volgende stap: week van {DMY(nxt['week'])} {nxt['actie']} naar {E(num(nxt['per_dag']))} per dag (Meta {E(num(nxt['meta_dag']))}, Google {E(num(nxt['google_dag']))}). Campagnes een week ervoor klaarzetten."
        at = (op.get('at') or '')[:10]
        if at and at < (today() - datetime.timedelta(days=7)).isoformat():
            txt += f"<br><i>Plan voor het laatst bijgewerkt op {at} (wordt bijgewerkt als iemand het Ads-tabblad opent).</i>"
        parts.append(('Ads deze week', txt))
    # --- omzet en winst
    sd = (store.dataset_rows('shop_sales_daily') or []) + (store.dataset_rows('shop_sales_recent') or [])
    seen = {}
    for r in sd:
        seen[r['day']] = r
    sd = list(seen.values())
    om, oml, orders = _sum(sd, 'day', A, B, 'omzet'), _sum(sd, 'day', lA, lB, 'omzet'), _sum(sd, 'day', A, B, 'orders')
    pm = store.dataset_rows('pm_full') or []
    bw, ads, np_ = _sum(pm, 'd', A, B, 'gross_profit'), _sum(pm, 'd', A, B, 'total_adspend'), _sum(pm, 'd', A, B, 'net_profit')
    g = (om / oml - 1) if oml else None
    t = f"Omzet {E(om)} ({int(orders)} orders){'' if g is None else f', {g * 100:+.0f}% t.o.v. vorig jaar'}. Brutowinst {E(bw)}, ads {E(ads)}"
    t += f" (POAS {bw / ads:.1f})".replace('.', ',') if ads else ''
    t += f", nettowinst {E(np_)}."
    parts.append((f'Vorige week ({DMY(A)} t/m {DMY(B)})', t))
    # --- website en uitlevering
    ss = store.dataset_rows('shop_sessions_daily') or []
    ses, cmp = _sum(ss, 'day', A, B, 'sessions'), _sum(ss, 'day', A, B, 'sessions_that_completed_checkout')
    ful = _sum(store.dataset_rows('shop_fulfil_daily') or [], 'day', A, B, 'orders_fulfilled')
    pr = {}
    for r in store.dataset_rows('shop_products_daily') or []:
        if A <= r['day'] <= B and num(r.get('orders')) > 0:
            pr[r['product_title']] = pr.get(r['product_title'], 0) + num(r.get('net_sales'))
    top = sorted(pr.items(), key=lambda x: -x[1])[:3]
    t = f"{int(ses):,} sessies".replace(',', '.') + (f", conversie webshop {P(cmp / ses)}" if ses else '') + f". {int(ful)} orders uitgeleverd."
    if top:
        t += ' Top 3 producten: ' + '; '.join(f'{html.escape(n or "?")} ({E(v)})' for n, v in top) + '.'
    parts.append(('Website en uitlevering', t))
    # --- openstaand, voorraad, containers
    op_rows = store.dataset_rows('shop_open') or []
    cat = {}
    for r in op_rows:
        cat[r['categorie']] = cat.get(r['categorie'], 0) + num(r['openstaand'])
    t = f"Openstaande klantbetalingen {E(sum(cat.values()))}: " + ', '.join(f'{k.lower()} {E(v)}' for k, v in cat.items()) + '.'
    st = (store.dataset_rows('st_summary') or [{}])[0]
    if st:
        t += f" Voorraadwaarde {E(num(st.get('voorraadwaarde')))}, {int(num(st.get('negatieve_voorraad_skus')))} SKU's met negatieve voorraad."
    fx = (store.dataset_rows('fx') or [{}])[0]
    rate = num(fx.get('usd_eur')) or 0.9
    lim = (today() + datetime.timedelta(days=30)).isoformat()
    due = 0.0
    for r in store.dataset_rows('cp_open') or []:
        if not r.get('container_betaald') and r.get('betalen_voor', '9') <= lim:
            due += num(r.get('open_usd')) * rate
        if r.get('eta', '9') <= lim:
            due += num(r.get('vracht_usd')) * rate
    t += f" Containers en vracht komende 30 dagen: {E(due)}."
    parts.append(('Geld en voorraad', t))
    # --- mislukte taken
    bad = [r for r in store.last_runs_per_job() if not r['ok']]
    if bad:
        parts.append(('Niet gelukt', ', '.join(f"{r['job']}: {html.escape((r['message'] or '').splitlines()[0][:120])}" for r in bad)))
    url = os.getenv('PUBLIC_URL') or (('https://' + os.getenv('RAILWAY_PUBLIC_DOMAIN')) if os.getenv('RAILWAY_PUBLIC_DOMAIN') else '')
    body = ''.join(f'<h3 style="color:#1f4b47;margin:18px 0 4px;font-size:15px">{h}</h3><p style="margin:0;line-height:1.5">{p}</p>' for h, p in parts)
    if url:
        body += f'<p style="margin-top:20px"><a href="{url}" style="color:#1f4b47;font-weight:600">Open het dashboard →</a></p>'
    page = f'<div style="font-family:Poppins,Segoe UI,Arial,sans-serif;font-size:14px;color:#24221f;max-width:640px">{body}</div>'
    return f'Weekrapport Loungesetland · week van {DMY(A)}', page


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
    with smtplib.SMTP(host, port, timeout=60) as s:
        s.starttls(context=ssl.create_default_context())
        if os.getenv('SMTP_USER'):
            s.login(os.getenv('SMTP_USER'), os.getenv('SMTP_PASSWORD', ''))
        s.send_message(msg)
    return f'verstuurd via SMTP naar {", ".join(to)}'
