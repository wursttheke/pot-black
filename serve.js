// Lokaler Entwicklungsserver: liefert das Spiel ohne Browser-Caching aus (ES-Module werden sonst veraltet
// geladen; per file:// laden Browser sie gar nicht). Online läuft das Spiel als statische Seite.
// Start: npm start bzw. node serve.js [port]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  '.wav': 'audio/wav',
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

server.listen(port, host, () => console.log(`Pot Black läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
