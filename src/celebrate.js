// Feier-Animationen über dem Spiel: Konfetti, Feuerwerk und Banner in vier Steigerungsstufen.
// Stufe 1: 50er-Break, Stufe 2: Century, Stufe 3: Clearance, Stufe 4: Maximum (147).

const LEVELS = {
  1: { confetti: 160, cannons: 0, bursts: 0, duration: 3.5, palette: ['#f2c91a', '#ffffff', '#3fbf5a', '#e8b84a'] },
  2: { confetti: 380, cannons: 2, bursts: 4, duration: 5.5, palette: ['#ffd700', '#fff4c2', '#f2c91a', '#ffffff', '#e05a5a', '#3fbf5a'] },
  3: { confetti: 800, cannons: 6, bursts: 12, duration: 8, palette: ['#ffd700', '#ff4d6d', '#4dabff', '#7dff8a', '#ffffff', '#c77dff', '#ff9f1c'] },
  4: { confetti: 1400, cannons: 10, bursts: 34, duration: 13, palette: ['#ffd700', '#ffe98a', '#fff4c2', '#ffffff', '#ffb627', '#ff4d6d', '#4dabff', '#7dff8a'] },
};

// Kugelfarben für den Regen beim Maximum: viele Rote, dazu alle Farben
const BALL_COLOURS = ['#c0101c', '#c0101c', '#c0101c', '#c0101c', '#c0101c', '#f2c91a', '#138a3e', '#7a3d1c', '#1d4fd0', '#f27aa6', '#151515'];
const COUNT_MS = 2400; // Hochzählen bis 147, dann der große Knall

