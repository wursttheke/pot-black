# Pot Black

Browser-Snooker mit three.js, eigener Kugelphysik und vollständigem Regelwerk. Kein Build-Schritt.

## Starten

ES-Module brauchen einen lokalen Webserver (ohne Caching, damit Änderungen sofort ankommen):

```bash
npm start
```

Dann http://localhost:8123 öffnen.

## Online-Modus

Der Server stellt unter `/ws` eine WebSocket-Schnittstelle bereit (ohne externe Pakete). Mitspieler im
selben Netzwerk öffnen `http://<IP-des-Rechners>:8123`. Ein Spieler erstellt ein Spiel, ein zweiter tritt
bei; weitere können zuschauen. Der stoßende Spieler liefert das verbindliche Ergebnis, die anderen Browser
spielen den Stoß zur Anzeige nach und übernehmen danach diesen Stand.

## Aufbau

- `src/constants.js` – Tischmaße (WPBSA, 12 ft), Kugelwerte, Physikparameter
- `src/physics.js` – Gleiten/Rollen mit Spin, Kugel-Kugel-Stöße mit Throw, Banden mit erhöhter Nase, Taschen mit Backen
- `src/table.js` – Aufbau, Wiederaufsetzen der Farben, D-Bereich, Snooker-Prüfung (Free Ball)
- `src/rules.js` – Frame-Ablauf: Rot/Farbe, Endsequenz, Fouls (min. 4), Respot, Re-Black bei Gleichstand
- `src/render.js` – Szene, Tisch, Kugeln, Queue, Vorschaulinien
- `src/main.js` – Eingabe, Ego-Kamera, Stoßablauf, HUD, Vorschau per Vorab-Simulation, Online-Ablauf
- `src/ai.js` – Computergegner in drei Spielstärken
- `src/net.js` – WebSocket-Client für Lobby und Online-Spiele
- `server/` – WebSocket-Protokoll und Lobby/Spielverwaltung
