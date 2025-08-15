# Investitionsdetails – statische Leistungsübersicht (DE)

Dieses Paket ist für eine Bereitstellung unter **massmutualventures.de/investitionsdetails** gebaut.
Es ist vollständig responsive (Desktop & Mobil), deutsch lokalisiert und ohne Server/DB lauffähig.

## Struktur
- `investitionsdetails/` – Frontend (nur statische Dateien)
  - `index.html`
  - `assets/styles.css`
  - `assets/app.js`
  - `data/recommendations.json` – Datenquelle (von Actions befüllt)
- `.github/ISSUE_TEMPLATE/` + `backend/handle-issue.mjs` – Admin-Workflow (Issues → JSON)
- Workflow: `.github/workflows.yml`

## Deployment (GitHub Pages + Custom Domain)
1. Kopiere **den Ordner `investitionsdetails/`** in das Root deines bestehenden Repos (das bereits die Domain `massmutualventures.de` nutzt).
2. Kopiere **`.github/ISSUE_TEMPLATE/`, `backend/handle-issue.mjs`, `.github/workflows.yml`** ebenfalls ins Repo-Root (falls bereits vorhanden, sinnvoll zusammenführen).
3. Stelle sicher, dass GitHub Pages für das Repo aktiv ist und die Custom Domain auf `massmutualventures.de` zeigt.
4. Danach ist die Kundenansicht unter **https://massmutualventures.de/investitionsdetails/** erreichbar.
5. Admin: Unter **Issues** die Templates „Neue Empfehlung anlegen / Empfehlung bearbeiten / Import (JSON)“ nutzen. Der Workflow schreibt nach `investitionsdetails/data/recommendations.json`.

## Kurse
- Quellen: Yahoo / Stooq. Wenn beides fehlschlägt, wird `0` angezeigt (kein Chaos bei Preisen).
- P/L % zeigt „—“, wenn kein Live-Preis verfügbar ist (statt -100%).

## Mobil
- Kartenlayout mit klaren Sektionen, große Tiptargets, deutschsprachige Labels.
- Desktop nutzt Tabelle mit Sticky-Header; mobile ohne Header (Karten).