// Welche Feier steht nach einem Stoß an? Clearance = Frame in einer Aufnahme beendet, die mit
// mindestens allen sechs Farben auf dem Tisch begann. Liefert null oder { level, title, subtitle }.
export function celebrationFor(out, prevBreak, visitStart, name) {
  if (out.foul || !out.points) return null;
  const brk = prevBreak + out.points;
  if (out.frameOver && visitStart >= 6) {
    if (brk >= 147) return { level: 4, title: 'Maximum!', subtitle: `${name} spielt das perfekte Frame · Break ${brk}`, points: brk };
    return { level: 3, title: 'Clearance!', subtitle: `${name} räumt den Tisch ab · Break ${brk}` };
  }
  if (prevBreak < 100 && brk >= 100) return { level: 2, title: 'Century Break!', subtitle: `${name} · Break ${brk}` };
  if (prevBreak < 50 && brk >= 50) return { level: 1, title: '50er-Break!', subtitle: `${name} · Break ${brk}` };
  return null;
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export class Celebration {
  constructor(sfx) {
    this.sfx = sfx;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fx';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.banner = document.createElement('div');
    this.banner.id = 'celebrate';
    document.body.appendChild(this.banner);
    this.flash = document.createElement('div');
    this.flash.id = 'fxFlash';
    document.body.appendChild(this.flash);
    this.parts = [];
    this.sparks = [];
    this.rings = [];
    this.balls = [];
    this.max = null; // laufende Maximum-Show: { t0, points, slam }
    this.timers = [];
    this.running = false;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = innerWidth * this.dpr;
    this.canvas.height = innerHeight * this.dpr;
  }

  play(level, title, subtitle, points = 147) {
    const cfg = LEVELS[level];
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (level === 4) { this.playMaximum(cfg, title, subtitle, points); return; }
    const W = innerWidth, H = innerHeight;

    // Konfettiregen von oben, über eine Sekunde verteilt
    for (let i = 0; i < cfg.confetti; i++) {
      this.later(rand(0, 1000 + level * 400), () => this.parts.push(this.confetto(rand(0, W), rand(-60, -10), rand(-60, 60), rand(40, 160), cfg)));
    }
    // Konfettikanonen aus den unteren Ecken
    for (let c = 0; c < cfg.cannons; c++) {
      this.later(c * 450, () => {
        for (const side of [0, 1]) {
          for (let i = 0; i < 70; i++) {
            const a = side ? rand(-2.6, -2.0) : rand(-1.15, -0.55);
            const v = rand(550, 1000);
            this.parts.push(this.confetto(side ? W + 10 : -10, H * 0.9, Math.cos(a) * v, Math.sin(a) * v, cfg));
          }
        }
      });
    }
    // Feuerwerk
    for (let b = 0; b < cfg.bursts; b++) {
      this.later(300 + b * (level === 3 ? 450 : 650), () => this.burst(rand(W * 0.15, W * 0.85), rand(H * 0.12, H * 0.45), cfg, level));
    }

    this.banner.className = `lvl${level}`;
    this.banner.innerHTML = `<h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}`;
    void this.banner.offsetWidth; // Animation neu starten
    this.banner.classList.add('show');
    this.later(cfg.duration * 1000, () => this.banner.classList.remove('show'));
    this.sfx?.fanfare(level);

    this.start();
  }

  // Maximum: Szene abdunkeln, Trommelwirbel und Zähler bis 147, dann Knall mit Blitz, Beben und
  // Schockwellen, Kugelregen, Feuerwerk in Wellen und ein großes Finale
  playMaximum(cfg, title, subtitle, points) {
    const W = innerWidth, H = innerHeight;
    this.max = { t0: performance.now(), points, slam: false, dim: 0, end: performance.now() + cfg.duration * 1000 };
    this.banner.className = 'lvl4 counting';
    this.banner.innerHTML = `<div class="num">0</div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}`;
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.sfx?.maximum(COUNT_MS / 1000);

    this.later(COUNT_MS, () => {
      this.max.slam = true;
      this.banner.classList.remove('counting');
      this.banner.classList.add('slam');
      this.flashScreen();
      this.shake();
      const cx = W / 2, cy = H * 0.3;
      for (let i = 0; i < 3; i++) this.later(i * 140, () => this.rings.push({ x: cx, y: cy, r: 20, v: 900 + i * 250, w: 14 - i * 3, age: 0, life: 1.3 }));
      for (let i = 0; i < 12; i++) this.burst(cx + rand(-60, 60), cy + rand(-40, 40), cfg, 5);
      // Konfettikanonen aus allen vier Ecken, mehrere Salven
      for (let c = 0; c < cfg.cannons; c++) {
        this.later(c * 380, () => {
          for (const [x, y, a0, a1] of [[-10, H * 0.92, -1.2, -0.5], [W + 10, H * 0.92, -2.65, -1.95], [-10, H * 0.15, -0.3, 0.5], [W + 10, H * 0.15, 2.65, 3.45]]) {
            for (let i = 0; i < 45; i++) {
              const a = rand(a0, a1), v = rand(600, 1150);
              this.parts.push(this.confetto(x, y, Math.cos(a) * v, Math.sin(a) * v, cfg));
            }
          }
        });
      }
      // Dauerregen aus Konfetti und Snooker-Kugeln
      for (let i = 0; i < cfg.confetti; i++) {
        this.later(rand(0, 6500), () => this.parts.push(this.confetto(rand(0, W), rand(-60, -10), rand(-60, 60), rand(40, 180), cfg)));
      }
      for (let i = 0; i < 147; i++) {
        this.later(rand(200, 7000), () => this.balls.push({ x: rand(0, W), y: rand(-80, -20), vx: rand(-40, 40), vy: rand(60, 220), r: rand(9, 17), color: pick(BALL_COLOURS), bounced: 0 }));
      }
      // Feuerwerk in Wellen, immer dichter
      for (let b = 0; b < cfg.bursts; b++) {
        const t = 500 + b * (b < 20 ? 260 : 170);
        this.later(t, () => {
          this.burst(rand(W * 0.08, W * 0.92), rand(H * 0.08, H * 0.5), cfg, 4);
        });
      }
      // Finale: alles auf einmal
      this.later(8200, () => {
        this.flashScreen(0.55);
        this.shake();
        this.sfx?.crash(0.8);
        for (let i = 0; i < 10; i++) this.burst(W * (0.08 + i * 0.093), H * rand(0.12, 0.42), cfg, 6);
        this.rings.push({ x: W / 2, y: H * 0.3, r: 20, v: 1400, w: 10, age: 0, life: 1.4 });
      });
    });
    this.later(cfg.duration * 1000, () => this.banner.classList.remove('show'));
    this.later(cfg.duration * 1000 + 800, () => { this.max = null; });
    this.start();
  }

  flashScreen(strength = 0.9) {
    this.flash.style.setProperty('--flash', strength);
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
  }

  shake() {
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.remove('shake');
    void app.offsetWidth;
    app.classList.add('shake');
    this.later(700, () => app.classList.remove('shake'));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
  }

  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  confetto(x, y, vx, vy, cfg) {
    return {
      x, y, vx, vy, w: rand(6, 11), h: rand(10, 18), rot: rand(0, Math.PI * 2), vr: rand(-8, 8),
      flip: rand(0, Math.PI * 2), vf: rand(4, 10), sway: rand(0.5, 1.5), color: pick(cfg.palette),
    };
  }

  burst(x, y, cfg, level) {
    const n = 60 + level * 30;
    const color = pick(cfg.palette);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
      const v = rand(120, 320 + level * 40);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.9, 1.6), age: 0, color: Math.random() < 0.25 ? '#ffffff' : color });
    }
  }

  // Hintergrund der Maximum-Show: abgedunkelte Szene, rotierender Strahlenkranz, Zähler bis 147
  drawMaximum(c, now, dt) {
    const m = this.max, W = innerWidth, H = innerHeight;
    const t = now - m.t0;
    const fadingOut = now > m.end;
    m.dim += ((fadingOut ? 0 : 1) - m.dim) * Math.min(1, dt * (fadingOut ? 3 : 2.5));
    const cx = W / 2, cy = H * 0.3;
    const vg = c.createRadialGradient(cx, cy, Math.min(W, H) * 0.1, cx, cy, Math.max(W, H) * 0.8);
    vg.addColorStop(0, `rgba(0,0,0,${0.35 * m.dim})`);
    vg.addColorStop(1, `rgba(0,0,0,${0.8 * m.dim})`);
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
    // Strahlenkranz: wächst beim Zählen, nach dem Knall voll und golden
    const grow = m.slam ? 1 : Math.min(1, t / COUNT_MS);
    const len = Math.max(W, H) * (0.25 + 0.75 * grow), rays = 24;
    c.save();
    c.translate(cx, cy);
    c.rotate(t / 1000 * (m.slam ? 0.35 : 0.15));
    c.globalCompositeOperation = 'lighter';
    const rg = c.createRadialGradient(0, 0, 0, 0, 0, len);
    rg.addColorStop(0, `rgba(255,215,90,${(m.slam ? 0.42 : 0.22) * m.dim})`);
    rg.addColorStop(1, 'rgba(255,215,90,0)');
    c.fillStyle = rg;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, len, a, a + Math.PI / rays * 0.9);
      c.closePath();
      c.fill();
    }
    c.restore();
    c.globalCompositeOperation = 'source-over';
    // Zähler: beschleunigt hoch bis zum Break
    if (!m.slam) {
      const f = Math.min(1, t / COUNT_MS);
      const n = Math.round(m.points * f * f);
      const el = this.banner.querySelector('.num');
      if (el && el.textContent !== String(n)) el.textContent = n;
    } else {
      const el = this.banner.querySelector('.num');
      if (el && el.textContent !== String(m.points)) el.textContent = m.points;
      // Goldener Glitzer rund um den Schriftzug
      if (!fadingOut && Math.random() < 0.6) {
        this.sparks.push({ x: cx + rand(-W * 0.3, W * 0.3), y: cy + rand(-H * 0.12, H * 0.16), vx: rand(-20, 20), vy: rand(-40, 10), life: rand(0.5, 1.1), age: 0, color: Math.random() < 0.5 ? '#ffffff' : '#ffd700' });
      }
    }
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const c = this.ctx, H = innerHeight;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, innerWidth, H);
    if (this.max) this.drawMaximum(c, now, dt);

    for (const p of this.parts) {
      p.vy += 520 * dt;
      p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.1 * dt;
      p.x += (p.vx + Math.sin(p.flip) * 30 * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt; p.flip += p.vf * dt;
      c.save();
      c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, Math.cos(p.flip));
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    this.parts = this.parts.filter(p => p.y < H + 40);

    c.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      s.age += dt;
      s.vy += 160 * dt;
      s.vx *= 1 - 1.2 * dt; s.vy *= 1 - 1.2 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const a = Math.max(0, 1 - s.age / s.life);
      c.globalAlpha = a;
      c.fillStyle = s.color;
      c.beginPath(); c.arc(s.x, s.y, 2.2 + a * 1.5, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    this.sparks = this.sparks.filter(s => s.age < s.life);

    // Schockwellen
    for (const r of this.rings) {
      r.age += dt;
      r.r += r.v * dt;
      r.v *= 1 - 1.4 * dt;
      const a = Math.max(0, 1 - r.age / r.life);
      c.globalAlpha = a;
      c.strokeStyle = '#ffe27a';
      c.lineWidth = r.w * a + 1;
      c.beginPath(); c.arc(r.x, r.y, r.r, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
    this.rings = this.rings.filter(r => r.age < r.life);

    // Regen aus Snooker-Kugeln, die am unteren Rand noch einmal aufspringen
    for (const b of this.balls) {
      b.vy += 700 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y > H - b.r && b.bounced < 1) { b.y = H - b.r; b.vy *= -0.45; b.bounced++; }
      const g = c.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, b.color); g.addColorStop(1, '#000000');
      c.fillStyle = g;
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
    }
    this.balls = this.balls.filter(b => b.y < H + 40);

    if (this.parts.length || this.sparks.length || this.rings.length || this.balls.length || this.max || this.banner.classList.contains('show')) {
      requestAnimationFrame(t => this.frame(t));
    } else {
      this.running = false;
      c.clearRect(0, 0, innerWidth, H);
    }
  }
}
