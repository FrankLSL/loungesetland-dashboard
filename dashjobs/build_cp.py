# Build containerplanning_open.json from the Planning tab.
# Kolommen: A Leverancier, B Besteldatum, D Nummer/code, E Geboekt?, G ETA, I Inhoud, L Aanbetaling $, M Aanbetaling €,
# N Dollar openstaand, O Euro betaling 2, T Kosten transport verwacht/afgesproken, U Kosten transport DAADWERKELIJK (vracht in USD)
import sys, json, datetime, openpyxl
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)
ws = wb['Planning']
hdr = {ws.cell(1, c).value.strip() if isinstance(ws.cell(1, c).value, str) else None: c for c in range(1, 40)}
def col(name):
    for k, c in hdr.items():
        if k and k.lower().startswith(name.lower()): return c
    raise SystemExit('kolom niet gevonden: ' + name)
C = {k: col(n) for k, n in dict(lev='Leverancier', best='Besteldatum', nr='Nummer', geb='Geboekt', eta='ETA', inh='Inhoud',
     a_usd='Aanbetaling Dollar', a_eur='Aanbetaling EURO', open='Dollar openstaand', eur2='Euro betaling 2',
     tr_v='Kosten transport verwacht', tr_d='Kosten transport DAAD').items()}
po_col = 3
hidden = {k for k, d in ws.row_dimensions.items() if d.hidden}
num = lambda x: float(x) if isinstance(x, (int, float)) else 0.0
d = lambda x: x.date().isoformat() if isinstance(x, datetime.datetime) else None
rows = []
for r in range(2, 200):
    if r in hidden: continue
    g = lambda k: ws.cell(r, C[k]).value
    po = ws.cell(r, po_col).value
    if not isinstance(g('eta'), datetime.datetime):
        # rij zonder ETA (of PO) maar met een aanbetaling in euro: telt mee als aanbetaald onderweg, niet in de betaalplanning
        if g('lev') and num(g('a_eur')) > 0:
            rows.append({'po': str(po or g('lev')).strip(), 'leverancier': g('lev'), 'nummer': str(g('nr') or '').strip(), 'besteld': d(g('best')),
                         'geboekt': g('geb'), 'eta': None, 'betalen_voor': None, 'inhoud': g('inh'), 'aanbetaling_usd': round(num(g('a_usd')), 2),
                         'aanbetaling_eur': round(num(g('a_eur')), 2), 'container_betaald': num(g('eur2')) > 0, 'betaling2_eur': round(num(g('eur2')), 2),
                         'open_usd': 0.0, 'vracht_usd': 0.0, 'vracht_bron': 'verwacht'})
        continue
    if not po: continue
    betaald = num(g('eur2')) > 0  # Euro betaling 2 ingevuld = container volledig betaald
    tr_d, tr_v = g('tr_d'), g('tr_v')
    vracht = num(tr_d) if isinstance(tr_d, (int, float)) and tr_d > 0 else num(tr_v)
    if 'tierra' in str(g('lev') or '').lower(): vracht = 0.0  # Tierra: geen vracht
    eta = g('eta').date()
    rows.append({'po': str(po).strip(), 'leverancier': g('lev'), 'nummer': str(g('nr') or '').strip(), 'besteld': d(g('best')),
                 'geboekt': g('geb'), 'eta': eta.isoformat(), 'betalen_voor': (eta - datetime.timedelta(days=7)).isoformat(),
                 'inhoud': g('inh'), 'aanbetaling_usd': round(num(g('a_usd')), 2), 'aanbetaling_eur': round(num(g('a_eur')), 2),
                 'container_betaald': betaald, 'betaling2_eur': round(num(g('eur2')), 2), 'open_usd': 0.0 if betaald else round(num(g('open')), 2),
                 'vracht_usd': round(vracht, 2), 'vracht_bron': 'daadwerkelijk' if isinstance(tr_d, (int, float)) and tr_d > 0 else 'verwacht'})
json.dump(rows, open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(rows), 'rijen')

# Optional: CSV with euro amounts at the given rate: python3 build_cp.py <xlsx> <json> <usd_eur> <koersdatum> <csv>
if len(sys.argv) >= 6:
    import csv, io
    rate, rdate, csv_out = float(sys.argv[3]), sys.argv[4], sys.argv[5]
    import zoneinfo
    today = datetime.datetime.now(zoneinfo.ZoneInfo('Europe/Amsterdam')).date()
    nl = lambda x: f"{x:.2f}".replace('.', ',')
    buf = io.StringIO(); w = csv.writer(buf, delimiter=';')
    w.writerow(['PO', 'Leverancier', 'Nummer/code', 'Geboekt', 'ETA', 'Container betalen uiterlijk', 'Container betaald', 'Inhoud',
                'Aanbetaling USD', 'Aanbetaling EUR', 'Open USD', f'Container open EUR (koers {rate} van {rdate})', 'Vracht USD', 'Vracht EUR', 'Vracht bron', 'Totaal open EUR'])
    for r in sorted([r for r in rows if r['eta']], key=lambda r: r['eta' if r['container_betaald'] else 'betalen_voor']):
        ce = r['open_usd'] * rate
        ve = r['vracht_usd'] * rate
        w.writerow([r['po'], r['leverancier'], r['nummer'], r['geboekt'] or '', r['eta'], '' if r['container_betaald'] else r['betalen_voor'],
                    'Ja' if r['container_betaald'] else 'Nee', r['inhoud'], nl(r['aanbetaling_usd']), nl(r['aanbetaling_eur']), nl(r['open_usd']),
                    nl(ce), nl(r['vracht_usd']), nl(ve), r['vracht_bron'], nl(ce + ve)])
    open(csv_out, 'w', encoding='utf-8-sig').write(buf.getvalue())
    print('csv geschreven')
