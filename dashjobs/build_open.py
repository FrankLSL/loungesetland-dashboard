# Openstaande klantbetalingen voor het Loungesetland-dashboard.
# Gebruik: python3 build_open.py <orders.json> [<orders2.json> ...] <uit.json> <peildatum YYYY-MM-DD>
# Elk invoerbestand: het antwoord van de Shopify graphql_query (data.orders.nodes) of een lijst nodes.
import json, re, sys
from datetime import date

MAANDEN = {'jan': 1, 'januari': 1, 'feb': 2, 'februari': 2, 'mrt': 3, 'maart': 3, 'apr': 4, 'april': 4, 'mei': 5,
           'jun': 6, 'juni': 6, 'jul': 7, 'juli': 7, 'aug': 8, 'augustus': 8, 'sep': 9, 'sept': 9, 'september': 9,
           'okt': 10, 'oktober': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12}
MNAAM = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
MRE = '(' + '|'.join(sorted(MAANDEN, key=len, reverse=True)) + r')(?![a-z])\.?'


def parse(text, ref):
    """First date in a text -> (date, exact?) ; ref = order date (year guess for dates without a year)."""
    if not text:
        return None
    t = text.lower()
    m = re.search(r'\b(\d{1,2})-(\d{1,2})-(\d{4})\b', t)
    cand = []
    if m:
        try:
            cand.append((m.start(), date(int(m.group(3)), int(m.group(2)), int(m.group(1))), True))
        except ValueError:
            pass
    for m in re.finditer(r'\b(\d{1,2})\s+' + MRE + r'(?:\s+(\d{4}))?', t):
        d, mo, y = int(m.group(1)), MAANDEN[m.group(2)], m.group(3)
        yr = int(y) if y else (ref.year if (mo, d) >= (ref.month, ref.day) else ref.year + 1)
        try:
            cand.append((m.start(), date(yr, mo, d), True))
        except ValueError:
            pass
    for m in re.finditer(r'\b' + MRE + r'(?:\s+(\d{4}))?', t):
        # a month without a day ("in januari 2027", "maart"): only when no day number precedes it
        before = t[max(0, m.start() - 4):m.start()]
        if re.search(r'\d\s*$', before):
            continue
        mo, y = MAANDEN[m.group(1)], m.group(2)
        yr = int(y) if y else (ref.year if mo >= ref.month else ref.year + 1)
        cand.append((m.start(), date(yr, mo, 1), False))
    if not cand:
        return None
    cand.sort(key=lambda c: c[0])
    return cand[0][1], cand[0][2]


def label(d, exact):
    return f"{DAGEN[d.weekday()]} {d.day} {MNAAM[d.month - 1]}" + ('' if d.year == date.today().year else f" {d.year}") if exact else f"{MNAAM[d.month - 1]} {d.year}"


def bezorg(node, ref):
    attrs = {a['key']: a['value'] for a in node.get('customAttributes') or []}
    for key, bron in (('Bezorgdatum bevestigd', 'bevestigd'), ('Bezorgdatum', 'gepland')):
        if attrs.get(key):
            r = parse(attrs[key], ref)
            if r:
                return r, bron
    r = parse(node.get('note') or '', ref)
    if r:
        return r, 'notitie'
    for tag in node.get('tags') or []:
        r = parse(tag, ref)
        if r:
            return r, 'tag'
    return None, None


def main():
    *ins, out, peil = sys.argv[1:]
    peil_d = date.fromisoformat(peil)
    nodes = []
    for f in ins:
        j = json.load(open(f))
        nodes += j['data']['orders']['nodes'] if isinstance(j, dict) else j
    seen, rows = set(), []
    cat = {'UNFULFILLED': 'Nog te leveren', 'PARTIALLY_FULFILLED': 'Deels geleverd', 'FULFILLED': 'Geleverd, nog niet betaald'}
    bet = {'PENDING': 'Niet betaald', 'PARTIALLY_PAID': 'Deels betaald', 'AUTHORIZED': 'Geautoriseerd'}
    for n in nodes:
        if n['name'] in seen or n.get('cancelledAt'):
            continue
        seen.add(n['name'])
        open_ = float(n['totalOutstandingSet']['shopMoney']['amount'])
        if open_ <= 0:
            continue
        besteld = n['createdAt'][:10]
        ref = date.fromisoformat(besteld)
        r, bron = bezorg(n, ref)
        note = (n.get('note') or '').strip().split('\n')[0][:90]
        rows.append({
            'order': n['name'], 'besteld': besteld, 'dagen_open': (peil_d - ref).days,
            'categorie': cat.get(n['displayFulfillmentStatus'], 'Nog te leveren'),
            'betaalstatus': bet.get(n['displayFinancialStatus'], n['displayFinancialStatus'].title()),
            'totaal': float((n.get('currentTotalPriceSet') or n['totalPriceSet'])['shopMoney']['amount']),  # current total: removed items excluded
            'ontvangen': float(n['totalReceivedSet']['shopMoney']['amount']),
            'openstaand': open_,
            'bezorgdatum': r[0].isoformat() if r else None,
            'bezorg_exact': bool(r and r[1]),
            'bezorg_label': label(*r) if r else None,
            'bezorg_bron': bron,
            'notitie': note,
            'peildatum': peil,
        })
    json.dump(rows, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(len(rows), 'orders')


if __name__ == '__main__':
    main()
