# Pot Black

Browser-Snooker mit three.js, eigener Kugelphysik und vollständigem Regelwerk. Kein Build-Schritt.

## Starten

ES-Module brauchen einen lokalen Webserver (ohne Caching, damit Änderungen sofort ankommen):

```bash
npm start
```

Dann http://localhost:8123 öffnen.

## Deployment auf Render

Das Spiel ist eine statische Seite: `index.html`, die Module in `src/`, `sounds/` und Bilder; three.js kommt
per CDN. Das Repository enthält eine `render.yaml` für eine Render „Static Site“: In Render „New → Blueprint“
wählen und dieses GitHub-Repository verbinden. Jeder Push auf `main` wird automatisch veröffentlicht.
`serve.js` wird nur für die lokale Entwicklung gebraucht.

Die Vorschau-Tags für geteilte Links (`og:url`, `og:image` in `index.html`) enthalten die feste Adresse
`https://pot-black.onrender.com` – bei einer anderen Domain dort anpassen.

## Aufbau

- `src/constants.js` – Tischmaße (WPBSA, 12 ft), Kugelwerte, Physikparameter
- `src/physics.js` – Gleiten/Rollen mit Spin, Kugel-Kugel-Stöße mit Throw, Banden mit erhöhter Nase, Taschen mit Backen
- `src/table.js` – Aufbau, Wiederaufsetzen der Farben, D-Bereich, Snooker-Prüfung (Free Ball)
- `src/rules.js` – Frame-Ablauf: Rot/Farbe, Endsequenz, Fouls (min. 4), Respot, Re-Black bei Gleichstand
- `src/render.js` – Szene, Tisch, Kugeln, Queue, Vorschaulinien
- `src/main.js` – Eingabe, Ego-Kamera, Stoßablauf, HUD, Vorschau per Vorab-Simulation
- `src/ai.js` – Computergegner in drei Spielstärken
