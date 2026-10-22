// WebSocket-Verbindung zum Spielserver mit automatischem Wiederverbinden (für die Lobby).
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.queue = [];
    this.name = 'Spieler';
    this.wanted = false;
    this.retry = 0;
  }

  on(type, fn) { this.handlers.set(type, fn); }

  get connected() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  connect(name) {
    this.name = name || this.name;
    this.wanted = true;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      if (this.connected) this.send({ type: 'hello', name: this.name });
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.emit('status', { state: 'connecting' });
    ws.onopen = () => {
      this.retry = 0;
      this.emit('status', { state: 'open' });
      ws.send(JSON.stringify({ type: 'hello', name: this.name }));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.emit(msg.type, msg);
    };
    ws.onclose = () => {
      this.emit('status', { state: 'closed' });
      if (this.wanted) setTimeout(() => this.wanted && this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
  }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  emit(type, msg) {
    const fn = this.handlers.get(type);
    if (fn) fn(msg);
  }
}
