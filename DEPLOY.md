# Dashboard online zetten (Railway)

Zelfde opzet als de planner: elke push naar `main` zet Railway automatisch live.

## 1. Service aanmaken
1. Railway → het project van de planner → **New** → **GitHub Repo** → `loungesetland-dashboard`.
2. Service → Settings → **Volumes** → Add volume, mount path `/data` (hier staat de database met alle cijfers, gebruikers en instellingen).
3. Settings → Networking → **Generate Domain** (of een eigen domein, bv. `dashboard.loungesetland.nl` met een CNAME naar het Railway-adres).

## 2. Variables
| Naam | Waarde |
|---|---|
| `ADMIN_USER` | frank |
| `ADMIN_PASSWORD` | sterk wachtwoord (eigenaar, altijd beheerder) |
| `SECRET_KEY` | lange willekeurige tekst |
| `PUBLIC_URL` | het adres van stap 1.3, bv. `https://dashboard.loungesetland.nl` |
| `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | zelfde als de planner (app heeft `read_orders` en `read_reports` nodig) |
| `SUMTRACKER_API_KEY` | zelfde als de planner |
| `WINDSOR_API_KEY` | Windsor.ai → account → API key |
| `PROFITMETRICS_API_KEY` (+ `PROFITMETRICS_API_URL`) | ProfitMetrics → instellingen → API |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Microsoft app-registratie (stap 3) |
| `MAIL_TO` | ontvangers maandagbericht, komma-gescheiden |

Optioneel: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` als de mail niet via Microsoft moet.

## 3. Microsoft-koppeling (OneDrive + mail)
1. portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**.
   - Naam: `Loungesetland dashboard`
   - Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*
   - Redirect URI: platform **Web**, `https://<PUBLIC_URL>/onedrive/callback`
2. **Certificates & secrets** → New client secret → kopieer de *Value* → `MS_CLIENT_SECRET`.
3. **Overview** → *Application (client) ID* → `MS_CLIENT_ID`.
4. **API permissions** → Add → Microsoft Graph → Delegated: `Files.Read`, `User.Read`, `Mail.Send`, `offline_access`.
5. In het dashboard: **Status** → **Koppel OneDrive** en log in met het account waar de containerplanning staat.

Het bestand wordt gelezen van `Loungesetland/1.0 Live documenten/Containerplanning 2026.xlsx` (relatief aan je OneDrive);
een ander pad kan via `CONTAINERPLANNING_PATH`.

## 4. Eerste start
De eerste keer zet de app alle cijfers uit het oude dashboard (map `seed/`) in de database: geschiedenis, aannames,
gedeelde instellingen en het opschaalplan. Daarna verversen de taken zichzelf (zie **Status**).

## Automatische taken (Europe/Amsterdam)
| Wanneer | Wat |
|---|---|
| dagelijks 06:22 | Shopify-omzet per dag + ontvangsten |
| elk uur 08:07–22:07 | omzet en productverkoop laatste 7 dagen |
| 8, 10, 12, 14, 16, 18, 20 uur | openstaande klantbetalingen |
| dagelijks 06:52 | Meta/Google, campagnes, sessies, ProfitMetrics, weer, bedrijfsprofiel, zoekbezoek, Meta-advertenties |
| elk uur 07:37–21:37 | containerplanning (alleen als het bestand veranderd is) + wisselkoers |
| maandag 06:33 | zoekvolume (Zoekwoordplanner) |
| maandag 06:41 | sessies, uitleveringen, productverkoop (2 jaar), Sumtracker-voorraad |
| maandag 07:30 | maandagbericht per mail |

Eén replica laten staan: de planning draait in het webproces.
