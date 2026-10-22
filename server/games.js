// Lobby und Online-Spiele. Der Server ist nur Vermittler: Er verwaltet Spiele, Spieler und
// Zuschauer, leitet Spielnachrichten weiter und merkt sich den letzten Spielstand für neue Zuschauer.
// Den verbindlichen Spielstand liefert jeweils der stoßende Spieler.
import crypto from 'node:crypto';

const RELAY = new Set(['aim', 'shot', 'result', 'decision', 'newFrame', 'state']);
const clients = new Set();
const games = new Map();

const cleanName = n => String(n || '').trim().slice(0, 20) || 'Spieler';

function lobbyList() {
  return [...games.values()].map(g => ({
    id: g.id,
    status: g.players.length < 2 ? 'open' : 'playing',
    players: g.players.map(p => p.name),
    watchers: g.watchers.size,
  }));
}

function broadcastLobby() {
  const msg = { type: 'lobby', games: lobbyList() };
  for (const c of clients) c.ws.send(msg);
}

function members(g) {
  return [...g.players.map(p => p.client), ...g.watchers];
}

function leave(client) {
  const g = games.get(client.gameId);
  client.gameId = null;
  if (!g) return;
  const seat = client.seat;
  client.seat = null;
  if (client.role === 'watcher') {
    g.watchers.delete(client);
  } else {
    g.players = g.players.filter(p => p.client !== client);
    // Ein Spieler geht: das Spiel endet für alle Übrigen
    for (const m of members(g)) {
      m.ws.send({ type: 'opponentLeft', seat, name: client.name });
      m.gameId = null; m.seat = null; m.role = null;
    }
    games.delete(g.id);
  }
  client.role = null;
  broadcastLobby();
}

function handle(client, msg) {
  switch (msg.type) {
    case 'hello':
      client.name = cleanName(msg.name);
      client.ws.send({ type: 'lobby', games: lobbyList() });
      break;
    case 'create': {
      if (client.gameId) leave(client);
      client.name = cleanName(msg.name || client.name);
      const g = { id: crypto.randomBytes(4).toString('hex'), players: [{ client, name: client.name }], watchers: new Set(), snapshot: null };
      games.set(g.id, g);
      Object.assign(client, { gameId: g.id, role: 'player', seat: 0 });
      client.ws.send({ type: 'created', gameId: g.id, seat: 0 });
      broadcastLobby();
      break;
    }
    case 'join': {
      const g = games.get(msg.gameId);
      if (!g || g.players.length >= 2) { client.ws.send({ type: 'error', message: 'Spiel ist nicht mehr verfügbar.' }); break; }
      if (client.gameId) leave(client);
      client.name = cleanName(msg.name || client.name);
      g.players.push({ client, name: client.name });
      Object.assign(client, { gameId: g.id, role: 'player', seat: 1 });
      const names = g.players.map(p => p.name);
      for (const p of g.players) p.client.ws.send({ type: 'start', gameId: g.id, seat: p.client.seat, names });
      for (const w of g.watchers) w.ws.send({ type: 'start', gameId: g.id, seat: null, names });
      broadcastLobby();
      break;
    }
    case 'watch': {
      const g = games.get(msg.gameId);
      if (!g) { client.ws.send({ type: 'error', message: 'Spiel ist nicht mehr verfügbar.' }); break; }
      if (client.gameId) leave(client);
      g.watchers.add(client);
      Object.assign(client, { gameId: g.id, role: 'watcher', seat: null });
      client.ws.send({ type: 'watching', gameId: g.id, names: g.players.map(p => p.name), started: g.players.length === 2, snapshot: g.snapshot });
      broadcastLobby();
      break;
    }
    case 'leave':
      leave(client);
      break;
    default:
      if (RELAY.has(msg.type) && client.role === 'player') {
        const g = games.get(client.gameId);
        if (!g) break;
        if ((msg.type === 'result' || msg.type === 'state') && msg.snapshot) g.snapshot = msg.snapshot;
        if (msg.type === 'newFrame') g.snapshot = null;
        const out = { ...msg, from: client.seat };
        for (const m of members(g)) if (m !== client) m.ws.send(out);
      }
  }
}

export function attachClient(ws) {
  const client = { ws, name: 'Spieler', gameId: null, role: null, seat: null };
  clients.add(client);
  ws.on('message', msg => { try { handle(client, msg); } catch (e) { console.error(e); } });
  ws.on('close', () => { leave(client); clients.delete(client); });
}
