// Lokaler Server: liefert das Spiel ohne Browser-Caching aus (ES-Module werden sonst veraltet geladen)
// und stellt unter /ws die WebSocket-Schnittstelle für Online-Spiele bereit.
// Start: node serve.js [port]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './server/websocket.js';
import { attachClient } from './server/games.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 8123;

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
    const data = await fs.readFile(file);
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

server.listen(port, () => console.log(`Pot Black läuft auf http://localhost:${port}`));
