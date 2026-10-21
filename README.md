# Loungesetland dashboard

Weekrapport, liquiditeitsprognose en ads-monitor als eigen webapp (FastAPI) op Railway.

- `web/index.html`, `web/ads.js`, `web/markt.js` — de pagina (zelfde code als het oorspronkelijke dashboard)
- `web/static/dash-shim.js` — de `dash`-functies waar de pagina op rekent (data, filters, berekeningen, gedeelde instellingen)
- `app.py` — webserver, inloggen, data-API, statuspagina, gebruikers
- `store.py` — SQLite op `/data`
- `dashjobs/` — automatische taken (Shopify, ProfitMetrics, Windsor, Sumtracker, OneDrive, weer, koers, maandagmail)
- `seed/` — de gegevens uit het oude dashboard, eenmalig ingelezen bij de eerste start

Lokaal: `pip install -r requirements.txt && DASH_NO_SCHEDULER=1 uvicorn app:app --reload` (zonder `ADMIN_PASSWORD` geen inlogscherm).
Online zetten: zie [DEPLOY.md](DEPLOY.md).
