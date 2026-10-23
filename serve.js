// Lokaler Server: liefert das Spiel ohne Browser-Caching aus (ES-Module werden sonst veraltet geladen)
// und stellt unter /ws die WebSocket-Schnittstelle für Online-Spiele bereit.
// Start: node serve.js [port] – auf Hosting-Plattformen (z. B. Render) kommt der Port aus $PORT.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './server/websocket.js';
import { attachClient } from './server/games.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || Number(process.argv[2]) || 8123;
const host = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function origin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() === 'https' ? 'https' : 'http';
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`).split(',')[0].trim();
  return `${proto}://${/^[\w.:\[\]-]+$/.test(hostHeader) ? hostHeader : `localhost:${port}`}`;
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.join(root, urlPath);
  // Nur Dateien innerhalb des Projektordners ausliefern
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let data = await fs.readFile(file);
    // Vorschau-Tags (Open Graph) brauchen absolute Adressen: aus dem Aufruf übernehmen (Render setzt X-Forwarded-Proto)
    if (path.extname(file) === '.html') data = data.toString().replaceAll('__ORIGIN__', origin(req));
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
  }
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/ws') { socket.destroy(); return; }
  const ws = acceptUpgrade(req, socket);
  if (ws) attachClient(ws);
});

server.listen(port, host, () => console.log(`Pot Black läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
