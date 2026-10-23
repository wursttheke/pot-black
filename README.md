# Pot Black

Browser-Snooker mit three.js, eigener Kugelphysik und vollständigem Regelwerk. Kein Build-Schritt.

## Starten

ES-Module brauchen einen lokalen Webserver (ohne Caching, damit Änderungen sofort ankommen):

```bash
npm start
```

Dann http://localhost:8123 öffnen.

## Deployment auf Render

Das Repository enthält eine `render.yaml`. In Render „New → Blueprint“ wählen und dieses GitHub-Repository
verbinden; Render startet dann `node serve.js` als Webdienst (Port kommt aus `$PORT`).

## Aufbau

- `src/constants.js` – Tischmaße (WPBSA, 12 ft), Kugelwerte, Physikparameter
- `src/physics.js` – Gleiten/Rollen mit Spin, Kugel-Kugel-Stöße mit Throw, Banden mit erhöhter Nase, Taschen mit Backen
- `src/table.js` – Aufbau, Wiederaufsetzen der Farben, D-Bereich, Snooker-Prüfung (Free Ball)
- `src/rules.js` – Frame-Ablauf: Rot/Farbe, Endsequenz, Fouls (min. 4), Respot, Re-Black bei Gleichstand
- `src/render.js` – Szene, Tisch, Kugeln, Queue, Vorschaulinien
- `src/main.js` – Eingabe, Ego-Kamera, Stoßablauf, HUD, Vorschau per Vorab-Simulation
- `src/ai.js` – Computergegner in drei Spielstärken
